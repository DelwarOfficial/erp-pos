# ADR 0004 — Idempotency Middleware

**Status:** Accepted
**Date:** 2026-07-10
**Blueprint reference:** §5.3 idempotency_requests, §5 Section 12, §6 rule 4

## Context

Every business mutation MUST be idempotent. The `Idempotency-Key` HTTP header is required on every POST/PUT/PATCH. Same key + same payload returns the stored committed response. Same key + different payload returns 409 `IDEMPOTENCY_KEY_REUSED`.

## Decision

Implementation in `src/lib/idempotency/index.ts`:

1. **On entry**: `INSERT INTO idempotency_requests (..., status='processing', expires_at=now+24h)`. The `idempotency_key` column is `@unique` — a duplicate insert throws.
2. **On unique violation**: look up the existing row.
   - If `companyId` differs → critical security event + 409.
   - If `request_hash` differs → high-severity security event + 409 `IDEMPOTENCY_KEY_REUSED`.
   - If `status='processing'` → 409 `CONCURRENT_MODIFICATION` (another request in flight).
   - If `status='succeeded'` or `'failed'` → replay the stored response (`isReplay=true`).
3. **On success**: `UPDATE idempotency_requests SET status='succeeded', response_status, response_body, completed_at, resource_type, resource_id`.
4. **On failure**: `UPDATE idempotency_requests SET status='failed', response_status, response_body=error JSON, completed_at`.

## Request hash

`requestHash = sha256(JSON.stringify({ method, path, body }))`. The body is the parsed JSON payload, so key order is canonical (Zod parsing normalizes it). Query string params are part of `path`.

## TTL

Default 24 hours. The `expires_at` column is indexed. A scheduled worker (M7) will delete expired rows. Replays after expiry are treated as fresh requests.

## SQLite sandbox note

The blueprint specifies `UNIQUE(company_id, idempotency_key)` — a composite unique. SQLite supports this, but Prisma's `@unique` annotation is column-level. We use `@unique` on `idempotencyKey` (globally unique) and validate `companyId` match in the catch block. Production migration will use a composite unique constraint.

## Blueprint compliance

- ✓ Same key + same hash → stored response (tested)
- ✓ Same key + different hash → 409 + security event (tested)
- ✓ `Idempotency-Key` header required on mutations
- ✓ Stored response includes status, body, resource type/id
- ✓ Concurrent in-flight detection
- ✓ Cross-tenant reuse detection + critical security event
