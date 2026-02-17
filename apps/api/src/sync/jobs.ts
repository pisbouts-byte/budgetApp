import { createHash } from "node:crypto";
import { db } from "../db/pool.js";
import { runIncrementalSyncForUser } from "../plaid/incremental-sync.js";

type SyncJobStatus = "PENDING" | "RETRY" | "PROCESSING" | "COMPLETED" | "FAILED";

interface SyncJobRow {
  id: string;
  user_id: string;
  plaid_item_id: string;
  idempotency_key: string;
  status: SyncJobStatus;
  attempt_count: number;
  max_attempts: number;
}

export function buildWebhookIdempotencyKey(payload: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

export async function enqueueWebhookSyncJob(params: {
  plaidApiItemId: string;
  payload: unknown;
}) {
  const { plaidApiItemId, payload } = params;

  const itemResult = await db.query<{ id: string; user_id: string }>(
    `SELECT id, user_id
     FROM plaid_item
     WHERE plaid_item_id = $1`,
    [plaidApiItemId]
  );
  const item = itemResult.rows[0];
  if (!item) {
    return null;
  }

  const idempotencyKey = buildWebhookIdempotencyKey(payload);

  const insert = await db.query<{ id: string }>(
    `INSERT INTO sync_job (
       user_id,
       plaid_item_id,
       idempotency_key,
       trigger_source,
       status,
       payload
     )
     VALUES ($1, $2, $3, 'WEBHOOK', 'PENDING', $4::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [item.user_id, item.id, idempotencyKey, JSON.stringify(payload)]
  );

  if (insert.rows[0]) {
    return { created: true, jobId: insert.rows[0].id, plaidItemDbId: item.id };
  }

  const existing = await db.query<{ id: string }>(
    `SELECT id
     FROM sync_job
     WHERE idempotency_key = $1`,
    [idempotencyKey]
  );
  const existingJob = existing.rows[0];
  if (!existingJob) {
    return null;
  }

  return { created: false, jobId: existingJob.id, plaidItemDbId: item.id };
}

function nextRetryAt(attempt: number) {
  const backoffSeconds = Math.min(300, 2 ** Math.max(1, attempt));
  return new Date(Date.now() + backoffSeconds * 1000);
}

export async function processSyncJob(jobId: string) {
  const claim = await db.query<SyncJobRow>(
    `UPDATE sync_job
     SET status = 'PROCESSING'
     WHERE id = $1
       AND status IN ('PENDING', 'RETRY')
       AND next_run_at <= now()
     RETURNING id, user_id, plaid_item_id, idempotency_key, status, attempt_count, max_attempts`,
    [jobId]
  );
  const job = claim.rows[0];
  if (!job) {
    return { claimed: false };
  }

  try {
    await runIncrementalSyncForUser({
      userId: job.user_id,
      plaidItemDbId: job.plaid_item_id
    });

    await db.query(
      `UPDATE sync_job
       SET status = 'COMPLETED',
           attempt_count = attempt_count + 1,
           last_error = NULL
       WHERE id = $1`,
      [job.id]
    );

    return { claimed: true, completed: true };
  } catch (error) {
    const nextAttempt = job.attempt_count + 1;
    const finalFailure = nextAttempt >= job.max_attempts;

    await db.query(
      `UPDATE sync_job
       SET status = $2,
           attempt_count = $3,
           next_run_at = $4,
           last_error = $5
       WHERE id = $1`,
      [
        job.id,
        finalFailure ? "FAILED" : "RETRY",
        nextAttempt,
        finalFailure ? new Date() : nextRetryAt(nextAttempt),
        (error as Error).message ?? "Unknown sync failure"
      ]
    );

    return { claimed: true, completed: false, failed: finalFailure };
  }
}

export async function processDueSyncJobs(limit = 20) {
  const jobs = await db.query<{ id: string }>(
    `SELECT id
     FROM sync_job
     WHERE status IN ('PENDING', 'RETRY')
       AND next_run_at <= now()
     ORDER BY next_run_at ASC
     LIMIT $1`,
    [limit]
  );

  let processed = 0;
  for (const job of jobs.rows) {
    const result = await processSyncJob(job.id);
    if (result.claimed) {
      processed += 1;
    }
  }

  return { queued: jobs.rows.length, processed };
}

export async function processDueSyncJobsForUser(userId: string, limit = 20) {
  const jobs = await db.query<{ id: string }>(
    `SELECT id
     FROM sync_job
     WHERE user_id = $1
       AND status IN ('PENDING', 'RETRY')
       AND next_run_at <= now()
     ORDER BY next_run_at ASC
     LIMIT $2`,
    [userId, limit]
  );

  let processed = 0;
  for (const job of jobs.rows) {
    const result = await processSyncJob(job.id);
    if (result.claimed) {
      processed += 1;
    }
  }

  return { queued: jobs.rows.length, processed };
}
