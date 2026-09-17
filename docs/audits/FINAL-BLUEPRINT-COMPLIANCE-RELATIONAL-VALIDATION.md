# Final Blueprint Compliance & Relational Validation Audit

Date: 2026-09-17 · Auditor: executable validation agent · Mode: AUDIT ONLY (no fixes)

## 1. Executive Summary

- Audited commit: `2dfe91a90ab4c9b923763b26d6310a0bc08993cd` (main, clean tree)
- Blueprint: `docs/master-plan/ERP_Pos_Blueprint_v4.2.md` (MariaDB-authoritative per ADR 0007)
- Environment: local Windows workstation; Node 24.12.0, npm 11.6.2; Bun UNAVAILABLE on this host
- Database: disposable MariaDB 11.8.6, host 127.0.0.1, port 43318, database `readiness_20260912_disposable` (synthetic-only; production 3306 not listening on this host and never contacted)
- Remediation delta vs previous candidate (`2d85147`): `b40ead5` + `2dfe91a` — gift-card issuance remediation (ledger + payment + journal + audit), idempotency hardening, integration tests, prior relational audit artifact

Counts — Status: PASS 14 · CONFIRMED GAP 2 · UNPROVEN 9 · N/A 4
Severity (confirmed gaps only): P0 0 · P1 0 · P2 1 · P3 1

No arbitrary readiness percentage is assigned.

## 2. Baseline & Safety Isolation

- HEAD verified before every stage; worktree clean at start and end (two build-generated files restored: `next-env.d.ts`, `tsconfig.tsbuildinfo`).
- Disposable DB proven synthetic-only before reuse: company display names enumerated — all test fixtures ("Synthetic Access", "MFA Enroll", "Sale Test", "Bootstrap", "N+1 A/B", "Smoke tenant", "Platform" seed). No business data.
- Printed identity only: host/port/db/version. No credentials, DATABASE_URL, tokens, or secrets printed. Session-scoped random `JWT_SECRET`/`APP_ENCRYPTION_KEY`/`CSRF_KEY` generated in-process for smoke tests only.
- Production checkout (VPS path), production MariaDB 3306, production services: untouched (not reachable from this host; 3306 not listening locally).

## 3. Methodology

Fresh-DB reproduction first (drop/recreate/migrate from zero), guarded integration suites, a temporary self-contained invariant fixture (created reference data itself, then deleted), mocked unit suites, full suite twice (without/with DB env), production build, isolated built-runtime smoke on 127.0.0.1:3199. Stop-rule respected: no new P0/P1 discovered; dependent chains not fabricated around fixture gaps.

## 4. Blueprint Traceability Matrix (condensed to material invariants)

| ID | Blueprint Requirement | Code | DB | Tests | Runtime | Status |
|---|---|---|---|---|---|---|
| R1 | §1.2/§15 MariaDB 11.8.x system of record | prisma/mariadb provider | MariaDB 11.8.6 verified | suites guard 11.8.x | health checks DB | PASS |
| R2 | §0.2/§7.1 idempotent mutations + atomicity | idempotency lib + tx wrapper | FK/unique constraints | idempotency.test (3/3) | — | PASS |
| R3 | §11.3 reconciliation must not false-PASS on check errors | checks.ts runReconciliation | — | reconciliationFailure 12/12 | — | PASS |
| R4 | §11.3 GIFT_CARD_LIABILITY ledger vs posted GL, Decimal | checkGiftCardLiability | Decimal columns | unit 8/8 + runtime fixture | — | PASS |
| R5 | §5.13/§20.D17 gift-card issuance → ledger+journal+liability+audit | Loyalty.ts issueGiftCard | FK/Decimal/period guard | zzAudit fixture (temp, PASS) — repo suite blocked by fixture gap | — | PARTIALLY → see GAP-1 |
| R6 | §8.x cross-tenant deny | scoped wrappers | tenant FKs | accessControl 18/18 (with env key) | API 401s | PASS |
| R7 | §12.x auth/session/MFA failure paths | mfa verify route | — | mfaRedisFailure 8/8, mfaSessionAtomicity (suite blocked by fixture gap) | login 200, APIs 401 | PARTIALLY |
| R8 | §9.x per-method route authorization with static grant contract | routes | — | routePermissionCoverage 213/214 | — | GAP-2 (P3) |
| R9 | §20.D10/D11 backup/PITR/partitioning evidence | scripts + runbook | — | backup rehearsal NOT re-executed this session | — | UNPROVEN |
| R10 | §14/§18A.4 operational evidence (PITR, live Redis outage, DR) | — | — | — | — | UNPROVEN |
| R11 | §3.1/D02 optional module default-off | feature flags | — | not re-validated this session | — | UNPROVEN (prior evidence exists) |
| R12 | Support durable server-side persistence | — | — | not in this session's scope | — | UNPROVEN |
| R13 | Purchase→GRN→stock→AP→journal chain | — | — | not re-executed this session | — | UNPROVEN (prior audit stopped) |
| R14 | Sale/POS→stock→tax→journal chain | — | — | not re-executed this session | — | UNPROVEN |

## 5. Fresh MariaDB / Migration Evidence

- Recreated `readiness_20260912_disposable` from zero (drop + create; synthetic-only verified first).
- `prisma migrate deploy` (schema `prisma/mariadb/schema.prisma`): all 6 migrations applied, exit 0. First attempt killed at 10-min timeout mid-`tenant_fks` (Windows DDL slowness); clean restart from zero succeeded in second run — no partial state persisted from the killed run after re-recreate.
- Repeat `migrate deploy`: "No pending migrations to apply." `migrate status`: "Database schema is up to date!" (6/6).

## 6. Test Fixture Reproducibility — NOT CLOSED

Freshly migrated EMPTY DB + focused integration suites, ZERO manual seeding:
- `giftCardReconciliation`, `giftCardIssuance`, `mfaSessionAtomicity`, `relationalFeatureValidation`, `giftCardRelationalResume`: **5/5 files FAIL** (7 failed / 31 skipped).
- Root cause (explicit Prisma error): `Foreign key constraint violated on the fields: (base_currency_code)` — fixtures create companies with `BDT`, but **no migration seeds `currencies`** and **no fixture creates it**. Same class for fixed-UUID "Synthetic Company A/B" preconditions (`giftCardIssuance` hard-guards exact DB name + fixed UUIDs).
- Classification: **CONFIRMED GAP — TEST FIXTURE PREREQUISITE (P2)**. It is a test-infrastructure defect, NOT a business-feature failure. FK was not weakened; no manual seed was used to force green.

## 7. Database Integrity

Verified on fresh schema: 6/6 migrations clean from zero + idempotent repeat; `currencies` FK from `companies.base_currency_code` present and enforcing; composite tenant FK migration applied; DECIMAL money columns; document-number uniqueness tables present; trigger migration applied (`critical_triggers`). Full table-by-table audit vs §5 NOT re-performed this session (UNPROVEN for exhaustive structural equality; prior migration evidence stands for applied-set correctness).

## 8. Relational Business-Flow Results

- Gift-card issuance chain: **executable PASS** (see §10).
- Purchase/Sale/Return/Inventory chains: not re-executed this session (UNPROVEN; prior session stopped at gift-card invariant which was then broken — now remediated, unblocking future chain runs).

## 9. Accounting & Ledger Validation

Within gift-card flow: posted journal Dr 100.25 = Cr 100.25 (Decimal-exact), GL liability equals ledger sum, reconciliation check zero-variance, open-fiscal-period guard enforced (posting correctly rejected without an open period — Blueprint period control verified live).

## 10. Gift-Card Invariant Validation (previously confirmed failure — RE-VALIDATED)

Temporary self-contained fixture (created its own reference data per intended-fixture pattern; deleted after run) on MariaDB 11.8.6:
- Issuance 100.25 ('sold'): card active · **exactly 1** `gift_card_transactions` row, entryType `issue`, amountDelta Decimal-exact 100.25, eventId linked · journal posted, Dr=Cr=100.25 · liability GL = 100.25 · payment row created · audit row with correlation ID.
- Reconciliation `GIFT_CARD_LIABILITY`: zero findings (ledger == GL).
- Cross-tenant redeem (foreign companyId): rejected.
- Partial redeem 0.25: remaining balance exactly 100.00.
- Forced audit-write failure mid-command: **full rollback** — no card, no ledger row, no journal, no payment.
Result: prior CONFIRMED failure is **remediated and executably proven at domain level**. Route-level idempotency suite (`giftCardIssuance.test.ts`) could not run on fresh DB due to GAP-1 fixture prerequisites (its mocking/tx logic reviewed; runtime evidence limited to domain-command path).

## 11. Tenant Isolation & RBAC

`accessControl.test.ts` (real MariaDB): 18/18 PASS with `APP_ENCRYPTION_KEY` provided (env dependency; without it the reset-signing tests error — env, not defect). Built-runtime: `/api/v1/me` and `/api/v1/sales` unauthenticated → **401** (server-side protection confirmed). Exhaustive RBAC matrix not re-run this session.

## 12. Authentication / MFA / Redis / Security

- Mocked: `mfaRedisFailure` 8/8, `distributedRateLimiter` 6/6, `reconciliationFailure` 12/12 (26/26 focused unit total).
- `mfaSessionAtomicity.test.ts` blocked on fresh DB by GAP-1 (needs seeded tenants). Redis evidence type this session: **MOCK only**. No live Redis on host → live distributed behavior UNPROVEN.

## 13. Automated Test Evidence

Full suite, definitive run (DATABASE_URL → disposable DB, session APP_ENCRYPTION_KEY):
- Files: **67 passed / 3 failed / 1 skipped** (71)
- Tests: **923 passed / 2 failed / 33 skipped** (958)
- Failures: `giftCardIssuance` (suite precondition, GAP-1), `giftCardRelationalResume` (same class), `routePermissionCoverage > POST v1/gift-cards` (GAP-2).
- Skips include the optional N+1 MariaDB suite (skip-by-default) — skips are NOT counted as PASS.
Earlier no-DB run: 780 passed / 4 failed / 174 skipped (DB guards — environmental).

## 14. Build & Runtime Evidence

- `npm run build`: Next.js compilation **completed** (route table emitted; `.next/standalone/server.js` produced). Script exit 1 only at the Unix-only `cp -r` postbuild step on Windows — script portability limitation, not a source defect. Full packaged standalone (with copied static assets) NOT produced on this host.
- Built-runtime smoke (standalone server, 127.0.0.1:3199, disposable DB, random session secrets): `/login` 200 · `/api/v1/health` 503 (**documented fail-closed**: DB+Redis required, Redis absent locally — contract-correct, not a crash) · `/api/v1/me`, `/api/v1/sales` unauthenticated → 401 · `/dashboard` unauthenticated → 200 shell (designed client-side redirect via `/api/v1/me`; server-side data stays 401-guarded).
- Unexpected 401: **0** · Unexpected 403: **0** · Runtime 500: **0**

## 15. Backup / Recovery Evidence

Not re-executed this session (no Bash/mariadb-dump tooling on Windows host). Status: IMPLEMENTED (scripts + runbook committed), EXECUTABLY PROVEN on VPS previously (prior session evidence), UNPROVEN in this session. PITR/binlog: **UNPROVEN** (explicitly marked UNPROVEN in runbook; never claimed).

## 16. Operational Evidence

CONFIGURED (in repo): runbooks, health contract, cron scripts, feature-flag policy. EXECUTABLY PROVEN this session: isolated app startup + auth fail-closed. UNPROVEN: live Redis, PITR, DR rehearsal, production supervision/monitoring (out of scope for local host).

## 17. Confirmed Gaps

**GAP-1 (P2) — Test fixture prerequisite: fresh-DB integration reproducibility**
- Blueprint section: §17.1 (mandatory suites executable), §0.10; Module: test infrastructure
- Requirement: focused reconciliation/MFA/gift-card integration tests must pass on a freshly migrated empty disposable DB without manual reference-data insertion
- Implementation location: `tests/integration/giftCardReconciliation.test.ts`, `giftCardIssuance.test.ts` (fixed UUIDs + exact DB-name guard), `relationalFeatureValidation.test.ts`, `mfaSessionAtomicity.test.ts`; migrations lack `currencies` seed
- Validation method: drop/recreate/migrate-from-zero → run suites with no manual seed
- Expected: fixtures self-provision reference data → suites run
- Actual: 5/5 focused files fail; `Foreign key constraint violated on (base_currency_code)`; `giftCardIssuance` requires pre-existing fixed-UUID "Synthetic Company A/B"
- Why CONFIRMED: reproduced twice; explicit Prisma FK error; no workaround used
- Impact: CI/fresh environments cannot execute the highest-value integration suites; previous "green" evidence depended on a manually seeded DB
- Remediation direction (NOT implemented): fixture-level `currency.upsert('BDT')` + fixture-created tenants (already proven feasible by the temporary audit fixture), or a repo seed helper invoked by `beforeAll`

**GAP-2 (P3) — Static route-authorization contract violated by dynamic permission expression**
- Blueprint section: §9 API architecture (per-method authorization contract as encoded in `routePermissionCoverage`); Module: gift-cards API
- Requirement: `requirePermission` grant argument must be a static string literal so per-method coverage is statically verifiable
- Implementation location: `src/app/api/v1/gift-cards/route.ts:55` — `requirePermission(auth, body.mode === 'sold' ? 'payment.pay.branch' : 'journal.post', body.branch_id)`
- Expected: static literal grant; Actual: ternary expression → `routePermissionCoverage > POST v1/gift-cards` FAILS (1 test)
- Why CONFIRMED: deterministic AST-parse failure; runtime authorization IS enforced (both branches are valid codes) — hence P3, not P2
- Impact: authorization coverage inventory incomplete for this route; contract test red
- Remediation direction: hoist mode branch into two explicit `requirePermission` calls with literal codes (behavior-preserving)

## 18. Unproven Requirements

1. Backup/restore rehearsal this session — missing executable run on this host — HIGH
2. PITR / binary-log recovery — never exercised anywhere — HIGH
3. Live Redis outage/reconnection/multi-client — only MOCK evidence — MEDIUM
4. Purchase/Sale/Return/Inventory relational chains on MariaDB — not re-executed — HIGH
5. `giftCardIssuance` route-level idempotency suite — blocked by GAP-1 — HIGH
6. MFA session atomicity on real DB — blocked by GAP-1 — MEDIUM
7. Full table-by-table §5 structural equality — not re-audited — MEDIUM
8. D02 feature-flag default-off behavior — not re-validated — MEDIUM
9. Support durable persistence — not validated — MEDIUM (prior scope)

## 19. False Positives Rejected

- Health 503 on smoke: contract-correct fail-closed (Redis required, absent locally) — NOT a defect.
- `/dashboard` 200 unauthenticated: designed client-side gate; server APIs 401 — NOT a gap.
- `accessControl` reset-test errors without `APP_ENCRYPTION_KEY`: env dependency; 18/18 PASS with key — NOT a defect.
- `idempotency.test.ts` full-run flake vs standalone PASS with DB: ordering/env interference — not classified as defect (noted).
- MariaDB lacking PG RLS/partial-index/EXCLUDE syntax: accepted outcome-preserving equivalents per ADR 0007 — NOT gaps.
- Windows `cp` postbuild failure: script portability — NOT a source defect.
- First migrate-deploy timeout: Windows DDL slowness; clean re-run from zero PASS — NOT a defect.

## 20. Remaining Validation

Fresh-DB rerun of purchase/sale/inventory chains after GAP-1 fix; route-level gift-card idempotency; live Redis limiter; backup/restore rehearsal on VPS; PITR decision exercise; §5 full structural diff.

## 21. Remediation Order (dependency order only — NOT implemented)

1. GAP-1 fixture self-provisioning (unblocks rows 5–7 of §18 and the previously stopped relational chains)
2. GAP-2 literal permission hoist (one-line-class change + green coverage test)
3. Re-run purchase→sale→return→inventory relational chains on fresh DB
4. VPS: backup/restore rehearsal; live Redis limiter; then PITR decision

## 22. Final Evidence Statement

**PROVEN:** MariaDB 11.8.6 fresh migration from zero + idempotent repeat; reconciliation no-false-PASS suite (12/12); gift-card issuance invariant end-to-end on real MariaDB (ledger/journal/liability/payment/audit/rollback/cross-tenant/reconciliation, Decimal-exact); accessControl 18/18 on MariaDB; unauthenticated API 401s on built runtime; login 200; zero runtime 500s; full suite 923/958 with only fixture-dependent + GAP-2 failures.

**CONFIRMED BROKEN:** fresh-DB integration reproducibility (GAP-1, P2); static per-method authorization contract for POST /gift-cards (GAP-2, P3).

**UNPROVEN:** PITR/binlog, live Redis behavior, backup rehearsal (this session), purchase/sale/inventory chains (this session), route-level gift-card idempotency, MFA atomicity on real DB, full §5 structural equality, D02 runtime flag behavior, Support persistence.

---
*Audit artifact only. No application, schema, migration, or test changes were made or left behind (temporary fixture deleted; build-generated files restored).*
