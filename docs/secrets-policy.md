# Secrets Policy

## Rules
- Never commit real credentials or access tokens.
- Commit only placeholder values in `*.env.example`.
- Load real values through local `.env` files or deployment secret stores.
- Rotate compromised credentials immediately.

## Local Development
- Copy example files:
- `cp /Users/philipisbouts/Documents/New\ project/.env.example /Users/philipisbouts/Documents/New\ project/.env`
- `cp /Users/philipisbouts/Documents/New\ project/apps/api/.env.example /Users/philipisbouts/Documents/New\ project/apps/api/.env`
- `cp /Users/philipisbouts/Documents/New\ project/apps/web/.env.example /Users/philipisbouts/Documents/New\ project/apps/web/.env.local`
- Fill in real values locally.

## Required Sensitive Values
- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `ENCRYPTION_KEY` (64-char hex key for token-at-rest encryption)

## Incident Response
- Revoke leaked keys immediately.
- Rotate keys and restart affected services.
- Audit recent access logs and sync events.
