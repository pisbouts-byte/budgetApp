# Plaid Integration Notes

## Config Source
- API env schema: `/Users/philipisbouts/Documents/New project/apps/api/src/config/env.ts`
- Required values:
  - `PLAID_ENV` (`sandbox` | `development` | `production`)
  - `PLAID_CLIENT_ID`
  - `PLAID_SECRET`
  - `PLAID_WEBHOOK_URL`

## Client Wrapper
- Plaid API client module:
  - `/Users/philipisbouts/Documents/New project/apps/api/src/plaid/client.ts`
- Exports:
  - `plaidClient` configured with env-specific base path and headers.

## Next Endpoint Work
- Completed:
  - `POST /plaid/create-link-token` (auth required)
  - `POST /plaid/exchange-public-token` (auth required)
  - `POST /plaid/transactions/sync` (auth required, initial backfill via `transactions/get`)
  - `POST /plaid/transactions/sync-incremental` (auth required, cursor-based via `transactions/sync`)
  - `POST /webhooks/plaid` (Plaid webhook receiver for transaction updates)
  - Sync job retry + idempotency via `sync_job` table and webhook payload hash key
- Next:
  - `R02-T02`: transaction table UI
