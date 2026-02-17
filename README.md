# Spending Tracker

Monorepo scaffold for a spending tracker app with Plaid integration, editable categorization, learning rules, budgeting, and reporting.

## Workspace Layout
- `apps/web`: Next.js frontend
- `apps/api`: Express API
- `packages/shared`: Shared TypeScript types/contracts
- `db/schema.sql`: starter PostgreSQL schema
- `docs/roadmap.md`: task roadmap with IDs

## Local Setup
1. Install dependencies:
   - `npm install`
2. Create environment files:
   - `cp .env.example .env`
   - `cp apps/api/.env.example apps/api/.env`
   - `cp apps/web/.env.example apps/web/.env.local`
3. Fill Plaid credentials in `apps/api/.env`.
   - Also set `ENCRYPTION_KEY` (64-char hex) for token encryption.
4. Start API:
   - `npm run dev:api`
5. Start web app:
   - `npm run dev`

## Database Migrations
- Apply migrations:
  - `npm run db:migrate:up`
- Roll back last migration:
  - `npm run db:migrate:down`
- Create new SQL migration:
  - `npm run db:migrate:create -- add_descriptive_name`

## Auth Baseline
- Register user: `POST /auth/register`
- Login: `POST /auth/login`
- Read current user: `GET /auth/me` with `Authorization: Bearer <token>`
- Update user preferences (week start / currency): `PATCH /auth/preferences`

## Plaid Baseline
- Create link token: `POST /plaid/create-link-token`
- Exchange public token: `POST /plaid/exchange-public-token`
- Initial transaction sync: `POST /plaid/transactions/sync`
- Incremental transaction sync: `POST /plaid/transactions/sync-incremental`
- Webhook receiver: `POST /webhooks/plaid`
- Due-job processor (auth required): `POST /webhooks/plaid/process-due`

## Observability Baseline
- Request lifecycle structured logs: `request.start`, `request.finish`, `request.error`
- Startup structured log: `server.start`
- Per-request ID surfaced via `x-request-id` response header
- Health metrics endpoint: `GET /health/metrics`

## Data Lifecycle Baseline
- Deletion preview (user-scoped table counts): `GET /data/deletion-preview`
- Full user data deletion (requires `{"confirm":"DELETE"}`): `DELETE /data/me`
- Retention purge for stale records: `POST /data/retention/purge`

## Deployment Runbook
- Production deployment guide: `docs/deployment/runbook.md`
- Hosted deployment setup (Render + Vercel): `docs/deployment/hosted-setup.md`

## Transactions API Baseline
- List transactions: `GET /transactions`
- Supports filters: account, category, date range, includeExcluded, text search
- Supports pagination and sorting metadata
- Single recategorize: `PATCH /transactions/:transactionId/category`
- Bulk recategorize: `PATCH /transactions/category/bulk`
- Single exclusion toggle: `PATCH /transactions/:transactionId/exclusion`
- Bulk exclusion toggle: `PATCH /transactions/exclusion/bulk`

## Categorization Learning Baseline
- Deterministic rule-priority strategy is documented in:
  - `docs/categorization/rule-priority.md`
- Manual recategorization with `createRule=true` now persists learned `category_rule` entries.
- Apply best matching rule to one transaction:
  - `POST /transactions/:transactionId/apply-category-rules`
- Backfill uncategorized transactions with active rules:
  - `POST /transactions/backfill-category-rules`
- Manage rules:
  - `GET /rules`
  - `POST /rules`
  - `PATCH /rules/:ruleId`
  - `DELETE /rules/:ruleId`

## Budget API Baseline
- List budgets: `GET /budgets`
- Create budget: `POST /budgets`
- Update budget: `PATCH /budgets/:budgetId`
- Delete budget: `DELETE /budgets/:budgetId`
- Budget progress view: `GET /budgets/progress`
- Budget alerts view: `GET /budgets/alerts`

## Budget UI Baseline
- Web app renders budget dashboard cards based on `/budgets/progress`
- Includes spent/remaining indicators, progress bars, and pace labels

## Reporting API Baseline
- Run report query: `POST /reports/query`
- Supports shared filters with grouped outputs (`none`, `category`, `day`, `merchant`)
- Category summary: `POST /reports/category-summary`
- Trend report: `POST /reports/trend`
- Merchant concentration: `POST /reports/merchant-concentration`
- Budget variance: `POST /reports/budget-variance`
- CSV export: `POST /reports/export-csv`
- Report presets:
  - `GET /reports/presets`
  - `POST /reports/presets`
  - `PATCH /reports/presets/:presetId`
  - `DELETE /reports/presets/:presetId`

## Categories API Baseline
- List: `GET /categories`
- Create: `POST /categories`
- Update: `PATCH /categories/:categoryId`
- Delete: `DELETE /categories/:categoryId`

## Transactions UI Baseline
- Web app home renders a transaction table connected to `/transactions`
- Includes controls for token, search, includeExcluded, sorting, page size, and paging

## Current Progress
- Completed: `R00-T01` through `R06-T06` (all roadmap tasks complete)
- Next: manual Plaid sandbox and deployment verification.
