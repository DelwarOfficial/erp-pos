# Gift-card issuance remediation and relational resume

## Verdict

Issuance is implemented and its focused checks pass. Overall gift-card release status:
**NOT READY**. Resumed validation found a redemption accounting failure. No production
access, push, deployment, migration or service restart was performed by this agent.

Evidence date: 2026-09-19. Local disposable MariaDB 11.8.6,
127.0.0.1:43318, database `readiness_20260912_disposable`. Synthetic data only.

## 1. Root cause

Original POST and the separate issuance domain command created a card and audit
without the authoritative initial ledger entry or liability journal. The POST now
calls the existing domain command; accounting uses the existing journal helper once.
The previous idempotency wrapper persisted its success response outside business
commit, leaving a retry gap. An optional transaction client closes this gap for issuance
without changing the default behavior of other callers.

## 2. Files changed during issuance work

- `src/domain/commands/m6/Loyalty.ts`: issuance validation, receipt, journal, ledger, audit.
- `src/app/api/v1/gift-cards/route.ts`: explicit contract, authorization, atomic idempotency, controlled errors.
- `src/lib/idempotency/index.ts`: opt-in transaction client, rollback propagation.
- `src/app/(erp)/dashboard/gift-cards/page.tsx`: mode/branch/account selectors, cash confirmation, same-request retry.
- `docs/master-plan/ERP_Pos_Blueprint_v4.2.md`: section 20.D17 issuance contract clarification only.
- `tests/integration/giftCardIssuance.test.ts`: direct MariaDB regression coverage.
- `tests/integration/relationalFeatureValidation.test.ts`: update original issuance request/permissions for the new contract.
- `tests/integration/giftCardRelationalResume.test.ts`: original fail-fast resume probe; subsequently modified externally.
- `tests/integration/giftCardRedemptionAccounting.test.ts`: current rollback-only GL gate.
- This report.

The original `2026-09-17-relational-validation.md` remains historical evidence. Unrelated
blueprint edits and externally supplied redemption/refund changes were preserved.

## 3. Transaction boundary

One `withTenant` Serializable transaction contains the idempotency reservation,
card, cash receipt (sold only), journal header/lines, posting event, initial ledger,
audits and successful replay response. No 201 until commit succeeds. Any required
write failure rolls back the entire unit; retry may safely reuse the same key/body.

## 4–6. Ledger, accounting and Decimal contract

- Explicit mode; no implicit sold/promotional fallback.
- Positive decimal-string amount, at most 12 integer and 2 fractional digits.
- Exactly one positive `entry_type='issue'` ledger entry equals the issued amount.
- Sold: operator confirms received cash; active same-branch, same-tenant base-currency
  cash financial account. One incoming receipt, Dr cash / Cr mapped gift liability.
- Promotional: manually postable, non-control, debit-normal expense account explicitly
  chosen by an authorized accountant. Dr marketing expense / Cr gift liability; no payment.
- Active liability mapping and open fiscal period mandatory. Missing context fails closed.
- Existing posting helper supplies one balanced journal and event. Journal source is
  gift_card/card ID; ledger uses its event; audit links mode, branch, account, journal, payment.
- 100.25 remains exact throughout Decimal arithmetic and persisted rows.
- External-provider funding and FX are unsupported, not silently treated as cash.
- API now requires a string amount and new mode/account fields; old clients must update.

## 7–10. Executable outcomes

- Forced failures at ledger, journal line, final gift audit, payment, and final idempotency
  response write: no partial business records. Error response omits injected driver details.
- Cross-company branch, cash and expense references rejected. Same-company wrong cash
  branch and unassigned branch rejected. Missing posting permission rejected.
- Same-key retry returns original response. Changed payload gets 409. Two concurrent
  same-key requests: 409 + 201; replay 201; one card/ledger/journal/receipt/event only.
- MariaDB ER_CHECKREAD 1020 observed during contention and mapped narrowly to 409.
  The numeric error definition is documented by
  [MariaDB](https://mariadb.com/docs/server/reference/error-codes/mariadb-error-codes-1000-to-1099/e1020).
- Issuance reconciliation: exact subledger/posted-liability equality. Direct fixture-scoped
  ledger-to-card/event orphan/cross-company count: zero. Not an all-table orphan audit.

## 11–12. Current-source verification

```text
node scripts/verify-access-tests.mjs tests/integration/giftCardIssuance.test.ts tests/integration/giftCardReconciliation.test.ts tests/unit/reconciliationFailure.test.ts tests/unit/idempotency.test.ts tests/unit/journalEntry.test.ts tests/unit/journalReversal.test.ts tests/unit/financialPostingIntegrity.test.ts tests/unit/tenantContext.test.ts tests/unit/branchScopeCoverage.test.ts
```

Latest run: **9 files, 131 passed, 0 failed**, exit 0.

| Suite | Passed |
| --- | ---: |
| Gift-card issuance | 28 |
| Gift-card reconciliation integration | 5 |
| Reconciliation failure handling | 14 |
| Idempotency | 3 |
| Journal entry | 6 |
| Journal reversal | 1 |
| Financial posting integrity | 11 |
| Tenant context | 12 |
| Branch-scope coverage | 51 |

Warning: journal suite cleanup reports seven deletions blocked by immutable/provenance
constraints. Tests pass; synthetic records remain in the disposable DB. No bypass used.

`node node_modules/typescript/bin/tsc --noEmit --incremental false`: final rerun after
the accounting probe was added **PASS**, exit 0, zero errors.

Earlier development runs exposed test-fixture field mistakes and the MariaDB 1020
classification gap. Those failures were corrected; they are not omitted from history.

## 13–14. Resumed validation and next failure

The first resume previously proved redemption changed face value to 80.25 while ledger
stayed 100.25. Externally supplied uncommitted edits now append redemption ledger rows
and retain face value. That old observation is historical, not the current verdict.

Current command:

```text
node scripts/verify-access-tests.mjs tests/integration/giftCardRedemptionAccounting.test.ts --bail=1
```

Result: **1 failed test**, exit 1, genuine business invariant failure:

| Observation | Exact amount |
| --- | ---: |
| Issued | 100.25 |
| Redeemed | 20.00 |
| Authoritative ledger after redemption | 80.25 |
| Posted liability linked to card after redemption | 100.25 |
| Expected posted liability | 80.25 |
| Unexplained difference | 20.00 |

`redeemGiftCard` in `src/domain/commands/m6/Loyalty.ts` appends the negative ledger
and audit but does not post a liability reduction. The probe calls the domain command
directly: it does not claim a browser/HTTP redemption path exists. The entire probe,
including its new card, was rolled back; read-back confirms the card does not remain.

Stop at this failure. Do not declare redemption fixed based only on ledger tests.
Next authorized implementation must define sale/payment linkage and a single balanced
GL posting owner, preserving idempotency, tenant/branch scope and concurrent spending
controls. Do not blindly add another journal if a caller already owns posting.

| Module / scope | Happy path | FK integrity | Tenant isolation | Branch isolation | Accounting | Stock | Rollback | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gift-card issuance, tested modes | PASS | PASS (tested links) | PASS | PASS | PASS | N/A | PASS | PASS |
| Gift-card redemption, current domain probe | Ledger changes | UNPROVEN | UNPROVEN | UNPROVEN | FAIL | N/A | PASS (probe rollback) | FAIL |
| Other modules | Prior evidence retained | Not expanded | Not expanded | Not expanded | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |

Original foundation results are retained. This pass does not certify all feature modules,
gift-card refunds, expiry, transfers, payment reversals, immutable/delete policies, browser
flows, full Vitest, build, runtime smoke, production readiness, or historical data repair.
No historical unledgered cards were silently backfilled.

## 15–16. Safety and Git provenance

Production touched: **NO**. Push/deploy by this agent: **NOT PUSHED / NOT DEPLOYED**.
Schema changes/migrations added: **NONE**. No forbidden Prisma commands used.

Starting HEAD: `2d85147c902afa29196d55a553fe8ddde869c0bc`.
During work another actor committed the shared tree:

- `b40ead536ffb6e9a37346c36ce8c12d3b847be9f`: issuance implementation checkpoint.
- `2dfe91a`: MariaDB retry mapping, evidence tests and blueprint checkpoint.
- Current observed HEAD: `286b0d0dc13b9b8a08858273278c34b7aa8f9620`.

These commits were observed, not created or pushed by this agent. On continuation,
uncommitted `Loyalty.ts` and `giftCardRelationalResume.test.ts` changes already existed.
They were preserved. This continuation adds only the accounting probe and this report.
Working tree remains uncommitted; no claim of a clean verified release commit.
