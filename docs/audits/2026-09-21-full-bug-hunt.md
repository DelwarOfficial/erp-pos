# Full bug hunt — Phases 1–5

Baseline `865df2a`, branch `main`, clean tree. Context in
`docs/audits/2026-09-21-audit-context.md`. All five phases executed. The rubric score is at the end.

## Gate results (executed, not inferred)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | **PASS** — exit 0, zero errors |
| Lint | `node node_modules/eslint/bin/eslint.js src instrumentation.ts` | **PASS** — exit 0, zero problems. See F-10: the ruleset is disabled to the point where this result carries little information |
| Unit + integration | `node scripts/verify-access-tests.mjs` | **FAIL** — exit 1. 72 files: 1 failed, 70 passed, 1 skipped. 961 tests: 1 failed, 955 passed, 5 skipped. Duration 138.30s |
| E2E | Playwright | Not run in this phase |

The single failing test:

```
FAIL tests/integration/giftCardRedemptionAccounting.test.ts
> gift-card redemption decreases posted GL liability by the exact redeemed amount
AssertionError: STOP: redemption reduced ledger but left posted gift-card liability at 100.25
```

A repo-wide `eslint .` takes **14m34s** and reports **428,621 problems (202,150 errors,
226,471 warnings)**, exit 1. Essentially none of it is this project's source: the run
descends into `.local/` (50 full copies of `src`, `tests`, `prisma` and `scripts` left
behind by `scripts/verify-access-tests.mjs`), `.kilo/worktrees/`, and the vendored
`skills/` tree. Scoped to `src`, ESLint reports zero problems. See F-16.

## Findings — Phase 1 (static sweep)

| ID | Severity | Area | `file:line` | Defect | Failure scenario | Fix | Verified by |
|---|---|---|---|---|---|---|---|
| F-01 | **P0** | Gift cards / GL | `tests/integration/giftCardRedemptionAccounting.test.ts:50` | Redemption debits the gift-card ledger but posts no offsetting GL entry | Issue a card for 100.25, redeem 20.00. Ledger sum becomes 80.25; the posted gift-card liability account stays at 100.25. Liability is overstated by every redemption ever made | Post a balanced journal on redemption (Dr gift-card liability / Cr revenue or receivable) inside the same transaction as the ledger write, mirroring the issuance path in `src/domain/commands/m6/Loyalty.ts` | Existing failing test — it is already the gate |
| F-02 | **P0** | Secrets | `cookies.txt`, `headers.txt` (commit `4a7730f`, 2026-08-31) | Live cPanel session token for `host.zhostbd.com`, account `rangpurt`, committed and tracked; neither file is gitignored | Anyone with repository read access replays the `cpsession` cookie against the hosting control panel | Rotate the cPanel password and terminate all sessions first; then untrack both files, gitignore them, and purge from history | Manual verification after rotation; add a secret scan to CI |
| F-03 | **P0** | Payments | `src/app/api/v1/payments/[id]/refund/route.ts:44` | The `withIdempotency` result is awaited and then **discarded**; the handler always continues into Phase 2 | A client retries a refund with the same `Idempotency-Key`. `withIdempotency` returns `isReplay: true` with the stored response, the route ignores it, calls `provider.refund()` a second time — real money leaves twice — then fails inserting the second reversal row on `@@unique([companyId, referenceNo])` (the reference is the fixed string `REFUND-${payment.referenceNo}`), so the second refund is never recorded. Money out, no record, 500 to the client | Return the stored response when `isReplay` is true, before any gateway call | New integration test: same key twice, assert exactly one `provider.refund` invocation and one reversal row |
| F-04 | **P1** | Payments / GL | `src/app/api/v1/payments/[id]/refund/route.ts:110` | The gateway refund path creates a reversal `payment` row and an audit log, and posts no journal entry | Refund 500.00 through bKash. The payments subledger shows the outflow; the GL cash and revenue accounts are unchanged. Bank reconciliation will not balance | Route the reversal through a domain command that calls `postJournalEntry`, as every other money path does | Test asserting a balanced journal exists with `sourceId` = reversal payment |
| F-05 | **P1** | Payments / GL | `src/domain/commands/m3/Payments.ts:93` | `reversePayment` — the *correct* reversal command — also posts no journal entry and emits no `businessEvent` | Any cheque bounce or manual reversal moves the subledger without moving the GL | Add the offsetting `postJournalEntry` call and business event | Test over `reversePayment` directly |
| F-06 | **P1** | Payments | `src/app/api/v1/payments/[id]/refund/route.ts:54` | The guard `payment.paymentStatus === 'reversed'` is unreachable: the route never sets the original payment to `reversed` (unlike `reversePayment`, `src/domain/commands/m3/Payments.ts:121`) | Refund a payment twice with different idempotency keys. The guard does not fire. Only the `referenceNo` unique constraint stops the second row — after the second gateway refund has already succeeded | Set the original payment to `reversed` inside the same transaction, and check it before the gateway call | Test: second refund attempt rejected with 409 before any provider call |
| F-07 | **P1** | Money precision | `src/app/api/v1/payments/[id]/refund/route.ts:27,57` | Refund amount is `z.number().positive()` and is compared with `parseFloat(payment.amount.toString())`; there is no cumulative cap across prior refunds | `{"amount": 10.005}` is accepted and stored; and two partial refunds of 60 against a 100 payment both pass the single-value check, totalling 120 | Accept a decimal string with a bounded scale, compare with Decimal, and cap against payment amount minus the sum of existing non-failed reversals | Test with partial refunds summing above the original |
| F-08 | **P1** | Multi-tenancy | `src/app/api/v1/webhooks/payment/[provider]/route.ts:64` | The local payment is resolved with `systemDb.payment.findFirst({ where: { methodReference } })` — no `companyId` scope, no unique constraint on `methodReference`, no `orderBy` | Two tenants hold payments with the same provider reference (a provider-side collision, or a value an attacker can influence). A verified webhook for tenant A flips a payment belonging to tenant B to `completed`, and which row is picked is not deterministic | Scope the lookup by the tenant the provider credential belongs to; add a unique index covering `(companyId, paymentMethod, methodReference)` | Cross-tenant test: same reference in two companies, assert the correct row is updated |
| F-09 | **P1** | Payments / audit | `src/app/api/v1/webhooks/payment/[provider]/route.ts:75` | A webhook transitions `paymentStatus` to `completed` with no audit log, no business event, and no GL posting | A bKash payment completes asynchronously. The payment row says completed; the GL never receives the cash debit, and nothing records who or what changed it | Post the receipt journal and write an audit row in the same transaction as the status change | Test asserting journal and audit rows after a verified webhook |
| F-10 | **P1** | Test/gate integrity | `eslint.config.mjs:10-47` | 26 rules are switched off, including `no-unreachable`, `no-fallthrough`, `no-undef`, `no-unused-vars`, `no-empty`, `no-console`, `@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-non-null-assertion`, and all `react-hooks` correctness rules | The go-live checklist item "Lint clean (0 errors, 0 warnings)" is satisfiable while genuinely broken code — unreachable branches, switch fallthrough, undefined identifiers — passes silently | Re-enable the correctness rules (leave style rules off if desired), fix the resulting findings, and treat the count as a tracked number | Lint run after re-enabling, with the error count recorded |
| F-11 | **P1** | Auth | `src/lib/auth/sessions.ts:19-28`, `src/app/api/v1/auth/login/route.ts:146` | `E2E_TESTING=true` and `DISABLE_SECURE_COOKIES=true` are honoured regardless of `NODE_ENV`. They strip the `Secure` cookie flag, downgrade `SameSite` from `strict` to `lax`, and — for `E2E_TESTING` — bypass mandatory MFA for privileged users | Either variable present in the production environment silently disables three controls the go-live checklist claims are verified. Neither variable is listed in `.env.example`, so nothing prompts an operator to check | Hard-fail at boot if either is set while `NODE_ENV=production`; document both in `.env.example` | Startup test asserting the process refuses to boot in that combination |
| F-12 | **P2** | Idempotency coverage | 22 mutating routes | 22 of 112 routes exporting a mutating verb never call `requireIdempotencyKey`. Auth, WebAuthn, webhook and cron routes are defensible; `admin/roles`, `admin/users`, `admin/users/[id]/password-reset`, `notifications/[id]/read`, `offline/bootstrap` and `admin/risk-alerts/evaluate` are not | A retried role or user mutation applies twice. ADR 0004 says every mutation carries a key | Add the wrapper to the non-auth routes; document the exemptions explicitly in ADR 0004 | Route inventory test asserting the exemption list is exhaustive |
| F-13 | **P2** | Money precision | `src/app/api/v1/customers/[id]/route.ts:360,369`; `installments/route.ts:48,53`; `inventory/stocks/route.ts:53-67`; `export-jobs/route.ts:196-267`; `export-jobs/[id]/download/route.ts:98-157`; `print/escpos/[saleId]/route.ts:48-56` | Monetary and quantity values are converted to IEEE-754 with `parseFloat` and summed in JavaScript. `customers/[id]/route.ts:360` compares allocation against total with a hardcoded `- 0.01` tolerance, which is a symptom of the same problem | Enough allocation rows and the reduce drifts; an outstanding balance of exactly 0.01 is classified as settled. Exported CSVs and printed receipts can disagree with the ledger in the last digit | Keep Decimal end to end; format only at the boundary | Property test over many-line documents comparing Decimal and float totals |
| F-14 | **P2** | Logging | 58 `console.*` call sites across `src/app`, `src/lib`, `src/domain`, `src/workers` | Server code writes to `console` directly while `src/lib/logging` exists. `src/app/api/v1/sales/route.ts:187` logs a full stack trace; `src/lib/audit/index.ts:72` logs raw metadata | Stack traces and audit metadata land in container stdout unstructured and unscrubbed, and the go-live item "No console.log in production code" is false | Route everything through `src/lib/logging` with PII scrubbing | Grep gate in CI |
| F-15 | **P2** | Auth | `src/app/api/v1/cron/risk-alerts/route.ts:29` | Cron token compared with `!==` — not constant time | Token recovery by timing is impractical over a network but trivial to avoid | `crypto.timingSafeEqual` on equal-length buffers | Unit test |
| F-16 | **P2** | Tooling | `eslint.config.mjs:50` | The `ignores` list omits `.local/**` and `.kilo/**`, and writes `"skills"` without a glob. `.local/` is where `scripts/verify-access-tests.mjs` materialises a full copy of the source tree on every test run — 50 such copies are present now, and `.gitignore:36` already excludes the directory | The documented `bun run lint` takes 14m34s and reports 428,621 problems, almost all from copied or vendored trees, so nobody runs it and any genuine finding is unfindable. The count also grows with every test run | Add `.local/**` and `.kilo/**`, and correct `"skills"` to `"skills/**"` | Timed repo-wide lint run: measured 14m34s / 428,621 problems before the change |
| F-17 | **P3** | Configuration | `.env.example` | 44 environment variables read by `src/` are absent from `.env.example`, including `BARCODE_SIGNING_KEY`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, every payment and courier provider credential, `S3_*`, `SENDGRID_API_KEY`, and the two security kill switches in F-11 | An operator provisioning production from `.env.example` misses WebAuthn origin binding and barcode signing entirely | Document all of them with safe defaults and mark which are required in production | Boot-time config validation listing missing required variables |
| F-18 | **P3** | Release readiness | `docs/runbooks/go-live-checklist.md` | Every item is unchecked, including six external sign-offs (tax, legal, labour, PCI QSA, accounting owner, forex) | Go-live cannot be declared, and several items are now known false rather than merely unverified — see F-02, F-10, F-11, F-14 | Work the checklist; correct the items this audit contradicts | The checklist itself |

## Hypotheses — not yet concrete

These were noticed during the sweep but lack a demonstrated failing path. They belong to
Phase 2 or 3, not to the table above.

- `src/lib/reconciliation/scheduler.ts:52` fires `enqueue(...)` without awaiting and with
  `.catch(console.error)`. Whether a dropped enqueue can lose a reconciliation run
  depends on the caller's lifetime, which was not traced.
- `evaluateRiskAlerts()` is invoked from the cron route with no tenant context. Whether it
  establishes its own per-company scoping internally was not verified.
- `src/app/api/v1/payments/initiate/route.ts:130,179,187` swallow errors with
  `.catch(() => {})`. What is lost in each case was not traced.
- 35 `as any` / `as unknown as` sites remain; whether any sit on a money or permission
  path was not determined.
- 32 `} catch {` blocks in `app`, `lib`, `domain`, `workers`. No empty catch bodies exist,
  but which of these convert a failure into a success response is unknown.

## Immediate observations for Phase 2

Every P0 and P1 above except F-02 and F-10 is a **GL posting omission or a payment
duplication** — the subledger moves and the general ledger does not, or a money movement
repeats. That is one structural defect wearing four faces: money paths that bypass
`postJournalEntry`. Phase 2 should start by enumerating every write to the `payment`,
`gift_card_transaction` and stock tables and checking each for a corresponding journal
posting, rather than auditing route by route.


---

# Phase 2 — Domain correctness

Method: rather than auditing route by route, every call site of `postJournalEntry` was
enumerated and compared against every write to the money and stock tables. The gap
between those two sets is where this phase's findings live.

## The GL coverage map

`postJournalEntry` (`src/domain/commands/m4/PostJournalEntry.ts:55`) is itself **correct**.
It rejects fewer than two lines, requires each line to be debit-XOR-credit, sums with
`Prisma.Decimal`, refuses an unbalanced or zero entry, requires an open fiscal period,
verifies every chart-of-account id belongs to the company, leases a gap-free entry number,
and emits a `journal_entry.posted` business event. No defect was found in the helper.

The defect is which paths call it.

| Money or stock movement | Posts to GL? | Where |
|---|---|---|
| Sale (revenue + COGS) | yes | `m3/PostSale.ts:587,631` |
| Purchase **return** | yes | `m2/PostPurchaseReturn.ts:99` |
| Expense | yes | `m4/PostExpense.ts:132` |
| Fixed assets | yes | `m4/AssetManagement.ts:153,299,506` |
| Bank reconciliation | yes | `m4/BankReconciliation.ts:478` |
| Courier COD settlement | yes | `m5/PostCourierCodSettlement.ts` |
| Payroll post / pay | yes | `m6/PostPayrollRun.ts`, `m6/PayPayrollRun.ts` |
| Gift card **issuance** | yes | `m6/Loyalty.ts` |
| Customer advance | yes | `app/api/v1/advances/route.ts:126` |
| Manual payment | yes | `app/api/v1/payments/route.ts:144` |
| **Purchase receipt** | **no** | `m2/ReceivePurchase.ts` |
| **Sale void** | **no** | `m3/VoidSale.ts` |
| **Sale return** | **no** | `m3/PostSaleReturn.ts` |
| **Gift card redemption** | **no** | `m6/Loyalty.ts:115` |
| **Stock adjustment** | **no** | `m2/PostStockAdjustment.ts` |
| **Stock count** | **no** | `m2/PostStockCount.ts` |
| **Transfer** | **no** | `m2/Transfer.ts` |
| **Gateway refund** | **no** | `app/api/v1/payments/[id]/refund/route.ts` |
| **Payment reversal** | **no** | `m3/Payments.ts:93` |
| **Provider webhook completion** | **no** | `app/api/v1/webhooks/payment/[provider]/route.ts` |
| **Cashier shift variance** | **no** | `m3/CashierShift.ts` |

There is no compensating mechanism. `businessEvent` rows are written by eleven call sites
and **read by none** — a search for any `businessEvent` access other than `.create` returns
nothing across `src/`. Nothing consumes `sale.voided`. The events table is write-only, so
no asynchronous poster closes any of these gaps.

## Findings — Phase 2

| ID | Severity | Area | `file:line` | Defect | Failure scenario | Fix | Verified by |
|---|---|---|---|---|---|---|---|
| F-19 | **P0** | Inventory / GL | `src/domain/commands/m2/ReceivePurchase.ts:217` | Receiving a purchase posts an inbound stock movement and recalculates moving-average cost, and posts **no** journal. Meanwhile sales credit the inventory account (`m3/PostSale.ts:631`) and purchase returns credit it again (`m2/PostPurchaseReturn.ts:106`) | The inventory GL account is only ever credited and never debited. Receive 1,000 of stock, sell it: inventory on the balance sheet reads −1,000 while the warehouse holds the goods. Accounts payable is never recognised either. The balance sheet diverges further with every purchase | Post Dr inventory / Cr accounts payable (plus input tax) inside the `ReceivePurchase` transaction | Integration test: receive, then assert inventory GL equals stock valuation |
| F-20 | **P0** | Sales / GL | `src/domain/commands/m3/VoidSale.ts:128-192` | Voiding a sale reverses stock movements, reverts serials and reverses payments, but posts no reversing journal. It writes a `sale.voided` business event that nothing consumes | Ring up a 5,000 sale, void it a minute later — a routine POS correction. Stock returns, the payment is reversed, and revenue, output VAT and COGS stay on the books permanently. Revenue and VAT payable are overstated by every void ever made | Post reversing entries for the `sale_revenue` and `sale_cogs` journals in the same transaction | Test: void a sale, assert net GL movement for that sale id is zero |
| F-21 | **P0** | Returns / GL | `src/domain/commands/m3/PostSaleReturn.ts` | A sale return restocks goods and credits the customer with no GL posting of any kind | Return 2,000 of goods. Inventory comes back, the customer is refunded, and revenue, output VAT and COGS are never reversed | Post Dr sales returns and Dr output VAT / Cr cash or AR, and Dr inventory / Cr COGS | Test asserting the return journals net against the original sale |
| F-22 | **P0** | Tax | `src/domain/commands/m3/PostSale.ts:209-216` | `TaxCode.priceIncludesTax` exists in the schema (`prisma/schema.prisma:1423`) and is **never read** by any computation. Its only occurrences in `src/` are the CRUD echo at `app/api/v1/tax-codes/route.ts:41,96`. `PostSale` always treats the unit price as tax-exclusive | A tenant configures VAT-inclusive pricing, normal for Bangladeshi retail, by ticking the checkbox the UI offers. A 115.00 shelf price intended to contain 15.00 of VAT is charged as 115.00 + 17.25. Every customer is overcharged and output VAT is overstated | Read the flag and back-compute the taxable base when it is set | Test over both settings with the same shelf price |
| F-23 | **P0** | Tax | `src/domain/commands/m3/PostSale.ts:210-214` | `TaxComponent.compoundOnPrevious` and `calculationOrder` (`prisma/schema.prisma:1447-1448`) are never applied. The loop adds every component flat against the same `taxableAmount`. Both fields appear in `src/` only as CRUD echoes | SD-then-VAT stacking requires VAT on base plus SD. With SD 10% and VAT 15% on a base of 100, correct tax is 10 + 16.50 = 26.50; this code charges 10 + 15 = 25.00. Every affected line under-collects, and the shortfall is the taxpayer's liability | Sort by `calculationOrder` and accumulate the base when `compoundOnPrevious` is set | Test with a compound component pair against a hand-computed figure |
| F-24 | **P1** | Tax | `src/domain/commands/m3/PostSale.ts:210` | Components come from `product.defaultTaxCode.components` with no `effectiveFrom` / `effectiveTo` predicate, and the rate is read live rather than resolved as of the document date | A rate change takes effect on 1 July. A sale backdated to June is taxed at the July rate, and a component whose `effectiveTo` has passed keeps being charged | Resolve components as of `businessDate` and filter on the effective window | Test posting a backdated sale across a rate change |
| F-25 | **P1** | Data integrity | `prisma/mariadb/migrations/20260831181000_critical_invariants/migration.sql:106-109` vs `prisma/migrations/0010_inventory_purchasing_transfers.sql:21,30` | The PostgreSQL migration set carries `CHECK (qty_on_hand >= 0)` and `CHECK (qty_reserved <= qty_on_hand)`. The MariaDB set — the production target per ADR 0007 — carries only `qty_reserved >= 0 AND qty_in_transit_out >= 0 AND qty_damaged >= 0`. Neither on-hand check exists in production | `docs/runbooks/go-live-checklist.md` claims "Negative-stock CHECK enforced — verified". In production it is not. The application guard at `src/domain/inventory/stockMovement.ts:122` is the only thing between a bug or a direct SQL write and negative inventory | Add both constraints to the MariaDB invariants migration | Insert a negative quantity directly against MariaDB and assert rejection |
| F-26 | **P1** | Data integrity | `prisma/mariadb/migrations/20260831181000_critical_invariants/migration.sql` | There is a per-line `CHECK ((debit_base > 0 AND credit_base = 0) ...)` but **no entry-level constraint or trigger that a journal entry's lines balance**. Fifty-six triggers exist for immutability and tenant consistency; none checks balance | The double-entry invariant lives entirely in application code. Any path writing `journal_lines` outside `postJournalEntry` — a repair script, a future bulk import, a raw query — can leave the ledger permanently unbalanced with nothing detecting it | Add an `AFTER INSERT` / `AFTER UPDATE` trigger asserting the entry sums match, on every database target | Direct SQL insert of an unbalanced entry, expect rejection |
| F-27 | **P1** | Cash / shift close | `src/domain/commands/m3/CashierShift.ts:84-93` | Expected closing cash is `opening_float + sum(incoming cash payments)`. The query filters `direction: 'incoming'`, so **cash paid out of the drawer is never subtracted** | A cashier refunds 500 in cash during the shift. At close, expected cash is 500 higher than the drawer can hold, so every such shift reports a 500 shortage. Real shortages hide inside that noise, and the variance-approval threshold fires on correct behaviour | Subtract outgoing cash payments for the same shift | Test: one cash sale, one cash refund, assert variance is zero |
| F-28 | **P1** | Cash / GL | `src/domain/commands/m3/CashierShift.ts:110-130` | The shift-close variance is stored on the shift row and audited, never posted to a cash over/short account | A 300 shortage is recorded, approved by a supervisor, and the GL cash balance still claims the money is there | Post Dr cash over/short / Cr cash, or the reverse, for a non-zero variance | Test asserting a variance journal exists |
| F-29 | **P1** | Inventory / GL | `src/domain/commands/m2/PostStockAdjustment.ts`, `src/domain/commands/m2/PostStockCount.ts` | Write-offs, damage and physical-count variances change stock quantity and valuation with no GL posting | Write off 50,000 of expired goods. Inventory on hand drops; the balance sheet and P&L never see it. The same applies to every count variance | Post Dr inventory shrinkage expense / Cr inventory for the valuation delta | Test asserting the adjustment's valuation delta equals the journal amount |
| F-30 | **P1** | Money precision | `src/domain/commands/m3/PostSaleReturn.ts:148-150,165` | Return amounts prorate discount and tax in IEEE-754: `parseFloat(saleItem.discountAmount) * (qtyReturned / originalQty)`, and the same for `taxAmount`, accumulated with `+=`. `PostSale` computes the originals in `Prisma.Decimal` | Return 1 of 3 units. The factor 1/3 is inexact, so credited tax and discount differ from one third of the original in the last digits, and three single-unit returns do not sum to the original line. The customer is refunded an amount that cannot be reconciled to the sale | Prorate in `Prisma.Decimal` and allocate the final return's remainder rather than recomputing it | Property test: a full return in N parts must equal the original line exactly |
| F-31 | **P2** | Multi-currency | `src/domain/commands/m4/PostJournalEntry.ts:65`, `src/domain/commands/m3/PostSale.ts:600-601` | `exchangeRate` is a JavaScript `number` validated with `Number.isFinite`, and Decimal line amounts are multiplied by it | A rate such as 121.4567 is not exactly representable, so converted amounts carry float error into otherwise-exact Decimal arithmetic. Contained today only because `multi_currency_enabled` defaults to false | Carry the rate as a decimal string end to end | Test comparing a converted posting against Decimal-only arithmetic |
| F-32 | **P2** | Money precision | `prisma/mariadb/migrations/20260831180000_initial/migration.sql:2372-2374` | `debit_base`, `credit_base` and `amount_currency` are `DECIMAL(65,30)`, and nothing rounds to currency scale before storage. The rubric's "rounding applied once, at a defined boundary" has no boundary here | An FX-converted or prorated line is stored with up to 30 fractional digits. Entries balance, but a report rounding late can disagree with one rounding earlier, and statutory documents may not tie to the ledger | Define the rounding boundary explicitly — round at posting, allocate residuals — and document it | Test that a rounded report ties exactly to the ledger |
| F-33 | **P2** | Inventory | `src/domain/inventory/stockMovement.ts:122` | The negative-quantity guard covers only the `on_hand` bucket. `damaged` and `in_transit` are computed in float and never checked | A movement driving `qty_damaged` negative is caught only by the MariaDB `CHECK`, surfacing as a raw constraint error rather than a `DomainError`, so the API returns 500 instead of 409. This is the exact inverse of F-25: on-hand has an application guard and no production constraint; these buckets have a constraint and no application guard | Apply the same guard to every bucket | Test driving each bucket negative, expecting 409 |
| F-34 | **P2** | Sales / GL | `src/domain/commands/m3/PostSale.ts:586` | `if (revenueJournalLines.length >= 2)` silently skips the revenue posting when fewer than two lines were assembled, instead of failing | Any future path producing a single line posts no revenue journal and still returns 201. The sale looks successful and the GL never hears about it | Fail loudly, or assert the expected line count | Test asserting a revenue journal exists for every posted sale |
| F-35 | **P2** | Concurrency | `src/lib/db/transaction.ts:63` | Every tenant transaction runs at `Serializable`, and there is no retry-on-serialization-failure wrapper anywhere | Two cashiers selling the same product at the same busy moment produce InnoDB lock-wait or deadlock errors. Correct behaviour under contention is a bounded retry; instead the sale fails and the customer waits | Wrap `withTenant` in a bounded retry on serialization and deadlock error codes | Concurrent-sale test asserting both succeed |
| F-36 | **P3** | API clarity | `src/lib/db/transaction.ts:45-63` | `withTenant` accepts `options?: { isolationLevel?: 'Serializable' \| 'ReadCommitted' }` and then hardcodes `isolationLevel: 'Serializable'`, ignoring the argument | A caller requesting `ReadCommitted` silently gets `Serializable`. The direction is safe, so this is a clarity defect rather than a correctness one — but the parameter documents a capability that does not exist | Honour the option or remove it | Unit test over both values |

## What Phase 2 confirms about Phase 1

F-01 now has its root cause located precisely. `redeemGiftCard`
(`src/domain/commands/m6/Loyalty.ts:115-161`) is otherwise among the best-written commands
in the codebase — it takes `FOR UPDATE` on both the card row and the ledger sum, which
correctly prevents concurrent overspend under REPEATABLE READ, enforces two-decimal
amounts, and works in `Prisma.Decimal` throughout. It simply never posts the offsetting
journal. The failing test is not reporting a concurrency bug; it reports the same
missing-GL defect as F-19 through F-21 and F-29.

## Areas checked and found sound

Recorded so a later phase does not re-audit them:

- `postJournalEntry` balance, fiscal-period, tenant and numbering validation.
- `projectStockValue` (`src/domain/inventory/valuation.ts`) — `Prisma.Decimal` at precision
  65, refuses a negative resulting value, refuses residual value at zero quantity, and is
  authoritative for the `on_hand` bucket, so moving-average costing is exact.
- Optimistic locking on `warehouse_stocks` via `version` with an `updated.count !== 1`
  check (`stockMovement.ts:178-188`) — lost updates are prevented.
- The over-return quantity guard (`PostSaleReturn.ts:101-115`), safe under the forced
  `Serializable` isolation.
- Serial-number handling in `PostSale`: status checked, same-sale double-claim rejected,
  warehouse ownership verified.
- Gift-card redemption concurrency, as described above.
- Fifty-six database triggers enforcing append-only audit logs and immutable stock
  movements, journal entries, journal lines, gift-card transactions, serial events and
  advance ledgers.

## Severity roll-up so far

| Severity | Phase 1 | Phase 2 | Total open |
|---|---:|---:|---:|
| P0 | 3 | 5 | 8 |
| P1 | 8 | 7 | 15 |
| P2 | 5 | 5 | 10 |
| P3 | 2 | 1 | 3 |

Seven of the eight P0 findings are one structural defect: money moves in a subledger or a
stock table and the general ledger is not informed. Fixing them is a single piece of work
with seven insertion points, not seven separate investigations.


---

# Phase 3 — Concurrency, idempotency, transactions

## Asynchronous infrastructure is wired at only one end

Phase 2 found that `businessEvent` rows are written by eleven call sites and read by none.
Phase 3 finds the same shape three more times. The queue, outbox and offline-sync
subsystems are all built, and all of them are missing either their producer or their
consumer:

| Subsystem | Producer | Consumer | State |
|---|---|---|---|
| `business_events` | 11 call sites | **none** | write-only table |
| `outbox_events` | **none** — no TypeScript writer, no trigger | `processOutboxBatch` (well built) | consumer with no input |
| `offline_commands` | `POST /api/v1/offline/sync` | **none** | write-only table |
| `QUEUE_NAMES.OFFLINE_SYNC` | — | **no worker registered** | declared, never served |
| `QUEUE_NAMES.WEBHOOK` | — | **no worker registered** | declared, never served |

Five BullMQ workers are registered (`outbox`, `communication`, `reconciliation`,
`expire-reservations`, `retention`). Job retry is configured properly —
`attempts: 3`, exponential backoff from 1s, `removeOnFail: 500`
(`src/lib/queue/index.ts:29`) — so the retry and dead-letter concerns the audit prompt
raises are already handled at the BullMQ layer. The outbox worker additionally carries its
own dead-letter path with a `critical` security event and a stable delivery id across
retries. That code is sound; it simply never receives an event.

## Findings — Phase 3

| ID | Severity | Area | `file:line` | Defect | Failure scenario | Fix | Verified by |
|---|---|---|---|---|---|---|---|
| F-37 | **P0** | Offline POS | `src/app/api/v1/offline/sync/route.ts:92-107` | Offline commands are validated, deduplicated and stored with `status: 'synced'`, and **never executed**. `offlineCommand` has no reader anywhere in `src/` other than the duplicate check in this same handler, and no worker is registered for `QUEUE_NAMES.OFFLINE_SYNC` | A terminal runs offline through a power cut, takes 200 cash sales, reconnects and syncs. The API returns `synced_count: 200` and the operator believes the day is captured. No sale, payment, stock movement, journal or receipt exists. The stock on hand, the GL and the cash drawer are all wrong, and the only record is a JSON blob in `offline_commands`. `status: 'synced'` actively misreports this | Apply each command through its domain command inside the sync transaction, or enqueue to `offline-sync` and register a worker that does. Until then the endpoint should report `status: 'accepted'`, not `'synced'` | Integration test: sync a `cash_sale` command, assert a sale, a stock movement and a balanced journal exist |
| F-38 | **P0** | Authorization | `src/app/api/v1/import-jobs/[id]/commit/route.ts:23-29` and 21 further route files | The permission check is wrapped as `try { await requirePermission(...) } catch (e) { if (e instanceof DomainError && !auth.isGlobal) return 403; }`. Any exception that is **not** a `DomainError` is swallowed and the handler proceeds. `requirePermission` performs a database read (`src/lib/auth/middleware.ts:121-128`), so a Prisma error — connection-pool exhaustion, lock-wait timeout, a dropped connection — is not a `DomainError` | Under database pressure the permission lookup throws a Prisma error, the catch swallows it, and the request executes with no authorization check at all. This is a fail-open control: it fails exactly when the system is under stress. It affects 22 route files including `import-jobs/[id]/commit`, `admin/risk-threshold-changes`, `admin/risk-assessments/[id]/outcome` and `approvals` | Let the exception propagate; return 500 on anything that is not a `DomainError`. Note that the `!auth.isGlobal` guard is dead logic — `requirePermission` already returns early for `isGlobal` at line 111, so it never throws for those users | Test injecting a non-`DomainError` from the permission lookup, asserting 500 and no side effects |
| F-39 | **P1** | Webhooks | `src/workers/outboxWorker.ts:17` | Nothing writes `outbox_events`. A search across `src/`, `prisma/triggers/` and every MariaDB migration finds only readers and the table definition | Every configured webhook endpoint stays silent forever. Worse, the two reconciliation checks over this table (`src/lib/reconciliation/checks.ts:336,350` — dead-letter count and stale-pending count) always evaluate to zero, so they pass vacuously and report a healthy integration surface that does not exist | Emit outbox events from the domain commands that claim to publish them; assert a non-zero event count in the reconciliation check rather than only an upper bound | Test asserting an outbox row exists after a posted sale |
| F-40 | **P1** | Idempotency | `src/lib/idempotency/index.ts:136-153` | The replay branch returns the stored response for **any** completed status. The only special case is `'processing'` (409, retry shortly); `'failed'` falls through to the replay return | A sale request fails transiently — a lock-wait timeout, a dropped connection. The idempotency row is marked `failed` with the 500 body. The POS client retries with the same `Idempotency-Key`, exactly as ADR 0004 requires, and receives the cached 500 again. It will receive it for the full 24-hour TTL. The sale can never be completed under that key, and the client has no way to know it must mint a new one | Replay only `succeeded` records; allow a `failed` record to be re-attempted, or distinguish retryable from terminal failures | Test: force a transient failure, retry with the same key, assert the second attempt executes |
| F-41 | **P1** | Idempotency | 82 of 83 `withIdempotency` call sites | `withIdempotency` accepts an optional transaction client so the reservation commits atomically with the business writes. Only `app/api/v1/gift-cards/route.ts:62-78` uses it, in the shape `withTenant(tx => withIdempotency(..., tx))`. Every other call site uses `withIdempotency(() => withTenant(...))`, so the reservation is written on the autocommit client outside the business transaction | Three separate commits — reservation, business work, completion — with no atomicity between them. A crash after the business commit but before the completion update leaves the row stuck at `processing`, so every retry gets 409 for 24 hours even though the work succeeded. This is the exact defect the 2026-09-19 gift-card remediation fixed, left unfixed in the other 82 sites | Adopt the gift-card shape everywhere | Crash-injection test between business commit and completion update |
| F-42 | **P1** | Imports | `src/app/api/v1/import-jobs/[id]/commit/route.ts:57-63,41-48` | Two defects in one handler. The CSV content is taken from the **request body at commit time** rather than re-read from the validated artifact, with the comment "production: re-download from S3". And the `job.status !== 'ready'` guard is a read-then-act outside any transaction, with no status transition to claim the job | The validation step is decorative: a client validates one CSV and commits a different one. Separately, two concurrent commits of the same job both observe `ready` and both import, doubling every row | Re-read the stored artifact; claim the job with a conditional status update inside a transaction | Test committing content that differs from the validated content, expecting rejection; plus a concurrent double-commit test |
| F-43 | **P1** | Offline POS | `src/app/api/v1/offline/sync/route.ts:63-90` | `payload_hash` is accepted from the client and **never recomputed** from `payload`. Deduplication and conflict detection both key on the client's claim about its own content | A device with a bug, or a tampered client, sends a different payload under a previously used sequence number and the original hash. The server classifies it as a duplicate and discards it silently. Conversely, a correct resend with a recomputed hash that differs by whitespace is recorded as a conflict | Recompute the hash server-side and reject any mismatch | Test with a deliberately wrong hash, expecting rejection |
| F-44 | **P1** | Authorization | `src/app/api/v1/offline/sync/route.ts:30` | Bulk upload of up to 500 sale, shift and customer commands is gated on `device.read` — a read permission | Any principal that can read device records can push a batch that, once F-37 is fixed, will post sales and open and close shifts | Require a write-scoped permission such as `offline.sync.branch`, and verify the caller owns the device | Test with a read-only principal, expecting 403 |
| F-45 | **P2** | Concurrency | `src/workers/outboxWorker.ts:17-20` | Pending events are selected with `findMany({ status: 'pending' }, take: 50)` and no claim, lock or status transition before delivery. The worker runs at `concurrency: 4` | Four concurrent invocations select the same 50 rows and each delivers them. Subscribers receive duplicates. Latent only because there is no producer (F-39) — it becomes live the moment F-39 is fixed | Claim rows with a conditional update to `delivering` before the HTTP call | Concurrent-worker test asserting exactly one delivery per event |
| F-46 | **P2** | Concurrency / performance | `src/lib/numbering/index.ts:47-57` | `nextDocumentNumber` issues `INSERT ... ON DUPLICATE KEY UPDATE next_number = next_number + n`, which is correctly atomic and correctly rolls back with the parent transaction, so numbering is gap-free and duplicate-free. But the exclusive row lock is held until the parent transaction commits, and that transaction is `Serializable` with a 30s timeout | Every sale in a branch serializes on a single `document_sequences` row for the whole posting transaction — stock lookups, journal posting and audit writes included. Under the load target in the go-live checklist (POS sale p95 ≤ 2s) this is the throughput ceiling, and it is not visible in single-threaded tests | Allocate the number as late as possible in the transaction, or lease ranges per device as the schema's `document_number_leases` table already anticipates | Concurrent-sale load test measuring p95 against the 2s target |
| F-47 | **P2** | Numbering | `src/domain/commands/m3/Payments.ts:101` | The reversal sequence is requested with `fiscalYear: new Date().getFullYear()` instead of the business date's fiscal year. `postAccountTransfer` uses `params.businessDate.getFullYear()` correctly | A December payment reversed on 2 January draws from the new year's sequence, so the reversal number does not sit in the same statutory sequence as the document it reverses | Derive the fiscal year from the business date | Test reversing a document across a year boundary |
| F-48 | **P2** | Queues | `src/lib/queue/index.ts:20-22` | `QUEUE_NAMES.WEBHOOK` and `QUEUE_NAMES.OFFLINE_SYNC` are declared and no worker consumes either | Anything enqueued to them accumulates in Redis unprocessed, with no error and no alert. `startWorkers` logs "All workers started" while two of the seven declared queues have no consumer | Register workers or remove the names | Startup assertion that every declared queue has a registered worker |
| F-49 | **P3** | Error handling | `src/app/api/v1/import-jobs/[id]/commit/route.ts:14` | `requireIdempotencyKey(req)` is called before the surrounding `try`, so a missing header throws out of the handler | The client receives an unhandled 500 instead of the documented 400 with a `VALIDATION_FAILED` code | Move the call inside the `try` | Test omitting the header, expecting 400 |
| F-50 | **P3** | Dead code | 22 route files | `if (e instanceof DomainError && !auth.isGlobal)` — `requirePermission` returns early for `isGlobal` (`src/lib/auth/middleware.ts:111`), so it never throws for those users and the second conjunct can never be false when the first is true | The guard reads as a deliberate platform-operator bypass and is in fact inert. Its only behavioural effect is the fail-open in F-38, which is presumably not what the author intended | Remove the condition when fixing F-38 | Covered by the F-38 test |

## Areas checked and found sound

- **BullMQ retry policy** — `attempts: 3` with exponential backoff and `removeOnFail: 500`
  is configured at the queue level (`src/lib/queue/index.ts:29`), so every worker inherits
  bounded retry. Graceful shutdown closes all five workers and quits Redis.
- **Outbox delivery mechanics** — unique `(webhookEndpointId, outboxEventId)` delivery row,
  delivery id stable across retries, 15s fetch timeout with `AbortController`, exponential
  backoff with jitter capped at one hour, dead-letter transition with a `critical` security
  event. Only the missing producer (F-39) and the missing claim (F-45) are defects.
- **Document numbering atomicity** — gap-free and duplicate-free on MariaDB, and the
  increment rolls back with the parent transaction. Only the contention profile (F-46) and
  the fiscal-year derivation (F-47) are findings.
- **Idempotency key validation and conflict handling** — hash mismatch on the same key
  returns 409 with a `high` security event; cross-tenant reuse returns 409 with a
  `critical` event; in-flight requests return 409 rather than executing twice.
- **Offline sync transaction boundary** — the whole batch runs in one `withTenant`
  transaction, so a partial batch cannot be half-recorded.
- **`withTenant` isolation** — every tenant transaction runs `Serializable`, which is what
  makes the read-then-write guards in Phase 2 (over-return, stock-count variance) safe.

## Severity roll-up

| Severity | Phase 1 | Phase 2 | Phase 3 | Total open |
|---|---:|---:|---:|---:|
| P0 | 3 | 5 | 2 | 10 |
| P1 | 8 | 7 | 6 | 21 |
| P2 | 5 | 5 | 4 | 14 |
| P3 | 2 | 1 | 2 | 5 |

## The shape of the problem after three phases

Two structural defects account for most of the P0 and P1 findings:

1. **Write paths that stop short of the ledger.** Eleven money or stock movements do not
   post to the GL (Phase 2), and three asynchronous subsystems are wired at only one end
   (Phase 3). In both cases the subsystem exists, is reachable, returns success, and does
   not complete the work it claims to have done.
2. **Controls that report success without having run.** The lint gate with 26 rules off
   (F-10), the reconciliation checks over an empty outbox (F-39), `status: 'synced'` on a
   command that was never applied (F-37), the unreachable refund guard (F-06), the
   never-read `priceIncludesTax` (F-22), and the fail-open permission check (F-38) all
   share it.

Neither is a scattering of unrelated bugs. Both are single pieces of work with many
insertion points.


---

# Phase 4 — Security and access control

## Tenant isolation is the strongest part of this codebase

`src/lib/db/tenantClient.ts` deserves saying plainly: it is a well-built, fail-closed
Prisma extension. It derives the set of tenant-scoped models from the DMMF rather than a
hand-maintained list, throws `TENANT_MODEL_UNCLASSIFIED` for any model it does not
recognise, throws `TENANT_CONTEXT_REQUIRED` when no context is present, injects the
company scope into every filtered operation via `AND` (so a caller cannot overwrite it),
validates parent ownership before an indirect create, blocks `companyId` rewrites on
update and upsert, refuses nested writes into branch-owned relations, and checks branch
access on direct `branchId` assignment. Thirteen indirect-scope relations are enumerated
explicitly.

The IDOR probes the audit prompt asks for are therefore answered structurally rather than
resource by resource: any route using `db` inside a tenant context is scoped by
construction, and any model the author forgot to classify fails closed rather than open.

That makes the exceptions the whole story. `systemDb` bypasses the extension entirely and
appears in 22 files. Most are legitimately pre-authentication (login, refresh, logout, MFA
challenge, enrollment, WebAuthn challenge storage). The rest are not: the payment webhook
(F-08, already filed), the courier webhook, `communication/campaignProcessor`,
`inventory/reservationExpiry`, `reconciliation/scheduler` and `retention/job` all run
cross-tenant with no scope.

## Findings — Phase 4

| ID | Severity | Area | `file:line` | Defect | Failure scenario | Fix | Verified by |
|---|---|---|---|---|---|---|---|
| F-51 | **P0** | Compliance | `src/app/api/v1/legal-holds/route.ts`, `src/app/api/v1/legal-holds/[id]/route.ts` | `legalHold` is a **write-only table**. It is created, listed, counted and released, and **nothing reads it to block anything**. A search across `src/` finds no reference to `legalHold` outside those two CRUD routes — not in the retention job, not in any delete or anonymize path, not in the DSR handler | Counsel places a litigation hold on a customer's records. The retention job runs that night and anonymizes the customer's name, phone, email, address and tax identifier, and hard-deletes the related security events. The hold was recorded, acknowledged in the UI, and had no effect. This is spoliation, and the system reports the hold as active throughout | Consult active holds in every retention, anonymization and deletion path, and fail closed when a hold covers the subject | Test: place a hold, run retention, assert the held subject is untouched |
| F-52 | **P0** | Compliance / multi-tenancy | `src/lib/retention/job.ts:6,29,34,41` | The retention job runs on `systemDb` with **no tenant scope at all**. `deleteMany({ occurredAt: { lt: cutoff } })` deletes across every company, and the cutoffs come from two process-wide environment variables | One global retention policy is imposed on all tenants. A tenant with a seven-year statutory retention obligation has its security events hard-deleted at 90 days because another tenant's default applies. Nothing in the API lets a tenant express its own policy, and nothing records which tenant's data was destroyed | Scope the job per company and read the retention period from tenant configuration | Test with two companies on different policies |
| F-53 | **P1** | SSRF | `src/app/api/v1/webhook-endpoints/route.ts:16` | Endpoint URLs are validated only as `z.string().url()` plus an `https://` prefix check. There is no host allowlist, no private-range or link-local denylist, no DNS-rebinding protection, and the delivery `fetch` (`src/workers/outboxWorker.ts:81`) follows redirects by default | A tenant administrator registers `https://127.0.0.1:8080/` or a host that redirects to `http://169.254.169.254/`. The server then issues signed POSTs to internal services or the cloud metadata endpoint on a schedule, and the response body excerpt is stored back on the delivery row where the tenant can read it — a full SSRF read primitive. Latent only because nothing produces outbox events yet (F-39); live the moment that is fixed | Resolve the host and reject private, loopback, link-local and unique-local addresses; disable redirects; re-validate on every delivery | Test registering a loopback and a metadata-service URL, expecting rejection |
| F-54 | **P1** | Auth configuration | `src/lib/auth/webauthn.ts:26-34` | `WEBAUTHN_RP_ID` defaults to `'localhost'` and `WEBAUTHN_ORIGIN` to `'http://localhost:3000'`, with **no production guard**. Compare `getSecret()` in `src/lib/auth/jwt.ts:12-15`, which throws when `JWT_SECRET` is missing in production. Both variables are also absent from `.env.example` (F-17) | Deployed without them, every passkey registration is bound to RP ID `localhost` and every assertion is verified against origin `http://localhost:3000`, so passkey authentication silently never works on the real domain. The go-live checklist records "WebAuthn passkey support — implemented". The failure is closed rather than open, but it is silent, and origin binding — the control that makes WebAuthn phishing-resistant — is configured by default to a value that is wrong everywhere except a developer laptop | Throw at startup when either is unset in production, as `JWT_SECRET` does | Startup test asserting the process refuses to boot |
| F-55 | **P1** | Auth | `src/lib/auth/jwt.ts:10-19,35,48` | `JWT_SECRET` is required in production but its length and entropy are never checked. It is used directly as an HS256 key | `JWT_SECRET=secret` passes. HS256 with a short secret is brute-forceable offline from a single captured token, and a forged token mints any `company_id` and `user_id` the attacker chooses — a full authentication and tenant bypass. Nothing in the deployment path prevents it | Require at least 32 bytes of decoded entropy and fail startup otherwise | Startup test with a short secret, expecting refusal |
| F-56 | **P1** | Dead code on security paths | `src/lib/db/tenant.ts`, `src/lib/db/exclude.ts` | Two unreferenced modules duplicate security-critical logic and would not work if used. `tenant.ts` exports a `tenantDb` proxy that injects **`company_id`** (snake_case) into Prisma `where` clauses and matches models against snake_case table names — Prisma's client uses camelCase, so the model list never matches and the injected argument would be rejected as unknown. `exclude.ts` contains a second `nextDocumentNumber` that reads a sequence and then increments it in a separate statement, with no lock and no atomic upsert. It is imported by nothing; it imports the broken proxy | A future contributor imports `nextDocumentNumber` from `@/lib/db/exclude` instead of `@/lib/numbering` and gets duplicate document numbers under concurrency, breaking statutory sequencing. The name, signature and location all look plausible. The same applies to anyone reaching for `tenantDb` from `./tenant` rather than the real extension | Delete both files | Confirm no importers remain, and that the deletion does not change any test outcome |
| F-57 | **P1** | Compliance | `src/app/api/v1/data-subject-requests/[id]/route.ts:35-56` | Completing a data-subject request only writes `status`, `resolvedBy` and `resolvedAt`. No export is produced and no erasure is performed. Nothing links the request to the retention job or to any customer record | An operator marks an erasure request `completed`. The subject's data remains in full. The system now holds a durable record asserting the request was fulfilled, which is worse than holding no record at all | Either implement export and erasure, or rename the status to reflect that fulfilment is manual and record the evidence | Test asserting subject data is unreachable after a completed erasure request |
| F-58 | **P2** | Secrets | `src/lib/storage/index.ts:29-31` | S3 credentials default to `minioadmin` / `minioadmin` and the region to `ap-south-1`, with no production guard | Deployed without `S3_ACCESS_KEY` / `S3_SECRET_KEY`, the client silently authenticates with development credentials. Every document upload, export artifact and backup target fails at runtime rather than at boot, and the failure surfaces as a storage error rather than a configuration error. `S3_*` is also missing from `.env.example` | Fail startup when unset in production | Startup test |
| F-59 | **P2** | Forensics | `src/lib/retention/job.ts:34`; MariaDB trigger set | `audit_logs` is protected by `trg_auditlogs_immutable_upd` / `_del` and the retention job explicitly skips it on MariaDB (line 27-30, a deliberate and correct choice). `security_events` has **no equivalent trigger** and is hard-deleted at 90 days on every database | The forensic record of authentication failures, cross-tenant idempotency reuse, unverified webhooks and outbox dead-letters — the `critical` events this codebase raises — is destroyed on a rolling 90-day window with no archive. An incident discovered at 100 days cannot be investigated | Add the immutability trigger, archive before purge, and make the window tenant-configurable | Direct `UPDATE` on a security event, expecting rejection |
| F-60 | **P2** | Compliance | `src/lib/retention/job.ts:40-62` | Customer anonymization selects on `isActive: false` and `updatedAt < cutoff`, then applies a loop of individual updates outside any transaction | `updatedAt` is a poor proxy for "closed twelve months ago": any incidental write — a bulk import touching the row, a backfill — resets the clock and defers anonymization indefinitely. And a failure part-way through the 500-row batch leaves some customers anonymized and the rest not, with no record of where it stopped | Track a `closedAt` timestamp explicitly; wrap the batch in a transaction and record progress | Test interrupting the batch |
| F-61 | **P3** | Auth | `src/lib/auth/mfa.ts:31-42` | `authenticator.verify()` is called with no record of which TOTP code was last consumed for that user | A code remains valid for the remainder of its 30-second step after first use. Impact is limited because the MFA challenge cookie is single-use and consumed irreversibly, so replay also requires a fresh challenge — which requires the password. Worth closing anyway | Store the last accepted step per user and reject a repeat | Test submitting the same code twice within one step |
| F-62 | **P3** | API hygiene | `src/app/api/v1/data-subject-requests/[id]/route.ts:17,39` | `const idempotencyKey = requireIdempotencyKey(req)` is called in both `GET` and `PATCH` and the value is never used. On `GET` it makes a read require an `Idempotency-Key` header | A client performing a plain read gets a 400 until it invents a key. The unused binding is invisible because `no-unused-vars` is disabled (F-10) | Remove it from `GET`; use it in `PATCH` | Test a `GET` without the header |

## Areas checked and found sound

- **`tenantClient.ts`** — as described above. No defect found.
- **Password reset** (`src/lib/access/reset.ts`) — 256-bit nonce, HMAC-signed token,
  `timingSafeEqual` comparison, expiry enforced, single-use through a conditional
  `updateMany` with a `consumed.count !== 1` check, and all other outstanding challenges
  for the user invalidated on redemption. This is textbook.
- **Argon2 parameters** — `argon2id`, `memoryCost: 65536` (64 MB), `timeCost: 3`,
  `parallelism: 1` (`src/lib/auth/password.ts:6-11`). Meets the go-live requirement and
  current OWASP guidance.
- **Access token lifetime** — 15 minutes, `HttpOnly`, `SameSite=Strict`, HS256 with
  audience and issuer claims verified. Subject to F-11 (the `E2E_TESTING` /
  `DISABLE_SECURE_COOKIES` kill switches) and F-55 (unvalidated secret strength).
- **Injection surface** — zero `$queryRawUnsafe` / `$executeRawUnsafe` in the codebase. All
  eleven raw statements are tagged templates with bound parameters. No filesystem path is
  built from user input; `src/lib/i18n/index.ts:31` joins from a fixed locale list.
- **Webhook signature verification** — inbound payment webhooks verify before acting and
  raise a `high` security event on failure or non-verification (`src/app/api/v1/webhooks/payment/[provider]/route.ts:26-46`).
- **Rate limiting** — distributed Redis limiter, fail-closed in production, with a
  dedicated request-scoped connection and hard deadlines, per the 2026-09-16 remediation.

## The write-only table pattern, fourth instance

`legalHold` (F-51) joins `business_events` (Phase 2), `outbox_events` and
`offline_commands` (Phase 3). Four tables are written by the API, exposed in the UI, and
read by nothing that acts on them. In each case the feature appears complete from outside:
the endpoint returns 200, the row exists, the list view shows it. `legalHold` is the most
serious because the gap is invisible precisely when it matters — a hold that does nothing
looks identical to a hold that works until the data is already gone.

## Severity roll-up

| Severity | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Total open |
|---|---:|---:|---:|---:|---:|
| P0 | 3 | 5 | 2 | 2 | 12 |
| P1 | 8 | 7 | 6 | 5 | 26 |
| P2 | 5 | 5 | 4 | 3 | 17 |
| P3 | 2 | 1 | 2 | 2 | 7 |


---

# Phase 5 — Framework, performance, operations

Framework judgements here were checked against the bundled Next.js 16.2.10 docs at
`node_modules/next/dist/docs/`, per `AGENTS.md`, rather than from memory. The relevant
page is `01-app/03-api-reference/03-file-conventions/instrumentation.md`.

## Findings — Phase 5

| ID | Severity | Area | `file:line` | Defect | Failure scenario | Fix | Verified by |
|---|---|---|---|---|---|---|---|
| F-63 | **P1** | Build gates | `next.config.ts:6-8` | `typescript: { ignoreBuildErrors: true }`. The production build compiles regardless of type errors, and no ESLint step runs in the build either | `tsc` currently passes (exit 0), so nothing is broken today — but the gate is switched off, so the next type error ships silently. Together with the 26 disabled lint rules (F-10) and the never-run repo-wide lint (F-16), all three static gates are configured not to block. Every "Code Quality" line on the go-live checklist rests on gates that cannot fail | Remove the flag; keep `tsc --noEmit` and ESLint in CI as blocking steps | A deliberately introduced type error must fail `next build` |
| F-64 | **P1** | Observability | `instrumentation.ts`, `sentry.server.config.ts:7,47` | `sentry.server.config.ts` exports `register()` and `onRequestError`, and **nothing imports it**. Next.js 16 loads both hooks from the root `instrumentation.ts` (confirmed in the bundled docs), and this project's `instrumentation.ts` starts the OpenTelemetry SDK and never imports the Sentry config. There is also no `instrumentation-client.ts`, the file Next 16 uses for client-side init | `Sentry.init()` never executes on the server, so no server error is ever reported, and `Sentry.captureRequestError` is never wired to the hook Next actually calls. `@sentry/nextjs`, `withSentryConfig`, three config files and a `beforeSend` PII scrubber are all present and inert. The `[telemetry] Sentry DSN detected — error tracking enabled` log line at `src/lib/telemetry/index.ts:17` prints on DSN presence alone and asserts something untrue | Import the Sentry configs from `instrumentation.ts` and re-export `onRequestError` from there; add `instrumentation-client.ts` | Throw a deliberate error in a route handler and confirm it arrives in Sentry |
| F-65 | **P1** | Observability | `src/workers/index.ts:19-21` | The worker process runs as `bun src/workers/index.ts`, entirely outside Next.js, so neither `instrumentation.ts` nor any Sentry config is loaded there. Worker failures are handled by `log('error', ...)` to stdout | Reconciliation, retention, outbox and campaign failures produce a console line in a container log and nothing else. No alert, no trace, no error grouping. The daily reconciliation can fail every night unnoticed | Initialise Sentry and OTel explicitly in the worker entrypoint | Force a worker job to throw and confirm it is reported |
| F-66 | **P1** | Performance / money | `src/app/api/v1/reports/trial-balance/route.ts:21-50` | The trial balance loads **every posted journal line since inception** with `findMany` — no `take`, no `groupBy` — joins the chart of account per row, then aggregates in JavaScript with `parseFloat` and `+=` | Two defects in the one report whose purpose is proving that debits equal credits. After a year of POS trading this is millions of rows joined and held in memory, which will exhaust the heap; and the totals are summed in IEEE-754 from `DECIMAL(65,30)` values that per F-32 carry up to 30 fractional digits, so the report can show a spurious imbalance or conceal a real one | Aggregate with `groupBy` and `_sum` in SQL, keep `Prisma.Decimal` throughout, and round once at the presentation boundary | Test over a large synthetic ledger asserting the report ties exactly to a Decimal-computed control total |
| F-67 | **P1** | Performance | `prisma/schema.prisma` — 620 single-column `@@index`, 17 composite | The tenant extension guarantees `companyId` appears in the predicate of every scoped query (`src/lib/db/tenantClient.ts:156`). Almost every index is single-column: `@@index([companyId])`, `@@index([businessDate])`, `@@index([saleStatus])` separately rather than `@@index([companyId, businessDate])` | `WHERE company_id = ? AND business_date BETWEEN ? AND ?` can use only one index per table access in InnoDB. `company_id` alone has near-zero selectivity — one tenant is most of the table — so the engine scans a large slice and filters in memory. This is the structural reason the POS-sale and dashboard latency targets in the go-live checklist are at risk, and the 620 indexes also cost write throughput on every insert | Replace the single-column indexes on scoped models with `companyId`-prefixed composites matching the actual filters; drop the redundant remainder | `EXPLAIN` on the hot queries before and after, plus the k6 load scripts already in `tests/load/` |
| F-68 | **P2** | Security headers | `next.config.ts:41` | The CSP is `script-src 'self' 'unsafe-inline'`, with an inline comment stating this should be replaced by per-request nonces in production. `frame-ancestors` additionally allows `https://*.space-z.ai`, a third-party preview gateway | `unsafe-inline` removes the main protection CSP offers against injected script. And a third-party origin may frame the production ERP, which is a clickjacking path against an authenticated money application; the `X-Frame-Options: SAMEORIGIN` header on the line above does not help, because modern browsers prefer `frame-ancestors` where both are present | Adopt nonce-based CSP; restrict `frame-ancestors` to `'self'` in production | Header assertion test against a production build |
| F-69 | **P2** | Source disclosure | `next.config.ts:10` | `productionBrowserSourceMaps` is enabled whenever `SENTRY_AUTH_TOKEN` is set, so maps are **served publicly** rather than uploaded and deleted | Anyone can reconstruct the full client source, including route structure, permission code strings and any constant that was assumed obscure. Sentry does not need publicly served maps — it needs them uploaded at build time | Upload to Sentry and delete from the build output (`sourcemaps.deleteSourcemapsAfterUpload`) | Confirm no `.map` is reachable from the deployed origin |
| F-70 | **P2** | Operations | `src/lib/health/runtime.ts:22` | `checks.worker` is initialised to `'skipped'` and never set. Database, Redis and storage are genuinely probed; the worker process is not | The worker process runs reconciliation, retention and outbox delivery. It can be dead for days while `/api/v1/health` returns 200 and the deployment is considered healthy | Have workers write a heartbeat and check its freshness | Stop the worker and assert the health check degrades |
| F-71 | **P2** | Performance | `src/app/api/v1/stock-counts/route.ts:113`, `src/app/api/v1/offline/sync/route.ts:61` | Per-item database round trips inside a `Serializable` transaction with a 30-second timeout. Stock counts iterate `body.items`; offline sync iterates up to 500 commands issuing at least two queries each | A physical count of a 5,000-line warehouse issues thousands of sequential round trips inside one long-held transaction, exceeding the timeout and holding locks throughout. Compare `purchases/route.ts:191` and `quotations/route.ts:108`, which batch correctly with `PRODUCT_VALIDATION_BATCH_SIZE` — the pattern exists in the codebase and was not applied here | Batch the lookups as those two routes do | Test a 5,000-line stock count within the timeout |
| F-72 | **P2** | Performance | 20 list endpoints | Twenty routes call `findMany` with no `take` or pagination, including `chart-of-accounts`, `categories`, `products/[id]/barcodes`, `tax-codes`, `branches` and `warehouses` | These are small today because they are reference data, but nothing bounds them. A tenant with 50,000 categories gets an unbounded response and an unbounded query | Apply the cursor pagination the paginated routes already use | Test asserting a bounded page size |
| F-73 | **P3** | Framework | `next.config.ts:9` | `reactStrictMode: false` | Strict mode surfaces unsafe effects and double-invocation bugs in development. Disabling it hides exactly the class of defect the disabled `react-hooks` lint rules (F-10) would otherwise catch | Enable it and fix what surfaces | Development run after enabling |

## Areas checked and found sound

- **Migration safety** — no `DROP COLUMN`, `DROP TABLE` or `RENAME COLUMN` anywhere in the
  MariaDB migration set. The single schema change beyond the initial migration widens
  `before_value` / `after_value` to `LONGTEXT`, which is expand-only and safe. This is the
  cleanest area of the codebase against its rubric dimension.
- **Health check** — `src/lib/health/runtime.ts` genuinely probes dependencies: a real
  `currency.count()` against the database, a real Redis `PING`, an S3 `headObject`, each
  bounded at 2 seconds, with results throttled to one probe per 5 seconds and a dedicated
  quiet connection so probe failures do not log raw credentials. The public endpoint
  returns only `status` and `service`; detail is admin-only. It is not the rubber-stamp
  200 the audit prompt warns about. Only the never-populated `worker` check (F-70) is a
  defect.
- **Server/client boundary** — no client component imports `@/lib/db`, `@/lib/auth/jwt`,
  `@/lib/crypto` or `@prisma/client`; no non-`NEXT_PUBLIC_` environment variable is read
  in a client component. The boundary is clean, though it is maintained by convention — the
  `server-only` package is not used anywhere, so nothing enforces it mechanically.
- **Per-tenant caching** — no route segment config, no `unstable_cache`, no
  `cache: 'force-cache'` anywhere in `src/`. Every route handler calls
  `authenticateRequest()`, which reads cookies, making all of them dynamic. There is no
  path by which one tenant's data can be served from another's cache entry.
- **Security headers** — HSTS with a two-year max-age and `preload`, `nosniff`,
  `strict-origin-when-cross-origin` referrer policy, and a `Permissions-Policy` denying
  camera, microphone and geolocation are all correctly set. Only the CSP and
  `frame-ancestors` weaknesses in F-68 detract.
- **OpenTelemetry** — traces and metrics exporters configured with a batch span processor,
  a 30-second metric interval and a `SIGTERM` shutdown hook.

## Final severity roll-up

| Severity | P1 | P2 | P3 | P4 | P5 | Total open |
|---|---:|---:|---:|---:|---:|---:|
| P0 | 3 | 5 | 2 | 2 | 0 | **12** |
| P1 | 8 | 7 | 6 | 5 | 5 | **31** |
| P2 | 5 | 5 | 4 | 3 | 5 | **22** |
| P3 | 2 | 1 | 2 | 2 | 1 | **8** |

(Column headings are phases, not severities.)

---

# Rubric score

Scored per `docs/audits/FULL-CODEBASE-BUG-HUNT-PROMPT.md`: a dimension loses its full
weight for an open P0 within it, and half its weight for an open P1.

| Dimension | Weight | Open findings | Score |
|---|---:|---|---:|
| Domain correctness (money, inventory, tax) | 25 | P0: F-01, F-19, F-20, F-21, F-22, F-23 | **0** |
| Concurrency, idempotency, transactions | 15 | P0: F-03, F-37 | **0** |
| Security and access control | 15 | P0: F-02, F-38, F-51, F-52 | **0** |
| Data integrity and migrations | 10 | P1: F-25, F-26 (no P0) | **5** |
| Test coverage of critical paths | 10 | P1: F-10 (no P0) | **5** |
| Error handling and resilience | 8 | P1: F-40, F-42 (no P0) | **4** |
| Observability and operations | 7 | P1: F-64, F-65 (no P0) | **3.5** |
| Performance | 5 | P1: F-66, F-67 (no P0) | **2.5** |
| Framework correctness | 5 | P1: F-63 (no P0) | **2.5** |

**Total: 22.5 / 100.** Target: 98.

The three heaviest dimensions — 55 of the 100 points — score zero because each holds at
least one open P0. No amount of work on the lighter dimensions moves the number until
those twelve P0 findings are closed; closing them alone takes the score to roughly 80,
and clearing the 31 P1 findings takes it the rest of the way.

The residual 2 points the prompt asks to be named explicitly: even at 98 this audit has
not executed the Playwright suite, has not load-tested against the p95 targets, and has
not verified any of the six external sign-offs (tax, legal, labour, PCI QSA, accounting,
forex). Those are the known unknowns that keep the score short of 100.

## What this audit did not cover

Stated plainly so the score is not read as broader than it is:

- The Playwright end-to-end suite was not run.
- No load testing was performed; the k6 scripts in `tests/load/` were not executed.
- Accessibility was not assessed.
- The `(erp)/dashboard` UI was examined only for the server/client boundary.
- Payroll, fixed assets, courier settlement and service/warranty were confirmed to post to
  the GL but their calculations were not audited line by line.
- No production environment was accessed, and no MariaDB constraint claim was verified by
  executing SQL against a live production schema — the comparisons in F-25 and F-26 are
  from the migration sources.

## Next

Remediation has not started. **No code has been modified in any of the five phases.**
Per the prompt's remediation rules, work proceeds in severity order: all twelve P0
findings first, each with a regression test that fails before the change and passes after,
with database-level enforcement added on all three schema targets where the finding is an
invariant, one logical fix per commit, and the full gate set re-run after each severity
tier.

The recommended first move is not a code change at all: rotate the cPanel credential in
F-02, which is live and exposed right now.

---

# Remediation — P0 tier complete (2026-09-23)

All twelve P0 findings are closed. Eight commits on `main`, each one logical fix
with a regression test that fails against the previous source.

## Gate set after the tier

| Gate | Result |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | **PASS** — exit 0 |
| `node node_modules/eslint/bin/eslint.js src instrumentation.ts` | **PASS** — exit 0 (still subject to F-10: 26 rules disabled) |
| `node scripts/verify-access-tests.mjs` | **PASS** — 989 passed, 0 failed, 5 skipped, 78 files |

The suite was 970 passed / 4 failed at the start of remediation and 955 passed /
1 failed when the audit began.

## Commits

| Commit | Findings closed | Regression proof |
|---|---|---|
| `9fb66ea` | F-02 | n/a — credential rotation is the operator's step |
| `64bceb8` | F-38, F-50 | `commitImport` not reached when the permission lookup throws |
| `f9db455` | F-03 | provider not called and no reversal row created on replay |
| `0499df0` | F-22, F-23, F-24 | 12 tests over inclusive pricing, compounding, order, effective dates |
| `8922f8d` | F-01, F-19, F-20, F-21, F-30 | see `eb69a8b` |
| `9a59c91` | F-37, F-43, F-44 | 5 tests, all failing before |
| `60837b2` | F-51, F-52, F-60, F-57 (partial) | 7 tests; the unfixed job deleted with `companyId: undefined` |
| `eb69a8b` | tests for F-19/F-20/F-21 | `'0.00' → '600.00'`, `'-200.00' → '0.00'`, `'0.00' → '100.00'` |

## What changed, by finding

**F-01, F-19, F-20, F-21 — the missing general ledger.** Four of the eleven write
paths that bypassed `postJournalEntry` now post. Purchase receipt debits inventory
against GRNI (or AP where no goods-received account is configured), so the inventory
account is no longer credited-only and drifting negative. Voiding a sale reverses its
revenue and COGS entries. A sale return posts its customer credit with output tax
reversed to the accounts it was charged to, plus a COGS reversal for goods that
actually re-enter stock. Gift-card redemption debits the liability that issuance
recognised. `postJournalEntry` gained an optional `eventSourceId` so a document that
is posted against repeatedly keeps a unique `business_events` key.

**F-22, F-23, F-24 — tax.** `src/domain/tax/computeLineTax.ts` is now the single
computation. `priceIncludesTax` is read, so a 115.00 inclusive shelf price yields
100.00 + 15.00 rather than 115.00 + 17.25. `compoundOnPrevious` and
`calculationOrder` are applied, so SD 10% then VAT 15% on 100 collects 26.50 rather
than 25.00. Components are resolved as of the document's business date. The
inclusive path allocates its division residual to the last component, so
`taxableAmount + Σ tax` equals the gross exactly.

**F-03 — duplicate refunds.** The replay result is no longer discarded, so a retried
`Idempotency-Key` returns the stored response before any gateway call. The real
refund outcome now replaces the Phase 1 placeholder.

**F-37, F-43, F-44 — offline POS.** Commands are executed through the same domain
commands the online path uses, preserving the terminal's business date. Payloads are
validated per command type. The payload hash is recomputed server-side. The endpoint
requires `sale.post` instead of `device.read`.

**F-38, F-50 — fail-open authorization.** Seven call sites across five files caught
every exception from `requirePermission` and continued when it was not a
`DomainError` — which is exactly what a Prisma failure during the permission lookup
produces. They now rethrow. The `!auth.isGlobal` conjunct was dead in all of them.

**F-51, F-52, F-57 (partial), F-60 — compliance.** `src/lib/retention/legalHold.ts`
makes `legal_holds` load-bearing: a hold on the subject, on the company, or on the
audit or security-event stream blocks the corresponding purge, and completing an
erasure-type DSR now fails with 409 while a hold covers the subject. The retention
job runs per company, reads its retention periods from that company's
`configuration_values`, reports per-company counts including subjects held back, and
anonymizes each batch in one transaction.

**F-30 — sale-return money.** Proration moved to `Prisma.Decimal`. The totals also
never subtracted the prorated discount — `subtotal - 0 + tax` refunded customers a
discount they had not paid.

## Correction to the audit

**F-38's blast radius was overstated.** The report said 22 route files. Only 5 files
(7 call sites) actually failed open. The other 15 use
`if (e instanceof DomainError) { ... } else { return 500 }`, which is fail-closed;
they carry the same dead `!auth.isGlobal` conjunct but no defect. The finding is real
and is fixed; the count was wrong.

## Two things the operator must still do for F-02

1. Rotate the cPanel password for `host.zhostbd.com` / `rangpurt` and terminate all
   active sessions. The committed token is still valid until this is done.
2. Purge `cookies.txt` and `headers.txt` from git history and force-push. The files
   are untracked and ignored now, but every historical commit still contains them.

## Fixture defect found and fixed at source

`tests/integration/helpers/disposableFixtures.ts` mapped `salesRevenueAccountId` to
the gift-card liability account, so `Dr liability / Cr revenue` landed twice on one
account and netted to zero — which is why the redemption gate could not be satisfied
by any correct implementation. Eleven existing policy rows in the disposable database
were repaired, and the helper now provisions a distinct operating-revenue account so
the collision is not recreated on a fresh database.

This also produced a new finding for the P1 backlog: **the accounting-policy API
validates nothing about role distinctness or account class**, which is how the
mapping was accepted in the first place.

## Next

P1 tier: 31 findings. Rubric currently reads 55/100 — the three zero-scoring
dimensions (domain correctness, concurrency/idempotency, security/access control) no
longer hold an open P0, so each now scores half weight rather than nothing, pending
their P1 findings.
