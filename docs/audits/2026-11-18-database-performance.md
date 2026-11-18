# Database performance review — 2026-11-18

Starting revision: `ad4131c`. Authority: ERP/POS v4.2 and ADR 0007. This is a scoped review, not a claim that every database path is optimized.

## Retained fix

`src/lib/db/tenantClient.ts`: indirect `createMany` parent validation previously called `findFirst` for each input row and parent. Actual SQL confirmed linear growth, including repeated parent IDs. `src/lib/access/service.ts:saveRole` exercises this through role-permission replacement.

Validation now deduplicates IDs per parent and uses tenant-filtered, ID-only reads in batches of 500. Every parent must exist before the original bulk write proceeds. The supplied transaction client remains authoritative. Branch validation still precedes this validation; single creates/upserts retain their existing path. No cache survives an operation. Permission grants, mutation order, audit, idempotency, schema, dependencies, configuration, and external delivery are unchanged.

## Reproducible measurement

Run `node scripts/verify-access-tests.mjs tests/integration/indirectParentSqlGrowth.test.ts`.

Target: approved loopback disposable MariaDB only, port 43318, database `readiness_20260912_disposable`; MariaDB 11.8.2, Prisma 6.19.3, Windows, one Vitest worker. The benchmark runs the actual tenant query extension in an interactive transaction. Synthetic companies, roles, permissions and user-role links are rolled back, and company absence is asserted after rollback. It logs counts/timings, never SQL parameters or credentials.

Each case uses one first-use sample followed by seven warm samples. Timings cover validation plus bulk insert; deletion and fixture setup are outside the timer. SQL counts come from Prisma query events, not delegate mocks. The transaction's BEGIN/ROLLBACK are outside the operation count. Data shape and procedure are identical before/after; randomized IDs are regenerated. First-use is not a flushed database/OS cold-cache test. Warm p95 is the nearest-rank maximum of seven observations and is only a small-sample diagnostic.

| Parent distribution | Rows | SELECTs before → after | All SQL before → after | Warm median ms before → after | Warm p95 ms before → after | First-use ms before → after |
| --- | ---: | --- | --- | --- | --- | --- |
| Distinct | 1 | 1 → 1 | 2 → 2 | 0.813 → 0.865 | 0.954 → 1.080 | 1.838 → 1.706 |
| Distinct | 10 | 10 → 1 | 11 → 2 | 3.913 → 1.552 | 6.060 → 3.582 | 4.540 → 1.347 |
| Distinct | 50 | 50 → 1 | 51 → 2 | 19.119 → 2.259 | 29.284 → 2.415 | 18.006 → 2.580 |
| Distinct | 501 | 501 → 2 | 502 → 3 | 168.357 → 10.402 | 174.750 → 11.053 | 176.231 → 12.729 |
| Repeated | 1 | 1 → 1 | 2 → 2 | 0.612 → 0.832 | 0.799 → 1.009 | 0.715 → 0.823 |
| Repeated | 10 | 10 → 1 | 11 → 2 | 3.516 → 0.831 | 4.366 → 1.152 | 3.525 → 1.011 |
| Repeated | 50 | 50 → 1 | 51 → 2 | 13.962 → 1.405 | 15.247 → 1.437 | 14.986 → 1.653 |
| Repeated | 501 | 501 → 1 | 502 → 2 | 131.995 → 6.128 | 135.017 → 6.610 | 133.487 → 7.231 |

Singleton timings show noise/slight overhead; the benefit is reduced growth. No hosting-cost estimate follows from these local timings. Baseline output is retained locally in `.local/indirect-parent-before.log` (the tests passed; PowerShell reported stderr warning redirection as a native-command error). The test itself prints reproducible post-change measurements.

## Correctness and resource evidence

The focused run passed 134 tests across ten files: the new real-SQL growth test, existing MariaDB N+1 tests, tenant isolation, branch scope coverage, access policy/API authorization, sale posting, financial posting, document creation, and reconciliation regressions. Only the two integration files establish actual SQL counts; unit delegate counts are correctness/regression evidence, not SQL benchmarks.

The new test covers empty input, singleton/multiple rows, repeated parents, the 500-ID boundary, two-parent user-role validation, nonexistent/foreign-tenant/missing parent IDs, mixed valid/invalid rows rejected before any insert, duplicate join handling with `skipDuplicates`, and complete fixture rollback. Creating fixtures and joining them inside the same uncommitted transaction also checks transaction-local visibility. Existing branch tests pass unchanged. Pagination is not changed by this fix.

The existing MariaDB reconciliation suite verified two SELECTs for each of four 100-row checks and completed 100 concurrent reconciliation operations without tenant leakage. That is not a contention benchmark for bulk parent validation. Concurrent parent deletion/lock-wait behavior, pool saturation and production latency remain unmeasured.

The new helper holds a set/list of unique parent IDs (O(unique input IDs)) and at most 500 returned IDs per read. No large parent columns are fetched. Heap/RSS, database rows examined and connection counts were not instrumented. Pool configuration and transaction boundaries were not changed. No schema/index change is proposed, so no migration or query-plan claim is made.

## Reviewed surfaces and remaining candidates

| Surface | Evidence inspected now | Result / remaining work |
| --- | --- | --- |
| Sales/POS | `src/domain/commands/m3/PostSale.ts`; POS page; customer picker/dialog; posting regressions | Product, stock, serial and financial-account reads are already batched. Posting regressions passed for BDT/USD. Full checkout SQL/load timing was not measured in this review. |
| Customer search | `src/app/api/v1/customers/route.ts`; `src/components/customers/QuickCreateCustomer.tsx` | List uses narrow projection and maximum 500 rows. Dialog debounces/aborts lookup and deduplicates identical search terms, but can issue different name/phone-format requests. Contains searches and concurrent checkout request volume need representative plans/network measurements; no search-contract change made. |
| Credit collections | `src/domain/receivables/collections.ts`; `src/domain/receivables/reminders.ts:bulkPlan` | Overview uses SQL aggregates. Bulk reminder preview loops through individual previews and rereads installments; a high-priority SQL-growth candidate, not benchmarked or changed here. Preserve consent, daily limits, confirmation tokens and rechecks when addressing it. No reminders were sent. |
| Inventory | `src/lib/reconciliation/checks.ts`; real MariaDB reconciliation suite | Four projection checks use two reads each for 100 rows. Other checks still load full journal/payment relations, so memory growth remains a candidate. No ledger/precision semantics changed. |
| Purchases | `src/app/api/v1/purchases/route.ts`; document creation regressions | List already paginates, selects fields and uses relation counts. Creation batches product reads; tests passed. Receiving/returns/landed-cost workload timings remain unverified. |
| Accounting | `src/lib/accounting/trialBalance.ts`; financial/journal regressions | Trial balance aggregates Decimal amounts in the database and fetches account metadata in bulk. Tests passed; ledger-size timing/plan measurements remain unverified. |
| Reports | `src/reports/index.ts`; report routes | Existing aggregation, bounded details and cash-flow paging are present. Serial history and other full-result reports deserve size/memory benchmarks; full registry was not load-tested. |
| Workers | `src/workers/outboxWorker.ts`; `src/workers/dueReminders.ts` | Outbox fetches at most 50 events but includes company/endpoints; per-delivery checks may grow with fanout. Claim/retry semantics and provider behavior prevent treating these loops as automatically removable. Overfetch, polling cost and connections remain unmeasured; workers were not started. |
| Tenant/ownership extension | `src/lib/db/tenantClient.ts`; access role service | Confirmed indirect-parent N+1 fixed. Branch-parent checks already deduplicate repeated IDs but still read distinct parents individually; separate SQL/lock evidence is needed before restructuring these checks. |

This review did not establish a need for indexes, caching, a new pool, Redis, dependencies or infrastructure. No live business data was modified, no external service was invoked, and no commit/push/deploy was performed.

## Changed files and checks

- `src/lib/db/tenantClient.ts`: bounded indirect-parent bulk validation.
- `tests/integration/indirectParentSqlGrowth.test.ts`: rollback-only SQL benchmark and correctness regression.
- This review: measurements, coverage and limitations.
- Graphify output: refreshed under repository instructions.

Targeted ESLint passed. Repository TypeScript checking also encountered pre-existing errors in `graphify/tests/fixtures/` (missing fixture imports, invalid type-only value usage and an undeclared repository symbol); see final verification for current results. These unrelated graph fixtures were not edited.
