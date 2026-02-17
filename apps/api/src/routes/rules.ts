import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/pool.js";

const ruleFieldSchema = z.enum([
  "MERCHANT_NAME",
  "ORIGINAL_DESCRIPTION",
  "ACCOUNT_NAME",
  "MCC",
  "PLAID_PRIMARY_CATEGORY",
  "PLAID_DETAILED_CATEGORY"
]);

const ruleOperatorSchema = z.enum([
  "EQUALS",
  "CONTAINS",
  "STARTS_WITH",
  "ENDS_WITH",
  "REGEX"
]);

const createRuleSchema = z.object({
  categoryId: z.string().uuid(),
  field: ruleFieldSchema,
  operator: ruleOperatorSchema,
  pattern: z.string().trim().min(1).max(255),
  priority: z.number().int().min(1).max(10000).default(100),
  isActive: z.boolean().default(true)
});

const updateRuleSchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    field: ruleFieldSchema.optional(),
    operator: ruleOperatorSchema.optional(),
    pattern: z.string().trim().min(1).max(255).optional(),
    priority: z.number().int().min(1).max(10000).optional(),
    isActive: z.boolean().optional()
  })
  .refine(
    (data) =>
      data.categoryId !== undefined ||
      data.field !== undefined ||
      data.operator !== undefined ||
      data.pattern !== undefined ||
      data.priority !== undefined ||
      data.isActive !== undefined,
    { message: "At least one field must be provided" }
  );

const paramsSchema = z.object({
  ruleId: z.string().uuid()
});

export const rulesRouter = Router();

async function categoryExistsForUser(categoryId: string, userId: string) {
  const result = await db.query(
    `SELECT 1
     FROM category
     WHERE id = $1 AND user_id = $2`,
    [categoryId, userId]
  );
  return result.rows.length > 0;
}

rulesRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const rows = await db.query<{
      id: string;
      category_id: string;
      category_name: string;
      field: string;
      operator: string;
      pattern: string;
      priority: number;
      is_active: boolean;
      learned_from_transaction_id: string | null;
      created_by: string;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT
         r.id,
         r.category_id,
         c.name AS category_name,
         r.field,
         r.operator,
         r.pattern,
         r.priority,
         r.is_active,
         r.learned_from_transaction_id,
         r.created_by,
         r.created_at::text AS created_at,
         r.updated_at::text AS updated_at
       FROM category_rule r
       JOIN category c ON c.id = r.category_id
       WHERE r.user_id = $1
       ORDER BY r.is_active DESC, r.priority ASC, r.created_at ASC`,
      [userId]
    );

    return res.json({
      data: rows.rows.map((row) => ({
        id: row.id,
        categoryId: row.category_id,
        categoryName: row.category_name,
        field: row.field,
        operator: row.operator,
        pattern: row.pattern,
        priority: row.priority,
        isActive: row.is_active,
        learnedFromTransactionId: row.learned_from_transaction_id,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch {
    return res.status(500).json({ error: "Failed to list rules" });
  }
});

rulesRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = createRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  const payload = parsed.data;
  if (!(await categoryExistsForUser(payload.categoryId, userId))) {
    return res.status(400).json({ error: "Invalid category" });
  }

  try {
    const result = await db.query<{
      id: string;
      category_id: string;
      field: string;
      operator: string;
      pattern: string;
      priority: number;
      is_active: boolean;
      learned_from_transaction_id: string | null;
      created_by: string;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO category_rule (
         user_id,
         category_id,
         field,
         operator,
         pattern,
         priority,
         is_active,
         created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'USER')
       RETURNING
         id,
         category_id,
         field,
         operator,
         pattern,
         priority,
         is_active,
         learned_from_transaction_id,
         created_by,
         created_at::text AS created_at,
         updated_at::text AS updated_at`,
      [
        userId,
        payload.categoryId,
        payload.field,
        payload.operator,
        payload.pattern.trim().toLowerCase(),
        payload.priority,
        payload.isActive
      ]
    );

    const row = result.rows[0];
    if (!row) {
      return res.status(500).json({ error: "Failed to create rule" });
    }

    return res.status(201).json({
      id: row.id,
      categoryId: row.category_id,
      field: row.field,
      operator: row.operator,
      pattern: row.pattern,
      priority: row.priority,
      isActive: row.is_active,
      learnedFromTransactionId: row.learned_from_transaction_id,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  } catch {
    return res.status(500).json({ error: "Failed to create rule" });
  }
});

rulesRouter.patch("/:ruleId", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({
      error: "Invalid rule id",
      details: params.error.flatten()
    });
  }

  const parsed = updateRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  const ruleId = params.data.ruleId;
  const payload = parsed.data;

  try {
    const existingResult = await db.query<{
      id: string;
      category_id: string;
      field: string;
      operator: string;
      pattern: string;
      priority: number;
      is_active: boolean;
    }>(
      `SELECT id, category_id, field, operator, pattern, priority, is_active
       FROM category_rule
       WHERE id = $1 AND user_id = $2`,
      [ruleId, userId]
    );
    const existing = existingResult.rows[0];
    if (!existing) {
      return res.status(404).json({ error: "Rule not found" });
    }

    const nextCategoryId = payload.categoryId ?? existing.category_id;
    if (!(await categoryExistsForUser(nextCategoryId, userId))) {
      return res.status(400).json({ error: "Invalid category" });
    }

    const nextField = payload.field ?? existing.field;
    const nextOperator = payload.operator ?? existing.operator;
    const nextPattern = (payload.pattern ?? existing.pattern).trim().toLowerCase();
    const nextPriority = payload.priority ?? existing.priority;
    const nextIsActive = payload.isActive ?? existing.is_active;

    const updated = await db.query<{
      id: string;
      category_id: string;
      field: string;
      operator: string;
      pattern: string;
      priority: number;
      is_active: boolean;
      learned_from_transaction_id: string | null;
      created_by: string;
      created_at: string;
      updated_at: string;
    }>(
      `UPDATE category_rule
       SET category_id = $3,
           field = $4,
           operator = $5,
           pattern = $6,
           priority = $7,
           is_active = $8
       WHERE id = $1
         AND user_id = $2
       RETURNING
         id,
         category_id,
         field,
         operator,
         pattern,
         priority,
         is_active,
         learned_from_transaction_id,
         created_by,
         created_at::text AS created_at,
         updated_at::text AS updated_at`,
      [
        ruleId,
        userId,
        nextCategoryId,
        nextField,
        nextOperator,
        nextPattern,
        nextPriority,
        nextIsActive
      ]
    );

    const row = updated.rows[0];
    if (!row) {
      return res.status(404).json({ error: "Rule not found" });
    }

    return res.json({
      id: row.id,
      categoryId: row.category_id,
      field: row.field,
      operator: row.operator,
      pattern: row.pattern,
      priority: row.priority,
      isActive: row.is_active,
      learnedFromTransactionId: row.learned_from_transaction_id,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  } catch {
    return res.status(500).json({ error: "Failed to update rule" });
  }
});

rulesRouter.delete("/:ruleId", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({
      error: "Invalid rule id",
      details: params.error.flatten()
    });
  }

  try {
    const deleted = await db.query(
      `DELETE FROM category_rule
       WHERE id = $1
         AND user_id = $2`,
      [params.data.ruleId, userId]
    );

    if ((deleted.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: "Rule not found" });
    }
    return res.status(204).send();
  } catch {
    return res.status(500).json({ error: "Failed to delete rule" });
  }
});

