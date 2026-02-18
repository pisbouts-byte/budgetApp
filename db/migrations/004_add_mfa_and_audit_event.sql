BEGIN;

ALTER TABLE app_user
ADD COLUMN mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN mfa_totp_secret_encrypted TEXT,
ADD COLUMN mfa_enrolled_at TIMESTAMPTZ,
ADD COLUMN mfa_last_verified_at TIMESTAMPTZ;

CREATE TABLE audit_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  event_source TEXT NOT NULL DEFAULT 'API',
  ip_address TEXT,
  user_agent TEXT,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_event_user_created_at
  ON audit_event(user_id, created_at DESC);

CREATE INDEX idx_audit_event_type_created_at
  ON audit_event(event_type, created_at DESC);

COMMIT;
