# Plaid Live Cutover Checklist

Last updated: 2026-02-17

## Scope
Move hosted app from Plaid Sandbox to Plaid Production with controlled validation and rollback.

## Preconditions
1. Hosted web/API are stable in sandbox.
2. Monitoring is active:
- Render alerts (5xx, latency, memory)
- Uptime monitor on `/health`
3. Security controls are enabled:
- cookie auth
- CSRF protection
- webhook signature verification
4. Production DB backup/snapshot is current.

## Step 1: Prepare Plaid Production Credentials
In Plaid Dashboard (Production):
1. Copy `client_id`
2. Copy `secret`
3. Confirm webhook URL will be:
- `https://spend-tracker-api.onrender.com/webhooks/plaid`

## Step 2: Update Render API Environment
In Render service `spend-tracker-api`, set:
1. `PLAID_ENV=production`
2. `PLAID_CLIENT_ID=<plaid production client id>`
3. `PLAID_SECRET=<plaid production secret>`
4. `PLAID_WEBHOOK_URL=https://spend-tracker-api.onrender.com/webhooks/plaid`
5. `PLAID_WEBHOOK_VERIFICATION_ENABLED=true`

Keep these unchanged:
1. `CORS_ORIGINS=https://budget-app-web-pi.vercel.app`
2. `AUTH_COOKIE_NAME=spend_auth`
3. `AUTH_CSRF_COOKIE_NAME=spend_csrf`

Redeploy API after saving.

## Step 3: Update Plaid Dashboard Webhook
In Plaid Dashboard (Production app):
1. Set webhook URL to:
- `https://spend-tracker-api.onrender.com/webhooks/plaid`
2. Save.

## Step 4: Immediate Verification (15 minutes)
1. API health checks:
- `GET https://spend-tracker-api.onrender.com/health`
- `GET https://spend-tracker-api.onrender.com/health/metrics`
2. Web auth:
- login
- refresh page (session persists)
- logout
3. Plaid connect:
- connect a real institution
- confirm accounts load
- run `Sync now`
4. Reports/budgets:
- transactions appear in reports
- budgets still compute correctly

## Step 5: Webhook Verification Check
1. Trigger a Plaid production webhook event (or wait for a natural transaction update).
2. Confirm Render logs show successful `/webhooks/plaid` processing.
3. Confirm transactions update after webhook-triggered sync.

## Step 6: Go/No-Go
Go:
1. health endpoints stable
2. no webhook signature failures
3. no material increase in 5xx errors
4. live account linking + sync works

No-Go:
1. persistent 5xx on Plaid endpoints
2. webhook failures or signature verification failures
3. live sync not updating transactions

## Rollback Plan (Fast)
If cutover fails:
1. In Render, revert:
- `PLAID_ENV=sandbox`
- `PLAID_CLIENT_ID=<sandbox id>`
- `PLAID_SECRET=<sandbox secret>`
2. Redeploy API.
3. Re-validate `/health` and login.
4. Post incident update and pause rollout.

## Post-Cutover (First 24 Hours)
1. Watch alerts dashboard every 2-4 hours.
2. Monitor `request.error` spikes in logs.
3. Track Plaid webhook processing success.
4. Validate user-reported sync issues immediately.
