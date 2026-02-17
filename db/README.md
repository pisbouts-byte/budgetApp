# Database Migrations

Migration tooling: `node-pg-migrate` with SQL migration files.

## Prerequisites
- PostgreSQL running and reachable.
- `DATABASE_URL` set in environment (or root `.env`).
- Dependencies installed: `npm install`

## Commands
- Apply all pending migrations:
  - `npm run db:migrate:up`
- Roll back one migration:
  - `npm run db:migrate:down`
- Create a new SQL migration file:
  - `npm run db:migrate:create -- add_some_change`

## Current Baseline
- Initial schema migration:
  - `/Users/philipisbouts/Documents/New project/db/migrations/001_init_schema.sql`

