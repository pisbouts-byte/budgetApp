# MFA Implementation Plan

Last updated: 2026-02-17

## Current State
- Session auth is cookie-based with CSRF protection.
- MFA data model and TOTP setup/enable/disable API scaffolding are now added.
- Login flow currently remains password-first without mandatory second factor enforcement.

## Implemented API Surface
- `GET /auth/mfa/status`
- `POST /auth/mfa/setup`
- `POST /auth/mfa/enable`
- `POST /auth/mfa/disable`
- `POST /auth/mfa/verify-login`

## Proposed Rollout Phases

### Phase 1: Self-Service Enrollment (Now)
- Allow authenticated users to generate TOTP secret and enroll via authenticator app.
- Store encrypted secret and enrollment timestamps.
- Track events in `audit_event`.

### Phase 2: Step-Up Challenge at Login
- If `mfa_enabled=true`, require second factor after password validation.
- Introduce short-lived MFA challenge token.
- Endpoint `POST /auth/mfa/verify-login` is implemented.
- Set auth cookie only after successful TOTP verification.

### Phase 3: Recovery Controls
- Add backup/recovery codes (hashed at rest).
- Add "reset MFA" operational procedure with strong identity verification.
- Add lockout/rate-limit policy for repeated invalid codes.

### Phase 4: UX and Enforcement
- Add UI for setup QR code, status, disable flow, and recovery code download.
- Optionally require MFA before sensitive actions (bank relink, profile changes, data deletion).

## Security Controls
- TOTP: RFC 6238-style, 30-second window, 6 digits, small tolerance window.
- Secrets encrypted at rest.
- Audit logging for setup, enable, disable, failures.
- Existing CSRF and cookie security controls remain in effect.

## Operational Checklist
1. Run DB migration for MFA columns.
2. Verify enrollment endpoint in staging.
3. Roll out login challenge behind a feature flag.
4. Add support documentation for recovery/reset.
5. Monitor failed MFA attempts and alert on anomalies.
