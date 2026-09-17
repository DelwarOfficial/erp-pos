# Relational feature validation — stopped on confirmed failure

Date: 2026-09-17. Baseline: `2d85147c902afa29196d55a553fe8ddde869c0bc`, main, clean before this task.
Scope: synthetic MariaDB only; no production access/data, push, deployment or implementation changes.

## Result: FAIL — validation incomplete by stop-on-failure instruction

First confirmed business-relation failure:

`gift_cards.id → gift_card_transactions.gift_card_id`

Actual authenticated `POST /api/v1/gift-cards` returned 201 and committed an active card
with face value **100.25**, but no authoritative issuance ledger entry.

Source: `src/app/api/v1/gift-cards/route.ts:63–78` creates the card and audit row,
then returns success without a giftCardTransaction write.
Schema: `prisma/mariadb/schema.prisma:3960–3983` and `:4463–4482`.

This is a **missing required child/business posting**, not an orphan foreign-key row.
An FK from a child to a parent cannot require every parent to have a child.

## Direct database evidence

Server: MariaDB 11.8.6; host 127.0.0.1; port 43318;
database `readiness_20260912_disposable`. No unfinished, non-rolled-back migrations found.
This task did not certify complete schema/migration equality.

Synthetic test identifiers:

- Company A: `7ff2f39e-a402-4744-adcc-a9e4f2897ef2`
- Company B: `7e05c6d3-ce29-4740-8298-ed2a45ef4d41`
- Issued card: `8babab3a-f563-4a92-8dd8-1844555f0e7d`

| Persisted observation | Actual |
| --- | --- |
| Card status | active |
| Face value | 100.25 |
| Issuance ledger rows | 0 |
| Sum of signed ledger amounts | 0 |
| Tenant journal entries | 0 |
| Posted gift-card GL liability | 0 |
| Tenant payments | 0 |
| Gift-card issuance audit rows | 1 |
| Configured gift liability accounting policy | 1 |

All money comparisons use Decimal (precision 80), never floating-point totals.
A ledger-vs-GL comparison alone would compare zero against zero here; it does not
prove that issuance populated its required ledger. No claim of balanced issuance
accounting is made. Funding/payment requirements need domain-policy verification.

Independent read-only MariaDB client confirmation reproduced card status/value,
zero ledger/journals, and configured accounting policy.
Fixture-scoped warehouse→branch and product→category/unit orphan counts: **0**.
This is not an all-table orphan audit.

## Synthetic fixtures

Each run creates 2 companies (A/B), 2 branches per company, 1 warehouse per branch,
1 user/role/customer/supplier/product/category/unit/tax code/tax component per
company, 12 chart accounts and 1 accounting policy per company, financial accounts,
fiscal periods, branch assignments, role permission and tenant feature flags.
Codes are deliberately reused across tenants to exercise tenant-aware uniqueness.

Persisted fixtures are synthetic and retained in the disposable database.
The first harness run also left a separate synthetic A/B pair; no production data
was copied. No destructive cleanup or disabled constraints/triggers.

## Checks that executed successfully

- Foundation creation and direct read-back ownership for both companies.
- Customer update/read-back.
- Missing warehouse branch FK rejected: P2003.
- Cross-company warehouse→branch rejected: P2003.
- Cross-company product→category rejected: P2003.
- Cross-company tax-code→tax-component join rejected: TENANT_VIOLATION trigger.
- Cross-company user→role join rejected: TENANT_VIOLATION trigger.
- Duplicate branch code within company rejected: P2002; same codes across A/B accepted.
- Referenced branch deletion rejected: P2003.
- Forced customer transaction rollback: no customer remained.
- Rejected warehouse/product/tax/role inserts left no corresponding rows.
- Gift card carried correct company_id and issued_by, but missing ledger stopped testing.

Only Next's cookie transport is mocked. Gift-card route, signed JWT verification,
session-family validation, permission checks, tenant context, idempotency,
transactions and MariaDB are real. This is route-level execution, not browser or
network middleware/CSRF verification.

## Module matrix

PASS* means only the named subset above executed; it does not clear the entire
module or all 15 requested controls. — means not applicable to that fixture check.
Result remains UNPROVEN until all applicable controls are covered.

| Module | Happy path | FK integrity | Tenant isolation | Branch isolation | Accounting | Stock | Rollback | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Organization / branches / warehouses | PASS* | PASS* | PASS* | UNPROVEN | — | — | UNPROVEN | UNPROVEN |
| Users / roles / permissions / branch access | PASS* | UNPROVEN | PASS* | UNPROVEN | — | — | UNPROVEN | UNPROVEN |
| Authentication / MFA / sessions / WebAuthn | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | — | — | UNPROVEN | UNPROVEN |
| Catalogue / products / categories / units / prices / barcodes | PASS* | PASS* | PASS* | UNPROVEN | — | UNPROVEN | UNPROVEN | UNPROVEN |
| Taxes / tax codes / components / withholding | PASS* | UNPROVEN | PASS* | UNPROVEN | UNPROVEN | — | UNPROVEN | UNPROVEN |
| Customers / suppliers | PASS* | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | — | PASS* | UNPROVEN |
| Accounting policy / chart / financial accounts / fiscal setup | PASS* | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | — | UNPROVEN | UNPROVEN |
| Gift-card issuance | FAIL | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | — | UNPROVEN | FAIL |
| Gift-card redemption / expiry / transfer | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Loyalty / reward points | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Coupons / discounts | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Purchases / receiving / landed costs | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Purchase returns | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Sales / POS / quotations | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Sale returns / voids | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Payments / refunds / advances / allocations | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Cashier shifts | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Inventory / opening stock / valuation | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Serials / batches / combos | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Stock transfers | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Stock counts / adjustments / reservations | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Journals / reversals / period close / FX | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Account transfers | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Bank reconciliation | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Fixed assets / depreciation | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Expenses / approvals | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Payroll / HR | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Delivery / courier / COD | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Service / warranty | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| CRM / leads | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Communication campaigns / notifications / consents | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Central approvals / risk controls | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Reports / exports / imports | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Reconciliation | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Feature flags / settings / localization | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Offline / PWA / device sync | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Webhooks / integrations / outbox / idempotency | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Audit / security events / statutory documents | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |
| Support tickets / data-subject requests | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN | UNPROVEN |

Unreached modules have **not** received all four requested fixtures. Mutation testing
stopped at the first confirmed relation failure as instructed; do not infer coverage
from prior unit suites or unrelated historical evidence.

## Commands and results

```text
node scripts/verify-access-tests.mjs tests/integration/relationalFeatureValidation.test.ts --bail=1
Final validation run: 1 failed test, exit 1.
Failure: active issued card has zero authoritative ledger balance/rows.
```

The initial run stopped at a harness error: it expected all SQL constraint failures
to be PrismaClientKnownRequestError. MariaDB SIGNAL correctly rejected the
cross-tenant tax join as PrismaClientUnknownRequestError containing TENANT_VIOLATION.
Only the harness was corrected to recognize that exact expected trigger rejection.
No application or schema behavior was weakened.

Test helper TypeScript initially needed explicit Branch[]/Warehouse[] annotations;
only test code changed. Final `node node_modules/typescript/bin/tsc --noEmit --incremental false`:
**PASS**, exit 0, zero errors.

## Next decision

Do not silently fix. Approval needed for a scoped gift-card issuance implementation
change (atomic ledger creation and defined funding/accounting policy), or for
continuing validation of other modules while retaining this confirmed failure.

New files only:
- `tests/integration/relationalFeatureValidation.test.ts` — intentionally red regression, fail-fast.
- This evidence report.

No commit, push, deployment, migration or application-code changes made in this task.
