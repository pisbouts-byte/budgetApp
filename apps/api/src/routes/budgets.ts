import { Router } from "express";
import { z } from "zod";
import { getBudgetPeriodWindow, paceRatio } from "../budgets/period.js";
import { requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/pool.js";

const budgetPeriodSchema = z.enum(["WEEKLY", "MONTHLY"]);

const createBudgetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  period: budgetPeriodSchema,
  amount: z.number().nonnegative(),
  categoryId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().default(true),
  effectiveStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveEndDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  includeExcludedTransactions: z.boolean().default(false)
});

const updateBudgetSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    period: budgetPeriodSchema.optional(),
    amount: z.number().nonnegative().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
    effectiveStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    effectiveEndDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    includeExcludedTransactions: z.boolean().optional()
  })
  .refine(
    (payload) =>
      payload.name !== undefined ||
      payload.period !== undefined ||
      payload.amount !== undefined ||
      payload.categoryId !== undefined ||
      payload.isActive !== undefined ||
      payload.effectiveStartDate !== undefined ||
      payload.effectiveEndDate !== undefined ||
      payload.includeExcludedTransactions !== undefined,
    { message: "At least one field must be provided" }
  );

const listBudgetSchema = z.object({
  includeInactive: z.enum(["true", "false"]).default("false")
});
const progressQuerySchema = z.object({
  includeInactive: z.enum(["true", "false"]).default("false"),
  referenceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
});
const alertsQuerySchema = z.object({
  includeInactive: z.enum(["true", "false"]).default("false"),
  referenceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  progressThreshold: z.coerce.number().min(0).max(5).default(0.8),
  paceThreshold: z.coerce.number().min(0).max(5).default(1.1)
});

const paramsSchema = z.object({
  budgetId: z.string().uuid()
});

export const budgetsRouter = Router();

async function categoryExistsForUser(categoryId: string, userId: string) {
  const result = await db.query(
    `SELECT 1
     FROM category
     WHERE id = $1
       AND user_id = $2`,
    [categoryId, userId]
  );
  return result.rows.length > 0;
}

budgetsRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = listBudgetSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid query parameters",
      details: parsed.error.flatten()
    });
  }

  const includeInactive = parsed.data.includeInactive === "true";
  const whereClause = includeInactive
    ? "b.user_id = $1"
    : "b.user_id = $1 AND b.is_active = TRUE";

  try {
    const rows = await db.query<{
      id: string;
      name: string;
      period: "WEEKLY" | "MONTHLY";
      amount: string;
      category_id: string | null;
      category_name: string | null;
      is_active: boolean;
      effective_start_date: string;
      effective_end_date: string | null;
      include_excluded_transactions: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT
         b.id,
         b.name,
         b.period,
         b.amount::text AS amount,
         b.category_id,
         c.name AS category_name,
         b.is_active,
         b.effective_start_date::text AS effective_start_date,
         b.effective_end_date::text AS effective_end_date,
         b.include_excluded_transactions,
         b.created_at::text AS created_at,
         b.updated_at::text AS updated_at
       FROM budget b
       LEFT JOIN category c ON c.id = b.category_id
       WHERE ${whereClause}
       ORDER BY b.created_at DESC`,
      [userId]
    );

    return res.json({
      data: rows.rows.map((row) => ({
        id: row.id,
        name: row.name,
        period: row.period,
        amount: row.amount,
        categoryId: row.category_id,
        categoryName: row.category_name,
        isActive: row.is_active,
        effectiveStartDate: row.effective_start_date,
        effectiveEndDate: row.effective_end_date,
        includeExcludedTransactions: row.include_excluded_transactions,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch {
    return res.status(500).json({ error: "Failed to list budgets" });
  }
});

budgetsRouter.get(
  "/progress",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = progressQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid query parameters",
        details: parsed.error.flatten()
      });
    }

    const includeInactive = parsed.data.includeInactive === "true";
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
        is_active: boolean;
      }>(
        `SELECT
           b.id,
           b.name,
           b.period,
           b.amount::text AS amount,
           b.category_id,
           b.include_excluded_transactions,
           b.is_active
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

        const categoryFilter = budget.category_id
          ? `AND t.category_id = $4`
          : "";
        const excludedFilter = budget.include_excluded_transactions
          ? ""
          : "AND t.is_excluded = FALSE";
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
        const remaining = Number((budgetAmount - spent).toFixed(2));
        const progressRatio =
          budgetAmount <= 0 ? (spent > 0 ? 1 : 0) : Number((spent / budgetAmount).toFixed(6));
        const pace = paceRatio({
          budgetAmount,
          spent,
          periodStartDate: window.startDate,
          periodEndDate: window.endDate,
          referenceDate
        });

        rows.push({
          budgetId: budget.id,
          budgetName: budget.name,
          period: budget.period,
          periodStartDate: window.startDate,
          periodEndDate: window.endDate,
          categoryId: budget.category_id,
          includeExcludedTransactions: budget.include_excluded_transactions,
          isActive: budget.is_active,
          amount: budget.amount,
          spent: spent.toFixed(2),
          remaining: remaining.toFixed(2),
          progressRatio,
          paceRatio: pace
        });
      }

      return res.json({
        referenceDate,
        data: rows
      });
    } catch {
      return res.status(500).json({ error: "Failed to compute budget progress" });
    }
  }
);

budgetsRouter.get(
  "/alerts",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = alertsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid query parameters",
        details: parsed.error.flatten()
      });
    }

    const includeInactive = parsed.data.includeInactive === "true";
    const referenceDate = parsed.data.referenceDate ?? new Date().toISOString().slice(0, 10);
    const progressThreshold = parsed.data.progressThreshold;
    const paceThreshold = parsed.data.paceThreshold;

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

      const alerts = [];
      for (const budget of budgets.rows) {
        const window = getBudgetPeriodWindow({
          period: budget.period,
          referenceDate,
          weekStartDay: user.week_start_day
        });

        const categoryFilter = budget.category_id
          ? `AND t.category_id = $4`
          : "";
        const excludedFilter = budget.include_excluded_transactions
          ? ""
          : "AND t.is_excluded = FALSE";
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
        const progressRatio =
          budgetAmount <= 0 ? (spent > 0 ? 1 : 0) : Number((spent / budgetAmount).toFixed(6));
        const pace = paceRatio({
          budgetAmount,
          spent,
          periodStartDate: window.startDate,
          periodEndDate: window.endDate,
          referenceDate
        });

        if (progressRatio >= progressThreshold || pace >= paceThreshold) {
          alerts.push({
            budgetId: budget.id,
            budgetName: budget.name,
            period: budget.period,
            periodStartDate: window.startDate,
            periodEndDate: window.endDate,
            amount: budget.amount,
            spent: spent.toFixed(2),
            progressRatio,
            paceRatio: pace,
            reasons: {
              progress: progressRatio >= progressThreshold,
              pace: pace >= paceThreshold
            }
          });
        }
      }

      return res.json({
        referenceDate,
        progressThreshold,
        paceThreshold,
        data: alerts
      });
    } catch {
      return res.status(500).json({ error: "Failed to compute budget alerts" });
    }
  }
);

budgetsRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = createBudgetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  const payload = parsed.data;
  if (payload.categoryId && !(await categoryExistsForUser(payload.categoryId, userId))) {
    return res.status(400).json({ error: "Invalid category" });
  }

  if (
    payload.effectiveEndDate &&
    payload.effectiveEndDate < payload.effectiveStartDate
  ) {
    return res
      .status(400)
      .json({ error: "effectiveEndDate cannot be before effectiveStartDate" });
  }

  try {
    const created = await db.query<{
      id: string;
      name: string;
      period: "WEEKLY" | "MONTHLY";
      amount: string;
      category_id: string | null;
      is_active: boolean;
      effective_start_date: string;
      effective_end_date: string | null;
      include_excluded_transactions: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO budget (
         user_id,
         name,
         period,
         amount,
         category_id,
         is_active,
         effective_start_date,
         effective_end_date,
         include_excluded_transactions
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING
         id,
         name,
         period,
         amount::text AS amount,
         category_id,
         is_active,
         effective_start_date::text AS effective_start_date,
         effective_end_date::text AS effective_end_date,
         include_excluded_transactions,
         created_at::text AS created_at,
         updated_at::text AS updated_at`,
      [
        userId,
        payload.name,
        payload.period,
        payload.amount,
        payload.categoryId ?? null,
        payload.isActive,
        payload.effectiveStartDate,
        payload.effectiveEndDate ?? null,
        payload.includeExcludedTransactions
      ]
    );

    const row = created.rows[0];
    if (!row) {
      return res.status(500).json({ error: "Failed to create budget" });
    }

    return res.status(201).json({
      id: row.id,
      name: row.name,
      period: row.period,
      amount: row.amount,
      categoryId: row.category_id,
      isActive: row.is_active,
      effectiveStartDate: row.effective_start_date,
      effectiveEndDate: row.effective_end_date,
      includeExcludedTransactions: row.include_excluded_transactions,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  } catch {
    return res.status(500).json({ error: "Failed to create budget" });
  }
});

budgetsRouter.patch("/:budgetId", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({
      error: "Invalid budget id",
      details: params.error.flatten()
    });
  }

  const parsed = updateBudgetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  const budgetId = params.data.budgetId;
  const payload = parsed.data;

  try {
    const existingResult = await db.query<{
      id: string;
      name: string;
      period: "WEEKLY" | "MONTHLY";
      amount: string;
      category_id: string | null;
      is_active: boolean;
      effective_start_date: string;
      effective_end_date: string | null;
      include_excluded_transactions: boolean;
    }>(
      `SELECT
         id,
         name,
         period,
         amount::text AS amount,
         category_id,
         is_active,
         effective_start_date::text AS effective_start_date,
         effective_end_date::text AS effective_end_date,
         include_excluded_transactions
       FROM budget
       WHERE id = $1
         AND user_id = $2`,
      [budgetId, userId]
    );
    const existing = existingResult.rows[0];
    if (!existing) {
      return res.status(404).json({ error: "Budget not found" });
    }

    const nextCategoryId = payload.categoryId ?? existing.category_id;
    if (nextCategoryId && !(await categoryExistsForUser(nextCategoryId, userId))) {
      return res.status(400).json({ error: "Invalid category" });
    }

    const nextStartDate = payload.effectiveStartDate ?? existing.effective_start_date;
    const nextEndDate = payload.effectiveEndDate ?? existing.effective_end_date;
    if (nextEndDate && nextEndDate < nextStartDate) {
      return res
        .status(400)
        .json({ error: "effectiveEndDate cannot be before effectiveStartDate" });
    }

    const updated = await db.query<{
      id: string;
      name: string;
      period: "WEEKLY" | "MONTHLY";
      amount: string;
      category_id: string | null;
      is_active: boolean;
      effective_start_date: string;
      effective_end_date: string | null;
      include_excluded_transactions: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `UPDATE budget
       SET name = $3,
           period = $4,
           amount = $5,
           category_id = $6,
           is_active = $7,
           effective_start_date = $8,
           effective_end_date = $9,
           include_excluded_transactions = $10
       WHERE id = $1
         AND user_id = $2
       RETURNING
         id,
         name,
         period,
         amount::text AS amount,
         category_id,
         is_active,
         effective_start_date::text AS effective_start_date,
         effective_end_date::text AS effective_end_date,
         include_excluded_transactions,
         created_at::text AS created_at,
         updated_at::text AS updated_at`,
      [
        budgetId,
        userId,
        payload.name ?? existing.name,
        payload.period ?? existing.period,
        payload.amount ?? Number(existing.amount),
        nextCategoryId,
        payload.isActive ?? existing.is_active,
        nextStartDate,
        nextEndDate,
        payload.includeExcludedTransactions ?? existing.include_excluded_transactions
      ]
    );

    const row = updated.rows[0];
    if (!row) {
      return res.status(404).json({ error: "Budget not found" });
    }

    return res.json({
      id: row.id,
      name: row.name,
      period: row.period,
      amount: row.amount,
      categoryId: row.category_id,
      isActive: row.is_active,
      effectiveStartDate: row.effective_start_date,
      effectiveEndDate: row.effective_end_date,
      includeExcludedTransactions: row.include_excluded_transactions,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  } catch {
    return res.status(500).json({ error: "Failed to update budget" });
  }
});

budgetsRouter.delete(
  "/:budgetId",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({
        error: "Invalid budget id",
        details: params.error.flatten()
      });
    }

    try {
      const deleted = await db.query(
        `DELETE FROM budget
         WHERE id = $1
           AND user_id = $2`,
        [params.data.budgetId, userId]
      );
      if ((deleted.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: "Budget not found" });
      }
      return res.status(204).send();
    } catch {
      return res.status(500).json({ error: "Failed to delete budget" });
    }
  }
);
