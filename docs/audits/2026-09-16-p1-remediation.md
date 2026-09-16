# P1 remediation evidence — 2026-09-16

Baseline: c5f68d6e332bfe0ca2db4e46128587a9a6dcffba, main, clean working tree.
Scope: four user-specified blockers only. No production access, deployment or remote push.

## Changes

1. Reconciliation records PASS / FINDING / CHECK_ERROR for every mandatory check.
   Any execution/persistence error forces failed status. Safe metadata includes
   check code, run ID, phase, elapsed time and whitelisted Prisma code; no raw SQL,
   bind parameters, driver message or stack. Removed four error-to-zero fallbacks.
   Failed finding persistence remains visible in run summary; failed summary
   persistence rejects the runner instead of returning success.
2. Gift-card authority is SUM(gift_card_transactions.amount_delta), not active
   card face value. Compare credit_base minus debit_base for the tenant-mapped
   liability account in posted/reversed journals; exclude drafts and other tenants.
   Original reversed journals remain in GL together with compensating entries.
   Arithmetic uses Decimal precision 80; exact string values preserve precision.
   Missing/foreign mapping produces controlled CHECK_ERROR. Current ledger has no
   currency dimension: deltas represent company-base amounts. No issuance/posting
   workflow was changed.
3. MFA limiter uses dedicated request-scoped Redis connections, disabled offline
   queue/reconnect retries, 1s connect/command limits and 1.5s overall deadline.
   Connections disconnect after completion. Redis failure before verification
   remains fail-closed in production. After successful verification, failed reset
   retains quota until TTL and returns the already-authorized response.
   Challenge consumption is irreversible. Session token, success audit and cookie
   preparation are transactional; preparation/audit failure creates no session and
   does not re-enable the consumed challenge. Cookies are returned only after commit.
4. Current backup/migration instructions now target MariaDB. Logical dump includes
   routines/events/triggers, private artifacts, checksum and completion marker.
   Restore forces local TCP/new disposable target, rejects overwrite and checksum
   mismatch, stops on SQL errors (even if defaults enable force), never drops a DB.
   Removed embedded defaults and unsupported PostgreSQL recovery claims.

## Executed verification

All database tests target local MariaDB 11.8.6, loopback port 43318, explicitly
disposable synthetic databases. No production environment files loaded.

| Command / check | Result |
| --- | --- |
| `node scripts/verify-access-tests.mjs` (final full run) | 920 passed, 5 skipped, 0 failed; 66 test files passed, 1 skipped |
| Focused auth/MFA/reconciliation run through same runner | 67 passed, 0 failed (before addition of final DB failure-persistence test) |
| Final full-run reconciliation unit tests | 14 passed |
| Final full-run reconciliation MariaDB integration tests | 5 passed |
| Final full-run MFA outage tests | 7 passed |
| Direct MariaDB MFA session/rollback/concurrent verification | 3 passed in focused run |
| Bash `-n` on both backup scripts | 2/2 passed |
| Local backup/restore rehearsal | 5/5 checks passed: dump, import, exact rows/Decimal sum, existing-target refusal, checksum refusal |
| TypeScript `node node_modules/typescript/bin/tsc --noEmit --incremental false` | PASS, exit 0, zero errors |
| `node scripts/verify-ui-health.mjs build` | Final-source isolated build pending |

Five pre-existing skips are opt-in N+1 MariaDB tests. Full-suite warnings:
immutable/FK-protected teardown leaves synthetic fixtures in the disposable DB;
one existing CRM teardown logs P2003. No test failure was hidden or changed to pass.
Node was used for repository verification runners; Bun is not on PATH.

Initial sandbox build failed fetching Geist/Geist Mono (network EACCES).
An elevated earlier-source retry was stopped only after identifying its exact
local child process; it is not PASS evidence. Final-source retry is separate.
Existing Next middleware convention and Sentry instrumentation/deprecation
warnings are not fixed in this scoped task.

## Limits and operational handoff

- Backup rehearsal used a small synthetic two-row Decimal fixture, not a full ERP
  restore. Temporary local credential was revoked afterward; synthetic artifacts
  and databases retained for diagnosis.
- Full ERP recovery, routines/events/trigger restoration, offsite encryption and
  immutability, binary-log PITR, achieved RPO/RTO: UNPROVEN.
- Redis disconnect/timeout/error coverage is deterministic fault injection, not
  live-network Redis outage certification.
- HTTP response delivery cannot be atomic with a database commit; a lost response
  requires a new password challenge, never challenge replay/session reissuance.
- No schema migration required or added.
- Backup job configuration must change to protected MARIADB_DEFAULTS_FILE plus
  explicit DB_NAME/BACKUP_WORK_DIR; restore requires RESTORE_DB_NAME/RESTORE_PORT.
  Old S3 uploader, retention and PostgreSQL WAL helpers are not invoked.
- No broader readiness score or all-feature clearance is claimed. Prior audit
  backlog outside these four items remains unchanged, including gift-card issuance
  GL wiring, purchase branch wiring and localStorage support-ticket persistence.
  Other heuristic reconciliation controls (e.g. tax-input GL) were not redesigned.

## Files changed

- README.md
- docs/runbooks/backup-restore.md
- docs/runbooks/production-migration.md
- docs/audits/2026-09-16-p1-remediation.md
- scripts/backup/nightly-backup.sh
- scripts/backup/restore-from-backup.sh
- src/app/api/v1/auth/mfa/verify/route.ts
- src/lib/auth/distributedRateLimiter.ts
- src/lib/auth/rateLimitRedis.ts
- src/lib/auth/sessions.ts
- src/lib/reconciliation/checks.ts
- tests/unit/distributedRateLimiter.test.ts
- tests/unit/mfaRedisFailure.test.ts
- tests/unit/reconciliationFailure.test.ts
- tests/integration/giftCardReconciliation.test.ts
- tests/integration/mfaSessionAtomicity.test.ts

## Closure

Pending final build and local commit. NOT PUSHED.
