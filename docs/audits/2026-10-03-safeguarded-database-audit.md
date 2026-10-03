# Safeguarded database audit: initial classified inventory

Date: 2026-10-03. Source revision: `08082004c995182927e11c635f1bb59bd67faa56`.

## A. Executive summary

Completed the initial static classification phase. No application code, schema, historical migration, dependencies, or database was changed. This is not a completed runtime performance audit or a production certification. The attachment's stop conditions apply: benchmarks cannot currently be reproduced safely with the available environment, and inventory/accounting optimizations need stronger correctness evidence.

Authority: Master Blueprint v4.2 and ADR 0007; MariaDB is authoritative. Inspected schema, migration history, recorded schema fingerprint, scoped-client/context boundaries, representative sales/purchasing/inventory/journal/payroll/service/receivables paths, reporting, worker code and existing test instrumentation. Repository-wide searches identify candidates, not automatically verified defects.

There are 186 models and 14 MariaDB migration SQL files. Static text counts found 573 scalar Prisma relations, 932 FK declarations, and 359 company-leading composite FK declarations. Counts are declarations, not live constraints, and do not establish correctness or completeness. The accompanying CSV maps all 573 scalar relations to matching child-column/parent-reference signatures in the recorded schema fingerprint. The fingerprint is historical evidence, not a fresh database inspection.

## Initial finding classification

| ID | Classification | Source / symbol | Evidence and implication |
|---|---|---|---|
| DB01 | CONFIRMED; NEEDS RUNTIME EVIDENCE for performance impact | `src/domain/receivables/reminders.ts`, `queueDueReminderMessages`, `blockReason` | Successful occurrences read installment balance in blockReason, then call installmentBalances again in the same occurrence transaction before rendering. Per-occurrence read amplification exists. Moving reads outside the transaction or reusing stale page data is unsafe. |
| DB02 | NEEDS RUNTIME EVIDENCE / NEEDS BENCHMARK | `src/domain/inventory/transferBatches.ts`, `receiveTransferBatches` | Each allocation reads a destination batch, mutates/creates it, and records movement custody. A preload may be possible but must preserve state changes for repeated batch identities, destination metadata validation, Serializable conflicts and retry semantics. |
| DB03 | INTENTIONAL / CORRECT transactional sequence | `transferBatches.ts`, `dispatchTransferBatches` | FEFO-style expiry/batch ordering determines allocation. Each consumed batch has its own quantity change and provenance row. Query-in-loop presence is not sufficient evidence for a safe write optimization. |
| DB04 | CONFIRMED uncapped discovery; NEEDS RUNTIME EVIDENCE for severity | `src/workers/dueReminders.ts`, `companiesWithSms`; `src/lib/reconciliation/scheduler.ts`, `runScheduledReconciliation`; `src/lib/retention/job.ts`, `runRetentionJob` | Discovery reads fetch company IDs without a row cap/cursor. ID-only selection limits width but not row count. Company iteration is expected isolation work, not automatically N+1. |
| DB05 | CONFIRMED row-count-unbounded window; NEEDS RUNTIME EVIDENCE | `src/lib/risk/alerting.ts`, `evaluateRiskAlerts` | Loads assessments in a time window with all related outcomes and aggregates in memory. A date window does not bound cardinality. Preserve latest-outcome definitions and metric scope in any redesign. |
| DB06 | FALSE POSITIVE as missing tenant-FK claim | `ProductBatch`, `StockMovementBatch` schema and `20260831180500_tenant_fks/migration.sql` | ID-only Prisma relations coexist with company-leading composite MariaDB FKs. Parent tenant keys and child supporting indexes exist in migrations and fingerprint. Do not mechanically add duplicate constraints. |
| DB07 | INTENTIONAL / CORRECT | `PostSale`, `PostJournalEntry`, `PostPayrollRun`, `PostStockCount` | Existing bounded read batches preload product/account/employee/stock data; stock-count paths also batch writes. Preserve their chunk limits and mutation semantics. |
| DB08 | INTENTIONAL TRANSACTIONAL SEQUENCE | `src/domain/offline/syncOfflineBatch.ts` | Known device sequence rows preload once; commands apply sequentially and update the in-memory seen map. Order affects later commands, deduplication and posted business effects. |
| DB09 | INTENTIONAL TRANSACTIONAL SEQUENCE | `src/domain/receivables/CollectCustomerPayment.ts` | Customer FOR UPDATE precedes balances and allocation planning. Allocation rows preserve event line provenance and link installment allocations to generated IDs. No blind Promise.all or removal of locks. |
| DB10 | INTENTIONAL / CORRECT plus NEEDS BENCHMARK | `src/workers/outboxWorker.ts`, `processOutboxBatch`, `deliverWebhook` | Discovery caps events at 50 and preloads endpoints. Per-event conditional claims and per-endpoint delivery-state reads/writes implement retry behavior; endpoint fan-out itself is not capped by event count. |
| DB11 | NEEDS RUNTIME EVIDENCE; correctness investigation | `src/lib/inventory/reservationExpiry.ts`, `expireStaleReservations` | Discovery caps at 200, but transactions use isGlobal:true and update a discovered reservation by ID without rechecking status. The command posts adjustment_in into on_hand using a synthetic event/actor. Review claim races, reservation release semantics and required event/user FKs before any optimization. |
| DB12 | CONFIRMED Decimal-to-Number boundary; correctness impact unverified | `src/domain/commands/m6/PayPayrollRun.ts`, `payPayrollRun` | Converts run.netTotal with parseFloat before journal posting. Do not change financial behavior as a performance fix. Trace currency-scale limits, payable-account selection and journal provenance separately. |
| DB13 | LIKELY request-size-dependent validation amplification | `src/lib/db/tenantClient.ts`, `validateIndirectCreate` | Branch-parent validation caches identities per operation. Indirect-create validation still checks parent rows for each createMany row. These checks enforce ownership; quantify growth before considering scoped batched parent validation. |

## B. Confirmed N+1 issues

No new runtime-verified N+1 issue is claimed. DB01 confirms repeated balance reads statically, but this is transaction-local read amplification rather than an automatically safe cross-row N+1 fix.

DB01 parent collection: pending reminder occurrences, page-bounded. Repeated operations: installmentBalances in blockReason and again before renderFor; consent/template reads and state writes occur too. For N successfully queued occurrences, the duplicated balance-helper invocation count is 2N; exact SQL Q(N) remains unmeasured. Safe design candidate: return the validated balance alongside the blocking decision and reuse it only within the same transaction. Keep live eligibility/opt-out checks, conditional status transition and message creation. No change implemented without regression/runtime evidence.

## C. Intentional query-in-loop patterns

Transfer dispatch, offline command application, customer allocation writes and stock/serial/journal mutations carry order, identity or provenance. Preserve transactions and deterministic execution. Dispatch helper performs two initial ORM reads plus two writes per consumed batch; receive helper performs two initial reads plus a destination read and two writes per allocation, before extension/provider overhead. These are static ORM operation formulas, not measured SQL counts or performance numbers.

Transfer receive is **partially batchable in principle**, with correctness-sensitive writes retained. A destination preload must happen inside the transaction, use bounded batch-number sets and exact company/product/warehouse ownership, preserve conflict metadata checks, and update its map after each create/increment. Benchmark and concurrent-transfer tests are required. No locking guarantees beyond the actual Serializable wrapper/observed mutation behavior are asserted.

## D. Database relationship findings

See `2026-10-03-relation-inventory.csv`: model, relation, mapped child columns, parent reference, recorded matching FK, and exact company-leading composite FK where present. All 573 signatures matched the fingerprint after correcting four multiline extraction artifacts. This validates signature presence in the snapshot only. Delete/update semantics, nullability, one-to-one uniqueness, trigger rules and actual deployed DDL still require full semantic/live comparison.

ID-only and composite FKs are not interchangeable: the first provides referential identity while the latter prevents cross-company references. ProductBatch/StockMovementBatch restrictions were traced to the migration. The tenant-parent-keys migration additionally supplies company/user/device constraints for previously missed PIN/exchange-rate/risk tables. No new orphan/missing-FK finding is established from the current static evidence.

## E. Tenant-integrity findings

The scoped extension requires context, classifies models, injects direct/indirect company and branch filters, and validates branch-owned parents. Platform isGlobal deliberately bypasses it. Raw SQL is not automatically scoped; explicit bound company/branch conditions remain necessary.

Privileged-access inventory below is a preliminary file-level classification. It is not proof that every call in those files is safe.

| Access path | Classification | Boundary reviewed / remaining verification |
|---|---|---|
| auth middleware, login, refresh, logout, MFA verify, refreshToken, enrollment, mfaChallenge | LEGITIMATE GLOBAL ACCESS; SAFE BUT SHOULD BE DOCUMENTED | Authentication precedes tenant context; active user/family/company or signed challenge identities constrain access. Complete endpoint negative tests remain required. |
| db/index, db/transaction exports | SAFE BUT SHOULD BE DOCUMENTED | Define/export unrestricted client; export presence alone is not a bypass defect. |
| onboarding API | LEGITIMATE GLOBAL ACCESS; NEEDS RUNTIME EVIDENCE | Platform company provisioning requires complete authorization/audit trace before approval. |
| dueReminders company discovery | LEGITIMATE GLOBAL ACCESS | Reads company IDs; reminder work runs in a company-specific context. Add volume bounds only after testing tick progress. |
| outboxWorker | SAFE BUT SHOULD BE DOCUMENTED | Platform-wide event delivery uses systemDb and event-linked company endpoints; claims and delivery identity are correctness controls. Complete multi-tenant worker tests remain required. |
| reconciliation scheduler / risk alerting | LEGITIMATE GLOBAL ACCESS for scheduling; NEEDS RUNTIME EVIDENCE for metric visibility | Platform-wide discovery/metrics must not be assumed suitable for tenant-visible results. Review reporting and recipient scope. |
| retention job / legalHold | SAFE BUT SHOULD BE DOCUMENTED | Global discovery and company-keyed hold decisions; inspect every deletion and its legal-hold boundary independently. |
| payment/courier provider webhooks | LEGITIMATE GLOBAL ACCESS for verified reference discovery; NEEDS RUNTIME EVIDENCE | Payment path verifies provider and rejects ambiguous references, then resolves local company. Full courier signature/company and replay tests remain required. |
| reservationExpiry | TENANT BYPASS RISK / NEEDS REFACTOR review | Uses global context inside company work and stale discovery inputs; investigate DB11 before redesign. No exploit asserted. |

## F. Missing/inefficient index findings

Existing tenant-leading index migration covers sales/payment date ranges, journal company/status/date, audit/security time, active products/customers and holds. ProductBatch uniqueness is company/product/warehouse/batch; tenant parent FKs also have supporting composite indexes. Do not add overlapping indexes merely because a query has several predicates.

Candidates needing disposable EXPLAIN and representative data: transfer dispatch by company/warehouse/product/status; global reminder-policy/credential discovery; risk assessment date window with outcome lookup; endpoint fan-out; report date/status/account joins. No new index is justified by current runtime evidence. Existing migration comments about past benchmarks are historical claims, not measurements repeated here. Full scans can be appropriate for whole-ledger aggregation.

## G. Unbounded query findings

Confirmed uncapped discovery and risk dataset: DB04/DB05. Transfer batch discovery is product/warehouse scoped but has no quantity/cardinality cap. Allocations are constrained to a transfer line but potentially numerous. These are transaction-domain bounded predicates, not guaranteed small collections. Collection worklist clamps pages to 200; reminder planning uses cursors/pages; outbox caps 50 and reservation expiry caps 200. Reports cap detail rows at 10,000 and disclose truncation while computing full aggregates.

This inventory is not a verified classification of every findMany/raw SELECT/export in the repository; searches and source inventories need complete endpoint-by-endpoint tracing.

## H. Transaction/query amplification

Keep validation and state rechecks within the transaction. withTenant uses Serializable and bounded conflict retries. Its accepted isolationLevel option is not applied by runOnce; no isolation change proposed. CollectCustomerPayment locks customer before allocation. Sequential stock movement writes use a version guard. Full deadlock order analysis requires concurrent fixtures.

DB01/DB02/DB13 are the priority amplification candidates. Network delivery in outbox is outside an explicit business transaction. SMS preparation/claiming and external sending must remain separate. No blanket network-in-transaction conclusion follows for other modules.

## I. Report/worker findings

Database Decimal aggregates and opening/reversal logic already exist in reports; replacing them with capped in-memory calculations would regress correctness. Collection overview uses repeated full CTE aggregates with different definitions: query count is bounded but scan cost needs EXPLAIN. Workers use bounded send concurrency; global company arrays and risk outcome loading remain resource risks. Per-message balance/consent checks protect current sending eligibility and should not become stale caches.

## J. Raw SQL findings

reportSqlScope fails closed without context and constructs validated identifier/branch predicates. Collection SQL uses bound tenant/date values; fixed column identifiers passed to Prisma.raw are not automatically injection findings. CollectCustomerPayment includes company in its lock query. Repository search found no `$queryRawUnsafe`/`$executeRawUnsafe` usage under src. That search does not prove all interpolated identifier/fragment uses are safe. Every raw query still needs explicit ownership and branch analysis.

## K. Files changed

- `docs/audits/2026-10-03-safeguarded-database-audit.md`: classified review and validation plan.
- `docs/audits/2026-10-03-relation-inventory.csv`: static Prisma-to-recorded-FK signature mapping.

Existing untracked `.agents/` skills predate this audit and were preserved. No application fixes were made.

## L. New migrations

NONE.

## M. Tests added

NONE. No implementation was changed. Existing disposable MariaDB query-event tests, due-reminder tests and regression suites were inspected for potential reuse.

## N. Test results

NOT RUN: node_modules absent; Bun, Docker and MariaDB client were not found on PATH. No approved disposable database connection was established. No production access attempted. `git diff --check` passes for tracked changes; new CSV/report validation is limited to source signatures and file checks.

The intended runner is `node scripts/verify-access-tests.mjs`, which sanitizes environment and sets the approved loopback database (port 43318, database readiness_20260912_disposable). It executes Vitest, not Bun's native test runner. Existing nplus1MariaDb tests gather query text in disposable memory without logging parameter values; reuse them rather than enabling production SQL logs.

## O. Typecheck

NOT RUN: dependency/toolchain prerequisites absent.

## P. Lint

NOT RUN: dependency prerequisites absent.

## Q. Production build

NOT RUN: dependency prerequisites absent. No deploy or service restart.

## R. Remaining risks / runtime evidence

Measure N=1,10,50 for transfer receive, reminder queueing, collection/list/detail and representative sales/purchase/product/accounting endpoints. Distinguish Prisma extension validation, relation loading and SQL statements from helper calls. Compare bounded read growth while allowing necessary per-row mutation/provenance work.

Rebuild all ordered MariaDB migrations in an isolated disposable environment, compare actual FK/CHECK/index/trigger semantics to schema fingerprint and Prisma relations, and test cross-company/branch reads, writes, references and raw SQL. Capture EXPLAIN with realistic cardinalities and independently validate duplicate/orphan compatibility before proposing any forward migration.

This phase does not establish all module query paths, all cardinality/nullability rules, or complete live referential integrity. Continue those checks before declaring the full requested audit complete. No speculative fix is permitted where semantics or safe benchmark reproduction remain unresolved.

## S. Deployment notes

No deployment changes. Future approved patches require tests, typecheck, lint/build and a concrete deployment plan. Any schema change requires a new forward-only MariaDB migration with existing-data compatibility and lock-duration assessment. Do not edit applied migrations, remove constraints, reset data, or load-test production.

## T. Final commit SHA

No commit created. Audited HEAD: `08082004c995182927e11c635f1bb59bd67faa56`.
