import { db } from "../db/pool.js";

export interface AuditEventInput {
  userId?: string | null;
  eventType: string;
  eventSource?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAuditEvent(input: AuditEventInput) {
  try {
    await db.query(
      `INSERT INTO audit_event (
         user_id,
         event_type,
         event_source,
         ip_address,
         user_agent,
         request_id,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        input.userId ?? null,
        input.eventType,
        input.eventSource ?? "API",
        input.ipAddress ?? null,
        input.userAgent ?? null,
        input.requestId ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
  } catch {
    // Best-effort logging only; do not fail request paths.
  }
}
