import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/pool.js";
import {
  DEFAULT_RETENTION_DAYS,
  retentionCutoffDate
} from "../data-retention/policy.js";

const deleteMeSchema = z.object({
  confirm: z.literal("DELETE"),
  deleteUser: z.boolean().default(true)
});

const purgeRetentionSchema = z.object({
  categoryChangeEventDays: z.number().int().min(1).max(3650).optional(),
  budgetSnapshotDays: z.number().int().min(1).max(3650).optional(),
  syncJobDays: z.number().int().min(1).max(3650).optional()
});

export const dataRouter = Router();

dataRouter.get(
  "/deletion-preview",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const preview = await db.query<{
        app_user_count: string;
        plaid_item_count: string;
        account_count: string;
        transaction_count: string;
        category_count: string;
        category_rule_count: string;
        category_change_event_count: string;
        budget_count: string;
        budget_snapshot_count: string;
        report_preset_count: string;
        sync_job_count: string;
      }>(
        `SELECT
           (SELECT COUNT(*)::text FROM app_user u WHERE u.id = $1) AS app_user_count,
           (SELECT COUNT(*)::text FROM plaid_item pi WHERE pi.user_id = $1) AS plaid_item_count,
           (SELECT COUNT(*)::text FROM account a WHERE a.user_id = $1) AS account_count,
           (SELECT COUNT(*)::text FROM "transaction" t WHERE t.user_id = $1) AS transaction_count,
           (SELECT COUNT(*)::text FROM category c WHERE c.user_id = $1) AS category_count,
           (SELECT COUNT(*)::text FROM category_rule cr WHERE cr.user_id = $1) AS category_rule_count,
           (SELECT COUNT(*)::text FROM category_change_event cce WHERE cce.user_id = $1) AS category_change_event_count,
           (SELECT COUNT(*)::text FROM budget b WHERE b.user_id = $1) AS budget_count,
           (SELECT COUNT(*)::text
            FROM budget_snapshot bs
            JOIN budget b ON b.id = bs.budget_id
            WHERE b.user_id = $1) AS budget_snapshot_count,
           (SELECT COUNT(*)::text FROM report_preset rp WHERE rp.user_id = $1) AS report_preset_count,
           (SELECT COUNT(*)::text FROM sync_job sj WHERE sj.user_id = $1) AS sync_job_count`,
        [userId]
      );

      const row = preview.rows[0];
      if (!row) {
        return res.status(500).json({ error: "Failed to load deletion preview" });
      }

      return res.json({
        userId,
        counts: {
          appUser: Number(row.app_user_count),
          plaidItems: Number(row.plaid_item_count),
          accounts: Number(row.account_count),
          transactions: Number(row.transaction_count),
          categories: Number(row.category_count),
          categoryRules: Number(row.category_rule_count),
          categoryChangeEvents: Number(row.category_change_event_count),
          budgets: Number(row.budget_count),
          budgetSnapshots: Number(row.budget_snapshot_count),
          reportPresets: Number(row.report_preset_count),
          syncJobs: Number(row.sync_job_count)
        }
      });
    } catch {
      return res.status(500).json({ error: "Failed to load deletion preview" });
    }
  }
);

dataRouter.delete("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = deleteMeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  const { deleteUser } = parsed.data;
  if (!deleteUser) {
    return res.status(400).json({ error: "deleteUser must be true for full deletion" });
  }

  try {
    const deleted = await db.query<{ id: string }>(
      `DELETE FROM app_user
       WHERE id = $1
       RETURNING id`,
      [userId]
    );

    if ((deleted.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({
      deleted: true,
      userId
    });
  } catch {
    return res.status(500).json({ error: "Failed to delete user data" });
  }
});

dataRouter.post(
  "/retention/purge",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = purgeRetentionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid retention request",
        details: parsed.error.flatten()
      });
    }

    const categoryChangeEventDays =
      parsed.data.categoryChangeEventDays ??
      DEFAULT_RETENTION_DAYS.categoryChangeEvent;
    const budgetSnapshotDays =
      parsed.data.budgetSnapshotDays ?? DEFAULT_RETENTION_DAYS.budgetSnapshot;
    const syncJobDays = parsed.data.syncJobDays ?? DEFAULT_RETENTION_DAYS.syncJob;

    const categoryChangeEventCutoff = retentionCutoffDate(categoryChangeEventDays);
    const budgetSnapshotCutoff = retentionCutoffDate(budgetSnapshotDays);
    const syncJobCutoff = retentionCutoffDate(syncJobDays);

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const categoryChangeEventDeleted = await client.query(
        `DELETE FROM category_change_event
         WHERE user_id = $1
           AND changed_at < $2::timestamptz`,
        [userId, categoryChangeEventCutoff]
      );

      const budgetSnapshotDeleted = await client.query(
        `DELETE FROM budget_snapshot bs
         USING budget b
         WHERE bs.budget_id = b.id
           AND b.user_id = $1
           AND bs.computed_at < $2::timestamptz`,
        [userId, budgetSnapshotCutoff]
      );

      const syncJobDeleted = await client.query(
        `DELETE FROM sync_job
         WHERE user_id = $1
           AND status IN ('COMPLETED', 'FAILED')
           AND updated_at < $2::timestamptz`,
        [userId, syncJobCutoff]
      );

      await client.query("COMMIT");

      return res.json({
        purged: true,
        retentionDays: {
          categoryChangeEvent: categoryChangeEventDays,
          budgetSnapshot: budgetSnapshotDays,
          syncJob: syncJobDays
        },
        deletedCounts: {
          categoryChangeEvent: categoryChangeEventDeleted.rowCount ?? 0,
          budgetSnapshot: budgetSnapshotDeleted.rowCount ?? 0,
          syncJob: syncJobDeleted.rowCount ?? 0
        }
      });
    } catch {
      await client.query("ROLLBACK");
      return res.status(500).json({ error: "Failed to run retention purge" });
    } finally {
      client.release();
    }
  }
);
