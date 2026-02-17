import { Router } from "express";
import { z } from "zod";
import { getBudgetPeriodWindow } from "../budgets/period.js";
import { requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/pool.js";

const reportsQuerySchema = z.object({
  categoryIds: z.array(z.string().uuid()).optional(),
  accountIds: z.array(z.string().uuid()).optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  includeExcluded: z.boolean().default(false),
  groupBy: z.enum(["none", "category", "day", "merchant"]).default("none"),
  limit: z.number().int().min(1).max(5000).default(1000)
});
const summaryQuerySchema = z.object({
  categoryIds: z.array(z.string().uuid()).optional(),
  accountIds: z.array(z.string().uuid()).optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  includeExcluded: z.boolean().default(false),
  limit: z.number().int().min(1).max(5000).default(1000)
});
const trendQuerySchema = summaryQuerySchema.extend({
  interval: z.enum(["day", "week", "month"]).default("week")
});
const budgetVarianceSchema = z.object({
  includeInactive: z.boolean().default(false),
  referenceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
});
const reportPresetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  filters: z.record(z.any())
});
const reportPresetUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    filters: z.record(z.any()).optional()
  })
  .refine((payload) => payload.name !== undefined || payload.filters !== undefined, {
    message: "At least one field must be provided"
  });
const presetParamsSchema = z.object({
  presetId: z.string().uuid()
});

export const reportsRouter = Router();

function buildWhereClause(params: {
  userId: string;
  categoryIds?: string[];
  accountIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  includeExcluded: boolean;
}) {
  const where: string[] = ["t.user_id = $1"];
  const values: Array<string | string[] | number> = [params.userId];

  if (!params.includeExcluded) {
    where.push("t.is_excluded = FALSE");
  }
  if (params.categoryIds && params.categoryIds.length > 0) {
    values.push(params.categoryIds);
    where.push(`t.category_id = ANY($${values.length}::uuid[])`);
  }
  if (params.accountIds && params.accountIds.length > 0) {
    values.push(params.accountIds);
    where.push(`t.account_id = ANY($${values.length}::uuid[])`);
  }
  if (params.dateFrom) {
    values.push(params.dateFrom);
    where.push(`t.transaction_date >= $${values.length}::date`);
  }
  if (params.dateTo) {
    values.push(params.dateTo);
    where.push(`t.transaction_date <= $${values.length}::date`);
  }

  return {
    whereClause: where.join(" AND "),
    values
  };
}

function csvEscape(value: string | number | boolean | null | undefined) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

reportsRouter.post("/query", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = reportsQuerySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid report query",
      details: parsed.error.flatten()
    });
  }

  const query = parsed.data;
  if (query.dateFrom && query.dateTo && query.dateTo < query.dateFrom) {
    return res.status(400).json({ error: "dateTo cannot be before dateFrom" });
  }

  const { whereClause, values } = buildWhereClause({
    userId,
    includeExcluded: query.includeExcluded,
    categoryIds: query.categoryIds,
    accountIds: query.accountIds,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo
  });

  try {
    const totals = await db.query<{ spent: string; income: string; net: string }>(
      `SELECT
         COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0)::text AS spent,
         COALESCE(SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END), 0)::text AS income,
         COALESCE(SUM(t.amount), 0)::text AS net
       FROM "transaction" t
       WHERE ${whereClause}`,
      values
    );

    let data: unknown[] = [];

    if (query.groupBy === "category") {
      const grouped = await db.query<{
        category_id: string | null;
        category_name: string | null;
        transaction_count: string;
        spent: string;
        income: string;
        net: string;
      }>(
        `SELECT
           t.category_id,
           c.name AS category_name,
           COUNT(*)::text AS transaction_count,
           COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0)::text AS spent,
           COALESCE(SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END), 0)::text AS income,
           COALESCE(SUM(t.amount), 0)::text AS net
         FROM "transaction" t
         LEFT JOIN category c ON c.id = t.category_id
         WHERE ${whereClause}
         GROUP BY t.category_id, c.name
         ORDER BY spent::numeric DESC
         LIMIT $${values.length + 1}`,
        [...values, query.limit]
      );
      data = grouped.rows;
    } else if (query.groupBy === "day") {
      const grouped = await db.query<{
        day: string;
        transaction_count: string;
        spent: string;
        income: string;
        net: string;
      }>(
        `SELECT
           t.transaction_date::text AS day,
           COUNT(*)::text AS transaction_count,
           COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0)::text AS spent,
           COALESCE(SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END), 0)::text AS income,
           COALESCE(SUM(t.amount), 0)::text AS net
         FROM "transaction" t
         WHERE ${whereClause}
         GROUP BY t.transaction_date
         ORDER BY t.transaction_date DESC
         LIMIT $${values.length + 1}`,
        [...values, query.limit]
      );
      data = grouped.rows;
    } else if (query.groupBy === "merchant") {
      const grouped = await db.query<{
        merchant_name: string | null;
        transaction_count: string;
        spent: string;
        income: string;
        net: string;
      }>(
        `SELECT
           COALESCE(t.merchant_name, '(unknown)') AS merchant_name,
           COUNT(*)::text AS transaction_count,
           COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0)::text AS spent,
           COALESCE(SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END), 0)::text AS income,
           COALESCE(SUM(t.amount), 0)::text AS net
         FROM "transaction" t
         WHERE ${whereClause}
         GROUP BY COALESCE(t.merchant_name, '(unknown)')
         ORDER BY spent::numeric DESC
         LIMIT $${values.length + 1}`,
        [...values, query.limit]
      );
      data = grouped.rows;
    } else {
      const rows = await db.query<{
        id: string;
        transaction_date: string;
        merchant_name: string | null;
        original_description: string;
        amount: string;
        is_excluded: boolean;
        account_name: string;
        category_name: string | null;
      }>(
        `SELECT
           t.id,
           t.transaction_date::text AS transaction_date,
           t.merchant_name,
           t.original_description,
           t.amount::text AS amount,
           t.is_excluded,
           a.name AS account_name,
           c.name AS category_name
         FROM "transaction" t
         JOIN account a ON a.id = t.account_id
         LEFT JOIN category c ON c.id = t.category_id
         WHERE ${whereClause}
         ORDER BY t.transaction_date DESC, t.id DESC
         LIMIT $${values.length + 1}`,
        [...values, query.limit]
      );
      data = rows.rows;
    }

    return res.json({
      meta: {
        groupBy: query.groupBy,
        includeExcluded: query.includeExcluded,
        dateFrom: query.dateFrom ?? null,
        dateTo: query.dateTo ?? null,
        limit: query.limit
      },
      totals: totals.rows[0] ?? { spent: "0", income: "0", net: "0" },
      data
    });
  } catch {
    return res.status(500).json({ error: "Failed to run report query" });
  }
});

reportsRouter.post("/export-csv", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = reportsQuerySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid report query",
      details: parsed.error.flatten()
    });
  }

  const query = parsed.data;
  if (query.dateFrom && query.dateTo && query.dateTo < query.dateFrom) {
    return res.status(400).json({ error: "dateTo cannot be before dateFrom" });
  }

  const { whereClause, values } = buildWhereClause({
    userId,
    includeExcluded: query.includeExcluded,
    categoryIds: query.categoryIds,
    accountIds: query.accountIds,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo
  });

  try {
    let headers: string[] = [];
    let rows: Array<Record<string, string | number | boolean | null>> = [];

    if (query.groupBy === "category") {
      const grouped = await db.query<{
        category_id: string | null;
        category_name: string | null;
        transaction_count: string;
        spent: string;
        income: string;
        net: string;
      }>(
        `SELECT
           t.category_id,
           COALESCE(c.name, '(uncategorized)') AS category_name,
           COUNT(*)::text AS transaction_count,
           COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0)::text AS spent,
           COALESCE(SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END), 0)::text AS income,
           COALESCE(SUM(t.amount), 0)::text AS net
         FROM "transaction" t
         LEFT JOIN category c ON c.id = t.category_id
         WHERE ${whereClause}
         GROUP BY t.category_id, c.name
         ORDER BY spent::numeric DESC
         LIMIT $${values.length + 1}`,
        [...values, query.limit]
      );
      headers = ["category_id", "category_name", "transaction_count", "spent", "income", "net"];
      rows = grouped.rows;
    } else if (query.groupBy === "day") {
      const grouped = await db.query<{
        day: string;
        transaction_count: string;
        spent: string;
        income: string;
        net: string;
      }>(
        `SELECT
           t.transaction_date::text AS day,
           COUNT(*)::text AS transaction_count,
           COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0)::text AS spent,
           COALESCE(SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END), 0)::text AS income,
           COALESCE(SUM(t.amount), 0)::text AS net
         FROM "transaction" t
         WHERE ${whereClause}
         GROUP BY t.transaction_date
         ORDER BY t.transaction_date DESC
         LIMIT $${values.length + 1}`,
        [...values, query.limit]
      );
      headers = ["day", "transaction_count", "spent", "income", "net"];
      rows = grouped.rows;
    } else if (query.groupBy === "merchant") {
      const grouped = await db.query<{
        merchant_name: string;
        transaction_count: string;
        spent: string;
        income: string;
        net: string;
      }>(
        `SELECT
           COALESCE(t.merchant_name, '(unknown)') AS merchant_name,
           COUNT(*)::text AS transaction_count,
           COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0)::text AS spent,
           COALESCE(SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END), 0)::text AS income,
           COALESCE(SUM(t.amount), 0)::text AS net
         FROM "transaction" t
         WHERE ${whereClause}
         GROUP BY COALESCE(t.merchant_name, '(unknown)')
         ORDER BY spent::numeric DESC
         LIMIT $${values.length + 1}`,
        [...values, query.limit]
      );
      headers = ["merchant_name", "transaction_count", "spent", "income", "net"];
      rows = grouped.rows;
    } else {
      const rawRows = await db.query<{
        id: string;
        transaction_date: string;
        merchant_name: string | null;
        original_description: string;
        amount: string;
        is_excluded: boolean;
        account_name: string;
        category_name: string | null;
      }>(
        `SELECT
           t.id,
           t.transaction_date::text AS transaction_date,
           t.merchant_name,
           t.original_description,
           t.amount::text AS amount,
           t.is_excluded,
           a.name AS account_name,
           c.name AS category_name
         FROM "transaction" t
         JOIN account a ON a.id = t.account_id
         LEFT JOIN category c ON c.id = t.category_id
         WHERE ${whereClause}
         ORDER BY t.transaction_date DESC, t.id DESC
         LIMIT $${values.length + 1}`,
        [...values, query.limit]
      );
      headers = [
        "id",
        "transaction_date",
        "merchant_name",
        "original_description",
        "amount",
        "is_excluded",
        "account_name",
        "category_name"
      ];
      rows = rawRows.rows;
    }

    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(headers.map((header) => csvEscape(row[header])).join(","));
    }
    const csv = lines.join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=report.csv");
    return res.status(200).send(csv);
  } catch {
    return res.status(500).json({ error: "Failed to export CSV report" });
  }
});

reportsRouter.post(
  "/category-summary",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = summaryQuerySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid report query",
        details: parsed.error.flatten()
      });
    }
    const query = parsed.data;
    if (query.dateFrom && query.dateTo && query.dateTo < query.dateFrom) {
      return res.status(400).json({ error: "dateTo cannot be before dateFrom" });
    }

    const { whereClause, values } = buildWhereClause({
      userId,
      includeExcluded: query.includeExcluded,
      categoryIds: query.categoryIds,
      accountIds: query.accountIds,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo
    });

    try {
      const rows = await db.query<{
        category_id: string | null;
        category_name: string | null;
        transaction_count: string;
        spent: string;
        income: string;
        net: string;
      }>(
        `SELECT
           t.category_id,
           COALESCE(c.name, '(uncategorized)') AS category_name,
           COUNT(*)::text AS transaction_count,
           COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0)::text AS spent,
           COALESCE(SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END), 0)::text AS income,
           COALESCE(SUM(t.amount), 0)::text AS net
         FROM "transaction" t
         LEFT JOIN category c ON c.id = t.category_id
         WHERE ${whereClause}
         GROUP BY t.category_id, c.name
         ORDER BY spent::numeric DESC
         LIMIT $${values.length + 1}`,
        [...values, query.limit]
      );

      return res.json({
        meta: query,
        data: rows.rows
      });
    } catch {
      return res.status(500).json({ error: "Failed to build category summary" });
    }
  }
);

reportsRouter.post("/trend", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = trendQuerySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid report query",
      details: parsed.error.flatten()
    });
  }
  const query = parsed.data;
  if (query.dateFrom && query.dateTo && query.dateTo < query.dateFrom) {
    return res.status(400).json({ error: "dateTo cannot be before dateFrom" });
  }

  const { whereClause, values } = buildWhereClause({
    userId,
    includeExcluded: query.includeExcluded,
    categoryIds: query.categoryIds,
    accountIds: query.accountIds,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo
  });

  const bucketExpr =
    query.interval === "day"
      ? "t.transaction_date::date"
      : query.interval === "week"
        ? "date_trunc('week', t.transaction_date::timestamp)::date"
        : "date_trunc('month', t.transaction_date::timestamp)::date";

  try {
    const rows = await db.query<{
      bucket: string;
      transaction_count: string;
      spent: string;
      income: string;
      net: string;
    }>(
      `SELECT
         ${bucketExpr}::text AS bucket,
         COUNT(*)::text AS transaction_count,
         COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0)::text AS spent,
         COALESCE(SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END), 0)::text AS income,
         COALESCE(SUM(t.amount), 0)::text AS net
       FROM "transaction" t
       WHERE ${whereClause}
       GROUP BY ${bucketExpr}
       ORDER BY ${bucketExpr} ASC
       LIMIT $${values.length + 1}`,
      [...values, query.limit]
    );

    return res.json({
      meta: query,
      data: rows.rows
    });
  } catch {
    return res.status(500).json({ error: "Failed to build trend report" });
  }
});

reportsRouter.post(
  "/merchant-concentration",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = summaryQuerySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid report query",
        details: parsed.error.flatten()
      });
    }
    const query = parsed.data;
    if (query.dateFrom && query.dateTo && query.dateTo < query.dateFrom) {
      return res.status(400).json({ error: "dateTo cannot be before dateFrom" });
    }

    const { whereClause, values } = buildWhereClause({
      userId,
      includeExcluded: query.includeExcluded,
      categoryIds: query.categoryIds,
      accountIds: query.accountIds,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo
    });

    try {
      const totals = await db.query<{ spent: string }>(
        `SELECT COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0)::text AS spent
         FROM "transaction" t
         WHERE ${whereClause}`,
        values
      );
      const totalSpent = Number(totals.rows[0]?.spent ?? "0");

      const rows = await db.query<{
        merchant_name: string;
        transaction_count: string;
        spent: string;
      }>(
        `SELECT
           COALESCE(t.merchant_name, '(unknown)') AS merchant_name,
           COUNT(*)::text AS transaction_count,
           COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0)::text AS spent
         FROM "transaction" t
         WHERE ${whereClause}
         GROUP BY COALESCE(t.merchant_name, '(unknown)')
         ORDER BY spent::numeric DESC
         LIMIT $${values.length + 1}`,
        [...values, query.limit]
      );

      return res.json({
        meta: query,
        totalSpent: totalSpent.toFixed(2),
        data: rows.rows.map((row) => {
          const spent = Number(row.spent);
          const share = totalSpent <= 0 ? 0 : Number((spent / totalSpent).toFixed(6));
          return {
            merchantName: row.merchant_name,
            transactionCount: Number(row.transaction_count),
            spent: row.spent,
            share
          };
        })
      });
    } catch {
      return res.status(500).json({ error: "Failed to build merchant concentration" });
    }
  }
);

reportsRouter.post(
  "/budget-variance",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = budgetVarianceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid report query",
        details: parsed.error.flatten()
      });
    }

    const includeInactive = parsed.data.includeInactive;
    const referenceDate = parsed.data.referenceDate ?? new Date().toISOString().slice(0, 10);

    try {
      const userResult = await db.query<{ week_start_day: number }>(
        `SELECT week_start_day
         FROM app_user
         WHERE id = $1`,
        [userId]
      );
      const user = userResult.rows[0];
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const whereClause = includeInactive
        ? `b.user_id = $1
           AND b.effective_start_date <= $2::date
           AND (b.effective_end_date IS NULL OR b.effective_end_date >= $2::date)`
        : `b.user_id = $1
           AND b.is_active = TRUE
           AND b.effective_start_date <= $2::date
           AND (b.effective_end_date IS NULL OR b.effective_end_date >= $2::date)`;

      const budgets = await db.query<{
        id: string;
        name: string;
        period: "WEEKLY" | "MONTHLY";
        amount: string;
        category_id: string | null;
        include_excluded_transactions: boolean;
      }>(
        `SELECT
           b.id,
           b.name,
           b.period,
           b.amount::text AS amount,
           b.category_id,
           b.include_excluded_transactions
         FROM budget b
         WHERE ${whereClause}
         ORDER BY b.created_at DESC`,
        [userId, referenceDate]
      );

      const rows = [];
      for (const budget of budgets.rows) {
        const window = getBudgetPeriodWindow({
          period: budget.period,
          referenceDate,
          weekStartDay: user.week_start_day
        });

        const excludedFilter = budget.include_excluded_transactions
          ? ""
          : "AND t.is_excluded = FALSE";
        const categoryFilter = budget.category_id ? "AND t.category_id = $4" : "";
        const params = budget.category_id
          ? [userId, window.startDate, window.endDate, budget.category_id]
          : [userId, window.startDate, window.endDate];

        const spentResult = await db.query<{ spent: string }>(
          `SELECT COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0)::text AS spent
           FROM "transaction" t
           WHERE t.user_id = $1
             AND t.transaction_date >= $2::date
             AND t.transaction_date <= $3::date
             ${excludedFilter}
             ${categoryFilter}`,
          params
        );

        const budgetAmount = Number(budget.amount);
        const spent = Number(spentResult.rows[0]?.spent ?? "0");
        const variance = Number((budgetAmount - spent).toFixed(2));
        const variancePct =
          budgetAmount <= 0 ? (spent > 0 ? -1 : 0) : Number((variance / budgetAmount).toFixed(6));

        rows.push({
          budgetId: budget.id,
          budgetName: budget.name,
          period: budget.period,
          periodStartDate: window.startDate,
          periodEndDate: window.endDate,
          categoryId: budget.category_id,
          amount: budget.amount,
          spent: spent.toFixed(2),
          variance: variance.toFixed(2),
          variancePct
        });
      }

      return res.json({
        referenceDate,
        data: rows
      });
    } catch {
      return res.status(500).json({ error: "Failed to build budget variance report" });
    }
  }
);

reportsRouter.get("/presets", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const rows = await db.query<{
      id: string;
      name: string;
      filters: unknown;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT
         id,
         name,
         filters,
         created_at::text AS created_at,
         updated_at::text AS updated_at
       FROM report_preset
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId]
    );
    return res.json({ data: rows.rows });
  } catch {
    return res.status(500).json({ error: "Failed to list report presets" });
  }
});

reportsRouter.post("/presets", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = reportPresetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  try {
    const created = await db.query<{
      id: string;
      name: string;
      filters: unknown;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO report_preset (user_id, name, filters)
       VALUES ($1, $2, $3::jsonb)
       RETURNING
         id,
         name,
         filters,
         created_at::text AS created_at,
         updated_at::text AS updated_at`,
      [userId, parsed.data.name, JSON.stringify(parsed.data.filters)]
    );

    return res.status(201).json(created.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return res.status(409).json({ error: "Preset name already exists" });
    }
    return res.status(500).json({ error: "Failed to create report preset" });
  }
});

reportsRouter.patch(
  "/presets/:presetId",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const params = presetParamsSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({
        error: "Invalid preset id",
        details: params.error.flatten()
      });
    }

    const parsed = reportPresetUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten()
      });
    }

    try {
      const existing = await db.query<{ name: string; filters: unknown }>(
        `SELECT name, filters
         FROM report_preset
         WHERE id = $1
           AND user_id = $2`,
        [params.data.presetId, userId]
      );
      const current = existing.rows[0];
      if (!current) {
        return res.status(404).json({ error: "Preset not found" });
      }

      const updated = await db.query<{
        id: string;
        name: string;
        filters: unknown;
        created_at: string;
        updated_at: string;
      }>(
        `UPDATE report_preset
         SET name = $3,
             filters = $4::jsonb
         WHERE id = $1
           AND user_id = $2
         RETURNING
           id,
           name,
           filters,
           created_at::text AS created_at,
           updated_at::text AS updated_at`,
        [
          params.data.presetId,
          userId,
          parsed.data.name ?? current.name,
          JSON.stringify(parsed.data.filters ?? current.filters)
        ]
      );

      return res.json(updated.rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return res.status(409).json({ error: "Preset name already exists" });
      }
      return res.status(500).json({ error: "Failed to update report preset" });
    }
  }
);

reportsRouter.delete(
  "/presets/:presetId",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const params = presetParamsSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({
        error: "Invalid preset id",
        details: params.error.flatten()
      });
    }

    try {
      const deleted = await db.query(
        `DELETE FROM report_preset
         WHERE id = $1
           AND user_id = $2`,
        [params.data.presetId, userId]
      );
      if ((deleted.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: "Preset not found" });
      }
      return res.status(204).send();
    } catch {
      return res.status(500).json({ error: "Failed to delete report preset" });
    }
  }
);
