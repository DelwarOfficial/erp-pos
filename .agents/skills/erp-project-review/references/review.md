# Static review findings

Date: 2026-10-03. Revision: `0808200`. Application code and configuration were not edited. Repository surfaces were inventoried; representative core paths were inspected. This is not a line-by-line review of every file, a security penetration test, or a verified production-readiness assessment.

## Findings and verification priorities

| ID | Observation and evidence | Implication | Proposed next verification |
|---|---|---|---|
| R1 | `docs/adr/0007-mariadb-production-database.md` and package Prisma configuration select MariaDB, while `docker/docker-compose.yml` provisions PostgreSQL and passes PostgreSQL URLs to web/worker | The checked-in Compose path conflicts with the production data architecture; it cannot be assumed to validate the MariaDB application | Review Dockerfiles/generated client and reproduce disposable startup before proposing setup changes |
| R2 | `docs/runbooks/go-live-checklist.md`, Database section, still requires forced RLS, partial indexes, EXCLUDE constraints and legacy numbered migrations | Release instructions mix incompatible database mechanisms despite the MariaDB note | Reconcile each checklist item with v4.2, ADR 0007 and actual MariaDB migration evidence |
| R3 | `src/lib/db/transaction.ts`, comments around `withTenant`/`runOnce`, describe future PostgreSQL RLS; actual execution uses scoped Prisma transactions and hardcodes Serializable | Comments can mislead reviewers about the implemented security boundary; `options.isolationLevel` is accepted but not applied | Inspect callers and transaction tests; evaluate intended isolation and documentation separately |
| R4 | `src/lib/featureFlags/index.ts`, `IMPLEMENTED_MODULES` omits crm/hr/delivery/service/loyalty/offline, and `toggleFeatureFlag` rejects enabling omitted modules despite existing source surfaces | These modules have code but cannot be enabled through this helper; could be intentional release gating or stale registry | Compare each module against acceptance tests and owner-approved release policy before changing registry |
| R5 | `src/domain/commands/m3/PostSale.ts` rejects gift-card/store-credit tenders and combo/batch-tracked products | Explicit capability gaps; standalone gift-card APIs do not establish POS redemption support | Trace UI availability and blueprint requirements; verify rejection tests and atomic implementation plan |
| R6 | `src/domain/commands/m6/Loyalty.ts`, `redeemCoupon`, `earnRewardPoints`, `redeemRewardPoints`, contain TODOs and audit-only/simplified results rather than actual coupon/reward transaction persistence | These functions do not demonstrate complete loyalty functionality; financial redemption must not be assumed available | Trace callers, flags and schema; keep unavailable paths clear until persisted ledger/consumption behavior is validated |
| R7 | `src/app/api/v1/sales/route.ts` POST launches risk assessment through a `void` asynchronous hook after commit | Process interruption can lose this attempt; durability/recovery is a review question, not a demonstrated production incident | Trace any periodic backfill/reassessment and deduplication; verify eventual assessment after process interruption |
| R8 | `src/lib/idempotency/index.ts`, `withIdempotency`, optionally accepts a transaction client; absent it, uses an independent db client | Atomic replay state depends on caller composition. Sale POST supplies tx, but the helper does not guarantee it globally | Inventory mutating callers and verify response/commit/crash semantics per workflow |
| R9 | `scripts/backup/nightly-backup.sh` produces logical dumps; `docs/runbooks/backup-restore.md` explicitly marks PITR and runtime recovery evidence unproven | Backup script presence does not establish offsite protection, encryption, immutable retention or achieved RPO/RTO | Obtain dated isolated restore/reconciliation and binlog replay evidence |
| R10 | `PostSaleInput` accepts number values while sale arithmetic uses Prisma.Decimal; reconciliation checks contain parseFloat comparisons | Precision boundaries warrant targeted review; this scan does not prove an incorrect posting | Trace exact input serialization, rounding and currency-scale tests; distinguish display/comparison from authoritative arithmetic |

## Strengths observed in source

- Active JWT session family, user activity and company status are revalidated in `src/lib/auth/middleware.ts`.
- `src/lib/db/tenantClient.ts` provides direct/indirect tenant scope mappings and branch-aware controls; production migrations include tenant parent keys and ledger/stock guards. Runtime enforcement was not exercised.
- Sale POST shares its transaction client with idempotency. `withTenant` implements bounded write-conflict retries and reports persistent conflicts as retryable domain errors.
- Reports use Decimal/database aggregates for ledger totals and explicitly report detail truncation. Tests cover report scale, general ledger and reversal/accounting cases by filename; no pass status claimed.
- Worker code includes outbox, reconciliation, reservation expiry, retention, due reminders, SMS sends and heartbeat handling.
- Test configuration refuses unintended database targets. Source-map removal, production guards, MFA, SSRF tests and security regression suites are present.

## Review limits

No dependency installation or application execution. No database/environment secrets read. No deployed environment inspected. Every inventory entry needs end-to-end tracing before being called compliant. Historical audit claims and blueprint approval language were not adopted as present-day verification.

## Gathered skills

`erp-project-review` handles architecture mapping, blueprint traceability, static review and planning. Existing `redesign-existing-projects` handles ERP presentation work. Specialist knowledge is gathered in the module map and workflow checklist rather than creating multiple overlapping skills without demonstrated need.
