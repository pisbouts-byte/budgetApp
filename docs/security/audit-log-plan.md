# Audit Log Plan

Last updated: 2026-02-17

## Objectives
- Provide traceability for security-relevant and compliance-relevant actions.
- Support incident response, fraud investigation, and policy evidence.
- Avoid storing unnecessary sensitive payload data.

## Data Model
`audit_event` table fields:
- `id`
- `user_id` (nullable for unauthenticated events)
- `event_type`
- `event_source`
- `ip_address`
- `user_agent`
- `request_id`
- `metadata` (JSONB)
- `created_at`

## Event Coverage (Implemented)
- `auth.register.success`
- `auth.register.failed`
- `auth.login.success`
- `auth.login.failed`
- `auth.logout`
- `auth.preferences.updated`
- `auth.mfa.setup.started`
- `auth.mfa.enable.failed`
- `auth.mfa.enabled`
- `auth.mfa.disable.failed`
- `auth.mfa.disabled`

## Next Events to Add
- Plaid link success/failure and item exchange outcomes.
- Sync start/success/failure (manual and webhook-triggered).
- Category rule create/update/delete.
- Budget create/update/delete.
- Data deletion and retention purge actions.

## Retention and Access
- Retain audit logs according to legal and business requirements.
- Restrict direct access to audit log table to privileged operators only.
- Export capability should redact sensitive fields.

## Tamper Resistance
- Write path is append-only from application perspective.
- Avoid update/delete permissions except controlled maintenance processes.
- Use database backups and provider-level audit tooling for defense-in-depth.

## Monitoring and Alerts
- Alert on spikes in `auth.login.failed`.
- Alert on repeated MFA failures from same IP/user.
- Alert on unexpected surges in privileged action events.

## Operational Practices
1. Review log schema quarterly.
2. Validate event completeness after each major release.
3. Include request IDs in incident tickets.
4. Periodically test audit-query workflows during tabletop exercises.
