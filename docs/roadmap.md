# Spending Tracker Roadmap

Status legend: `[ ]` not started, `[~]` in progress, `[x]` done.

## R00 Project Foundation
- [x] `R00-T01` Initialize app scaffold (frontend, backend, shared types).
- [x] `R00-T02` Configure environment management (`.env.example`, secrets policy).
- [x] `R00-T03` Set up Postgres + migration tool.
- [x] `R00-T04` Add auth baseline (session/JWT, user table hookup).
- [x] `R00-T05` Create CI for lint, typecheck, tests.

## R01 Plaid Integration + Sync
- [x] `R01-T01` Create Plaid client wrapper and config validation.
- [x] `R01-T02` Implement `create_link_token` endpoint.
- [x] `R01-T03` Implement `public_token -> access_token` exchange + account persistence.
- [x] `R01-T04` Add initial transactions sync (`/transactions/sync`).
- [x] `R01-T05` Add incremental sync using `plaid_cursor`.
- [x] `R01-T06` Add webhook endpoint (transactions updates).
- [x] `R01-T07` Add idempotency + retry strategy for sync jobs.

## R02 Transaction Management + Categories
- [x] `R02-T01` Build transaction list API (filter, sort, paging).
- [x] `R02-T02` Build transaction table UI.
- [x] `R02-T03` Add category CRUD.
- [x] `R02-T04` Add recategorize action on single transaction.
- [x] `R02-T05` Add bulk recategorize.
- [x] `R02-T06` Add include/exclude toggle for budget calculations.
- [x] `R02-T07` Store category change audit entries.

## R03 Learning Categorization Rules
- [x] `R03-T01` Define deterministic matching strategy order.
- [x] `R03-T02` Create rule creation flow after manual recategorization.
- [x] `R03-T03` Implement rule matcher (merchant/name/account/mcc patterns).
- [x] `R03-T04` Add rule priority + tie-break logic.
- [x] `R03-T05` Backfill uncategorized transactions with new rules.
- [x] `R03-T06` Add confidence score fields for model/rule output.
- [x] `R03-T07` Build rule management UI (enable/disable/edit/delete).

## R04 Budgets + Progress
- [x] `R04-T01` Add budget CRUD (weekly/monthly, overall/category).
- [x] `R04-T02` Add configurable week start day per user.
- [x] `R04-T03` Implement period window utility respecting week start.
- [x] `R04-T04` Build budget progress service (spent, remaining, pace).
- [x] `R04-T05` Exclude flagged transactions from budget math.
- [x] `R04-T06` Build budget dashboard API + UI cards/charts.
- [x] `R04-T07` Add budget threshold alerts (optional notifications).

## R05 Reporting
- [x] `R05-T01` Build report query API with filter set (category/date/account/includeExcluded).
- [x] `R05-T02` Add category summary report.
- [x] `R05-T03` Add trend report (week-over-week, month-over-month).
- [x] `R05-T04` Add merchant concentration report.
- [x] `R05-T05` Add budget variance report.
- [x] `R05-T06` Add CSV export.
- [x] `R05-T07` Save named report presets.

## R06 Hardening + Release
- [x] `R06-T01` Encrypt sensitive tokens at rest.
- [x] `R06-T02` Add RBAC/ownership checks on all APIs.
- [x] `R06-T03` Add structured logs + metrics + error tracking.
- [x] `R06-T04` Add comprehensive tests (unit/integration/e2e smoke).
- [x] `R06-T05` Add data retention + deletion workflow.
- [x] `R06-T06` Prepare production deployment runbook.

## Session Slice Guidance
- Session A: `R00-T01` through `R00-T03`
- Session B: `R00-T04` through `R01-T02`
- Session C: `R01-T03` through `R01-T05`
- Session D: `R01-T06` through `R02-T02`
- Session E: `R02-T03` through `R02-T07`
- Session F: `R03-T01` through `R03-T04`
- Session G: `R03-T05` through `R04-T03`
- Session H: `R04-T04` through `R04-T07`
- Session I: `R05-T01` through `R05-T04`
- Session J: `R05-T05` through `R06-T06`

## End-of-Session Handoff Checklist
- [ ] Update status of completed task IDs in this file.
- [ ] Update `/STATUS.md` with completed work + known issues.
- [ ] Update `/NEXT_STEPS.md` with next 3 tasks by ID.
- [ ] Update `/DECISIONS.md` for any architecture or behavior decision.
- [ ] Ensure tests for changed behavior are passing.
