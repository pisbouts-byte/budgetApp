BEGIN;

CREATE TABLE sync_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  plaid_item_id UUID NOT NULL REFERENCES plaid_item(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  trigger_source TEXT NOT NULL, -- WEBHOOK or MANUAL
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, RETRY, PROCESSING, COMPLETED, FAILED
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (attempt_count >= 0),
  CHECK (max_attempts >= 1)
);

CREATE INDEX idx_sync_job_due ON sync_job(status, next_run_at);
CREATE INDEX idx_sync_job_item_status ON sync_job(plaid_item_id, status);

CREATE TRIGGER trg_sync_job_updated_at
BEFORE UPDATE ON sync_job
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

