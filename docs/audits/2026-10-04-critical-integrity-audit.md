# Critical integrity audit — 2026-10-04

Reviewed revision `ad3a39f` plus the working patch. Four confirmed defects corrected in the gateway refund handler. Two confirmed critical workflow gaps remain unresolved. This is source and mock-regression evidence, not production certification or an exhaustive proof that every ERP workflow is safe.

## Authority and scope

Read AGENTS.md, ERP/POS Blueprint v4.2 (tenant, inventory, payment, journal, transaction and gateway requirements), ADRs 0002/0004/0005/0007, production MariaDB schema and relevant ordered migrations. MariaDB migrations govern constraints; historical PostgreSQL and sandbox SQLite artifacts do not establish production safety. Read installed Next.js route-handler documentation before changing the route.

Graphify supplied navigation for payment/refund, sale, stock movement, reservation, tenant and idempotency paths. Findings were checked against source. Reviewed authentication/permission resolution, tenant/branch extensions, transaction retry, idempotency composition, provider adapters, sale posting/returns, stock projection and serial transitions, reservation workers, receivable calculations and corresponding safeguards/tests. No cosmetics, refactoring, dependency upgrades or performance changes.

## Ranked confirmed findings

### 1. CONFIRMED CRITICAL — external refund target not bound to authorized payment — FIXED

File/function: `src/app/api/v1/payments/[id]/refund/route.ts`, `POST`, phase 1/2. Supporting source: `src/adapters/providers.ts`, `BkashPaymentProvider.refund` and `registerProviders`; `payments/initiate/route.ts` stores the provider's transaction ID in `methodReference`.

Trigger: a caller with refund permission supplies an accessible local payment ID, but supplies a different gateway transaction ID or provider in the body. The bKash adapter uses process-wide merchant credentials and forwards that body ID directly to the refund API. An accepted gateway request can therefore refund a different payment, including another tenant/branch's payment under that merchant.

Expected: the external transaction and provider match the payment whose ownership was authorized. Actual: tenant ownership applies only to the local row; caller selects the external target independently. Impact: unauthorized external money movement and false local attribution.

Safeguards: authentication, branch-scoped payment lookup, amount cap and idempotency all existed. They never compared the external target with the stored `paymentMethod`/`methodReference`. SQL FKs cannot authorize an external gateway ID.

Proof: two new regressions supplied a stored transaction/provider mismatch. Both returned 200 and called the provider before the guard. Both now return 400 before claiming the payment or calling the provider. No live gateway was used; provider acceptance of any particular foreign transaction was not tested.

Correction: compare both stored fields inside phase 1's existing scoped transaction before any business effect. Keep request API and permissions intact.

### 2. CONFIRMED CRITICAL — refund lifecycle changes authoritative financial status before outcome — UNRESOLVED

File/function: refund `POST`, phase 1 and replay branch; `src/lib/idempotency/index.ts`, `withIdempotency`; `src/domain/receivables/balances.ts`, posted-payment allocation queries.

Trigger/source proof: phase 1 commits the original payment as `reversed` and stores a successful `{ok:true}` idempotency response. Terminate the process immediately after that commit, before the gateway call. A retry replays 200 and never contacts the gateway. No reversal payment/journal exists. A pending or definitively failed provider result also leaves the original payment reversed. A partial refund reverses the status of the entire receipt.

Expected: in-flight/unknown gateway outcomes remain distinguishable from completed refunds; receivables reflect actual retained money. Actual: queries counting only `posted` receipts stop counting the entire original allocation. For example, a fully allocated receipt of 1,000 ceases to count after requesting a partial refund of 50, or even after a rejected refund. Impact: incorrect customer debt and missing/unrecoverable business completion.

Safeguards: the conditional claim and replay short-circuit prevent repeated provider calls, but prematurely use final financial and idempotency states. The phase-3 transaction correction below does not roll back phase 1 or reverse external money movement.

Fix stopped: changing the claim without a durable replacement can enable duplicate refunds. A correct solution needs an agreed refund-intent state machine, provider idempotency/status lookup, partial-refund accounting, recovery ownership and forward migration compatibility. Blueprint §20.D20 requires unknown outcomes to be reconciled rather than assumed successful. No durable provider recovery interface/worker was established in the traced flow. Do not release this workflow as financially complete.

### 3. CONFIRMED CRITICAL — high-value gateway refund bypasses required approval — UNRESOLVED

File/function: refund `POST`; `src/lib/approval/thresholds.ts`, `getApprovalThresholds`; Blueprint §20.D04/§20.D20.

Trigger: a role granted `payment.refund.branch` submits a refund above the configured approval threshold against a sufficiently large eligible payment. The complete route reaches the provider without loading a threshold, validating an approved request, checking maker/checker separation or consuming approval provenance.

Expected: authorized approval precedes high-value external payout. Actual: ordinary refund permission is sufficient. Impact: unauthorized high-value disbursement. Tenant/branch guards and amount caps limit ownership/size relative to the receipt, not approval authority. No refund-approval enforcement was found in the adapter or relevant MariaDB triggers.

Proof: the full handler has one permission gate and no approval path before `provider.refund`. The permission exists in `src/lib/permissions/catalogue.ts`. Blueprint specifies approval, while current configuration helper uses `refund.approval_threshold` (default 5,000); the gateway section names `payment.refund_threshold` (default 10,000). A 20,000 refund exceeds both defaults.

Fix stopped: threshold precedence, approval resource binding and consumption semantics are unclear. Adding a guessed threshold/approval rule could bypass or block the intended process. Finance/security ownership must resolve that contract; no permission or approval check was weakened by this patch.

### 4. CONFIRMED CRITICAL — refund record and GL are separately committed — FIXED LOCALLY

File/function: refund `POST`, phase 3; `src/domain/commands/m4/PostJournalEntry.ts`, `postJournalEntry`.

Trigger: gateway completes the refund, payment creation succeeds, then journal validation rejects a locked fiscal period; alternatively, storing the final replay response fails after journal posting.

Expected: reversal payment, journal, outcome audit and final replay response commit together. Actual: `runInTenantContext` only installs scope; root-client queries autocommit separately. A posted reversal remains without its journal, or a completed financial effect remains without its final response. Returning the promise without awaiting it also escaped the route's error handlers.

Safeguards: tenant scoping, journal balance/immutability triggers and journal validation exist. None makes several root-client calls one transaction; valid individual rows can remain committed despite later failure.

Proof: rollback fault-injection tests observed `['payment']` after journal rejection and `['payment','journal']` after replay-write failure before correction. They now observe neither phase-3 effect committed, and confirm the same transaction client reaches the journal helper. This is a transaction-client simulation, not live InnoDB rollback evidence.

Correction: await `withTenant` and use its transaction client for every phase-3 query. Network calls remain outside the transaction; bounded database conflict retries cannot call the gateway again. Phase-1 claim and external recovery remain unresolved as described above.

### 5. CONFIRMED CRITICAL — failed/pending gateway refund posts cash-out journal — FIXED LOCALLY

File/function: refund `POST`, phase 3; payment provider result contract in `src/adapters/index.ts`.

Trigger: provider resolves normally with `status:'failed'` or `'pending'`. Both are supported outcomes; bKash can return failed and Nagad returns pending.

Expected: no cash-out journal until confirmed completion; pending remains pending. Actual: payment was marked failed for either outcome, yet a cash-credit/AR-debit journal posted unconditionally. Impact: fictitious cash outflow and GL/payment-subledger disagreement.

Safeguards: the entry balances and references tenant-owned accounts, so balance/FK constraints accept this false economic event. They cannot prove provider success.

Proof: failed and pending outcome regressions both failed before correction because the journal helper was called. Both pass afterward. Correction posts GL only on completed outcome, preserves pending/failed status and names outcome audit accordingly. Pending-provider completion and original receipt status still require the lifecycle solution above.

### 6. CONFIRMED CRITICAL — refund base currency omits exchange-rate conversion — FIXED

File/function: refund `POST`, phase 3; `postJournalEntry` accepts base-currency debit/credit inputs.

Trigger: refund 50 USD at locked rate 123.456789. Expected base payment and each journal side: 6,172.84; actual before correction: 50.00. Impact: understated cash/AR postings and incorrect financial reconciliation.

Safeguards: Decimal storage, positive exchange rate and balanced debit/credit do not detect equally wrong amounts on both sides. Journal posting documents that callers convert to base exactly once.

Proof: FX regression failed with 50.00 versus 6,172.84 before correction. It now confirms original 50.00, rounded base 6,172.84, equal debit/credit and exact locked Decimal exchange rate. Correction multiplies in Decimal once and shares the rounded base amount between reversal and journal. No binary float exchange-rate conversion remains in this refund posting.

## Other candidate classifications

- NEEDS EVIDENCE: reservation expiry uses an adjustment-in instead of decrementing reserved quantity, uses a synthetic event/actor and does not reclaim current state. However, production event FK rejects the fabricated movement; the transaction rolls back, so claimed stock inflation is not proved. The traced transfer creator uses no expiry timestamp. A reachable expiring reservation and intended serial/transfer release semantics need evidence before a critical fix. Worker is wired with concurrency 1 per process; that alone would not protect multiple processes.
- NEEDS EVIDENCE: `applyCustomerAdvance` in `m3/Payments.ts` lacks the complete documented ledger lifecycle, but no reachable caller was found in the source search. No change made.
- INTENTIONAL/CORRECT in traced source: fail-closed tenant context; branch ownership propagation; tenant composite FKs; version-guarded stock updates; journal balance/immutable-ledger safeguards; sale endpoint sharing transaction with idempotency; batch/combo and stored-value POS tenders explicitly rejected rather than silently processed. These observations do not replace database/concurrency tests.
- NEEDS EVIDENCE: live migration application, real provider responses, actual tenant role assignments, InnoDB deadlock/rollback behavior and end-to-end worker recovery. No production inspection was performed.

## Patch and validation

Application file: `src/app/api/v1/payments/[id]/refund/route.ts` only.
New regression: `tests/unit/refundCriticalIntegrity.test.ts` (12 tests).
Existing fixture updates: `tests/unit/paymentRefundIdempotency.test.ts`, `tests/unit/paymentReversalAccounting.test.ts`, to provide transaction delegates and valid stored gateway identity. Assertions preserved.
Audit: this file. Graphify AST update regenerated graph/report/HTML/manifest and its automatic dated backup. No migration added or edited; no constraints removed. Locked dependencies installed with `npm ci --ignore-scripts`; Prisma client generated without accessing a database. Package manifests/locks unchanged.

- Before fixes: six posting/atomicity regressions failed; four denial/replay controls passed. Before identity guard: two gateway-binding regressions failed.
- Final refund suites: 23/23 passed, including all 12 new tests.
- Broader relevant run: 67 tests passed across 8 suites. Two suites failed setup because approved MariaDB at `127.0.0.1:43318/readiness_20260912_disposable` was unreachable; 25 tests skipped. No live rollback, oversell or concurrent tenant-context result claimed.
- Changed-file ESLint: passed. Repository `npm run lint`: failed on 3 existing forbidden `require()` imports in cloned `graphify/tests/fixtures/cjs_require.js`; 3 existing UI navigation warnings.
- Repository `tsc --noEmit --incremental false`: failed on unresolved/invalid example imports in cloned Graphify fixtures. Isolated application build completed its TypeScript check.
- Production script in isolated workspace with synthetic secrets and approved disposable URL: Next.js compilation, TypeScript, and all 172 static-page generations passed. Source-map cleanup passed. Overall `npm run build` failed in packaging because Windows has no `cp`. No successful complete production build claimed.
- `git diff --check`: passed. Graphify AST update completed without LLM/API extraction; SQL parser unavailable, so SQL constraints were verified directly from migrations.

Tests/build used the repository-approved disposable target only. Mock tests do not connect to it. No alternative database, production changes, resets, deployment, service restart or live gateway call.

## Deployment considerations — no deployment performed

Four corrections need no schema change. Clients must submit the stored gateway provider and transaction ID; previously accepted mismatches now return 400. Pending/failed refunds no longer produce a journal or misleading completion audit.

Do not treat this patch as refund workflow release approval: high-value approval and durable lifecycle/partial-refund recovery remain critical blockers. Verify real MariaDB regressions and complete supported packaging on the deployment platform before release. Finance should reconcile historical gateway outcomes against reversal payments, journals and original receipt allocations using an approved read-only review first. Any repair must use approved compensating records, preserving immutable ledgers; this audit makes no historical data repairs.
