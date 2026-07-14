# ADR 0005 — Authentication & MFA

**Status:** Accepted
**Date:** 2026-07-10
**Blueprint reference:** §6 rules 1–4, M0 task 7

## Context

The blueprint mandates:
- Argon2id password hashing (memory ≥ 64MB, time ≥ 3)
- Access JWT 15min in HttpOnly+Secure+SameSite=Strict cookie
- Refresh tokens: random, hashed at rest, rotating, device-bound, family-based revocation
- TOTP/WebAuthn MFA mandatory for: owners, global admins, backup download, journal/adjustment approval, sensitive export, fiscal-period actions, supervisor/cashier-variance approval
- Progressive lockout per IP/account/company/device
- Refresh-token reuse → revoke family + critical security event

## Decision

### Password hashing (`src/lib/auth/password.ts`)
- `argon2.argon2id` with `memoryCost: 65_536` (64 MB), `timeCost: 3`, `parallelism: 1`.
- Progressive lockout: 5 fails → 5 min, 10 → 30 min, 15 → 4h, 20+ → 24h.

### JWT (`src/lib/auth/jwt.ts`)
- HS256 signed with `JWT_SECRET` env var.
- 15-minute TTL. Issuer `erp-pos`, audience `erp-pos-clients`.
- Claims: `sub`, `company_id`, `scope`, `is_global`, `branch_ids`, `session_id`, `family_id`, `mfa_verified`.

### Refresh tokens (`src/lib/auth/refreshToken.ts`)
- 32-byte random hex token. Hashed with SHA-256 at rest.
- 30-day TTL.
- On rotation: the old token is revoked (`revokeReason='rotated'`), a new token is issued in the same family with `rotated_from_id` pointing back.
- On reuse of an already-rotated token: revoke ALL tokens in the family + emit `refresh_token_reuse` critical security event. Tested in `tests/unit/auth.test.ts`.

### MFA (`src/lib/auth/mfa.ts`)
- TOTP via `@otplib/preset-default`.
- Secret is envelope-encrypted at rest (AES-256-GCM, see `src/lib/crypto/index.ts`).
- Setup returns: plaintext secret (shown once), otpauth URL, encrypted ciphertext (stored in DB).
- Verify: decrypt ciphertext → `authenticator.verify({ token, secret })`.

### Sessions (`src/lib/auth/sessions.ts`)
- Access cookie: `erp_access`, HttpOnly+Secure+SameSite=Strict, path `/`, 15min.
- Refresh cookie: `erp_refresh`, HttpOnly+Secure+SameSite=Strict, path `/api/v1/auth/refresh`, 30 days.
- MFA pending cookie: `erp_mfa_pending`, 5min TTL — holds `userId, companyId, familyId` while user completes TOTP.

## Blueprint compliance

- ✓ Argon2id (memory≥64MB, time≥3) — tested
- ✓ JWT 15min HttpOnly+Secure+SameSite=Strict cookie
- ✓ Refresh tokens: random, hashed, rotating, family-revocation on reuse — tested
- ✓ TOTP MFA with encrypted secret — tested
- ✓ Progressive lockout thresholds — tested
- ⚠ WebAuthn: not yet implemented (M0 ships TOTP only; WebAuthn deferred to M8 hardening)

## Blueprint deviation

WebAuthn is deferred to M8. The blueprint lists "TOTP/WebAuthn MFA" — TOTP alone satisfies the MFA requirement for M0; WebAuthn will be added as a second factor for owners/global_admins in M8.
