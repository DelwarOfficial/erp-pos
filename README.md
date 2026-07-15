# ERP/POS — Bangladesh Multi-Tenant Electronics Retail + Service + Warranty

> Production-grade multi-tenant ERP/POS system built per `ERP_Product_Blueprint_v4.1.md` (~7,000 lines). Covers electronics/mobile/appliance retail, service center, warranty management, accounting, CRM, HR/payroll, and delivery — all in a single TypeScript modular monolith.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Client (Browser / PWA)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐ │
│  │  POS (PWA)  │  │  Dashboard  │  │  Print/PDF  │  │  Offline  │ │
│  │  Offline OK │  │  Admin/ERP  │  │  Receipt/A4 │  │  IndexedDB│ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬─────┘ │
└─────────┼────────────────┼────────────────┼───────────────┼───────┘
          │                │                │               │
          ▼                ▼                ▼               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Next.js 16 (App Router)                          │
│  ┌──────────┐  ┌───────────┐  ┌────────────┐  ┌────────────────┐  │
│  │ Middleware│  │ API Routes│  │   Domain   │  │   Adapters     │  │
│  │ CSRF+CSP  │  │ /api/v1/* │  │  Commands  │  │ SMS/Email/COD  │  │
│  │ Auth+MFA  │  │ 118 routes│  │ 37 commands│  │ Payment/Risk   │  │
│  └──────────┘  └───────────┘  └────────────┘  └────────────────┘  │
│  ┌──────────┐  ┌───────────┐  ┌────────────┐  ┌────────────────┐  │
│  │  Reports │  │ Reconcile │  │   i18n     │  │   Providers    │  │
│  │ 28 types │  │ 22 checks │  │ bn-BD/en-BD│  │ Slack/Telegram │  │
│  └──────────┘  └───────────┘  └────────────┘  └────────────────┘  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
┌─────────────┐  ┌──────────────┐  ┌────────────────┐
│ PostgreSQL  │  │    Redis     │  │  S3 / MinIO    │
│  16+        │  │  7 (BullMQ)  │  │  (Media/Backup)│
│  201 tables │  │  5 Workers   │  │  Encrypted     │
│  175 RLS    │  │  Outbox/Recon│  │  Versioned     │
│  352 funcs  │  │  Retention   │  │  Signed URLs   │
└─────────────┘  └──────────────┘  └────────────────┘
```

---

## Project Stats

| Metric | Count |
|--------|-------|
| Prisma models | 181 |
| PostgreSQL tables (migrations) | 201 |
| RLS-enabled tables | 175 |
| SQL functions (SECURITY DEFINER) | 352 |
| SQL triggers | 62 |
| CHECK constraints | 1,700+ |
| EXCLUDE constraints | 2 |
| SQL views | 13 |
| Domain commands | 26 (across M2–M6) |
| API routes | 132 |
| UI pages | 38 |
| Reports | 28 |
| Reconciliation checks | 22 |
| Permission codes | 134 |
| System roles | 13 |
| Feature flags | 12 |
| Test files | 45 |
| Tests passing | 395 |
| Translation keys (per locale) | 150+ |
| Migrations | 20 (forward-only) |
| ADRs | 6 |
| Runbooks | 4 |

---

## Folder Structure

```
erp-pos/
├── prisma/
│   ├── schema.prisma                    # 181 Prisma models (mirrors DB schema)
│   ├── migrations/                      # 20 forward-only SQL migrations
│   │   ├── 0001_extensions_and_schemas.sql
│   │   ├── 0002_organization_currency.sql
│   │   ├── ...
│   │   ├── 0018_journal_payment_immutable_triggers.sql
│   │   ├── 0019_required_views.sql      # 13 SQL views (§11.2)
│   │   └── 0020_asset_management_banking.sql  # §21.1 Fixed Assets + §21.2 Bank Rec
│   ├── functions/                       # 33 SECURITY DEFINER SQL functions
│   │   ├── additional_functions.sql     # post_stock_movement, validate_*, etc.
│   │   ├── missing_functions.sql        # 9 functions added in audit
│   │   ├── supplemental_functions.sql   # post_expense, reverse_stock_movement, etc.
│   │   ├── next_document_number.sql
│   │   └── post_journal_entry.sql
│   ├── triggers/                        # 4 trigger definition files
│   │   ├── 0001_set_updated_at.sql
│   │   ├── 0002_prevent_posted_record_mutation.sql
│   │   ├── 0003_tenant_consistency_checks.sql
│   │   └── 0004_immutable_financial_records.sql
│   ├── rls/                             # RLS policy definitions
│   │   ├── 0001_enable_rls.sql          # Enable RLS on all tenant tables
│   │   └── 0002_tenant_policies.sql     # app_company_id(), app_is_global() helpers
│   └── roles/
│       └── 0001_db_roles.sql            # 4 DB roles (app/migration/backup/reporting)
├── src/
│   ├── domain/
│   │   ├── commands/                    # 37 domain commands (§7 workflows)
│   │   │   ├── m2/                      # Inventory: ReceivePurchase, Transfer, etc.
│   │   │   ├── m3/                      # POS: PostSale, VoidSale, PostSaleReturn, etc.
│   │   │   ├── m4/                      # Accounting: PostJournalEntry, PostExpense
│   │   │   ├── m5/                      # Delivery/Service: Delivery, Service, Warranty
│   │   │   └── m6/                      # CRM/HR: ConvertLead, Payroll, Loyalty
│   │   ├── invariants/                  # barcode, comboGraph, productActivation
│   │   └── inventory/
│   │       └── stockMovement.ts         # Moving-average cost (§20.D03)
│   ├── app/
│   │   ├── (auth)/login/page.tsx        # Login page
│   │   ├── (erp)/dashboard/             # 24 dashboard pages
│   │   │   ├── pos/                     # POS PWA (offline-capable)
│   │   │   ├── sales/                   # Sales list
│   │   │   ├── products/                # Products catalogue
│   │   │   ├── inventory/               # Stock view
│   │   │   ├── accounting/              # Journal, trial balance
│   │   │   ├── risk-tuning/             # Risk FP/FN dashboard with charts
│   │   │   ├── imports/                 # Import/export jobs
│   │   │   └── ...                      # +16 more pages
│   │   ├── print/                       # Receipt + Invoice print routes
│   │   │   ├── receipt/[id]/route.ts    # 80mm thermal receipt (HTML/PDF/ESC-POS)
│   │   │   └── invoice/[id]/route.ts    # A4 invoice (HTML/PDF)
│   │   └── api/v1/                      # 118 API route files
│   │       ├── auth/                    # login, logout, refresh, MFA
│   │       ├── sales/                   # POST sale (POS checkout)
│   │       ├── products/                # CRUD
│   │       ├── payments/                # list, reverse, refund, initiate
│   │       ├── approvals/               # maker-checker workflow
│   │       ├── reports/                 # 28 report types
│   │       ├── admin/                   # risk-config, risk-assessments, risk-alerts
│   │       ├── webhooks/                # payment + courier webhook receivers
│   │       └── ...                      # +40 more endpoint groups
│   ├── adapters/                        # Provider adapters (§9.3)
│   │   ├── index.ts                     # 5 interfaces: SMS, Email, Courier, Risk, Payment
│   │   ├── providers.ts                 # SSL Wireless, SendGrid, Resend, Pathao, bKash, etc.
│   │   ├── riskProvider.ts              # InternalRiskProvider (8 rules, env-configurable)
│   │   ├── slackProvider.ts             # Slack webhook + MockNotificationProvider
│   │   ├── telegramProvider.ts          # Telegram Bot API
│   │   └── mocks/                       # Mock providers for dev/test
│   ├── components/
│   │   ├── ui/                          # shadcn/ui primitives (30+ components)
│   │   ├── shared/                      # 7 shared components
│   │   │   ├── DataTable.tsx            # Sortable + paginated
│   │   │   ├── Money.tsx                # Locale-aware ৳ display
│   │   │   ├── Quantity.tsx             # Locale-aware qty display
│   │   │   ├── PermissionGate.tsx       # Conditional render by permission
│   │   │   ├── FilterBar.tsx            # Search + status filter
│   │   │   ├── ApprovalBadge.tsx        # Maker-checker status
│   │   │   └── OfflineStatus.tsx        # Online/offline/syncing indicator
│   │   └── pwa/                         # PWA components
│   │       ├── ServiceWorkerRegister.tsx
│   │       └── OfflineSyncProvider.tsx   # IndexedDB mutation queue
│   ├── lib/
│   │   ├── db/                          # Prisma client + tenant context
│   │   │   ├── transaction.ts           # withTenant() (SERIALIZABLE) + runInTenantContext()
│   │   │   └── tenantClient.ts          # Prisma extension injecting company_id filters
│   │   ├── auth/
│   │   │   ├── middleware.ts            # authenticateRequest() + requirePermission()
│   │   │   ├── password.ts              # Argon2id (64MB memory, time=3)
│   │   │   ├── jwt.ts                   # 15min access + rotating refresh
│   │   │   └── requireMfa.ts            # Action-time MFA for high-risk operations
│   │   ├── approval/
│   │   │   ├── thresholds.ts            # 9 tenant-configurable thresholds (§20.D04)
│   │   │   └── workflow.ts              # Maker-checker create/resolve
│   │   ├── accounting/
│   │   │   ├── revaluation.ts           # Multi-currency period-end revaluation (§20.D12)
│   │   │   ├── periodClose.ts           # 6-step period-end close workflow (§11.4)
│   │   │   └── seedCoa.ts              # 44-account Bangladesh retail CoA
│   │   ├── risk/
│   │   │   └── alerting.ts              # FP/FN analysis + email/Telegram/Slack alerts
│   │   ├── reconciliation/
│   │   │   ├── checks.ts                # 20 reconciliation checks (§11.3)
│   │   │   └── scheduler.ts             # Daily scheduled reconciliation
│   │   ├── payroll/
│   │   │   └── beftn.ts                 # BEFTN bank file generator (§20.D18)
│   │   ├── tax/
│   │   │   └── statutoryDocuments.ts    # Mushak 6.1/6.3/9.1 + withholding (§20.D08)
│   │   ├── import-export/
│   │   │   ├── csv.ts                   # CSV parser + formula-cell escaping
│   │   │   ├── templates.ts             # 7 import templates
│   │   │   └── importProcessor.ts       # Staged validation + dry-run + commit
│   │   ├── escpos/index.ts              # ESC/POS thermal printer command builder
│   │   ├── pdf/index.ts                 # PDF rendering with Bangla fonts
│   │   ├── i18n/index.ts                # bn-BD + en-BD, 150+ keys each
│   │   ├── crypto/                      # Envelope encryption (AES-256)
│   │   ├── idempotency/                 # Idempotency-Key middleware
│   │   ├── featureFlags/                # 10 feature flags (§20.D02)
│   │   ├── permissions/catalogue.ts     # 130 permission codes + 8 system roles
│   │   ├── storage/index.ts             # S3 SDK adapter (SSE-KMS)
│   │   ├── queue/index.ts               # BullMQ + Redis
│   │   ├── telemetry/                   # OpenTelemetry + Sentry
│   │   └── logging/                     # Structured JSON + correlation_id
│   ├── workers/
│   │   ├── index.ts                     # 5 BullMQ workers + daily cron schedule
│   │   └── outboxWorker.ts              # Outbox event delivery with HMAC + backoff
│   ├── hooks/
│   │   └── useAuth.ts                   # Client-side auth state
│   └── reports/
│       └── index.ts                     # 28 report functions (§11.5)
├── tests/
│   ├── unit/                            # 33 unit test files (360+ tests)
│   ├── integration/                     # 1 integration test file (15 tests)
│   ├── e2e/                             # 11 e2e spec files (100 Playwright tests)
│   └── load/                            # k6 load test scripts
├── docker/
│   ├── Dockerfile.web                   # Non-root Next.js production image
│   ├── Dockerfile.worker                # Non-root worker process
│   ├── docker-compose.yml               # Postgres 16 + Redis 7 + MinIO + web + worker
│   └── init-roles.sql                   # Creates 4 DB roles on startup
├── scripts/
│   ├── backup/                          # nightly-backup, restore, wal-archive, DR test
│   ├── run-postgres-migrations.ts       # Forward-only migration runner
│   ├── switch-to-postgres.ts            # One-shot SQLite→Postgres switch
│   ├── seed-risk-demo-data.ts           # Demo data seeder
│   ├── smoke-test-providers.ts          # Provider integration smoke test
│   └── validate-migrations-dry-run.ts   # SQL syntax validator (no DB needed)
├── docs/
│   ├── adr/                             # 6 Architecture Decision Records
│   └── runbooks/                        # 4 operational runbooks
├── public/
│   ├── locales/
│   │   ├── bn-BD/common.json            # Bangla translations (150+ keys)
│   │   └── en-BD/common.json            # English translations (150+ keys)
│   ├── sw.js                            # Service Worker (Background Sync API)
│   ├── manifest.json                    # PWA manifest
│   └── logo.svg                         # App logo
├── .env.example                         # Full environment variable reference
├── .github/workflows/ci.yml             # CI/CD pipeline (6 jobs)
├── next.config.ts                       # CSP, HSTS, PWA headers, Sentry
├── src/middleware.ts                    # CSRF protection (double-submit + Origin)
├── instrumentation.ts                   # OpenTelemetry startup hook
├── sentry.server.config.ts              # Sentry server config
├── sentry.client.config.ts              # Sentry browser config
├── Caddyfile                            # Reverse proxy config
├── package.json                         # Dependencies + scripts
└── prisma/schema.prisma                 # 176 models (source of truth)
```

---

## Module Overview

| Module | Blueprint Section | Key Files | Status |
|--------|------------------|-----------|--------|
| **Organization** | §5.1 | Company, Branch, Warehouse, Currency | ✅ |
| **Identity/RBAC** | §5.2, §8 | User, Role, Permission (130 codes), Device | ✅ |
| **Catalogue** | §5.4 | Product, Category, Brand, Unit, Barcode, TaxCode | ✅ |
| **Inventory** | §5.5, §5.5A | WarehouseStock, StockMovement, Serial, StockCount | ✅ |
| **Purchasing** | §5.8 | Purchase, Receiving, LandedCost, PurchaseReturn | ✅ |
| **Transfers** | §5.9 | Transfer (dispatch→receive→return lifecycle) | ✅ |
| **POS/Sales** | §5.7, §7.2 | PostSale, VoidSale, Hold/Recall, CashierShift | ✅ |
| **Returns** | §7.6 | PostSaleReturn (restock/damage/repair/loss) | ✅ |
| **Payments** | §5.11 | Payment, Allocation, Advance, Cheque, Installment | ✅ |
| **Accounting** | §5.10, §11 | JournalEntry, FiscalPeriod, TrialBalance, P&L | ✅ |
| **Reconciliation** | §11.3 | 20 checks (stock, journal, AR/AP, tax, outbox) | ✅ |
| **Reports** | §11.5 | 28 reports + 13 SQL views | ✅ |
| **Delivery** | §5.7A, §7.13 | DeliveryOrder, CourierShipment, COD Settlement | ✅ |
| **Service/Warranty** | §7.14, §20.D15 | ServiceRequest, WarrantyClaim, Parts | ✅ |
| **CRM** | §5.6A, §7.15 | Lead, LeadActivity, ConvertLead | ✅ |
| **Communications** | §5.14A, §7.16 | Templates, Campaigns, Consents, OutboundMessages | ✅ |
| **HR/Payroll** | §5.14, §7.17 | Employee, Attendance, PayrollRun, BEFTN | ✅ |
| **Loyalty** | §5.13, §20.D17 | GiftCard, RewardPoints, Coupons | ✅ |
| **Offline POS** | §10, §20.D07 | Bootstrap, Sync, ConflictResolution, RecoveryEpoch | ✅ |
| **Integrations** | §5.16, §9.3 | Outbox, Webhooks, Provider Adapters | ✅ |
| **Privacy/GDPR** | §20.D09 | DataSubjectRequest, LegalHold | ✅ |
| **Tax/Statutory** | §20.D08 | Mushak 6.1/6.3/9.1, Withholding Certificate | ✅ |
| **Multi-currency** | §20.D12 | CurrencyRevaluation, ExchangeRate | ✅ |
| **Risk Assessment** | §20.D20 | InternalRiskProvider (8 rules), FP/FN report | ✅ |
| **Backup/DR** | §20.D10 | pg_dump + WAL archive + restore test | ✅ |
| **Import/Export** | §9.5 | 7 templates, CSV formula escaping, control totals | ✅ |
| **PWA/Print** | §10 | Service Worker, ESC/POS, PDF with Bangla fonts | ✅ |

---

## Database Architecture

### PostgreSQL 16+ (Production)

| Aspect | Implementation |
|--------|---------------|
| **Tables** | 184 (19 forward-only migrations) |
| **RLS** | 170 tables with `ENABLE ROW LEVEL SECURITY` + tenant policies |
| **DB Roles** | `app_role` (NOSUPERUSER, NOBYPASSRLS), `migration_role` (BYPASSRLS), `backup_role` (BYPASSRLS, read-only), `reporting_role` (read-only) |
| **Functions** | 352 SECURITY DEFINER functions (safe search_path) |
| **Triggers** | 38 (immutable posted records, set_updated_at, tenant consistency) |
| **Views** | 13 (trial_balance_v, customer_ar_v, inventory_valuation_v, etc.) |
| **Constraints** | 1,687 CHECK + 2 EXCLUDE (fiscal_periods overlap, document_number_leases) |
| **Partitioning** | stock_movements, journal_entries, payments (monthly RANGE) |

### Key Constraints

- `warehouse_stocks.qty_on_hand >= 0` (negative stock prohibition — §20.D03)
- `journal_lines`: exactly-one-of debit/credit > 0 (double-entry integrity)
- `fiscal_periods`: EXCLUDE USING gist (no overlapping periods per company)
- `product_serials`: status-warehouse CHECK (in_stock requires warehouse)
- `gift_card_transactions`: refund requires sale_return_id (§20.D17)
- `customer_advance_ledger`: exactly-one-source (payment_id XOR sale_return_id)
- `risk_assessments`: block decision requires expires_at
- `webhook_endpoints.url`: CHECK ~ '^https://'

### Immutable Posted Records

Triggers prevent UPDATE/DELETE on:
- `journal_entries` (WHERE status = 'posted')
- `journal_lines` (always)
- `payment_allocations` (always)
- `stock_movements`, `serial_events`, `audit_logs`, `statutory_documents`

---

## API Flow

### Sale Posting (§7.2)

```
Client → POST /api/v1/sales (with Idempotency-Key)
  │
  ├─ 1. authenticateRequest() → verify JWT cookie
  ├─ 2. requirePermission(auth, 'sale.post')
  ├─ 3. requireIdempotencyKey(req) → check key+hash
  ├─ 4. Zod validation → parse items, payments
  ├─ 5. BEGIN SERIALIZABLE TRANSACTION
  │   ├─ set_config('app.company_id', ...)  (RLS context)
  │   ├─ next_document_number() → generate INV-000001
  │   ├─ Create business_event
  │   ├─ Validate products + stock availability
  │   ├─ Validate serials (in_stock → sold)
  │   ├─ D05: Credit sale checks (limit, overdue, exposure)
  │   ├─ Create sale + sale_items + sale_item_taxes
  │   ├─ post_stock_movement() → reduce warehouse_stocks
  │   ├─ Update serial status → sold
  │   ├─ Create payment + payment_allocation
  │   ├─ post_journal_entry() → Dr Cash, Cr Revenue + Dr COGS, Cr Inventory
  │   ├─ Create audit_log
  │   └─ Create outbox_event (for webhook delivery)
  ├─ 6. COMMIT
  ├─ 7. Fire-and-forget: risk assessment (InternalRiskProvider)
  └─ 8. Return { saleId, referenceNo, grandTotal, eventId }
```

### Authentication Flow

```
Client → POST /api/v1/auth/login { email, password }
  │
  ├─ 1. Find user across tenants
  ├─ 2. Verify Argon2id password hash
  ├─ 3. Check progressive lockout
  ├─ 4. Check MFA requirement for privileged roles
  │   └─ If privileged (owner/admin/global) AND !mfaEnabled → block (403 INVALID_MFA)
  ├─ 5. If MFA enabled → set MFA pending cookie, return { mfa_required: true }
  │   └─ Client → POST /api/v1/auth/mfa/verify { code }
  ├─ 6. Issue access JWT (15min, HttpOnly+Secure+SameSite=Strict cookie)
  ├─ 7. Issue refresh token (hashed, device-bound, family-based)
  └─ 8. Return { user, access_token_expires_in }
```

---


## Fixed Asset Management (§21.1)

Feature-flagged module (`asset_management_enabled`, default OFF) for capitalising fixed assets,
running depreciation (straight-line or declining-balance), and recording disposals with gain/loss
accounting. All asset events post through `post_journal_entry()` so the GL stays in sync with the
asset register.

| Layer | File / Object |
|-------|---------------|
| Prisma models | `FixedAsset`, `FixedAssetCategory`, `FixedAssetDepreciation` |
| Migration | `prisma/migrations/0020_asset_management_banking.sql` |
| Domain commands | `src/domain/commands/m4/AssetManagement.ts` → `postAssetAcquisition`, `postDepreciation`, `postAssetDisposal` |
| API routes | `POST /api/v1/fixed-assets`, `GET /api/v1/fixed-assets/[id]`, `POST /api/v1/fixed-assets/[id]/depreciate`, `POST /api/v1/fixed-assets/[id]/dispose` |
| UI page | `/dashboard/assets` |
| Reconciliation | `FIXED_ASSET_NBV` (NBV = cost − accumulated depreciation) |
| Permissions | `asset.view.branch`, `asset.view.global`, `asset.manage.branch`, `asset.depreciate.company` |
| CoA accounts | 1800 (control), 1810 Office Equipment, 1820 Vehicles, 1830 Furniture, 1840 Computers, 1850 Accumulated Depreciation (contra), 1860 Depreciation Expense, 1870 Gain/Loss on Disposal |
| Trigger | `trg_fixed_asset_dep_immutable` prevents mutation of posted depreciation rows |

---

## Bank Reconciliation (§21.2)

Feature-flagged module (`bank_reconciliation_enabled`, default OFF) for matching system payment
lines to bank statement lines with auto-match (amount + ±3 day tolerance) and manual match.
Variance posting creates an adjustment journal entry so the GL bank account equals the bank
statement closing balance.

| Layer | File / Object |
|-------|---------------|
| Prisma models | `BankReconciliation`, `BankReconciliationLine` |
| Migration | `prisma/migrations/0020_asset_management_banking.sql` |
| Domain commands | `src/domain/commands/m4/BankReconciliation.ts` → `createBankReconciliation`, `addStatementLinesBulk`, `autoMatchTransactions`, `manualMatch`, `postReconciliationVariance` |
| API routes | `POST /api/v1/bank-reconciliations`, `GET /api/v1/bank-reconciliations/[id]`, `POST /api/v1/bank-reconciliations/[id]/statement-lines`, `POST /api/v1/bank-reconciliations/[id]/auto-match`, `POST /api/v1/bank-reconciliations/[id]/manual-match`, `POST /api/v1/bank-reconciliations/[id]/finalize` |
| UI page | `/dashboard/bank-reconciliation` |
| Reconciliation | `BANK_RECONCILIATION_VARIANCE` (flags reconciliations with unresolved variance) |
| Permissions | `bank.reconciliation.view.company`, `bank.reconciliation.manage.company` |
| Note | The `payments` table is partitioned by `business_date` with composite PK `(id, business_date)`. The FK from `bank_reconciliation_lines.payment_id` is therefore enforced at the application layer (matches the pattern used by `payment_allocations` and `return_refund_allocations`). |

---

## Security Architecture

| Control | Implementation |
|---------|---------------|
| **CSRF** | `src/middleware.ts` — double-submit cookie + Origin/Referer validation |
| **CSP** | `script-src 'self'` (no unsafe-inline/unsafe-eval); style-src allows inline (Tailwind) |
| **HSTS** | `max-age=63072000; includeSubDomains; preload` |
| **Auth** | Argon2id (64MB memory, time=3), JWT 15min, rotating refresh tokens |
| **MFA** | TOTP + WebAuthn; mandatory for owners/global admins at login + action-time |
| **RLS** | 170 tables, `app_role` NOSUPERUSER NOBYPASSRLS, `set_config()` per transaction |
| **RBAC** | 130 permission codes, 8 system roles, `requirePermission()` on every route |
| **Idempotency** | Idempotency-Key header (same key+hash → replay; different hash → 409) |
| **Encryption** | AES-256 envelope encryption for MFA secrets, provider credentials, account numbers |
| **Webhooks** | HMAC-SHA256 + 5-min replay tolerance + delivery_id dedup |
| **Immutable ledgers** | Triggers prevent UPDATE/DELETE on posted journal entries/lines |
| **Maker-checker** | `approval_requests` table + SELF_APPROVAL_PROHIBITED enforcement |

---

## §20 Decisions (D01–D20)

| Decision | Description | Status |
|----------|-------------|--------|
| D01 | Multi-tenant onboarding | ✅ |
| D02 | Feature flags (10 flags) | ✅ |
| D03 | Negative stock prohibition (DB CHECK) | ✅ |
| D04 | Approval thresholds (9 configurable) | ✅ |
| D05 | Credit sales (5 validation checks) | ✅ |
| D06 | Cashier shifts (PIN + MFA + variance) | ✅ |
| D07 | Offline POS (bootstrap + sync + conflict) | ✅ |
| D08 | Tax/VAT (Mushak 6.1/6.3/9.1 + withholding) | ✅ |
| D09 | Privacy/GDPR (DSR + legal holds) | ✅ |
| D10 | Backup/DR (pg_dump + WAL + restore test) | ✅ |
| D11 | Partitioning (3 tables, monthly RANGE) | ✅ |
| D12 | Multi-currency (revaluation + reversal) | ✅ |
| D13 | Foreign-currency purchasing (locked rates) | ✅ |
| D14 | Courier/COD (settlement + reconciliation) | ✅ |
| D15 | Service/warranty (repair + replacement) | ✅ |
| D16 | SMS/email adapters (SSL, SendGrid, Resend) | ✅ |
| D17 | Loyalty/gift cards (FIFO points, refund) | ✅ |
| D18 | Payroll (BEFTN bank file) | ✅ |
| D19 | Localization (bn-BD + en-BD, 150+ keys) | ✅ |
| D20 | Payment gateway (bKash, Nagad, webhook) | ✅ |

---

## Deployment Guide

### Prerequisites

- Node.js 20+ / Bun 1.0+
- PostgreSQL 16+
- Redis 7+
- S3-compatible storage (MinIO / AWS S3 / Cloudflare R2)

### Quick Start (Docker)

```bash
# 1. Clone
git clone https://github.com/DelwarOfficial/erp-pos.git
cd erp-pos

# 2. Install dependencies
bun install

# 3. Configure environment
cp .env.example .env
# Edit .env with your settings

# 4. Start infrastructure
cd docker && docker compose up -d postgres redis minio

# 5. Run migrations
bun run scripts/switch-to-postgres.ts

# 6. Build + start
bun run build
NODE_ENV=production bun run start

# 7. Start background worker (separate terminal)
bun run worker
```

### Production Deployment (VPS)

```bash
# 1. Push to your server
git clone https://github.com/DelwarOfficial/erp-pos.git
cd erp-pos && bun install

# 2. Configure .env
cp .env.example .env
# Set DATABASE_URL, REDIS_URL, S3_*, JWT_SECRET, APP_ENCRYPTION_KEY

# 3. Generate secrets
openssl rand -base64 32  # JWT_SECRET
openssl rand -base64 32  # APP_ENCRYPTION_KEY

# 4. Start PostgreSQL + Redis
cd docker && docker compose up -d postgres redis

# 5. Run migrations
DATABASE_URL=postgresql://... bun run scripts/switch-to-postgres.ts

# 6. Build
bun run build

# 7. Start with process manager
NODE_ENV=production bun run start  # Web
bun run worker                      # Worker (separate process)

# 8. Set up reverse proxy with SSL (Caddy)
# Caddyfile already configured — just run:
caddy run --config Caddyfile
```

### Cron Jobs

```bash
# Nightly backup (1am UTC)
0 1 * * * /path/to/scripts/backup/nightly-backup.sh >> /var/log/erp-backup.log 2>&1

# Risk alert evaluation (via cron-job.org or local cron)
0 3 * * * /path/to/scripts/cron-evaluate-risk-alerts.sh >> /var/log/risk-alerts.log 2>&1
```

---

## Environment Setup

See `.env.example` for the complete reference. Key variables:

```bash
# Database
DATABASE_URL=file:./db/custom.db          # SQLite (dev)
# DATABASE_URL=postgresql://app_role:password@localhost:5432/erp_pos  # Postgres (prod)

# Auth
JWT_SECRET=<32+ char random string>
APP_ENCRYPTION_KEY=<32+ char random string>

# Redis
REDIS_URL=redis://localhost:6379

# S3/MinIO
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=erp-pos-storage
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin

# Providers (optional — leave empty to use mocks)
RESEND_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
SSL_SMS_API_KEY=
BKASH_APP_KEY=

# Risk alerting
RISK_ALERT_RECIPIENT_EMAIL=ops@yourcompany.bd
RISK_ALERT_PRECISION_THRESHOLD=0.4
RISK_ALERT_RECALL_THRESHOLD=0.85

# Monitoring
SENTRY_DSN=
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

---

## Important File Paths

| Purpose | Path |
|---------|------|
| Prisma schema (source of truth) | `prisma/schema.prisma` |
| SQL migrations | `prisma/migrations/0001-0019*.sql` |
| SQL functions | `prisma/functions/*.sql` |
| SQL triggers | `prisma/triggers/*.sql` |
| RLS policies | `prisma/rls/*.sql` |
| Domain commands | `src/domain/commands/m2-m6/*.ts` |
| API routes | `src/app/api/v1/*/route.ts` |
| UI pages | `src/app/(erp)/dashboard/*/page.tsx` |
| Auth middleware | `src/lib/auth/middleware.ts` |
| CSRF middleware | `src/middleware.ts` |
| Permission catalogue | `src/lib/permissions/catalogue.ts` |
| Reconciliation checks | `src/lib/reconciliation/checks.ts` |
| Reports | `src/reports/index.ts` |
| Risk provider | `src/adapters/riskProvider.ts` |
| Risk alerting | `src/lib/risk/alerting.ts` |
| Provider adapters | `src/adapters/providers.ts` |
| BEFTN generator | `src/lib/payroll/beftn.ts` |
| Statutory documents | `src/lib/tax/statutoryDocuments.ts` |
| Multi-currency revaluation | `src/lib/accounting/revaluation.ts` |
| Period-end close | `src/lib/accounting/periodClose.ts` |
| Approval workflow | `src/lib/approval/workflow.ts` |
| Approval thresholds | `src/lib/approval/thresholds.ts` |
| Backup scripts | `scripts/backup/*.sh` |
| Postgres migration runner | `scripts/run-postgres-migrations.ts` |
| Env reference | `.env.example` |
| Docker compose | `docker/docker-compose.yml` |
| CI/CD pipeline | `.github/workflows/ci.yml` |
| Localization (Bangla) | `public/locales/bn-BD/common.json` |
| Localization (English) | `public/locales/en-BD/common.json` |
| Service Worker | `public/sw.js` |
| Next.js config | `next.config.ts` |
| Sentry config | `sentry.server.config.ts`, `sentry.client.config.ts` |
| OpenTelemetry | `instrumentation.ts` |

---

## Testing

```bash
# Unit + integration tests
bun run test

# E2E tests (requires running dev server)
bun run test:e2e

# Accessibility tests
bun run test:e2e:accessibility

# Load tests (k6)
k6 run tests/load/pos-sale.k6.js

# Backup restore test
bash scripts/backup/first-restore-test.sh

# Provider smoke test
PROVIDER_MODE=mock bun run scripts/smoke-test-providers.ts
```

---

## Login Credentials (Sandbox)

| Field | Value |
|-------|-------|
| Email | `admin@erp-platform.local` |
| Password | `ChangeMe!2026` |
| Company | Platform Operations (global scope) |

---

## License

Proprietary — All rights reserved.

---

## GitHub

**Repository:** https://github.com/DelwarOfficial/erp-pos
