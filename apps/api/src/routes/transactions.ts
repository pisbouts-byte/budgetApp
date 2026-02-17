import { Router } from "express";
import { z } from "zod";
import {
  confidenceForRule,
  findBestCategoryRuleForTransaction,
  findBestCategoryRuleFromList,
  listActiveCategoryRules
} from "../categorization/matcher.js";
import { buildLearnedRuleCandidate } from "../categorization/rules.js";
import { requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/pool.js";

const listTransactionsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  includeExcluded: z.enum(["true", "false"]).default("false"),
  search: z.string().trim().min(1).max(120).optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sortBy: z
    .enum(["transaction_date", "amount", "created_at", "merchant_name"])
    .default("transaction_date"),
  sortOrder: z.enum(["asc", "desc"]).default("desc")
});
const recategorizeSchema = z.object({
  categoryId: z.string().uuid().nullable(),
  createRule: z.boolean().default(false)
});
const bulkRecategorizeSchema = z.object({
  transactionIds: z.array(z.string().uuid()).min(1).max(500),
  categoryId: z.string().uuid().nullable(),
  createRule: z.boolean().default(false)
});
const setExclusionSchema = z.object({
  isExcluded: z.boolean()
});
const bulkSetExclusionSchema = z.object({
  transactionIds: z.array(z.string().uuid()).min(1).max(500),
  isExcluded: z.boolean()
});
const backfillRulesSchema = z.object({
  limit: z.number().int().min(1).max(2000).default(500),
  includeExcluded: z.boolean().default(false),
  dryRun: z.boolean().default(false)
});
const paramsSchema = z.object({
  transactionId: z.string().uuid()
});

export const transactionsRouter = Router();

transactionsRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = listTransactionsSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid query parameters",
      details: parsed.error.flatten()
    });
  }

  const query = parsed.data;
  const whereParts = ["t.user_id = $1"];
  const values: Array<string | number | boolean> = [userId];

  if (query.accountId) {
    values.push(query.accountId);
    whereParts.push(`t.account_id = $${values.length}`);
  }
  if (query.categoryId) {
    values.push(query.categoryId);
    whereParts.push(`t.category_id = $${values.length}`);
  }
  if (query.includeExcluded === "false") {
    whereParts.push("t.is_excluded = false");
  }
  if (query.search) {
    values.push(`%${query.search.toLowerCase()}%`);
    whereParts.push(
      `(LOWER(COALESCE(t.merchant_name, '')) LIKE $${values.length} OR LOWER(t.original_description) LIKE $${values.length})`
    );
  }
  if (query.dateFrom) {
    values.push(query.dateFrom);
    whereParts.push(`t.transaction_date >= $${values.length}::date`);
  }
  if (query.dateTo) {
    values.push(query.dateTo);
    whereParts.push(`t.transaction_date <= $${values.length}::date`);
  }

  const whereClause = whereParts.join(" AND ");
  const offset = (query.page - 1) * query.pageSize;
  const sortBy = query.sortBy;
  const sortOrder = query.sortOrder.toUpperCase();

  try {
    const totalResult = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM "transaction" t
       WHERE ${whereClause}`,
      values
    );
    const total = Number(totalResult.rows[0]?.count ?? 0);

    const listValues = [...values, query.pageSize, offset];
    const rows = await db.query<{
      id: string;
      account_id: string;
      amount: string;
      iso_currency_code: string;
      transaction_date: string;
      authorized_date: string | null;
      merchant_name: string | null;
      original_description: string;
      pending: boolean;
      is_excluded: boolean;
      category_id: string | null;
      category_source: string;
      category_confidence: string | null;
      created_at: string;
      updated_at: string;
      account_name: string;
      category_name: string | null;
    }>(
      `SELECT
         t.id,
         t.account_id,
         t.amount::text AS amount,
         t.iso_currency_code,
         t.transaction_date::text AS transaction_date,
         t.authorized_date::text AS authorized_date,
         t.merchant_name,
         t.original_description,
         t.pending,
         t.is_excluded,
         t.category_id,
         t.category_source,
         t.category_confidence::text AS category_confidence,
         t.created_at::text AS created_at,
         t.updated_at::text AS updated_at,
         a.name AS account_name,
         c.name AS category_name
       FROM "transaction" t
       JOIN account a ON a.id = t.account_id
       LEFT JOIN category c ON c.id = t.category_id
       WHERE ${whereClause}
       ORDER BY t.${sortBy} ${sortOrder}, t.id DESC
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      listValues
    );

    return res.json({
      data: rows.rows.map((row) => ({
        id: row.id,
        accountId: row.account_id,
        accountName: row.account_name,
        amount: row.amount,
        currencyCode: row.iso_currency_code,
        transactionDate: row.transaction_date,
        authorizedDate: row.authorized_date,
        merchantName: row.merchant_name,
        description: row.original_description,
        pending: row.pending,
        isExcluded: row.is_excluded,
        categoryId: row.category_id,
        categoryName: row.category_name,
        categorySource: row.category_source,
        categoryConfidence: row.category_confidence,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        sortBy,
        sortOrder: query.sortOrder
      }
    });
  } catch {
    return res.status(500).json({ error: "Failed to list transactions" });
  }
});

transactionsRouter.patch(
  "/:transactionId/category",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({
        error: "Invalid transaction id",
        details: params.error.flatten()
      });
    }

    const parsed = recategorizeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten()
      });
    }

    const transactionId = params.data.transactionId;
    const { categoryId, createRule } = parsed.data;

    try {
      const txResult = await db.query<{
        id: string;
        category_id: string | null;
        merchant_name: string | null;
        original_description: string;
        mcc: string | null;
        plaid_primary_category: string | null;
        plaid_detailed_category: string | null;
      }>(
        `SELECT
           id,
           category_id,
           merchant_name,
           original_description,
           mcc,
           plaid_primary_category,
           plaid_detailed_category
         FROM "transaction"
         WHERE id = $1 AND user_id = $2`,
        [transactionId, userId]
      );
      const tx = txResult.rows[0];
      if (!tx) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      if (categoryId) {
        const categoryResult = await db.query(
          `SELECT 1
           FROM category
           WHERE id = $1 AND user_id = $2`,
          [categoryId, userId]
        );
        if (categoryResult.rows.length === 0) {
          return res.status(400).json({ error: "Invalid category" });
        }
      }

      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE "transaction"
           SET category_id = $3,
               category_source = 'USER',
               category_confidence = NULL
           WHERE id = $1 AND user_id = $2`,
          [transactionId, userId, categoryId]
        );

        await client.query(
          `INSERT INTO category_change_event (
             user_id,
             transaction_id,
             old_category_id,
             new_category_id,
             create_rule
           )
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, transactionId, tx.category_id, categoryId, createRule]
        );

        if (createRule && categoryId) {
          const ruleCandidate = buildLearnedRuleCandidate({
            merchantName: tx.merchant_name,
            originalDescription: tx.original_description,
            mcc: tx.mcc,
            plaidDetailedCategory: tx.plaid_detailed_category,
            plaidPrimaryCategory: tx.plaid_primary_category
          });

          if (ruleCandidate) {
            await client.query(
              `INSERT INTO category_rule (
                 user_id,
                 category_id,
                 field,
                 operator,
                 pattern,
                 priority,
                 is_active,
                 learned_from_transaction_id,
                 created_by
               )
               SELECT $1, $2, $3, $4, $5, $6, TRUE, $7, 'USER'
               WHERE NOT EXISTS (
                 SELECT 1
                 FROM category_rule
                 WHERE user_id = $1
                   AND category_id = $2
                   AND field = $3
                   AND operator = $4
                   AND pattern = $5
                   AND is_active = TRUE
               )`,
              [
                userId,
                categoryId,
                ruleCandidate.field,
                ruleCandidate.operator,
                ruleCandidate.pattern,
                ruleCandidate.priority,
                transactionId
              ]
            );
          }
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      return res.status(200).json({
        transactionId,
        categoryId,
        categorySource: "USER",
        createRule
      });
    } catch {
      return res.status(500).json({ error: "Failed to recategorize transaction" });
    }
  }
);

transactionsRouter.patch(
  "/category/bulk",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = bulkRecategorizeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten()
      });
    }

    const { transactionIds, categoryId, createRule } = parsed.data;
    const uniqueTransactionIds = [...new Set(transactionIds)];

    try {
      if (categoryId) {
        const categoryResult = await db.query(
          `SELECT 1
           FROM category
           WHERE id = $1 AND user_id = $2`,
          [categoryId, userId]
        );
        if (categoryResult.rows.length === 0) {
          return res.status(400).json({ error: "Invalid category" });
        }
      }

      const client = await db.connect();
      try {
        await client.query("BEGIN");

        const targetResult = await client.query<{
          id: string;
          old_category_id: string | null;
        }>(
          `SELECT id, category_id AS old_category_id
           FROM "transaction"
           WHERE user_id = $1
             AND id = ANY($2::uuid[])`,
          [userId, uniqueTransactionIds]
        );
        if (targetResult.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "No matching transactions found" });
        }

        await client.query(
          `UPDATE "transaction"
           SET category_id = $3,
               category_source = 'USER',
               category_confidence = NULL
           WHERE user_id = $1
             AND id = ANY($2::uuid[])`,
          [userId, uniqueTransactionIds, categoryId]
        );

        for (const tx of targetResult.rows) {
          await client.query(
            `INSERT INTO category_change_event (
               user_id,
               transaction_id,
               old_category_id,
               new_category_id,
               create_rule
             )
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, tx.id, tx.old_category_id, categoryId, createRule]
          );
        }

        await client.query("COMMIT");
        return res.status(200).json({
          updatedCount: targetResult.rows.length,
          categoryId,
          createRule
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch {
      return res.status(500).json({ error: "Failed to bulk recategorize" });
    }
  }
);

transactionsRouter.patch(
  "/:transactionId/exclusion",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({
        error: "Invalid transaction id",
        details: params.error.flatten()
      });
    }

    const parsed = setExclusionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten()
      });
    }

    const transactionId = params.data.transactionId;
    const { isExcluded } = parsed.data;

    try {
      const updated = await db.query<{ id: string; is_excluded: boolean }>(
        `UPDATE "transaction"
         SET is_excluded = $3
         WHERE id = $1
           AND user_id = $2
         RETURNING id, is_excluded`,
        [transactionId, userId, isExcluded]
      );
      const row = updated.rows[0];
      if (!row) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      return res.json({
        transactionId: row.id,
        isExcluded: row.is_excluded
      });
    } catch {
      return res.status(500).json({ error: "Failed to update exclusion state" });
    }
  }
);

transactionsRouter.patch(
  "/exclusion/bulk",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = bulkSetExclusionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten()
      });
    }

    const uniqueTransactionIds = [...new Set(parsed.data.transactionIds)];
    try {
      const updated = await db.query<{ id: string }>(
        `UPDATE "transaction"
         SET is_excluded = $3
         WHERE user_id = $1
           AND id = ANY($2::uuid[])
         RETURNING id`,
        [userId, uniqueTransactionIds, parsed.data.isExcluded]
      );
      if (updated.rows.length === 0) {
        return res.status(404).json({ error: "No matching transactions found" });
      }

      return res.json({
        updatedCount: updated.rows.length,
        isExcluded: parsed.data.isExcluded
      });
    } catch {
      return res.status(500).json({ error: "Failed to bulk update exclusion state" });
    }
  }
);

transactionsRouter.post(
  "/:transactionId/apply-category-rules",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({
        error: "Invalid transaction id",
        details: params.error.flatten()
      });
    }

    const transactionId = params.data.transactionId;

    try {
      const txResult = await db.query<{
        id: string;
        account_id: string;
        merchant_name: string | null;
        original_description: string;
        mcc: string | null;
        plaid_primary_category: string | null;
        plaid_detailed_category: string | null;
        account_name: string;
      }>(
        `SELECT
           t.id,
           t.account_id,
           t.merchant_name,
           t.original_description,
           t.mcc,
           t.plaid_primary_category,
           t.plaid_detailed_category,
           a.name AS account_name
         FROM "transaction" t
         JOIN account a ON a.id = t.account_id
         WHERE t.id = $1
           AND t.user_id = $2`,
        [transactionId, userId]
      );
      const tx = txResult.rows[0];
      if (!tx) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      const matchedRule = await findBestCategoryRuleForTransaction({
        userId,
        merchantName: tx.merchant_name,
        originalDescription: tx.original_description,
        accountName: tx.account_name,
        mcc: tx.mcc,
        plaidPrimaryCategory: tx.plaid_primary_category,
        plaidDetailedCategory: tx.plaid_detailed_category
      });

      if (!matchedRule) {
        return res.json({ matched: false });
      }

      await db.query(
        `UPDATE "transaction"
         SET category_id = $3,
             category_source = 'RULE',
             category_confidence = $4
         WHERE id = $1
           AND user_id = $2`,
        [
          transactionId,
          userId,
          matchedRule.category_id,
          confidenceForRule(matchedRule)
        ]
      );

      return res.json({
        matched: true,
        transactionId,
        ruleId: matchedRule.id,
        categoryId: matchedRule.category_id,
        priority: matchedRule.priority
      });
    } catch {
      return res.status(500).json({ error: "Failed to apply category rules" });
    }
  }
);

transactionsRouter.post(
  "/backfill-category-rules",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = backfillRulesSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten()
      });
    }

    const { limit, includeExcluded, dryRun } = parsed.data;
    const whereClause = includeExcluded
      ? "t.user_id = $1 AND t.category_id IS NULL"
      : "t.user_id = $1 AND t.category_id IS NULL AND t.is_excluded = FALSE";

    try {
      const candidateTxResult = await db.query<{
        id: string;
        merchant_name: string | null;
        original_description: string;
        mcc: string | null;
        plaid_primary_category: string | null;
        plaid_detailed_category: string | null;
        account_name: string;
      }>(
        `SELECT
           t.id,
           t.merchant_name,
           t.original_description,
           t.mcc,
           t.plaid_primary_category,
           t.plaid_detailed_category,
           a.name AS account_name
         FROM "transaction" t
         JOIN account a ON a.id = t.account_id
         WHERE ${whereClause}
         ORDER BY t.transaction_date DESC, t.id DESC
         LIMIT $2`,
        [userId, limit]
      );

      const rules = await listActiveCategoryRules(userId);
      let matchedCount = 0;
      let updatedCount = 0;

      for (const tx of candidateTxResult.rows) {
        const matchedRule = findBestCategoryRuleFromList(rules, {
          userId,
          merchantName: tx.merchant_name,
          originalDescription: tx.original_description,
          accountName: tx.account_name,
          mcc: tx.mcc,
          plaidPrimaryCategory: tx.plaid_primary_category,
          plaidDetailedCategory: tx.plaid_detailed_category
        });
        if (!matchedRule) {
          continue;
        }

        matchedCount += 1;
        if (dryRun) {
          continue;
        }

        const update = await db.query(
          `UPDATE "transaction"
           SET category_id = $3,
               category_source = 'RULE',
               category_confidence = $4
           WHERE id = $1
             AND user_id = $2
             AND category_id IS NULL`,
          [tx.id, userId, matchedRule.category_id, confidenceForRule(matchedRule)]
        );
        updatedCount += update.rowCount ?? 0;
      }

      return res.json({
        scanned: candidateTxResult.rows.length,
        matched: matchedCount,
        updated: updatedCount,
        dryRun
      });
    } catch {
      return res.status(500).json({ error: "Failed to backfill category rules" });
    }
  }
);
