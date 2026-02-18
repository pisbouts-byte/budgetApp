import { CountryCode, Products } from "plaid";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { env } from "../config/env.js";
import { db } from "../db/pool.js";
import { plaidClient } from "../plaid/client.js";
import {
  runIncrementalSyncForUser,
  upsertPlaidTransaction
} from "../plaid/incremental-sync.js";
import { decryptSecret, encryptSecret } from "../security/token-crypto.js";

export const plaidRouter = Router();
const exchangePublicTokenSchema = z.object({
  publicToken: z.string().min(1)
});
const syncTransactionsSchema = z.object({
  plaidItemId: z.string().uuid().optional(),
  days: z.number().int().min(1).max(730).default(90)
});
const syncIncrementalSchema = z.object({
  plaidItemId: z.string().uuid().optional()
});

function dateDaysAgo(days: number) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - days);
  return now.toISOString().slice(0, 10);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

plaidRouter.post(
  "/create-link-token",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const response = await plaidClient.linkTokenCreate({
        user: {
          client_user_id: userId
        },
        client_name: "Spending Tracker",
        products: [Products.Transactions],
        country_codes: [CountryCode.Us],
        language: "en",
        webhook: env.PLAID_WEBHOOK_URL
      });

      return res.status(201).json({
        linkToken: response.data.link_token,
        expiration: response.data.expiration
      });
    } catch {
      return res.status(502).json({ error: "Failed to create Plaid link token" });
    }
  }
);

plaidRouter.post(
  "/exchange-public-token",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = exchangePublicTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten()
      });
    }

    try {
      const exchange = await plaidClient.itemPublicTokenExchange({
        public_token: parsed.data.publicToken
      });
      const accessToken = exchange.data.access_token;
      const encryptedAccessToken = encryptSecret(accessToken);
      const plaidItemId = exchange.data.item_id;

      const accountsResponse = await plaidClient.accountsGet({
        access_token: accessToken
      });

      const client = await db.connect();
      try {
        await client.query("BEGIN");

        const itemResult = await client.query<{ id: string }>(
          `INSERT INTO plaid_item (
             user_id, plaid_item_id, access_token_encrypted, last_synced_at
           )
           VALUES ($1, $2, $3, now())
           ON CONFLICT (plaid_item_id)
           DO UPDATE SET
             user_id = EXCLUDED.user_id,
             access_token_encrypted = EXCLUDED.access_token_encrypted,
             last_synced_at = now()
           RETURNING id`,
          [userId, plaidItemId, encryptedAccessToken]
        );

        const item = itemResult.rows[0];
        if (!item) {
          throw new Error("Failed to persist Plaid item");
        }

        for (const account of accountsResponse.data.accounts) {
          await client.query(
            `INSERT INTO account (
               user_id,
               plaid_item_id,
               plaid_account_id,
               name,
               mask,
               subtype,
               type,
               current_balance,
               available_balance,
               currency_code,
               is_active
             )
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE)
             ON CONFLICT (plaid_account_id)
             DO UPDATE SET
               user_id = EXCLUDED.user_id,
               plaid_item_id = EXCLUDED.plaid_item_id,
               name = EXCLUDED.name,
               mask = EXCLUDED.mask,
               subtype = EXCLUDED.subtype,
               type = EXCLUDED.type,
               current_balance = EXCLUDED.current_balance,
               available_balance = EXCLUDED.available_balance,
               currency_code = EXCLUDED.currency_code,
               is_active = TRUE`,
            [
              userId,
              item.id,
              account.account_id,
              account.name,
              account.mask ?? null,
              account.subtype ?? null,
              account.type,
              account.balances.current ?? null,
              account.balances.available ?? null,
              account.balances.iso_currency_code ?? "USD"
            ]
          );
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      return res.status(201).json({
        itemId: plaidItemId,
        linkedAccounts: accountsResponse.data.accounts.length
      });
    } catch {
      return res
        .status(502)
        .json({ error: "Failed to exchange public token with Plaid" });
    }
  }
);

plaidRouter.post(
  "/transactions/sync",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = syncTransactionsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten()
      });
    }

    const whereClause = parsed.data.plaidItemId
      ? "WHERE user_id = $1 AND id = $2"
      : "WHERE user_id = $1";
    const params = parsed.data.plaidItemId
      ? [userId, parsed.data.plaidItemId]
      : [userId];

    try {
      const itemsResult = await db.query<{
        id: string;
        plaid_item_id: string;
        access_token_encrypted: string;
      }>(
        `SELECT id, plaid_item_id, access_token_encrypted
         FROM plaid_item
         ${whereClause}`,
        params
      );

      const items = itemsResult.rows;
      if (items.length === 0) {
        return res.status(404).json({ error: "No linked Plaid items found" });
      }

      let syncedTransactions = 0;
      const startDate = dateDaysAgo(parsed.data.days);
      const endDate = todayIsoDate();

      for (const item of items) {
        const accountRows = await db.query<{ id: string; plaid_account_id: string }>(
          `SELECT id, plaid_account_id
           FROM account
           WHERE user_id = $1 AND plaid_item_id = $2`,
          [userId, item.id]
        );

        const accountByPlaidId = new Map(
          accountRows.rows.map((row) => [row.plaid_account_id, row.id])
        );

        let totalTransactions = 0;
        let offset = 0;
        const count = 500;

        do {
          const plaidResponse = await plaidClient.transactionsGet({
            access_token: decryptSecret(item.access_token_encrypted),
            start_date: startDate,
            end_date: endDate,
            options: {
              count,
              offset
            }
          });

          const txs = plaidResponse.data.transactions;
          totalTransactions = plaidResponse.data.total_transactions;

          for (const tx of txs) {
            const accountId = accountByPlaidId.get(tx.account_id);
            if (!accountId) {
              continue;
            }

            await upsertPlaidTransaction({ userId, accountId, tx });
            syncedTransactions += 1;
          }

          offset += txs.length;
        } while (offset < totalTransactions);

        await db.query(
          `UPDATE plaid_item
           SET last_synced_at = now()
           WHERE id = $1`,
          [item.id]
        );
      }

      return res.status(200).json({
        syncedItems: items.length,
        syncedTransactions,
        startDate,
        endDate
      });
    } catch {
      return res.status(502).json({ error: "Failed to sync transactions" });
    }
  }
);

plaidRouter.post(
  "/transactions/sync-incremental",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = syncIncrementalSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten()
      });
    }

    try {
      const result = await runIncrementalSyncForUser({
        userId,
        plaidItemDbId: parsed.data.plaidItemId
      });
      return res.json(result);
    } catch (error) {
      if ((error as { name?: string }).name === "NoItemsError") {
        return res.status(404).json({ error: "No linked Plaid items found" });
      }
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to run incremental sync";
      return res.status(502).json({ error: message });
    }
  }
);
