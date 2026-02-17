-- Spending tracker starter schema (PostgreSQL)
-- This is intended as a first migration baseline.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE budget_period AS ENUM ('WEEKLY', 'MONTHLY');
CREATE TYPE transaction_source AS ENUM ('PLAID', 'MANUAL');
CREATE TYPE rule_field AS ENUM ('MERCHANT_NAME', 'ORIGINAL_DESCRIPTION', 'ACCOUNT_NAME', 'MCC', 'PLAID_PRIMARY_CATEGORY', 'PLAID_DETAILED_CATEGORY');
CREATE TYPE rule_operator AS ENUM ('EQUALS', 'CONTAINS', 'STARTS_WITH', 'ENDS_WITH', 'REGEX');

CREATE TABLE app_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  week_start_day SMALLINT NOT NULL DEFAULT 1, -- 0=Sun ... 6=Sat
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (week_start_day BETWEEN 0 AND 6)
);

CREATE TABLE plaid_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  plaid_item_id TEXT NOT NULL UNIQUE,
  access_token_encrypted TEXT NOT NULL,
  institution_id TEXT,
  institution_name TEXT,
  plaid_cursor TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_plaid_item_user_id ON plaid_item(user_id);

CREATE TABLE account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  plaid_item_id UUID REFERENCES plaid_item(id) ON DELETE SET NULL,
  plaid_account_id TEXT UNIQUE,
  name TEXT NOT NULL,
  mask TEXT,
  subtype TEXT,
  type TEXT,
  current_balance NUMERIC(14,2),
  available_balance NUMERIC(14,2),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_account_user_id ON account(user_id);

CREATE TABLE category (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_category_id UUID REFERENCES category(id) ON DELETE SET NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX idx_category_user_id ON category(user_id);

CREATE TABLE transaction (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  source transaction_source NOT NULL DEFAULT 'PLAID',
  external_id TEXT, -- plaid_transaction_id for Plaid rows
  amount NUMERIC(14,2) NOT NULL, -- debit positive, credit negative (normalize in app)
  iso_currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  transaction_date DATE NOT NULL,
  authorized_date DATE,
  merchant_name TEXT,
  original_description TEXT NOT NULL,
  mcc TEXT,
  pending BOOLEAN NOT NULL DEFAULT FALSE,
  is_excluded BOOLEAN NOT NULL DEFAULT FALSE,
  category_id UUID REFERENCES category(id) ON DELETE SET NULL,
  category_source TEXT NOT NULL DEFAULT 'SYSTEM', -- SYSTEM, USER, RULE
  category_confidence NUMERIC(5,4),
  plaid_primary_category TEXT,
  plaid_detailed_category TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE INDEX idx_transaction_user_date ON transaction(user_id, transaction_date DESC);
CREATE INDEX idx_transaction_user_category_date ON transaction(user_id, category_id, transaction_date DESC);
CREATE INDEX idx_transaction_user_excluded_date ON transaction(user_id, is_excluded, transaction_date DESC);
CREATE INDEX idx_transaction_account_id ON transaction(account_id);

CREATE TABLE category_rule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES category(id) ON DELETE CASCADE,
  field rule_field NOT NULL,
  operator rule_operator NOT NULL,
  pattern TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  learned_from_transaction_id UUID REFERENCES transaction(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL DEFAULT 'USER', -- USER or SYSTEM
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_category_rule_user_active_priority ON category_rule(user_id, is_active, priority);
CREATE INDEX idx_category_rule_user_field ON category_rule(user_id, field);

CREATE TABLE category_change_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES transaction(id) ON DELETE CASCADE,
  old_category_id UUID REFERENCES category(id) ON DELETE SET NULL,
  new_category_id UUID REFERENCES category(id) ON DELETE SET NULL,
  create_rule BOOLEAN NOT NULL DEFAULT FALSE,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_category_change_event_user_changed_at ON category_change_event(user_id, changed_at DESC);

CREATE TABLE budget (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  period budget_period NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  category_id UUID REFERENCES category(id) ON DELETE CASCADE, -- null means overall budget
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_start_date DATE NOT NULL,
  effective_end_date DATE,
  include_excluded_transactions BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (amount >= 0),
  CHECK (effective_end_date IS NULL OR effective_end_date >= effective_start_date)
);

CREATE INDEX idx_budget_user_active ON budget(user_id, is_active);
CREATE INDEX idx_budget_user_period ON budget(user_id, period);

CREATE TABLE budget_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL REFERENCES budget(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  spent NUMERIC(14,2) NOT NULL DEFAULT 0,
  remaining NUMERIC(14,2) NOT NULL DEFAULT 0,
  progress_ratio NUMERIC(9,6) NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (budget_id, period_start, period_end)
);

CREATE INDEX idx_budget_snapshot_budget_period ON budget_snapshot(budget_id, period_start DESC);

CREATE TABLE report_preset (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL, -- category_ids, date_range, account_ids, include_excluded
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX idx_report_preset_user_id ON report_preset(user_id);

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

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_app_user_updated_at BEFORE UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_plaid_item_updated_at BEFORE UPDATE ON plaid_item FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_account_updated_at BEFORE UPDATE ON account FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_category_updated_at BEFORE UPDATE ON category FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_transaction_updated_at BEFORE UPDATE ON transaction FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_category_rule_updated_at BEFORE UPDATE ON category_rule FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_budget_updated_at BEFORE UPDATE ON budget FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_report_preset_updated_at BEFORE UPDATE ON report_preset FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sync_job_updated_at BEFORE UPDATE ON sync_job FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
