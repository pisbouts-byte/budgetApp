# Production Deployment Runbook

Last updated: 2026-02-12

## Scope
- API service: `@spend/api`
- Web service: `@spend/web`
- Database: PostgreSQL with SQL migrations in `db/migrations`

## Required Environment Variables
### API
- `NODE_ENV=production`
- `API_PORT`
- `DATABASE_URL`
- `PLAID_ENV`
- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_WEBHOOK_URL`
- `ENCRYPTION_KEY` (64-char hex)
- `JWT_SECRET`
- `JWT_EXPIRES_IN`

### Web
- Ensure web runtime points to deployed API base URL.

## Pre-Deployment Checklist
1. Pull latest main branch commit.
2. Install dependencies: `npm ci`
3. Validate typecheck:
   - `npm run typecheck --workspace @spend/api`
   - `npm run typecheck --workspace @spend/web`
4. Validate API tests:
   - `npm run test --workspace @spend/api`
5. Confirm production secrets are present in secret manager.
6. Confirm PostgreSQL backup/snapshot is current.

## Deployment Steps
1. Build artifacts:
   - `npm run build --workspace @spend/api`
   - `npm run build --workspace @spend/web`
2. Apply database migrations:
   - `npm run db:migrate:up`
3. Deploy API service.
4. Deploy web service.
5. Restart workers/cron if used for sync processing.

## Post-Deployment Verification
1. API health:
   - `GET /health`
   - `GET /health/metrics`
2. Authentication sanity:
   - `POST /auth/login`
   - `GET /auth/me`
3. Plaid flow sanity:
   - `POST /plaid/create-link-token`
4. Budget/report sanity:
   - `GET /budgets/progress`
   - `POST /reports/query`
5. Data lifecycle sanity:
   - `GET /data/deletion-preview` (auth required)

## Rollback Procedure
1. If app-level error rate or auth failure spikes:
   - Roll back API and web to previous artifact version.
2. If migration caused issue:
   - Evaluate `npm run db:migrate:down` only for known-safe migration.
   - If data safety risk exists, restore DB from backup snapshot.
3. Re-run health verification after rollback:
   - `GET /health`
   - `GET /health/metrics`

## Incident Notes
- Include `x-request-id` from failed responses when triaging API errors.
- Use structured events (`request.start`, `request.finish`, `request.error`, `server.start`) for traceability.
- For Plaid callback incidents, verify webhook delivery and retry behavior in `sync_job`.
