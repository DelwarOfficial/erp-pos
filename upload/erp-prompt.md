You are a senior full-stack engineer tasked with building a complete, production-grade multi-tenant ERP/POS system for the Bangladesh market (electronics/mobile/appliance retail + service + warranty) from zero to production. You will work phase-by-phase through a long-running coding session, writing real code, running real migrations, and fixing real errors — not stopping at planning.

═══════════════════════════════════════════════════════════════════════
SECTION 0 — SINGLE SOURCE OF TRUTH
═══════════════════════════════════════════════════════════════════════

The attached file `ERP_Product_Blueprint_v4.1.md` (~7,000 lines) is the SINGLE AUTHORITATIVE SPECIFICATION for this project. It is the product contract, data contract, security contract, implementation contract, and go-live acceptance contract. You must follow it without deviation.

BINDING RULES:
1. Every database table, column, constraint, index, and relationship in §5 must be implemented exactly as specified. Do not rename, omit, or "simplify" any table.
2. Every workflow in §7 must be implemented as a domain command that executes inside one explicit database transaction with the idempotency boundary in §7.1.
3. Every permission in §8.5 must be enforced. Every RLS policy in §8.2 must be created.
4. Every one of the 20 resolved production decisions in §20 (D01–D20) must be implemented per its specification.
5. The 13 mandatory architecture controls in §20.0 are NON-NEGOTIABLE. No tenant, feature flag, or configuration may disable them.
6. If you find any ambiguity, do NOT guess — re-read the blueprint. If still ambiguous, implement the most conservative, secure, reversible interpretation and document the decision in an ADR file.
7. Never replace an authoritative ledger with a cached balance. Never omit a required workflow while leaving its navigation enabled. Never bypass transaction/RLS/idempotency controls.
8. All 37 domain commands listed in §9 must be implemented: PostSale, VoidSale, PostSaleReturn, ReceivePurchase, PostPurchaseReturn, DispatchTransfer, ReceiveTransfer, CancelTransfer, PostStockCount, PostStockAdjustment, PostExpense, ApplyCustomerAdvance, PostAccountTransfer, ReversePayment, ClearCheque, BounceCheque, CancelCheque, CloseCashierShift, PostJournalAdjustment, PostCourierCodSettlement, ConvertLead, PostPayrollRun, PayPayrollRun, CreateDeliveryOrder, PostLandedCost, PostOpeningStock, PostServicePartConsumption, CompleteServiceRequest, FulfillWarrantyClaim, IssueGiftCard, RedeemGiftCard, PostGiftCardRefund, RedeemCoupon, EarnRewardPoints, RedeemRewardPoints, PostCommunicationCampaign, ReverseJournalEntry, PostAccountAdjustment.
9. All DB functions/triggers in §16 must be created (next_document_number, post_journal_entry, post_stock_movement, validate_payment_allocations, validate_serial_transition, prevent_posted_record_mutation, tenant_consistency_checks, validate_combo_graph, validate_delivery_transition, post_courier_cod_settlement, post_account_transfer, validate_service_transition, post_service_part_consumption, validate_warranty_replacement, validate_typed_configuration, validate_cheque_transition, post_opening_stock, validate_fefo_override, validate_accounting_policies, post_landed_cost, validate_landed_cost_allocation, expire_held_sale_reservations, post_gift_card_refund, validate_currency_account_match, post_store_credit_from_return, reverse_journal_entry, post_account_adjustment, etc.).

═══════════════════════════════════════════════════════════════════════
SECTION 1 — TECHNICAL STACK (MANDATORY, NO SUBSTITUTIONS)
═══════════════════════════════════════════════════════════════════════

- Web/PWA: Next.js (App Router), React, TypeScript (strict mode)
- Styling: Tailwind CSS
- UI components: shadcn/ui (or equivalent accessible component library)
- Domain/API: TypeScript modular monolith; shared domain package used by API and workers
- ORM: Prisma with a request-scoped transaction wrapper that sets RLS context via set_config() before every query
- Database: PostgreSQL 16+ in local, CI, staging, production (same version everywhere)
- Pooling: PgBouncer transaction pooling (or managed equivalent); set_config must be local to every transaction
- Cache/Queue: Redis + BullMQ
- Object storage: S3-compatible (encrypted at rest, versioned, signed URLs)
- Auth: Argon2id password hashing, rotating refresh tokens (hashed, device-bound, family-based revocation), TOTP/WebAuthn MFA, access JWT 15min in HttpOnly+Secure+SameSite=Strict cookie
- Encryption: Envelope encryption (AES-256 + KMS) for MFA secrets, provider credentials, account numbers, webhook secrets
- Monitoring: Structured JSON logging with correlation_id, OpenTelemetry traces, error tracking (Sentry-equivalent)
- Deployment: Docker (non-root containers), TLS gateway/WAF, CI/CD with manual migration approval, immutable images
- Testing: Vitest (unit/domain), Playwright (e2e), k6 (load), axe (accessibility)
- Localization: bn-BD (Bangla, default) + en-BD (English); Noto Sans Bengali font embedded in PDFs and loaded as web font
- PDF/print: server-side rendering with embedded Bangla fonts; ESC/POS bridge for thermal; browser print for A4

Package versions are pinned in lockfiles. No unpinned future versions.

═══════════════════════════════════════════════════════════════════════
SECTION 2 — REPOSITORY STRUCTURE
═══════════════════════════════════════════════════════════════════════

```
erp-pos/
├── prisma/
│   ├── schema.prisma              # Prisma models (mirrors DB schema)
│   ├── migrations/                # Forward-only SQL migrations (numbered)
│   ├── functions/                 # SQL functions (post_journal_entry, etc.)
│   ├── triggers/                  # SQL triggers (prevent_posted_record_mutation, etc.)
│   ├── rls/                       # RLS policy definitions per table
│   ├── seeds/                     # Base currency, permissions, system roles, tax defaults
│   └── partitioning/              # Partition creation/management scripts
├── src/
│   ├── domain/                    # Shared TypeScript domain package
│   │   ├── commands/              # PostSale.ts, VoidSale.ts, ... (37 commands)
│   │   ├── entities/              # Sale.ts, Purchase.ts, JournalEntry.ts, ...
│   │   ├── events/                # BusinessEvent definitions
│   │   ├── policies/              # AccountingPolicies, TaxPolicies, PricingPolicies
│   │   └── invariants/            # Pure functions enforcing business rules
│   ├── api/                       # Next.js API routes (/api/v1/*)
│   │   ├── auth/
│   │   ├── products/
│   │   ├── inventory/
│   │   ├── sales/
│   │   ├── purchases/
│   │   ├── transfers/
│   │   ├── payments/
│   │   ├── accounting/
│   │   ├── deliveries/
│   │   ├── service/
│   │   ├── crm/
│   │   ├── hr/
│   │   ├── offline/
│   │   └── ... (one folder per module group in §9.1)
│   ├── app/                       # Next.js App Router UI
│   │   ├── (public)/              # login, forgot-password, reset-password
│   │   ├── (erp)/                 # all admin pages per §9.4 route tree
│   │   ├── (pos)/                 # POS PWA routes
│   │   ├── print/                 # receipt/[id], invoice/[id], etc.
│   │   └── api/v1/                # API route handlers
│   ├── components/                # Shared: DataTable, FilterBar, Money, Quantity, PermissionGate, ApprovalBadge, SerialPicker, PaymentDrawer, ThermalReceipt, A4Invoice, ConflictResolutionPanel, etc.
│   ├── lib/
│   │   ├── db/                    # Prisma client wrapper with RLS context
│   │   ├── auth/                  # JWT, refresh token, MFA, session
│   │   ├── crypto/                # Envelope encryption, hashing
│   │   ├── idempotency/           # Idempotency-Key handling
│   │   ├── errors/                # Domain error codes (§13.1)
│   │   ├── i18n/                  # Locale loading, fallback
│   │   └── validation/            # Zod schemas (shared with API)
│   ├── workers/                   # BullMQ workers (outbox, webhooks, communication, offline sync, reconciliation, retention, expire-reservations)
│   ├── adapters/                  # Provider adapters: Sms, Email, Courier, Risk, Payment (§9.3 interfaces)
│   └── reports/                   # Report definitions per §11.5 catalogue
├── tests/
│   ├── unit/                      # Domain invariant tests
│   ├── integration/               # RLS, constraints, concurrency, idempotency
│   ├── e2e/                       # Playwright UAT scenarios (§17.5)
│   ├── load/                      # k6 scripts
│   └── fixtures/                  # Synthetic seed data
├── docs/
│   ├── adr/                       # Architecture Decision Records
│   └── runbooks/                  # §18A.4 operational runbooks
├── docker/
│   ├── Dockerfile.web
│   ├── Dockerfile.worker
│   └── docker-compose.yml         # local dev: postgres, redis, minio
├── scripts/                       # DB management, migration helpers, seed scripts
└── README.md
```

═══════════════════════════════════════════════════════════════════════
SECTION 3 — PHASED DEVELOPMENT PLAN (EXECUTE IN ORDER, NO SKIPPING)
═══════════════════════════════════════════════════════════════════════

Follow §18A.1 milestone order M0→M1→M2→M3→M4→M5→M6→M7→M8. Do NOT begin a milestone until the previous milestone's exit criteria are met. Within each milestone, implement database → domain commands → API → UI → tests → reconciliation, in that order. Fix all errors before proceeding.

───────────────────────────────────────────────────────────────────────
PHASE M0 — ARCHITECTURE FOUNDATION
───────────────────────────────────────────────────────────────────────
Exit gate: RLS isolation test passes; first backup restore test passes; auth/MFA works end-to-end; CI/CD green; observability live.

Tasks:
1. Initialize Next.js + TypeScript + Tailwind + Prisma repo. Pin all versions in lockfile.
2. Create docker-compose.yml for local Postgres 16 + Redis + Minio. Verify parity with production config.
3. Create the request-scoped Prisma transaction wrapper (`src/lib/db/transaction.ts`) that calls `set_config('app.company_id', ...)`, `set_config('app.user_id', ...)`, `set_config('app.branch_ids', ...)`, `set_config('app.is_global', ...)` with `true` (local) before every transaction. No module may import an unrestricted Prisma client.
4. Create DB roles: `app_role` (NOSUPERUSER, NOBYPASSRLS, not owner of protected tables), `migration_role` (can bypass RLS for migrations only), `backup_role` (separate credential), `reporting_role` (read-only). Document each in `docs/adr/0001-db-roles.md`.
5. Implement migrations for §5.1 (Organization/Currency), §5.2 (Identity/RBAC/Devices), §5.3 (Numbering/Events/Idempotency), §5.15 (Audit/Approval/Statutory/Reconciliation) tables EXACTLY as specified — every column, constraint, index, partial unique index, EXCLUDE constraint. Pay special attention to: `document_sequences` two partial unique indexes (NULL vs NOT NULL branch_id), `document_number_leases` EXCLUDE USING gist with int8range, `idempotency_requests` unique(company_id, idempotency_key).
6. Create all RLS policies from §8.2 for every table created so far. Test cross-tenant isolation.
7. Implement auth: Argon2id (memory≥64MB, time≥3), JWT 15min HttpOnly cookie, rotating hashed refresh tokens with family revocation, TOTP MFA, device registration with public key, progressive lockout. Implement `cashier_device_pins` table (§20.D06).
8. Implement `next_document_number()` SQL function with `FOR UPDATE` row lock. Implement `prevent_posted_record_mutation()` trigger. Implement `set_updated_at()` trigger. Implement `tenant_consistency_checks()` trigger.
9. Implement the idempotency middleware: every mutation requires `Idempotency-Key` header; same key+hash → stored response; same key+different hash → 409; store in `idempotency_requests`.
10. Implement structured JSON logging with correlation_id, redaction of secrets/PII. Wire OpenTelemetry. Configure Sentry-equivalent.
11. Implement backup infrastructure: nightly pg_dump + continuous WAL archiving to encrypted Minio with object-lock; checksum verification; separate backup credential. Run first restore test.
12. Implement `recovery_epochs` table and the epoch-increment logic. Wire `devices.last_recovery_epoch` comparison.
13. Seed: BDT currency, first company, platform_operations role, permission catalogue (§8.5), system roles (§8.4), configuration_definitions defaults (approval thresholds from §20.D04, cashier config from §20.D06, offline config from §20.D07, retention from §20.D11, localization from §20.D19).
14. Write tests: RLS cross-tenant rejection, MFA flow, refresh-token family revocation, idempotency same-key/different-hash conflict, backup restore + reconciliation.
15. Create CI pipeline: format, lint, typecheck, unit tests, migration validation against real Postgres, SAST, dependency scan, secret scan, image scan.

CHECKPOINT: Do not proceed to M1 until all M0 exit criteria pass and all tests are green.

───────────────────────────────────────────────────────────────────────
PHASE M1 — ORGANIZATION AND CATALOGUE
───────────────────────────────────────────────────────────────────────
Exit gate: Product activation validates type/tax/unit/barcode/combo; barcode/QR prints and scans; bn-BD/en-BD templates render; RBAC enforced.

Tasks:
1. Migrate §5.4 (Categories, Brands, Units, Customer Groups, Products, Media, EntityMediaLinks, ProductBarcodes, ProductUnitOptions, ProductComboItems, DiscountPolicies, ProductPrices, TaxCodes, TaxComponents, TaxCodeComponents, WithholdingRules). Apply RLS to all. Create all partial unique indexes (product_barcodes is_primary, product_unit_options defaults, tax_codes effective dates).
2. Migrate §5.14A (ConfigurationDefinitions, ConfigurationValues, PosProfiles, DocumentTemplates, SupportedLanguages, CompanyLanguages, TranslationOverrides, FeatureFlags, DashboardPreferences, SalesTargets, SavedReportFilters, ReportExportJobs, SupportTickets, SupportTicketMessages).
3. Implement `validate_combo_graph()` (reject cycles), `validate_typed_configuration()`, `validate_translation_override()`.
4. Implement domain commands and API for: company/branch/warehouse CRUD, product CRUD with activation validation, barcode/QR generation (signed payloads), media upload (malware scan, MIME allowlist, SHA-256, signed URLs), category/brand/unit management, price tiers, tax code/component configuration, POS profile setup, document template management, translation overrides, feature flag toggling.
5. Implement the feature flag system (§20.D02): every domain command checks relevant flags; disabled flags hide navigation and return 403 FEATURE_NOT_ENABLED; enabling a flag for an unimplemented module returns 409 MODULE_NOT_IMPLEMENTED.
6. Implement localization: load bn-BD + en-BD translations; fallback to en-BD; Noto Sans Bengali web font + PDF embedding; locale-aware date/number/currency formatting (stored values locale-neutral DECIMAL).
7. Implement barcode/QR sheet PDF generation with versioned templates; test on representative thermal and A4.
8. Implement the company onboarding flow (§20.D01): platform_operations-only endpoint; seeds company+branch+warehouse+admin+role+policies+CoA skeleton+base currency+initial fiscal period in one transaction; status='suspended' until admin setup; activate via platform operations.
9. Write tests: duplicate barcode rejection, cyclic combo rejection, invalid unit conversion rejection, unsafe upload rejection, locale switch, feature flag hide/reject, onboarding seed completeness, RLS isolation.
10. Seed default tax components (VAT/SD/RD/ATV placeholders — final rates pending tax adviser per §20.D08), default chart of accounts skeleton, default POS profile, default receipt/invoice templates in bn-BD and en-BD.

CHECKPOINT: Do not proceed to M2 until M1 exit criteria pass.

───────────────────────────────────────────────────────────────────────
PHASE M2 — INVENTORY AND PURCHASING
───────────────────────────────────────────────────────────────────────
Exit gate: Negative-stock CHECK enforced at DB level; IMEI uniqueness; moving-average cost correct; transfer lifecycle complete; landed cost allocates; reconciliation checks pass.

Tasks:
1. Migrate §5.5 (WarehouseStocks with CHECK >= 0, StockMovements, StockReservations, ProductBatches, StockMovementBatches, ProductSerials with status-warehouse CHECK, SerialEvents), §5.5A (InventoryReasonCodes, StockCounts, StockCountItems with split partial uniques, StockCountSerials, StockAdjustments, StockAdjustmentItems, StockAdjustmentItemSerials), §5.6 (Customers, Suppliers), §5.8 (Purchases, PurchaseItems with qty_received<=qty_ordered and qty_returned<=qty_received CHECKs, PurchaseItemTaxes, PurchaseReceivings, PurchaseReceivingItems, PurchaseReceivingItemSerials, LandedCostDocuments, LandedCostAllocations, PurchaseReturns, PurchaseReturnItems, PurchaseReturnItemSerials), §5.9 (Transfers, TransferItems with qty dispatch/receive CHECKs, TransferItemSerials with partial unique on active transfers). Apply RLS to all.
2. Implement `post_stock_movement()` with FOR UPDATE lock on warehouse_stocks row, negative-stock check, moving-average cost recalculation per §5.5 rules (external inbound recalculates; outbound uses pre-movement average; sale returns at original cost; transfers carry source cost; bucket-to-bucket paired rows).
3. Implement `create_or_update_stock_reservation()`, `consume_stock_reservation()`, `reverse_stock_movement()`, `validate_serial_transition()`, `validate_return_quantities()`, `validate_stock_count_posting()`, `post_stock_adjustment()`, `validate_fefo_override()`, `post_opening_stock()`, `post_landed_cost()`, `validate_landed_cost_allocation()`.
4. Implement domain commands: ReceivePurchase, PostPurchaseReturn, DispatchTransfer, ReceiveTransfer, CancelTransfer, PostStockCount, PostStockAdjustment, PostLandedCost, PostOpeningStock.
5. Implement foreign-currency purchasing per §20.D13 (locked exchange rate on document; payment at different rate posts realized gain/loss). Landed cost allocation by quantity/value/weight/manual.
6. Implement APIs: /inventory/stocks, /inventory/movements, /serials/search, /stock-counts, /stock-adjustments, /transfers, /purchases, /purchases/{id}/receivings, /purchase-returns, /landed-costs.
7. Implement UI: warehouse stock view, stock ledger, IMEI lookup, batch/expiry, stock adjustment, stock count (blind count hides expected), low-stock, damaged stock, transfer, purchase list/create/detail, receiving with serial/batch capture, supplier return, landed cost allocation.
8. Write reconciliation checks: STOCK_QTY_LEDGER, STOCK_VALUE_LEDGER, SERIAL_STOCK_COUNT, RESERVATION_PROJECTION. Run nightly.
9. Write tests: concurrent sale cannot oversell (SERIALIZABLE or FOR UPDATE), same IMEI cannot sell twice (status lock + partial unique on active transfers), partial receiving/return limits, transfer reserve→dispatch→in_transit→receive/return, moving-average deterministic examples, backdated stock blocked, FEFO override requires approval, foreign-currency purchase + landed cost + moving-average recalculation, opening stock posts correctly.

CHECKPOINT: Do not proceed to M3 until M2 exit criteria pass and reconciliation is clean.

───────────────────────────────────────────────────────────────────────
PHASE M3 — POS AND PAYMENTS
───────────────────────────────────────────────────────────────────────
Exit gate: Online POS fully operable; cashier shifts with variance approval; payment gateway webhooks verified; receipts/invoices print in bn-BD + en-BD; reconciliation passes.

Tasks:
1. Migrate §5.7 (Quotations, QuotationItems, Sales, SaleItems with inventory_issue_source, SaleItemSerials [NO permanent UNIQUE on serial_id — runtime status lock only], SaleItemTaxes, SaleReturns, SaleReturnItems, SaleReturnItemSerials), §5.11 (AccountTransfers with currency-account deferred CHECKs, CashierShifts with partial unique on (cashier_id,cash_account_id) WHERE status='open', CashDrawerCounts, Payments with cheque_status default 'not_applicable', PaymentAllocations with event-line uniqueness, CustomerAdvanceLedger with nullable payment_id + sale_return_id + exactly-one-source CHECK + store_credit_issued entry type, SupplierAdvanceLedger same pattern, ReturnRefundAllocations, WithholdingTransactions, Installments, InstallmentAllocations), and new tables cashier_device_pins, gateway_settlements, gateway_settlement_items. Apply RLS to all.
2. Implement `post_journal_entry()` (verifies open period, tenant consistency, control-account dimensions, equal debit/credit; posts; immutable after). Implement `validate_payment_allocations()` (deferred sums; no over-allocation; customer/supplier match except courier_cod). Implement `validate_cheque_transition()`, `validate_currency_account_match()`, `post_store_credit_from_return()`.
3. Implement domain commands: PostSale, VoidSale, PostSaleReturn, ApplyCustomerAdvance, PostAccountTransfer, ReversePayment, ClearCheque, BounceCheque, CancelCheque, CloseCashierShift, IssueGiftCard, RedeemGiftCard, PostGiftCardRefund, RedeemCoupon, EarnRewardPoints, RedeemRewardPoints.
4. Implement the online POS sale workflow (§7.2) EXACTLY: open shift → scan/search → reserve stock/serial → server calculates price/discount/tax → submit with client_txn_id → BEGIN SERIALIZABLE → generate reference → insert sale+items+taxes → consume reservations → post stock movements at moving-average → post serial sold events → post payments/allocations or AR → post revenue/tax/COGS/inventory journals → receipt/statutory snapshot → audit+outbox → COMMIT. Client totals never trusted. Discounts above threshold require approval. Serialized count equals quantity. Allocated payment cannot exceed payment or invoice balance.
5. Implement credit sales per §20.D05: disabled by default; customer verification; credit limit; credit period; real-time exposure calculation; overdue check; walk-in credit prohibited. Return 409 CREDIT_LIMIT_EXCEEDED or 409 CUSTOMER_OVERDUE.
6. Implement cashier shifts per §20.D06: unique accounts, Argon2id password + 6-digit device PIN, register binding, TOTP MFA for supervisors, blind denomination count, expected = opening_float + cash_in - cash_out, variance threshold (amount + percent), supervisor MFA approval, shortage/overage journals, immutable after close.
7. Implement payment gateway per §20.D20: hosted/redirect checkout only; no card data stored (only last 4, brand, gateway TXN ID); webhook HMAC-SHA256 verification with 5-min replay tolerance and delivery_id dedup; settlement import and reconciliation; refund via gateway with approval above threshold; unmatched payment flagging after 48h.
8. Implement sale return + refund per §7.6: load original sale → select lines/serials → lock prior returns → validate quantity/ownership → assess disposition → post credit document + tax reversal → restock (inventory receipt at original cost + COGS reversal) OR damage/repair/loss → reduce AR or create refund liability → separate refund payment if cash required. Gift card refund: restore gift card balance with sale_return_id required. Store credit: customer_advance_ledger store_credit_issued entry.
9. Implement hold/recall per §7.12: held sale is mutable/unposted; optional expiring reservation; recall revalidates everything; completion reacquires reservation.
10. Implement `expire_held_sale_reservations()` worker (§7.25): runs every minute, locks expired reservations FOR UPDATE SKIP LOCKED, sets expired, decrements qty_reserved, posts business event, notifies cashier.
11. Implement receipt/invoice printing: 80mm thermal (ESC/POS bridge or browser), A4 invoice, reprint watermark, bn-BD + en-BD, printer-failure recovery without reposting. Same immutable data drives screen/PDF/browser/ESC-POS.
12. Implement account transfers per §7.20 and §20.D12: two-account lock in canonical UUID order; same-currency (from_amount=to_amount, rate=1) vs cross-currency (realized gain/loss); approval above threshold; immutable after post; reversal creates opposite linked document.
13. Write reconciliation checks: AR_SUBLEDGER_GL, AP_SUBLEDGER_GL, PAYMENT_ALLOCATION_LIMIT, ADVANCE_LIABILITY, CASH_SHIFT_VARIANCE, TAX_OUTPUT_GL, GIFT_CARD_LIABILITY, REWARD_POINT_BALANCE.
14. Write tests: online sale atomic post, split tender, hold/recall, return/refund, installment schedule, cashier shift open/close/variance with MFA, hosted checkout redirect, webhook signature verification (reject tampered), webhook replay tolerance, settlement reconciliation, thermal Bangla rendering, A4 rendering, credit limit enforcement, overdue rejection, gift card refund requires sale_return_id, store credit from return, account transfer same/cross currency.

CHECKPOINT: Do not proceed to M4 until M3 exit criteria pass and reconciliation is clean.

───────────────────────────────────────────────────────────────────────
PHASE M4 — ACCOUNTING AND COMPLIANCE
───────────────────────────────────────────────────────────────────────
Exit gate: Double-entry integrity; immutable posted ledgers; reconciliation checks pass; partitioning active; multi-currency revaluation works; tax configurable.

Tasks:
1. Migrate §5.10 (ChartOfAccounts, FinancialAccounts with encrypted account_number + split partial uniques on name, FiscalPeriods with EXCLUDE on overlapping dates, JournalEntries, JournalLines with branch/party dimensions and exactly-one-of debit/credit CHECK, AccountingPolicies with ALL GL account mappings including grni, opening_balance_equity, impairment_allowance, cheque_bounce_fee, service_cogs, repair_wip, courier_clearing, exchange_gain_loss, rounding). Apply RLS.
2. Migrate §5.12 (ExpenseCategories, Expenses with journal_entry_id, ExpenseItems, ExpenseItemTaxes [new table mirroring sale/purchase tax snapshots], ExpenseAttachments).
3. Migrate §5.15 (StatutoryDocuments, TaxReturnPeriods, ReconciliationRuns, ReconciliationFindings) if not already done in M0.
4. Implement partitioning per §20.D11: monthly RANGE partitioning on stock_movements.effective_at, journal_entries.entry_date, payments.business_date, audit_logs.occurred_at, outbox_events.occurred_at, report_export_jobs.created_at. Create partition_management() function that creates next month's partition ahead of time. Create archival tables (stock_movements_archive, etc.) and retention_jobs table. Implement daily archival + deletion worker that respects legal_holds.
5. Implement `validate_accounting_policies()` (conditional CHECKs: grni if purchasing enabled; service_cogs + repair_wip if service enabled; cheque_clearing if cheques used).
6. Implement `reverse_journal_entry()`, `post_account_adjustment()`, `post_expense()`.
7. Implement domain commands: PostJournalAdjustment, PostExpense, ReverseJournalEntry, PostAccountAdjustment.
8. Implement the chart of accounts, journal entry, fiscal period (open/soft_locked/locked with EXCLUDE), trial balance, P&L, balance sheet, cash flow. Reports use ONLY posted journal entries.
9. Implement tax configuration per §20.D08: effective-dated tax codes/components, withholding rules, fiscal periods, tax return periods (open/prepared/reviewed/filed/amended), statutory document generation (Mushak 6.1/6.2/6.3/9.1, withholding certificates). Tax snapshots immutable on transactions. Tax-rule changes require maker-checker (request_type='tax_rule_change').
10. Implement expenses per §7.22: draft → items with accounts → attach evidence → approval if required → post (Dr Expense per item, Cr AP or Cash/Bank) → tax journal. Voiding creates compensating reversal.
11. Implement multi-currency per §20.D12 (if feature flag enabled): exchange rate entry, locked transaction rates, realized gain/loss on payment, period-end revaluation (unrealized gain/loss), reversal at next period start. currency_revaluations table.
12. Implement reconciliation runs: nightly + manual + pre_close + post_restore. All 16 checks from §11.3. Critical/high findings block fiscal period locking.
13. Implement period close per §11.4: control backdating → reconcile → review drafts → generate trial balance/P&L/balance sheet/tax workpapers → soft-lock → resolve findings → lock.
14. Implement all §11.5 reports with the required filters and outputs. Implement §11.2 views (warehouse_stock_available_v, sale_balance_v, purchase_balance_v, customer_ar_v, supplier_ap_v, customer_advance_balance_v, supplier_advance_balance_v, gift_card_balance_v, reward_point_balance_v, cashier_shift_expected_v, trial_balance_v, inventory_valuation_v, overdue_installments_v). Implement §11.1 formulas EXACTLY.
15. Implement export jobs: async PDF/CSV/XLSX with immutable filter + data_cutoff snapshot; row count + control totals recorded; expired output deleted per retention.
16. Write tests: balanced journals, reversal exactly negates, AR/AP reconciles to GL, advance no double-count, transfer posts both accounts + fee + FX, return credit separate from refund, tax snapshots immutable, VAT return reconciles, partition routing, archival no data loss, deletion respects legal hold, multi-currency revaluation + reversal, all reconciliation checks pass.

CHECKPOINT: Do not proceed to M5 until M4 exit criteria pass and reconciliation is clean.

───────────────────────────────────────────────────────────────────────
PHASE M5 — DELIVERY AND SERVICE
───────────────────────────────────────────────────────────────────────
Exit gate: COD receivable reconciles; no restock without inspection; all service workflows post correct journals; serial history complete.

Tasks:
1. Migrate §5.7A (DeliveryOrders, DeliveryItems, DeliveryEvents, CourierShipments, CourierCodSettlements, CourierCodSettlementItems, ServiceRequests, ServiceRequestParts, ServiceEvents, WarrantyClaims). Apply RLS.
2. Implement `validate_delivery_transition()` (state machine: pending/packing/ready/dispatched/in_transit/delivered/failed/returned/cancelled; failed→pending/ready requires approval), `post_courier_cod_settlement()`, `validate_service_transition()`, `post_service_part_consumption()`, `validate_warranty_replacement()`.
3. Implement domain commands: CreateDeliveryOrder, PostCourierCodSettlement, PostServicePartConsumption, CompleteServiceRequest, FulfillWarrantyClaim.
4. Implement delivery workflow per §7.13 + §7.24 + §20.D14: create delivery order from posted sale → pack → internal/courier/pickup → courier booking via adapter → dispatch → track events → delivered (COD receivable: Dr Courier COD Receivable, Cr AR) OR failed (no stock change, COD reversed, resolution: re-dispatch/cancellation/reschedule-with-approval) OR returned (quarantine, no silent restock) → courier settlement import → post (Dr Cash/Bank net, Dr Courier Fee, Dr/Cr Settlement Adjustment, Cr Courier COD Receivable) → daily reconciliation → return inspection → restock (adjustment) or scrap.
5. Implement service/warranty workflow per §7.14 + §20.D15: intake (customer, serial, issue, condition, accessories, photos; serial→repair status) → diagnosis → estimate → approval (warranty repair no charge; paid repair customer approval) → parts consumption (Dr Repair WIP, Cr Inventory) → repair/test → ready → delivery (serial→in_stock/sold; linked service sale for billable) → warranty claim (repair/replace/refund/supplier_claim). Replacement: lock old + new serials, post serial events, cannot reuse replacement serial. Supplier claim: purchase return for defective unit. Deposit: customer advance applied to service sale.
6. Implement courier adapter interface (§9.3): quote, createShipment, cancelShipment, track. Provider-neutral statuses. Provider timeout never proves success/failure.
7. Implement UI: delivery list/detail, courier booking, tracking, COD settlement, failure resolution, service intake, work queue, estimate, parts usage, warranty claims, ready/delivery queue, service history.
8. Write tests: invalid delivery transitions fail, delivered COD enters clearing, failed/returned no silent restock, return inspection controls restock, settlement variance requires approval, warranty replacement cannot reuse serial, service parts reduce repair-warehouse stock, billable service creates linked sale, deposit applied correctly, repair WIP reconciles.

CHECKPOINT: Do not proceed to M6 until M5 exit criteria pass.

───────────────────────────────────────────────────────────────────────
PHASE M6 — CRM, COMMUNICATIONS, AND HR
───────────────────────────────────────────────────────────────────────
Exit gate: CRM pipeline works; campaigns respect consent; payroll posts with segregation; loyalty/gift card liability reconciles; privacy controls operational.

Tasks:
1. Migrate §5.6A (LeadSubjects, LeadSources, LeadStatuses, Leads, LeadActivities), §5.13 (GiftCards, GiftCardTransactions with sale_return_id + CHECK on refund, Coupons, CouponRedemptions, RewardPointTransactions, RewardPointConsumptions), §5.14 (Departments, Designations, Holidays, LeaveTypes, LeaveRequests, PayrollComponents, PayrollItemComponents, Employees with tenant-consistency CHECK on user_id, AttendanceRecords, PayrollRuns, PayrollItems), §5.14A (CommunicationTemplates, CommunicationConsents, CommunicationCampaigns, CommunicationCampaignRecipients, OutboundMessages with encrypted destination, Notifications, UserNotifications), and new tables data_subject_requests, legal_holds. Apply RLS.
2. Implement domain commands: ConvertLead, PostPayrollRun, PayPayrollRun, PostCommunicationCampaign, IssueGiftCard, RedeemGiftCard, PostGiftCardRefund, RedeemCoupon, EarnRewardPoints, RedeemRewardPoints.
3. Implement CRM per §7.15: lead creation (source, subject, branch, assignee, next action, contact), today's-actions query (derived, no stored flag), status changes append activities, won conversion atomically creates/links customer + optional quotation (idempotent), marketing requires consent.
4. Implement communications per §7.16 + §20.D16: provider-independent adapters (SMS: SSL Wireless/Mim; Email: SendGrid/SES), approved sender IDs, transactional always on, campaigns feature-flagged, audience freeze with consent snapshots, approval above cost/recipient threshold, rate limit + retry + provider status query, withdrawn/no-consent skipped with reason, encrypted destinations, dead-letter visibility, unsubscribe/bounce updates consent.
5. Implement HR/payroll per §7.17 + §20.D18: payroll calendar, attendance cutoff, overtime cap, leave types, payroll components (earning/deduction/employer_cost/withholding), payroll run (prepare → review → approve with segregation → post → bank file release → paid), reversal creates opposite journals, employee document retention. Bank file in BEFTN format.
6. Implement loyalty/gift cards per §20.D17: points earn/redeem/expire/reverse with FIFO consumption, gift card issue/redeem/refund(requires sale_return_id)/expire/transfer(if enabled)/lost-card-recovery, unclaimed balance flagging for dormant cards >2 years, liability reconciles to GL.
7. Implement privacy per §20.D09: consent capture (transactional not_required, marketing withdrawn until granted), consent withdrawal, purpose-based processing, PII field-level permissions, retention jobs (customer 7y, employee 7y post-termination, audit 10y, payment 7y, communication 3y), anonymization (master data only; financial snapshots preserved), legal holds (block deletion), DSR workflow (access/rectification/erasure/portability/objection). Privacy notice in document_templates.
8. Implement UI: CRM leads/today's-actions/statuses/sources/subjects/conversion; communications templates/campaigns/logs/notifications/consent management; HR departments/designations/employees/attendance/holidays/leave/payroll; gift card/coupon/loyalty management; DSR queue; legal holds.
9. Write tests: lead conversion idempotent, marketing skips withdrawn consent, provider timeout no duplicate, payroll totals = control totals, preparer cannot approve own run, bank file BEFTN format, points FIFO, gift card refund requires sale_return_id, lost card recovery cancels old + issues new, consent withdrawal prevents marketing, DSR workflow auditable, legal hold blocks deletion, anonymization preserves financial integrity.

CHECKPOINT: Do not proceed to M7 until M6 exit criteria pass.

───────────────────────────────────────────────────────────────────────
PHASE M7 — OFFLINE AND INTEGRATIONS
───────────────────────────────────────────────────────────────────────
Exit gate: Offline pilot tenants operational; all provider adapters tested in sandbox; DR exercise passes RTO ≤4h; outbox dead-letter visible; imports/exports respect scope.

Tasks:
1. Migrate §5.16 (IntegrationCredentials, RiskAssessments with NOT NULL expires_at > assessed_at + block-requires-expiry CHECK, OutboxEvents with status/dead_letter columns/max_attempts, WebhookEndpoints with HTTPS CHECK, WebhookDeliveries with timestamp_header as VARCHAR, ImportJobs with cancelled status, ImportJobErrors, PrintJobs, OfflineCommands with cancelled status, StockBudgetLeases with qty_consumed<=qty_granted CHECK, OfflineSyncBatches). Apply RLS.
2. Implement outbox worker: reads unpublished pending events, publishes to webhooks/providers, exponential backoff with jitter, max_attempts then dead_letter, dead-letter dashboard + manual requeue, critical alert on dead-letter.
3. Implement webhook delivery: HMAC-SHA256 over timestamp.raw_body, 5-min replay tolerance, delivery_id dedup, at-least-once, dead-letter visibility.
4. Implement provider adapters per §9.3: SmsProvider, EmailProvider, CourierProvider, RiskProvider, PaymentProvider. Provider-neutral statuses. Provider timeout never proves success/failure — query provider status before retry/reversal.
5. Implement offline POS per §10 + §20.D07: device registration with public key, signed bootstrap (catalogue/prices/taxes/permissions/stock-budget lease/document-number lease/schema/expiry), offline whitelist (cash_sale, held_sale_draft, shift_open, shift_close, customer_create, receipt_reprint, other_approved-requires-ADR), offline blacklist enforced (serialized/credit/gift-card/loyalty/cheque/return/refund/supplier-payment/adjustment/transfer/period-posting/manual-price-tax/config), signed monotonic commands in IndexedDB, provisional receipt (final invoice after sync), sync batch verification (device key/sequence/hash/idempotency/leases), conflict handling (duplicate/same-key-different-payload/revoked/reference-outside-lease/quantity-beyond-budget/price-outside-snapshot/sequence-gap/period-locked), conflict resolution UI (retry/replace/approve/convert/cancel), recovery epoch (mismatched devices quarantine + re-bootstrap).
6. Implement imports per §9.5: versioned templates, staged validation, dry-run, row error download, duplicate strategy, control totals, idempotent commit. Sale/transfer imports create drafts only. Serialized imports require one serial per row.
7. Implement exports: respect row scope + sensitive-field permissions, cost/margin/payroll/PII omitted unless authorized, CSV/Excel escape formula-leading cells.
8. Implement risk assessment integration per §20.D20: advisory unless policy blocks; fail-open/fail-review/fail-closed per workflow; POS cash sale never blocked by delivery-fraud provider; expires_at mandatory; block requires expiry.
9. Implement the quarterly DR exercise: declare incident → restore base backup + WAL to isolated env → run full post-restore reconciliation → verify RTO ≤4h → increment recovery epoch → devices re-bootstrap → document findings.
10. Implement UI: offline conflict resolution panel, device management, import job list/error download, export job list, webhook endpoint management, outbox dead-letter dashboard, risk assessment review.
11. Write tests: offline cash sale syncs, serialized/credit/gift-card rejected offline, lease exhaustion, sequence gap pauses later commands, recovery epoch prevents stale replay, conflict resolution creates audited commands, webhook signature rejects tampered, webhook replay tolerance enforced, import dry-run validation, export scope/permission, outbox dead-letter + requeue, DR exercise achieves RTO.

CHECKPOINT: Do not proceed to M8 until M7 exit criteria pass.

───────────────────────────────────────────────────────────────────────
PHASE M8 — HARDENING AND GO-LIVE
───────────────────────────────────────────────────────────────────────
Exit gate: All §17 + §18B acceptance criteria pass; all external sign-offs obtained; all 20 decisions confirmed implemented; go-live checklist complete; stakeholder sign-off.

Tasks:
1. Security testing: RLS penetration test (cross-tenant access fails even with app filter removed), SAST, dependency scan, secret scan, image scan, rate-limit verification, CSRF/CSP/HSTS audit.
2. Load testing (k6): peak POS completion p95 ≤2s, product search p95 ≤800ms, dashboard p95 ≤3s, sync storm after outage, report export, webhook retry. Query plan review for all large ledger queries.
3. Accessibility: axe scan on all critical routes, keyboard-only POS + forms manual test, responsive tests (mobile/tablet/desktop) covering POS/tables/dialogs/reports/print, locale-switch tests covering navigation/forms/validation/money-date formatting/printed documents.
4. Full UAT scenarios per §17.5: cashier open-shift→cash/split/due-sale→print→recall-held→collect-installment→approved-return→close-shift-with-variance; inventory receive-serialized+non-serialized→transfer→count→resolve-serial-variance→post-adjustment; accountant opening-entries→payments→expenses→payroll→courier-settlement→tax-period→month-close with reconciliation; service intake-IMEI→diagnose→consume-parts→repair/replace→print; manager dashboard→approvals→reports→exports→aging→audit under correct scope; offline cashier posts allowed sales→reconnects→resolves-conflicts→no duplicates.
5. Data migration rehearsal per §18A.3: inventory source systems → clean/normalize → import master via validated jobs → import opening stock via opening_stock movements → import balances via dated journals → reconcile source totals to ERP control reports → freeze legacy → delta import → stock/serial/cash count → sign opening balances → legacy read-only for retention. Zero unexplained variance required.
6. Run all runbook exercises per §18A.4: user/device compromise, POS outage/offline, duplicate/uncertain provider payment, stock/serial reconciliation failure, cashier variance/fraud, failed migration/rollback, backup restore/DR, courier COD mismatch, tax/period-close correction, queue backlog/webhook dead-letter, printer failure, DSR.
7. Confirm all 20 decisions implemented per Appendix F acceptance matrix. Confirm all external sign-offs initiated (Appendix B): tax professional, legal counsel, labour counsel, PCI DSS QSA, accounting owner, forex advisor.
8. Complete Appendix E go-live checklist. Obtain stakeholder sign-off from production/finance/inventory/security/operations/tax owners.
9. Deploy to production with manual migration approval. Post-deploy health + reconciliation verification. Monitor alerts for 72h stabilization.

═══════════════════════════════════════════════════════════════════════
SECTION 4 — DATABASE SCHEMA RULES (NON-NEGOTIABLE)
═══════════════════════════════════════════════════════════════════════

1. UUID PKs via gen_random_uuid(). Public document numbers separate via next_document_number().
2. All FKs indexed, default ON DELETE RESTRICT unless explicitly stated.
3. Money: DECIMAL(18,2). Unit cost/rate: DECIMAL(18,6). Quantity: DECIMAL(18,4). Percentages: DECIMAL(9,6). NO binary floating-point for money.
4. All timestamps TIMESTAMPTZ in UTC. Business dates explicit DATE.
5. Tenant uniqueness includes company_id. Composite tenant-consistency CHECKs prevent cross-company FKs.
6. Soft delete (deleted_at) only on master data. Financial/stock documents NEVER hard or soft delete.
7. Every nullable column that participates in a UNIQUE must use split partial unique indexes (NULL vs NOT NULL) — see document_sequences, financial_accounts.name, stock_count_items, sales_targets.
8. EXCLUDE constraints for overlapping ranges: fiscal_periods dates, document_number_leases int8range.
9. Hard CHECK >= 0 on warehouse_stocks.qty_on_hand (D03 — non-negotiable). qty_received <= qty_ordered, qty_returned <= qty_received, qty_dispatched <= qty_requested, qty_received <= qty_dispatched, qty_consumed <= qty_granted.
10. product_serials: status-warehouse CHECK (in_stock/reserved require warehouse; sold/scrapped do not). Serial uniqueness UNIQUE(company_id, serial_number). No permanent UNIQUE(serial_id) on sale_item_serials/transfer_item_serials/purchase_receiving_item_serials — runtime status lock + partial unique on active transfers only.
11. customer_advance_ledger + supplier_advance_ledger: nullable payment_id + sale_return_id/purchase_return_id + exactly-one-source CHECK. store_credit_issued/credit_issued entry types.
12. gift_card_transactions: sale_return_id column + CHECK requiring it on refund rows.
13. payments.cheque_status: NOT NULL DEFAULT 'not_applicable'.
14. webhook_endpoints.url: CHECK ~ '^https://'. webhook_deliveries.timestamp_header: VARCHAR(40) not TIMESTAMPTZ.
15. risk_assessments.expires_at: NOT NULL CHECK > assessed_at; CHECK decision<>'block' OR expires_at IS NOT NULL.
16. outbox_events: status (pending/published/dead_letter/skipped), max_attempts, dead_lettered_at, dead_letter_reason.
17. financial_accounts: account_number_encrypted + account_number_key_version; split partial uniques on name (NULL vs NOT NULL branch_id).
18. All JSONB configuration columns validated against registered schemas before COMMIT (§0 rule 13 enumerates all).
19. RLS on ALL tenant/sensitive tables. Application role NOSUPERUSER NOBYPASSRLS. Migration role may bypass; application may not.
20. Partitioning (M4+) preserves RLS + uniqueness; include company_id in partition key or sub-partition.

═══════════════════════════════════════════════════════════════════════
SECTION 5 — TRANSACTION, IDEMPOTENCY, AND FINANCIAL INTEGRITY RULES
═══════════════════════════════════════════════════════════════════════

1. Every business mutation is idempotent and executes inside ONE explicit database transaction (§7.1).
2. Transaction boundary: request + Idempotency-Key → authenticate/resolve tenant/branches → validate payload + hash → check existing idempotency → BEGIN → set RLS context → create idempotency processing row → lock sequences/balances/reservations/serials → revalidate business rules → generate reference before insert → write document + immutable ledgers → post balanced journal → audit + outbox + response snapshot → COMMIT. On invalid: ROLLBACK + domain error.
3. Inventory/serial/gift-card/coupon/advance-allocation/document-sequence commands use SERIALIZABLE or deterministic row locks under REPEATABLE READ. Serialization/deadlock failures retried with bounded jitter. Master-data writes may use READ COMMITTED.
4. Document numbers generated/leased BEFORE insert and BEFORE COMMIT.
5. Operational documents and their stock/serial/payment/tax/journal/audit/outbox effects commit or roll back TOGETHER.
6. Posted accounting/stock/serial/payment/tax/cash-drawer/statutory/audit records are IMMUTABLE. Corrections use reversal/return/refund/write-off/compensating entry.
7. Transaction lines snapshot mutable product/price/cost/tax/currency/warranty/customer/supplier values.
8. Double-entry accounting mandatory. post_journal_entry() verifies open period + tenant consistency + control-account dimensions + equal debit/credit. Deferred constraint rejects unbalanced at COMMIT.
9. Foreign-currency documents store original currency + exchange rate + original amount + base-currency amount.
10. External network calls NEVER inside a database transaction. Outbox triggers them after commit.
11. Event-line uniqueness (company_id, event_id, event_line_no) for child ledgers prevents retry duplicates while allowing later allocations.
12. Same Idempotency-Key + same request_hash → return stored committed response. Same key + different hash → 409 IDEMPOTENCY_KEY_REUSED + security event.
13. Concurrency controls (§13.2): document number (sequence row FOR UPDATE), stock (lock warehouse/product in deterministic product-ID order), IMEI (FOR UPDATE + version/status), gift card/coupon (row lock + ledger balance/use count), payment allocation (lock payment + invoices + deferred sums), advance (lock advance ledger balance + target invoice), cashier shift (partial unique open-shift index + row lock), transfer (lock transfer + stock in stable order), fiscal close (company/period advisory lock + status check).

═══════════════════════════════════════════════════════════════════════
SECTION 6 — SECURITY, RBAC, AND RLS RULES
═══════════════════════════════════════════════════════════════════════

1. Access JWT 15min in HttpOnly+Secure+SameSite=Strict cookie. Refresh tokens random, hashed, rotated on use, device-bound, family-based revocation. Refresh-token reuse revokes family + high-severity security event.
2. MFA (TOTP/WebAuthn) mandatory for: owners, global admins, backup download, journal/adjustment approval, sensitive export, fiscal-period actions, supervisor/cashier-variance approval. MFA secret encrypted (envelope encryption).
3. Shared cashier accounts PROHIBITED. Unique accounts + 6-digit device PIN + register binding (§20.D06).
4. Passwords: Argon2id (memory≥64MB, time≥3). Privileged min length 12. Known-compromised passwords rejected. Progressive lockout per IP/account/company/device.
5. CSRF on all cookie-auth mutations. Strict CSP, HSTS, no unsafe raw HTML. Parameterized SQL only (Prisma/TypedSQL) — no string interpolation.
6. Endpoint-specific body limits, rate limits, export abuse controls. TLS in transit; encrypted disks/storage/backups.
7. Files: extension + magic-byte allowlist, malware scan, random object keys, short signed URLs, SHA-256 verification.
8. CSV/Excel exports escape formula-leading cells (=, +, -, @).
9. Separate app/migration/reporting/backup/monitoring DB roles. App role cannot bypass RLS, disable triggers, or alter schema.
10. Containers non-root. Private network protects Postgres/Redis. CI: SAST + dependency + secret + image scan.
11. Permissions: resource.action.scope (§8.5). Sensitive fields (cost, margin) require separate field-level permission. Maker ≠ checker. Approver scope revalidated at resolution.
12. RLS context set via set_config() with true (local) before every transaction. Every read/write executes in this context.
13. Data classification (§12.6): Restricted (passwords/MFA/tokens/secrets/keys) — encrypted, least privilege, never logged/exported. Confidential (PII/payroll/payment refs/audit IP) — scoped, encrypted, redacted logs, retention. Internal (cost/margin/supplier pricing/stock valuation) — field permission, export controls. Public (product name/public price/branch contact) — normal integrity.
14. Webhook HMAC-SHA256 over timestamp.raw_body, 5-min replay, delivery_id dedup, exponential backoff + jitter, dead-letter.
15. Payment webhooks (§20.D20): verify signature, check delivery_id, validate replay tolerance, update payment_status. No card data (PAN/CVV/PIN) stored anywhere.
16. Backup download requires MFA + approval. Production restore requires platform operations + incident declaration.

═══════════════════════════════════════════════════════════════════════
SECTION 7 — CODING STANDARDS AND IMPLEMENTATION DISCIPLINE
═══════════════════════════════════════════════════════════════════════

1. TypeScript strict mode. No `any` without explicit justification in ADR.
2. Every domain command is a single class/function with: execute(input, context) → Result. Controllers call ONE domain command. No orchestration in controllers.
3. Shared Zod schemas validate HTTP input. Domain services revalidate invariants. Client totals NEVER trusted.
4. Every mutation requires Idempotency-Key header + client_txn_id.
5. Error envelope: `{"error":{"code":"...","message":"...","details":{...},"correlation_id":"uuid"}}` (§13.1). Never expose SQL, stack traces, secrets, internal topology, or another tenant's identifier.
6. Use the domain error codes from §13.1 exactly (VALIDATION_FAILED, UNAUTHORIZED, FORBIDDEN_SCOPE, RESOURCE_NOT_FOUND, IDEMPOTENCY_KEY_REUSED, CONCURRENT_MODIFICATION, INVENTORY_INSUFFICIENT, SERIAL_NOT_AVAILABLE, ALLOCATION_EXCEEDS_BALANCE, FISCAL_PERIOD_LOCKED, APPROVAL_REQUIRED, OFFLINE_LEASE_INVALID, GIFT_CARD_INSUFFICIENT, COUPON_INVALID, REWARD_POINTS_INSUFFICIENT, CREDIT_LIMIT_EXCEEDED, CHEQUE_STATUS_INVALID, DELIVERY_TRANSITION_INVALID, SERVICE_TRANSITION_INVALID, RATE_LIMITED, PROVIDER_STATUS_UNKNOWN, INTERNAL_ERROR, FEATURE_NOT_ENABLED, PUBLIC_SIGNUP_DISABLED, SELF_APPROVAL_PROHIBITED, REPLAY_OUTSIDE_TOLERANCE, INVALID_SIGNATURE, EXCHANGE_RATE_MISSING, LEGAL_HOLD_ACTIVE, STATUTORY_RETENTION_REQUIRED, NO_OPEN_SHIFT, INVALID_PIN, INVALID_MFA, CUSTOMER_OVERDUE, GIFT_CARD_EXPIRED, VERIFICATION_REQUIRED, MODULE_NOT_IMPLEMENTED).
7. Cursor pagination mandatory for large tables. Deterministic sort required.
8. Server components load read models; client components limited to interaction-heavy areas (POS cart, scanners, count entry, charts, offline queue).
9. Mutations call versioned API/domain actions; never write business state directly from browser.
10. Every route resolves feature flag + permission + tenant + branch scope before rendering sensitive data.
11. Logging: structured JSON with correlation_id, environment, release, company_id, permitted branch context. Redact passwords/tokens/secrets/full payment refs/unnecessary PII. Propagate correlation through API/DB/audit/queue/webhook/provider.
12. Forward-only SQL migrations. Expand/migrate/contract for destructive change. Concurrent indexes for large tables. Backfill before NOT NULL. No direct production SQL except audited incident runbook.
13. SECURITY DEFINER functions owned by non-login role, safe search_path, validate company context, EXECUTE granted only to app role.
14. Shared components (DataTable, FilterBar, Money, Quantity, PermissionGate, ApprovalBadge, SerialPicker, PaymentDrawer, ThermalReceipt, A4Invoice, ConflictResolutionPanel, OfflineStatus, etc.) are tested, single-source — no page-specific copies.
15. WCAG 2.2 AA: keyboard access, visible focus, programmatic labels, error associations, contrast, reduced motion, screen-reader landmarks, modal focus management, accessible data-table alternatives. Minimum 44×44 CSS-pixel touch targets for critical POS controls.
16. Destructive operations use explicit confirmation stating the accounting/stock consequence. Posted records offer reversal/return actions, not Edit/Delete.
17. Bangla + English layouts must not clip, overlap, or change financial meaning. Number/date/currency locale-aware; stored values locale-neutral.
18. Reprint includes REPRINT watermark + original doc number/time + reprint user/time. Never issues new invoice number. Print failure leaves sale committed; offers retry. Print success is not a transaction-commit condition.
19. Performance budgets (§9.4): login/admin LCP ≤2.5s p75 on Bangladesh mobile; POS bootstrap cached shell ≤2s, scanner-to-cart ≤150ms; server list p95 ≤800ms; POS post sale p95 ≤2s; report interactive p95 ≤3s.
20. Persist every generation/migration script to file before executing. On failure, edit the file and re-run — do not regenerate from scratch.

═══════════════════════════════════════════════════════════════════════
SECTION 8 — TESTING AND ACCEPTANCE
═══════════════════════════════════════════════════════════════════════

Implement and maintain these test suites (§17.1–17.4):

Financial integrity: every event produces balanced journals; reversal exactly negates; AR/AP reconciles to GL; cross-branch payment uses correct dimensions/clearing; advance receive/apply/refund no double-count; account transfer posts both accounts + fee + FX gain/loss + reverses exactly; return credit and refund separate.

Inventory integrity: concurrent sale cannot oversell; same IMEI cannot sell twice; partial receiving/return limits hold; transfer reservation/dispatch/receive/return preserves quantity + cost; moving-average deterministic; backdated stock follows policy.

Idempotency/offline: same key+same payload replays result; same key+different payload conflicts; multi-line sale creates multiple event-line ledger rows without collision; sequence gaps and revoked/expired leases rejected; recovery epoch prevents unsafe replay.

Security/isolation: cross-company access fails at RLS even with app filter removed; single-branch user cannot access another branch; transfer source/destination permissions work; posted ledgers cannot mutate; maker cannot approve own request; refresh-token reuse revokes family.

Operations: shift cash reconciles; backup restore passes post-restore reconciliation; outbox retry deduplicates; webhook dead-letter visible.

Catalogue/printing: duplicate barcode/cyclic combo/invalid unit/unsafe upload/missing tax-price rejected; barcode/QR sheet matches geometry + scans; bn-BD/en-BD receipt + A4 render without clipping; reprint cannot repost.

Stock operations: blind count hides expected; count variance posts exactly one adjustment + balanced value journal; missing/unexpected/duplicate/wrong-location serial scenarios reconcile.

Delivery/service: invalid delivery transitions fail; delivered COD enters clearing + reconciles; failed/returned no silent restock; return inspection controls restock; warranty replacement cannot reuse serial + records both histories; service parts reduce repair-warehouse stock + post configured financial treatment.

CRM/communications: lead conversion idempotent + no duplicate customer/quotation on retry; marketing skips withdrawn/no-consent; provider timeout retried/query-checked without duplicate send.

HR/payroll: holiday/approved leave affects attendance + payroll; payroll component totals = gross/deduction/net control totals; preparer cannot approve/post own run.

Provider risk/fraud: allow/review/block/unavailable follow configured policy; timeouts no duplicate provider requests; risk responses sanitized/scoped/expiry-aware/no permanent blacklist.

Frontend/accessibility: axe scans on all critical routes; keyboard-only POS + forms pass manual test; mobile/tablet/desktop responsive; locale-switch covers navigation/forms/validation/money-date/translation overrides/printed documents.

Performance: load tests cover peak POS/product search/dashboard/sync storm/report export/webhook retries; query plans meet index + latency budgets.

Module acceptance (§17.4): schema migrations + constraints + RLS + indexes + rollback plan exist; domain state machine + transaction boundary tests pass; API authorization + validation + idempotency + error envelope + audit tests pass; required pages + responsive + empty/loading/error + keyboard + accessibility pass; required reports + exports reconcile to source ledgers; provider failure/timeout/retry + dead-letter operable; monitoring dashboards + alerts exist; user documentation + operating procedure approved; product owner + accounting/security/operations owner sign module acceptance record.

Every milestone's exit criteria (§18A.1) must pass before proceeding. All §11.3 reconciliation checks must be green. No critical/high findings may remain open.

═══════════════════════════════════════════════════════════════════════
SECTION 9 — EXECUTION DISCIPLINE
═══════════════════════════════════════════════════════════════════════

1. WORK PHASE BY PHASE. Do not jump ahead. Do not begin M(n+1) until M(n) exit criteria pass and all tests are green.
2. WITHIN EACH PHASE: database migrations → DB functions/triggers → RLS policies → domain commands → API routes → UI pages → tests → reconciliation. In that order.
3. DO NOT STOP AT PLANNING. Write real code. Run real migrations. Execute real tests. Fix real errors. If a test fails, fix the code or the migration — do not delete or skip the test.
4. FIX ERRORS BEFORE MOVING FORWARD. A failing test, a broken migration, a type error, or a reconciliation finding blocks progress. Resolve it, commit the fix, re-run, confirm green, then proceed.
5. COMMIT AFTER EVERY COHERENT UNIT OF WORK. Each migration, each domain command, each API route, each UI page, each test suite — separate commit with clear message. Do not accumulate 1000 lines of uncommitted code.
6. RE-READ THE BLUEPRINT CONSTANTLY. When implementing a table, re-read its §5 definition. When implementing a workflow, re-read its §7 specification. When implementing a decision, re-read its §20.Dxx section. Do not rely on memory.
7. IF YOU HIT AN AMBIGUITY OR CONTRADICTION: stop, re-read the blueprint, implement the most conservative secure interpretation, document it in docs/adr/, and continue. Do not guess silently.
8. NEVER disable a mandatory architecture control (§20.0) to make a test pass or unblock progress.
9. NEVER store a cached balance in place of an authoritative ledger.
10. NEVER leave a navigation item enabled for an unimplemented workflow.
11. NEVER bypass transaction/RLS/idempotency controls for "quick" testing.
12. Run the full reconciliation suite at the end of every milestone. Zero critical/high findings required to proceed.
13. Keep the worklog updated: every commit, every migration, every test run, every error and fix.
14. If you discover a blueprint defect (contradiction, missing constraint, unsafe workflow), do NOT silently work around it. Document it in docs/adr/, implement the safest fix, and note it for human review.

═══════════════════════════════════════════════════════════════════════
SECTION 10 — STARTING INSTRUCTIONS
═══════════════════════════════════════════════════════════════════════

BEGIN NOW with Phase M0. Create the repository, initialize the stack, create the docker-compose, write the first migrations for §5.1/§5.2/§5.3/§5.15 tables, create the RLS policies, implement the Prisma transaction wrapper, implement auth, run the first backup restore test. Do not ask for permission to proceed — execute. At each checkpoint, run the full test suite + reconciliation, report results, and continue to the next phase if green. If red, fix and re-run until green.

The blueprint is attached. It is the law. Build the system.
```