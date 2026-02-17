# V1 Launch Checklist

Last updated: 2026-02-17

## Launch Readiness Gates
All items must be `PASS` before go-live.

1. Infrastructure
- API health endpoint returns `200`: `/health`
- API metrics endpoint returns `200`: `/health/metrics`
- Render alerts configured (5xx, latency, memory)
- Uptime monitor active for `https://spend-tracker-api.onrender.com/health`

2. Security
- `NODE_ENV=production`
- Cookie auth works (login persists after refresh, logout clears session)
- Plaid webhook verification enabled (`PLAID_WEBHOOK_VERIFICATION_ENABLED=true`)
- `CORS_ORIGINS` set to production web domain only

3. Data
- Production migrations applied successfully
- Database credentials rotated and verified
- Backup/snapshot policy confirmed in managed Postgres

4. Product Flow (manual smoke)
- Register/login succeeds from hosted web app
- Connect Bank works and accounts load
- Transactions load and `Sync now` works
- Create/edit/delete budget works
- Reports run for preset and custom date ranges

## Go/No-Go Decision
Use this rule:
1. Go
- All readiness gates are `PASS`
- No unresolved `P0/P1` defects
- No active incident in API, DB, or Plaid webhook pipeline
2. No-Go
- Any gate is `FAIL`
- Any auth, data integrity, or payment-linking regression is open
- Error rate or outage symptoms are present before launch

## Rollback Triggers
Roll back immediately if any of the following happen post-launch:
1. API health endpoint fails for 5+ minutes
2. 5xx error rate > 5% for 10+ minutes
3. Login failure rate materially spikes
4. Plaid webhook processing is failing and sync pipeline stalls
5. Database migration defect impacts writes or data integrity

## Rollback Actions
1. Roll API service to previous stable Render deployment.
2. Roll web app to previous stable Vercel deployment (if UI regression).
3. Verify `/health` and `/health/metrics`.
4. Run smoke checks (auth, transactions, sync, budgets, reports).
5. Publish incident update and hold new changes.

## Launch-Day Command Checklist
1. `npm run typecheck --workspace @spend/api`
2. `npm run test --workspace @spend/api`
3. `npm run typecheck --workspace @spend/web`
4. `npm run build --workspace @spend/web`
5. `npm run incident:check`

## First 24 Hours After Launch
1. Check alerts dashboard every 2-4 hours.
2. Review API logs for `request.error` spikes.
3. Confirm Plaid webhooks continue to process.
4. Track support-reported auth/sync issues and triage quickly.
