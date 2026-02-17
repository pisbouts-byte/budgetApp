import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { verifyPlaidWebhookSignature } from "../plaid/webhook-verification.js";
import {
  enqueueWebhookSyncJob,
  processDueSyncJobsForUser,
  processSyncJob
} from "../sync/jobs.js";

const plaidWebhookSchema = z.object({
  webhook_type: z.string(),
  webhook_code: z.string().optional(),
  item_id: z.string().optional(),
  new_transactions: z.number().int().optional()
});

export const webhooksRouter = Router();

webhooksRouter.post("/plaid", async (req, res) => {
  if (env.PLAID_WEBHOOK_VERIFICATION_ENABLED) {
    const plaidVerificationHeader = Array.isArray(req.headers["plaid-verification"])
      ? req.headers["plaid-verification"][0]
      : req.headers["plaid-verification"];
    const rawBody =
      (req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    const verification = await verifyPlaidWebhookSignature({
      plaidVerificationHeader,
      rawBody
    });
    if (!verification.ok) {
      return res.status(401).json({ error: verification.reason });
    }
  }

  const parsed = plaidWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid webhook payload",
      details: parsed.error.flatten()
    });
  }

  const payload = parsed.data;
  if (payload.webhook_type !== "TRANSACTIONS") {
    return res.status(200).json({ received: true, ignored: true });
  }

  if (!payload.item_id) {
    return res.status(400).json({ error: "Missing item_id for transactions webhook" });
  }

  try {
    const queued = await enqueueWebhookSyncJob({
      plaidApiItemId: payload.item_id,
      payload
    });
    if (!queued) {
      return res.status(202).json({ received: true, itemLinked: false });
    }

    const run = await processSyncJob(queued.jobId);

    return res.status(queued.created ? 202 : 200).json({
      received: true,
      itemLinked: true,
      duplicate: !queued.created,
      jobId: queued.jobId,
      processed: run.claimed
    });
  } catch {
    return res.status(502).json({ error: "Failed to process Plaid webhook" });
  }
});

webhooksRouter.post(
  "/plaid/process-due",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

  try {
      const result = await processDueSyncJobsForUser(userId);
    return res.json(result);
  } catch {
    return res.status(502).json({ error: "Failed to process due sync jobs" });
  }
  }
);
