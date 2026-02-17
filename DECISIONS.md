# Decisions Log

Track important decisions that impact architecture, behavior, and product logic.

## D-001: Initial Stack and Data Platform
- Date: 2026-02-12
- Status: Accepted
- Context: Need a maintainable stack for Plaid sync, budgeting logic, and reporting.
- Decision: Use a web app + API service backed by PostgreSQL.
- Consequences:
  - Strong relational modeling for accounts, transactions, rules, budgets.
  - Need migration discipline and background job handling for sync workloads.

### D-002: Monorepo Structure
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Need independent iteration on frontend, backend, and shared types without splitting repositories.
- Decision:
  - Use npm workspaces with:
  - `apps/web` for Next.js frontend
  - `apps/api` for Express backend
  - `packages/shared` for shared TypeScript contracts
- Alternatives considered:
  - Single app repository with no package boundaries
  - Separate repositories per service
- Consequences:
  - Clear separation of concerns and easier ownership boundaries.
  - Requires workspace-aware scripts and dependency management.
- Follow-up tasks:
  - `R00-T02`
  - `R00-T03`

### D-003: Fail-Fast Environment Validation
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Runtime failures from missing env vars are hard to diagnose after startup.
- Decision:
  - Validate API env vars with `zod` during process boot and exit on invalid configuration.
- Alternatives considered:
  - Lazy validation only when each dependency is used
  - No schema validation, rely on docs only
- Consequences:
  - Startup fails early with explicit error messages.
  - Requires keeping validation schema in sync with new env vars.
- Follow-up tasks:
  - `R01-T01`
  - `R06-T01`

### D-004: SQL-First Migration Strategy
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Need deterministic schema evolution from local dev through production.
- Decision:
  - Use `node-pg-migrate` with SQL migration files stored in `db/migrations`.
  - Seed initial migration as `001_init_schema.sql` copied from baseline schema.
- Alternatives considered:
  - Run raw `schema.sql` directly each time
  - Use ORM-generated migrations before API patterns are stable
- Consequences:
  - Explicit migration history and safer incremental schema changes.
  - Requires disciplined migration review before merge.
- Follow-up tasks:
  - `R00-T04`
  - `R06-T06`

### D-005: JWT Auth Baseline
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Need a practical auth baseline before Plaid account linking and user-scoped data APIs.
- Decision:
  - Use bearer JWTs with email/password auth endpoints:
  - `POST /auth/register`
  - `POST /auth/login`
  - `GET /auth/me`
- Alternatives considered:
  - Session cookie auth
  - Defer auth and continue with a single-user prototype
- Consequences:
  - Fast API-level auth enablement for user-scoped resources.
  - Requires secure JWT secret handling and token expiration strategy.
- Follow-up tasks:
  - `R00-T05`
  - `R06-T01`

### D-006: CI Gate Baseline
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Need a repeatable quality gate before adding Plaid workflows and transaction logic.
- Decision:
  - Add GitHub Actions CI running `npm ci`, lint, typecheck, test, and build.
- Alternatives considered:
  - Defer CI until feature-complete
  - Run only typecheck initially
- Consequences:
  - Earlier detection of regressions across the monorepo.
  - Build reliability now depends on scripts staying workspace-safe.
- Follow-up tasks:
  - `R01-T01`
  - `R06-T04`

### D-007: Centralized Plaid Client Wrapper
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Upcoming Plaid flows need consistent environment mapping and auth headers.
- Decision:
  - Create a shared Plaid client module at `apps/api/src/plaid/client.ts`.
  - Keep Plaid env validation in central env schema before app boot.
- Alternatives considered:
  - Instantiate Plaid client ad hoc in each route
  - Defer wrapper until more endpoints exist
- Consequences:
  - Single source of truth for Plaid configuration.
  - Route handlers stay focused on request/response behavior.
- Follow-up tasks:
  - `R01-T02`
  - `R01-T03`

### D-008: Auth-Protected Plaid Link Token Endpoint
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Link tokens must be associated with a specific signed-in user for secure account linking.
- Decision:
  - Implement `POST /plaid/create-link-token` behind bearer auth.
  - Use authenticated `userId` as Plaid `client_user_id`.
- Alternatives considered:
  - Unauthenticated link-token endpoint
  - Use a client-generated identifier instead of server-side user ID
- Consequences:
  - Plaid Link setup is user-scoped from day one.
  - Frontend must authenticate before requesting link tokens.
- Follow-up tasks:
  - `R01-T03`
  - `R01-T04`

### D-009: Transactional Public Token Exchange Persistence
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Linking an item should persist both Plaid item metadata and associated accounts consistently.
- Decision:
  - Implement `POST /plaid/exchange-public-token` to exchange token, fetch accounts, and write `plaid_item` + `account` rows inside a single SQL transaction.
- Alternatives considered:
  - Persist item and accounts in separate non-transactional steps
  - Queue background sync before account upsert
- Consequences:
  - Reduces risk of partial account-link state in DB.
  - Requires careful retry/idempotency handling in later sync tasks.
- Follow-up tasks:
  - `R01-T04`
  - `R01-T07`

### D-010: Initial Backfill via Plaid Transactions API
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Need initial transaction ingest before cursor-based incremental sync is in place.
- Decision:
  - Implement `POST /plaid/transactions/sync` using Plaid `transactions/get` over a configurable date window (default 90 days).
- Alternatives considered:
  - Wait for cursor sync implementation first
  - Backfill in background jobs only
- Consequences:
  - Delivers usable transaction ingestion immediately.
  - Requires follow-up cursor sync (`R01-T05`) to support efficient ongoing updates.
- Follow-up tasks:
  - `R01-T05`
  - `R01-T06`

### D-011: Cursor-Based Incremental Sync Endpoint
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Initial backfill is not efficient for ongoing sync and update/removal handling.
- Decision:
  - Add `POST /plaid/transactions/sync-incremental` using Plaid `transactions/sync` and per-item `plaid_cursor`.
  - Handle added, modified, and removed records explicitly.
- Alternatives considered:
  - Re-run full date-window sync on each update
  - Rely only on webhooks without cursor state
- Consequences:
  - Lower ongoing sync cost and correct removal propagation.
  - Requires webhook + retry/idempotency work to make operations resilient.
- Follow-up tasks:
  - `R01-T06`
  - `R01-T07`

### D-012: Webhook-Triggered Incremental Sync
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Transaction updates should arrive from Plaid webhooks and trigger fresh data sync.
- Decision:
  - Add `POST /webhooks/plaid` and trigger incremental sync when `webhook_type` is `TRANSACTIONS`.
  - Reuse shared incremental sync service instead of duplicating logic.
- Alternatives considered:
  - Poll-only synchronization without webhooks
  - Webhook handler that only records events and does not sync
- Consequences:
  - Data can update in near real-time when Plaid sends webhook events.
  - Need idempotency/retry hardening for production reliability.
- Follow-up tasks:
  - `R01-T07`
  - `R02-T01`

### D-013: Persistent Sync Jobs with Idempotency Keys
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Duplicate webhooks and transient Plaid/API failures can cause duplicate work or missed updates.
- Decision:
  - Persist sync jobs in `sync_job` with unique `idempotency_key`.
  - Generate key from webhook payload hash.
  - On failure, transition job to `RETRY` with exponential backoff; transition to `FAILED` after max attempts.
- Alternatives considered:
  - Stateless immediate processing only
  - In-memory retry tracking
- Consequences:
  - Better resilience and deduplication across webhook retries.
  - Requires operational visibility and eventual endpoint hardening for job processing.
- Follow-up tasks:
  - `R02-T01`
  - `R06-T03`

### D-014: Transaction List API Contract First
- Date: 2026-02-12
- Status: Accepted
- Context:
  - UI work needs a stable query contract for sorting/filtering/pagination.
- Decision:
  - Implement `GET /transactions` before transaction table UI.
  - Restrict sortable fields to a whitelist and enforce query validation with `zod`.
- Alternatives considered:
  - Build UI first and adjust API later
  - Expose unrestricted sort/query fields
- Consequences:
  - Frontend can integrate against a stable and safer query interface.
  - Additional list/report endpoints can reuse the same filtering conventions.
- Follow-up tasks:
  - `R02-T02`
  - `R05-T01`

### D-015: Token-Driven Transaction Table UI First
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Need immediate validation that `GET /transactions` supports UI flows before full auth UX exists.
- Decision:
  - Implement transaction table page with manual JWT input for now.
  - Include core controls (search, excluded toggle, sort, page size, pagination).
- Alternatives considered:
  - Delay UI until auth/session UX is complete
  - Use hardcoded mock data
- Consequences:
  - Fast integration testing of live transaction API behavior.
  - UX refinement and proper auth state management remain follow-up work.
- Follow-up tasks:
  - `R02-T03`
  - `R00-T04`

### D-016: Category CRUD via API Before Recategorization
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Recategorization and rules require stable category management primitives.
- Decision:
  - Implement `categories` CRUD endpoints before transaction recategorization endpoints.
  - Enforce user ownership checks and block deletion of system categories.
- Alternatives considered:
  - Hardcode fixed categories and add CRUD later
  - Build recategorization endpoints first
- Consequences:
  - Downstream category assignment flows can rely on validated category lifecycle.
  - Additional cycle/graph constraints for deep category trees remain future hardening work.
- Follow-up tasks:
  - `R02-T04`
  - `R02-T05`

### D-017: Recategorization Writes Explicit Audit Events
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Category changes should be traceable and feed future rule-learning flows.
- Decision:
  - `PATCH /transactions/:transactionId/category` updates category and writes `category_change_event`.
  - Include `createRule` intent flag in audit payload.
- Alternatives considered:
  - Update transaction category without audit event
  - Defer audit writes until bulk recategorization
- Consequences:
  - Stronger traceability and cleaner integration point for rule creation logic.
  - Requires consistent audit behavior for future bulk recategorization endpoint.
- Follow-up tasks:
  - `R02-T05`
  - `R03-T02`

### D-018: Bulk Recategorization Endpoint Mirrors Single-Change Audit Semantics
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Users need efficient multi-transaction category updates without losing audit trail consistency.
- Decision:
  - Add `PATCH /transactions/category/bulk` with `transactionIds`, `categoryId`, `createRule`.
  - Apply same audit semantics as single recategorization (`category_change_event` per transaction).
- Alternatives considered:
  - Client-side loop calling single recategorize endpoint
  - Bulk update without per-transaction audit entries
- Consequences:
  - Lower API round-trips for high-volume category cleanup.
  - Current implementation can be further optimized for very large batches.
- Follow-up tasks:
  - `R02-T06`
  - `R03-T02`

### D-019: Explicit Exclusion Toggle Endpoints
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Budget and reporting logic needs a first-class mechanism to ignore selected transactions.
- Decision:
  - Add single and bulk exclusion endpoints:
  - `PATCH /transactions/:transactionId/exclusion`
  - `PATCH /transactions/exclusion/bulk`
- Alternatives considered:
  - Reuse generic transaction update endpoint
  - Toggle exclusion only in frontend state
- Consequences:
  - Budget/report services can rely on persisted `is_excluded` state.
  - Requires authorization and test coverage hardening before production.
- Follow-up tasks:
  - `R03-T01`
  - `R04-T05`

### D-020: Learned Rule Candidate from Manual Recategorization
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Users requested category changes should inform future auto-categorization behavior.
- Decision:
  - On single recategorization with `createRule=true`, derive one deterministic rule candidate from the source transaction and insert into `category_rule` if no active duplicate exists.
- Alternatives considered:
  - Store only audit events and defer all rule creation
  - Create multiple rules per transaction in one action
- Consequences:
  - Immediate feedback loop from user corrections into rule set.
  - Requires follow-up matcher and backfill implementation to apply these rules at scale.
- Follow-up tasks:
  - `R03-T03`
  - `R03-T05`

### D-021: Deterministic Rule Tie-Breaking
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Multiple active rules can match a transaction; selection must be deterministic.
- Decision:
  - Select matched rule by:
  - lowest `priority`
  - then highest specificity score (operator + pattern length)
  - then earliest `created_at`
  - then stable id order
- Alternatives considered:
  - First match by insertion order only
  - Random or last-updated preference
- Consequences:
  - Predictable rule behavior across runs and environments.
  - Requires clear docs and consistent rule authoring UX.
- Follow-up tasks:
  - `R03-T05`
  - `R03-T07`

### D-022: Backfill Endpoint Uses Existing Rules Snapshot
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Applying rules transaction-by-transaction should avoid repeated rule fetch overhead.
- Decision:
  - `POST /transactions/backfill-category-rules` fetches active rules once per request and applies deterministic matching in memory for candidate transactions.
- Alternatives considered:
  - Query active rules per transaction
  - Fully SQL-based matching in this phase
- Consequences:
  - Better backfill throughput and deterministic behavior.
  - Future optimization may still be needed for very large datasets.
- Follow-up tasks:
  - `R03-T07`
  - `R06-T03`

### D-023: Rule Management via Unified Rules API
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Users need direct control over learned and manual categorization rules.
- Decision:
  - Add `/rules` CRUD API and expose rule management controls in web UI.
  - Keep field/operator/pattern/priority/isActive editable in one endpoint.
- Alternatives considered:
  - Read-only rules list and rely only on auto-learned updates
  - Separate toggle endpoint instead of unified patch
- Consequences:
  - Faster iteration for rule quality tuning by end users.
  - Requires stronger validation/testing for malformed regex and conflicting rules.
- Follow-up tasks:
  - `R04-T01`
  - `R06-T04`

### D-024: Budget Progress Computed from Period Windows + Exclusion Policy
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Budget tracking needs consistent period boundaries and predictable exclusion handling.
- Decision:
  - Compute budget progress using utility-derived period windows that respect user `weekStartDay`.
  - Exclude transactions with `is_excluded=true` unless the budget explicitly allows included excluded transactions.
- Alternatives considered:
  - Fixed Monday/Sunday week windows for all users
  - Always include excluded transactions in budget math
- Consequences:
  - Weekly budgeting aligns with user preference and budget intent.
  - Requires endpoint-level validation against real transaction data for edge cases.
- Follow-up tasks:
  - `R04-T06`
  - `R05-T01`

### D-025: Budget Dashboard Reuses Progress API
- Date: 2026-02-12
- Status: Accepted
- Context:
  - UI cards/charts should not duplicate period and budget math logic already implemented on API side.
- Decision:
  - Render budget dashboard cards from `/budgets/progress` response.
  - Keep client focused on presentation (progress bars + pace labels) only.
- Alternatives considered:
  - Recompute budget math client-side
  - Create a second dashboard-only endpoint with duplicate logic
- Consequences:
  - Single source of truth for budget calculations.
  - Frontend responsiveness depends on progress endpoint performance.
- Follow-up tasks:
  - `R04-T07`
  - `R05-T01`

### D-026: Threshold Alerts as Query-Time Signals
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Users need early warning on budget overrun risk without implementing notification infrastructure yet.
- Decision:
  - Add `GET /budgets/alerts` that evaluates current progress/pace against configurable thresholds.
- Alternatives considered:
  - Persist alert rows on a schedule first
  - Skip alerts until notification system is implemented
- Consequences:
  - Immediate alert visibility for UI and automation consumers.
  - Notification delivery remains a separate concern.
- Follow-up tasks:
  - `R05-T01`
  - `R06-T03`

### D-027: Unified Reporting Query Endpoint with Group Modes
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Reporting features need a stable API foundation before specialized report screens are added.
- Decision:
  - Add `POST /reports/query` with shared filter set and `groupBy` modes:
  - `none`, `category`, `day`, `merchant`
- Alternatives considered:
  - Separate endpoint for each report type from the start
  - Only raw transaction export API
- Consequences:
  - Faster delivery for subsequent report views with consistent filter semantics.
  - Endpoint complexity grows as specialized report requirements expand.
- Follow-up tasks:
  - `R05-T02`
  - `R05-T03`

### D-028: Dedicated Report Endpoints on Top of Shared Filters
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Product-facing report views benefit from explicit endpoints rather than overloading a single query mode.
- Decision:
  - Add specialized endpoints:
  - `POST /reports/category-summary`
  - `POST /reports/trend`
  - `POST /reports/merchant-concentration`
  - Reuse shared filter contract and where-clause builder.
- Alternatives considered:
  - Use only `POST /reports/query` with client-side interpretation
  - Build each report with duplicated filtering logic
- Consequences:
  - Clearer contracts for each report view.
  - Additional endpoint surface to maintain and test.
- Follow-up tasks:
  - `R05-T05`
  - `R05-T06`

### D-029: Budget Variance Report Reuses Budget Progress Inputs
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Budget variance should align with budget period logic and exclusion policy already used elsewhere.
- Decision:
  - Implement `POST /reports/budget-variance` with period windows driven by user week-start settings and budget includeExcluded policy.
- Alternatives considered:
  - Variance query based on fixed calendar windows only
  - Client-side variance calculation from separate APIs
- Consequences:
  - Consistent variance interpretation across budget dashboard and reports.
  - Endpoint complexity grows with future budget feature expansion.
- Follow-up tasks:
  - `R05-T06`
  - `R05-T07`

### D-030: Reporting Exports and Presets in Reporting Phase
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Reporting workflows require shareable outputs and reusable filter setups.
- Decision:
  - Add CSV export endpoint (`POST /reports/export-csv`).
  - Add report preset CRUD endpoints (`/reports/presets`) backed by `report_preset`.
- Alternatives considered:
  - Postpone export/presets to hardening phase
  - Client-only local preset storage
- Consequences:
  - Enables immediate practical reporting workflows.
  - Increases API surface and test requirements for report lifecycle endpoints.
- Follow-up tasks:
  - `R06-T01`
  - `R06-T04`

### D-031: Encrypt Plaid Access Tokens with App-Level AES-GCM
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Plaid access tokens are highly sensitive and must not be stored as plaintext.
- Decision:
  - Encrypt token payloads with AES-256-GCM before storing in `plaid_item.access_token_encrypted`.
  - Require `ENCRYPTION_KEY` (64-char hex) in environment.
  - Support temporary legacy plaintext fallback for pre-encryption rows.
- Alternatives considered:
  - Rely solely on database-level encryption features
  - Delay encryption until production deployment
- Consequences:
  - New writes are encrypted at rest immediately.
  - Legacy rows should be re-encrypted in a follow-up migration task.
- Follow-up tasks:
  - `R06-T02`
  - `R06-T04`

### D-032: Scope Due Sync Job Processing to Authenticated User
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Unscoped due-job processing could let one authenticated caller trigger global job processing.
- Decision:
  - Require auth for `/webhooks/plaid/process-due`.
  - Process only due sync jobs owned by the authenticated user.
- Alternatives considered:
  - Keep endpoint unauthenticated
  - Keep endpoint authenticated but process all users' jobs
- Consequences:
  - Reduced cross-user operational risk.
  - Admin/global worker processing should be implemented separately if needed.
- Follow-up tasks:
  - `R06-T03`
  - `R06-T04`

### D-033: Request-Centric Observability Baseline in API Middleware
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Need immediate operational visibility before adding broad test coverage and release runbook work.
- Decision:
  - Add structured JSON logging for request start/finish/error events.
  - Generate and return `x-request-id` for every API request.
  - Track in-memory request metrics (total, status class counts, avg/max duration) and expose through `GET /health/metrics`.
- Alternatives considered:
  - Add only ad-hoc `console.log` statements per route
  - Defer metrics endpoint until external monitoring stack is selected
- Consequences:
  - Faster diagnosis for failures and latency issues during development.
  - Metrics reset on process restart; external sink/instrumentation is still needed for production-grade retention.
- Follow-up tasks:
  - `R06-T04`
  - `R06-T06`

### D-034: User-Scoped Data Lifecycle Controls (Preview, Delete, Retention Purge)
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Need explicit controls for privacy-driven account deletion and bounded growth of operational/audit tables.
- Decision:
  - Add authenticated data lifecycle endpoints:
  - `GET /data/deletion-preview` for per-table delete impact counts.
  - `DELETE /data/me` requiring explicit `confirm: "DELETE"` to remove the user row and cascade user-owned data.
  - `POST /data/retention/purge` for user-scoped cleanup of stale `category_change_event`, `budget_snapshot`, and terminal `sync_job` rows.
- Alternatives considered:
  - Database-only retention jobs with no API entry points
  - Soft-delete users without immediate hard-deletion option
- Consequences:
  - Clear and auditable workflow for user-requested deletion and retention maintenance.
  - Full production rollout still needs scheduled automation/operator runbook coverage.
- Follow-up tasks:
  - `R06-T04`
  - `R06-T06`

### D-035: Deployment Readiness via Versioned Runbook
- Date: 2026-02-12
- Status: Accepted
- Context:
  - Release hardening needs repeatable operational steps beyond code changes.
- Decision:
  - Add a versioned deployment runbook at `docs/deployment/runbook.md` covering:
  - environment prerequisites
  - pre-deploy checks
  - migration/deploy sequence
  - post-deploy verification
  - rollback and incident notes
- Alternatives considered:
  - Keep deployment steps only in tribal knowledge
  - Defer operational documentation until first production incident
- Consequences:
  - Lower release risk and faster operator onboarding.
  - Runbook must be maintained as infra/process changes over time.
- Follow-up tasks:
  - `R06-T04`

### D-036: Sandbox-Compatible API Test Strategy for Hardening
- Date: 2026-02-12
- Status: Accepted
- Context:
  - The execution environment blocks socket listeners, which prevents network-bound smoke tests.
- Decision:
  - Use handler-level and middleware-level tests with stubs/mocks for DB and response objects.
  - Run tests through `node --import tsx --test` and include both root and nested `*.test.ts` files.
- Alternatives considered:
  - Defer all smoke tests until non-sandbox environments only
  - Introduce additional HTTP test frameworks immediately
- Consequences:
  - Reliable CI-friendly coverage without requiring open ports.
  - Live end-to-end coverage still requires manual or dedicated integration environments.
- Follow-up tasks:
  - Post-roadmap: add DB-backed and live-environment e2e verification.

## Decision Template
Copy this block for each new decision:

### D-XXX: <Short title>
- Date: <!-- YYYY-MM-DD -->
- Status: Proposed | Accepted | Superseded
- Context:
  - <!-- What problem is being solved -->
- Decision:
  - <!-- Exact choice -->
- Alternatives considered:
  - <!-- Option A -->
  - <!-- Option B -->
- Consequences:
  - <!-- Benefit -->
  - <!-- Tradeoff -->
- Follow-up tasks:
  - <!-- Roadmap task IDs -->

## Superseded Decisions
- <!-- D-XXX superseded by D-YYY on YYYY-MM-DD -->
