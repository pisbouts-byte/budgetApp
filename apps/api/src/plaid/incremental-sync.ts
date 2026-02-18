import { db } from "../db/pool.js";
import { decryptSecret } from "../security/token-crypto.js";
import { plaidClient } from "./client.js";

interface SyncTransaction {
  transaction_id: string;
  amount: number;
  iso_currency_code: string | null;
  date: string;
  authorized_date?: string | null;
  merchant_name?: string | null;
  name: string;
  mcc?: string | null;
  pending: boolean;
  personal_finance_category?: {
    primary?: string | null;
    detailed?: string | null;
  } | null;
}

function plaidErrorCode(error: unknown) {
  const code = (error as { response?: { data?: { error_code?: unknown } } })?.response
    ?.data?.error_code;
  return typeof code === "string" ? code : null;
}

function plaidErrorMessage(error: unknown) {
  const message = (error as { response?: { data?: { error_message?: unknown } } })?.response
    ?.data?.error_message;
  if (typeof message === "string" && message.trim()) {
    return message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Unknown Plaid sync error";
}

function plaidCategoryLabel(tx: SyncTransaction) {
  const detailed = tx.personal_finance_category?.detailed?.trim();
  const primary = tx.personal_finance_category?.primary?.trim();
  const raw = detailed || primary;
  if (!raw) {
    return null;
  }

  return raw
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function ensureSystemCategoryIdForPlaidTransaction(params: {
  userId: string;
  tx: SyncTransaction;
}) {
  const label = plaidCategoryLabel(params.tx);
  if (!label) {
    return null;
  }

  const category = await db.query<{ id: string }>(
    `INSERT INTO category (user_id, name, is_system, sort_order)
     VALUES ($1, $2, TRUE, 0)
     ON CONFLICT (user_id, name)
     DO UPDATE SET is_system = TRUE
     RETURNING id`,
    [params.userId, label]
  );

  return category.rows[0]?.id ?? null;
}

async function upsertPlaidTransaction(params: {
  userId: string;
  accountId: string;
  tx: SyncTransaction;
}) {
  const { userId, accountId, tx } = params;
  const categoryId = await ensureSystemCategoryIdForPlaidTransaction({ userId, tx });

  await db.query(
    `INSERT INTO "transaction" (
       user_id,
       account_id,
       source,
       external_id,
       amount,
       iso_currency_code,
       transaction_date,
       authorized_date,
       merchant_name,
       original_description,
       mcc,
       pending,
       is_excluded,
       category_id,
       category_source,
       category_confidence,
       plaid_primary_category,
       plaid_detailed_category,
       raw_payload
     )
     VALUES (
       $1,$2,'PLAID',$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE,$12,'SYSTEM',NULL,$13,$14,$15::jsonb
     )
     ON CONFLICT (source, external_id)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       account_id = EXCLUDED.account_id,
       amount = EXCLUDED.amount,
       iso_currency_code = EXCLUDED.iso_currency_code,
       transaction_date = EXCLUDED.transaction_date,
       authorized_date = EXCLUDED.authorized_date,
       merchant_name = EXCLUDED.merchant_name,
       original_description = EXCLUDED.original_description,
       mcc = EXCLUDED.mcc,
       pending = EXCLUDED.pending,
       category_id = CASE
         WHEN "transaction".category_source = 'USER' THEN "transaction".category_id
         WHEN "transaction".category_source = 'RULE' THEN "transaction".category_id
         ELSE EXCLUDED.category_id
       END,
       category_source = CASE
         WHEN "transaction".category_source = 'USER' THEN "transaction".category_source
         WHEN "transaction".category_source = 'RULE' THEN "transaction".category_source
         ELSE 'SYSTEM'
       END,
       category_confidence = CASE
         WHEN "transaction".category_source = 'USER' THEN "transaction".category_confidence
         WHEN "transaction".category_source = 'RULE' THEN "transaction".category_confidence
         ELSE NULL
       END,
       plaid_primary_category = EXCLUDED.plaid_primary_category,
       plaid_detailed_category = EXCLUDED.plaid_detailed_category,
       raw_payload = EXCLUDED.raw_payload`,
    [
      userId,
      accountId,
      tx.transaction_id,
      tx.amount,
      tx.iso_currency_code ?? "USD",
      tx.date,
      tx.authorized_date ?? null,
      tx.merchant_name ?? null,
      tx.name,
      tx.mcc ?? null,
      tx.pending,
      categoryId,
      tx.personal_finance_category?.primary ?? null,
      tx.personal_finance_category?.detailed ?? null,
      JSON.stringify(tx)
    ]
  );
}

export async function runIncrementalSyncForUser(params: {
  userId: string;
  plaidItemDbId?: string;
}) {
  const { userId, plaidItemDbId } = params;

  const whereClause = plaidItemDbId
    ? "WHERE user_id = $1 AND id = $2"
    : "WHERE user_id = $1";
  const queryParams = plaidItemDbId ? [userId, plaidItemDbId] : [userId];

  const itemsResult = await db.query<{
    id: string;
    access_token_encrypted: string;
    plaid_cursor: string | null;
  }>(
    `SELECT id, access_token_encrypted, plaid_cursor
     FROM plaid_item
     ${whereClause}`,
    queryParams
  );

  const items = itemsResult.rows;
  if (items.length === 0) {
    const error = new Error("NO_ITEMS");
    error.name = "NoItemsError";
    throw error;
  }

  let totalAdded = 0;
  let totalModified = 0;
  let totalRemoved = 0;

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

    let cursor = item.plaid_cursor ?? undefined;
    let hasMore = true;

    while (hasMore) {
      let syncResponse;
      try {
        syncResponse = await plaidClient.transactionsSync({
          access_token: decryptSecret(item.access_token_encrypted),
          cursor
        });
      } catch (error) {
        // Cursor drift can occur in production; reset once and retry from scratch.
        if (cursor) {
          cursor = undefined;
          await db.query(
            `UPDATE plaid_item
             SET plaid_cursor = NULL
             WHERE id = $1`,
            [item.id]
          );
          syncResponse = await plaidClient.transactionsSync({
            access_token: decryptSecret(item.access_token_encrypted),
            cursor
          });
        } else {
          const details = `${plaidErrorCode(error) ?? "PLAID_ERROR"}: ${plaidErrorMessage(error)}`;
          throw new Error(details);
        }
      }

      for (const tx of syncResponse.data.added) {
        const accountId = accountByPlaidId.get(tx.account_id);
        if (!accountId) {
          continue;
        }
        await upsertPlaidTransaction({ userId, accountId, tx });
        totalAdded += 1;
      }

      for (const tx of syncResponse.data.modified) {
        const accountId = accountByPlaidId.get(tx.account_id);
        if (!accountId) {
          continue;
        }
        await upsertPlaidTransaction({ userId, accountId, tx });
        totalModified += 1;
      }

      for (const tx of syncResponse.data.removed) {
        await db.query(
          `DELETE FROM "transaction"
           WHERE user_id = $1
             AND source = 'PLAID'
             AND external_id = $2`,
          [userId, tx.transaction_id]
        );
        totalRemoved += 1;
      }

      cursor = syncResponse.data.next_cursor;
      hasMore = syncResponse.data.has_more;
    }

    await db.query(
      `UPDATE plaid_item
       SET plaid_cursor = $2,
           last_synced_at = now()
       WHERE id = $1`,
      [item.id, cursor ?? null]
    );
  }

  return {
    syncedItems: items.length,
    added: totalAdded,
    modified: totalModified,
    removed: totalRemoved
  };
}

export async function runIncrementalSyncForPlaidItemId(plaidItemId: string) {
  const itemResult = await db.query<{ id: string; user_id: string }>(
    `SELECT id, user_id
     FROM plaid_item
     WHERE plaid_item_id = $1`,
    [plaidItemId]
  );

  const item = itemResult.rows[0];
  if (!item) {
    return null;
  }

  return runIncrementalSyncForUser({
    userId: item.user_id,
    plaidItemDbId: item.id
  });
}

export { plaidCategoryLabel, upsertPlaidTransaction };
