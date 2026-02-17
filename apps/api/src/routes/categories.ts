import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/pool.js";

const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  parentCategoryId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).default(0)
});

const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    parentCategoryId: z.string().uuid().nullable().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional()
  })
  .refine(
    (payload) =>
      payload.name !== undefined ||
      payload.parentCategoryId !== undefined ||
      payload.sortOrder !== undefined,
    { message: "At least one field must be provided" }
  );

const paramsSchema = z.object({
  categoryId: z.string().uuid()
});

export const categoriesRouter = Router();

async function categoryExistsForUser(categoryId: string, userId: string) {
  const result = await db.query(
    `SELECT 1
     FROM category
     WHERE id = $1 AND user_id = $2`,
    [categoryId, userId]
  );
  return result.rows.length > 0;
}

categoriesRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const rows = await db.query<{
      id: string;
      name: string;
      parent_category_id: string | null;
      is_system: boolean;
      sort_order: number;
      created_at: string;
      updated_at: string;
      usage_count: string;
    }>(
      `SELECT
         c.id,
         c.name,
         c.parent_category_id,
         c.is_system,
         c.sort_order,
         c.created_at::text AS created_at,
         c.updated_at::text AS updated_at,
         COUNT(t.id)::text AS usage_count
       FROM category c
       LEFT JOIN "transaction" t
         ON t.category_id = c.id
         AND t.user_id = c.user_id
       WHERE c.user_id = $1
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.name ASC`,
      [userId]
    );

    return res.json({
      data: rows.rows.map((row) => ({
        id: row.id,
        name: row.name,
        parentCategoryId: row.parent_category_id,
        isSystem: row.is_system,
        sortOrder: row.sort_order,
        usageCount: Number(row.usage_count),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch {
    return res.status(500).json({ error: "Failed to list categories" });
  }
});

categoriesRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = createCategorySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  const payload = parsed.data;
  if (payload.parentCategoryId) {
    const parentExists = await categoryExistsForUser(payload.parentCategoryId, userId);
    if (!parentExists) {
      return res.status(400).json({ error: "Invalid parent category" });
    }
  }

  try {
    const result = await db.query<{
      id: string;
      name: string;
      parent_category_id: string | null;
      is_system: boolean;
      sort_order: number;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO category (user_id, name, parent_category_id, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING
         id,
         name,
         parent_category_id,
         is_system,
         sort_order,
         created_at::text AS created_at,
         updated_at::text AS updated_at`,
      [userId, payload.name, payload.parentCategoryId ?? null, payload.sortOrder]
    );

    const row = result.rows[0];
    if (!row) {
      return res.status(500).json({ error: "Failed to create category" });
    }

    return res.status(201).json({
      id: row.id,
      name: row.name,
      parentCategoryId: row.parent_category_id,
      isSystem: row.is_system,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return res.status(409).json({ error: "Category name already exists" });
    }
    return res.status(500).json({ error: "Failed to create category" });
  }
});

categoriesRouter.patch(
  "/:categoryId",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({
        error: "Invalid category id",
        details: params.error.flatten()
      });
    }

    const parsed = updateCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten()
      });
    }

    const categoryId = params.data.categoryId;
    const payload = parsed.data;

    const existingResult = await db.query<{
      id: string;
      is_system: boolean;
      name: string;
      parent_category_id: string | null;
      sort_order: number;
    }>(
      `SELECT id, is_system, name, parent_category_id, sort_order
       FROM category
       WHERE id = $1 AND user_id = $2`,
      [categoryId, userId]
    );
    const existing = existingResult.rows[0];
    if (!existing) {
      return res.status(404).json({ error: "Category not found" });
    }

    if (payload.parentCategoryId === categoryId) {
      return res.status(400).json({ error: "Category cannot be its own parent" });
    }

    if (payload.parentCategoryId) {
      const parentExists = await categoryExistsForUser(payload.parentCategoryId, userId);
      if (!parentExists) {
        return res.status(400).json({ error: "Invalid parent category" });
      }
    }

    const nextName = payload.name ?? existing.name;
    const nextParent = payload.parentCategoryId ?? existing.parent_category_id;
    const nextSortOrder = payload.sortOrder ?? existing.sort_order;

    try {
      const updated = await db.query<{
        id: string;
        name: string;
        parent_category_id: string | null;
        is_system: boolean;
        sort_order: number;
        created_at: string;
        updated_at: string;
      }>(
        `UPDATE category
         SET name = $3,
             parent_category_id = $4,
             sort_order = $5
         WHERE id = $1 AND user_id = $2
         RETURNING
           id,
           name,
           parent_category_id,
           is_system,
           sort_order,
           created_at::text AS created_at,
           updated_at::text AS updated_at`,
        [categoryId, userId, nextName, nextParent, nextSortOrder]
      );

      const row = updated.rows[0];
      if (!row) {
        return res.status(404).json({ error: "Category not found" });
      }

      return res.json({
        id: row.id,
        name: row.name,
        parentCategoryId: row.parent_category_id,
        isSystem: row.is_system,
        sortOrder: row.sort_order,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return res.status(409).json({ error: "Category name already exists" });
      }
      return res.status(500).json({ error: "Failed to update category" });
    }
  }
);

categoriesRouter.delete(
  "/:categoryId",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({
        error: "Invalid category id",
        details: params.error.flatten()
      });
    }

    const categoryId = params.data.categoryId;

    const found = await db.query<{ is_system: boolean }>(
      `SELECT is_system
       FROM category
       WHERE id = $1 AND user_id = $2`,
      [categoryId, userId]
    );
    const category = found.rows[0];
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }
    if (category.is_system) {
      return res.status(400).json({ error: "System categories cannot be deleted" });
    }

    try {
      await db.query(
        `DELETE FROM category
         WHERE id = $1 AND user_id = $2`,
        [categoryId, userId]
      );
      return res.status(204).send();
    } catch {
      return res.status(500).json({ error: "Failed to delete category" });
    }
  }
);

