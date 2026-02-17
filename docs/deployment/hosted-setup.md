# Hosted Setup (Production)

This guide deploys:
- API on Render
- Web on Vercel
- PostgreSQL on a managed provider (Render Postgres, Neon, or Supabase)

## 1. Database
1. Provision a PostgreSQL instance.
2. Copy its connection string to `DATABASE_URL`.
3. Run migrations once against production DB:
   - from local machine:
     - `DATABASE_URL=<prod-db-url> npm run db:migrate:up`

## 2. Deploy API (Render)
1. Push repo to GitHub.
2. In Render, create a new Blueprint and point it to this repo.
3. Render uses `/render.yaml` and creates `spend-tracker-api`.
4. Set/verify these env vars in Render:
   - `NODE_ENV=production`
   - `API_PORT=10000` (or keep Render default)
   - `DATABASE_URL`
   - `PLAID_ENV`
   - `PLAID_CLIENT_ID`
   - `PLAID_SECRET`
   - `PLAID_WEBHOOK_URL` (use your Render API URL + `/webhooks/plaid`)
   - `ENCRYPTION_KEY` (64 hex chars)
   - `JWT_SECRET`
   - `JWT_EXPIRES_IN=7d`
   - `AUTH_COOKIE_NAME=spend_auth`
   - `CORS_ORIGINS=https://<your-vercel-domain>`
   - `RATE_LIMIT_WINDOW_MS=60000`
   - `RATE_LIMIT_MAX_REQUESTS=300`
5. Deploy and confirm:
   - `GET https://<render-api-domain>/health`
   - `GET https://<render-api-domain>/health/metrics`
   - Register/login from web works without manual token input (cookie session).

## 3. Deploy Web (Vercel)
1. Import this repo in Vercel.
2. Set project root to `apps/web`.
3. Vercel will use `apps/web/vercel.json`.
4. Add env var:
   - `NEXT_PUBLIC_API_BASE_URL=https://<render-api-domain>`
5. Deploy and open your Vercel URL.

## 4. Plaid Webhook
1. In Plaid Dashboard, set webhook URL to:
   - `https://<render-api-domain>/webhooks/plaid`
2. Trigger a Plaid sandbox webhook test event.
3. Verify API receives and processes the event.

## 5. Post-Deploy Smoke Checks
1. Register/login from web UI.
2. Open menu -> Connect Bank.
3. Confirm transactions load.
4. Create/edit/delete budget.
5. Run a report with custom date range.

## 6. DNS and Custom Domains (Optional)
- Attach custom domain to Vercel web project.
- Attach custom domain to Render API service.
- If API domain changes, update:
  - `NEXT_PUBLIC_API_BASE_URL` in Vercel
  - `PLAID_WEBHOOK_URL` in Render

## 7. Security Follow-Ups Before Broad Release
- Move JWT from localStorage to secure HTTP-only cookies.
- Add Plaid webhook signature verification.
- Add API rate limiting and stricter CORS allowlist.

## 8. Mobile Install (PWA)
After web deployment on HTTPS:
1. Open your Vercel URL on iOS Safari or Android Chrome.
2. Log in once and verify API calls succeed.
3. Install to home screen:
   - iOS Safari: Share -> Add to Home Screen
   - Android Chrome: menu -> Install app / Add to Home screen
4. Launch from home screen and verify:
   - tabs/navigation
   - budget and report forms
   - Plaid connect flow opens correctly
