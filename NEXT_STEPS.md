# Next Steps

Use this file to define exactly what should be done first in the next session.

## Next 3 Tasks (In Order)
1. Deploy API to Render and web to Vercel using `/Users/philipisbouts/Documents/New project/docs/deployment/hosted-setup.md`.
2. Execute end-to-end Plaid sandbox verification in hosted environment (link, sync, transactions, webhook).
3. Replace localStorage JWT handling with secure HTTP-only cookie auth.

## Immediate First Command / Check
- `npm run test --workspace @spend/api && npm run build --workspace @spend/web`

## Dependencies / Prerequisites
- Node.js 20+ available locally.
- Postgres must be reachable via `DATABASE_URL` for `db:migrate:up`.
- Plaid sandbox credentials required in `apps/api/.env`.

## If Time Runs Short
- Stop after completing: release readiness verification.
- Minimum handoff updates required:
  - `/Users/philipisbouts/Documents/New project/docs/roadmap.md`
  - `/Users/philipisbouts/Documents/New project/STATUS.md`
  - `/Users/philipisbouts/Documents/New project/NEXT_STEPS.md`
  - `/Users/philipisbouts/Documents/New project/DECISIONS.md` (if new decisions were made)
