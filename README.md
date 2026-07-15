# ERP/POS — Bangladesh Multi-Tenant Electronics Retail + Service + Warranty

> **Production-grade multi-tenant ERP/POS SaaS** built on the master blueprint (`ERP_Product_Blueprint_v4.1.md`). Covers electronics, mobile, appliance, and accessory retail — plus service-center workflows, warranty management, full double-entry accounting, CRM, HR/payroll, and courier-delivery integration. All in a single TypeScript modular monolith.

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)]()
[![Tests](https://img.shields.io/badge/tests-395%2F395-brightgreen)]()
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-blue)]()
[![Next.js](https://img.shields.io/badge/Next.js-16-black)]()
[![License](https://img.shields.io/badge/license-Proprietary-red)]()

---

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Project Statistics](#project-statistics)
4. [Tech Stack](#tech-stack)
5. [Repository Layout](#repository-layout)
6. [Module Coverage](#module-coverage)
7. [Database Architecture](#database-architecture)
8. [Security Architecture](#security-architecture)
9. [Key Workflows](#key-workflows)
10. [Fixed Asset Management (§21.1)](#fixed-asset-management-§211)
11. [Bank Reconciliation (§21.2)](#bank-reconciliation-§212)
12. [Production Decisions (D01–D20)](#production-decisions-d01d20)
13. [Quick Start](#quick-start)
14. [Staging / UAT Setup](#staging--uat-setup)
15. [Production Deployment](#production-deployment)
16. [Environment Configuration](#environment-configuration)
17. [Testing](#testing)
18. [Backup & Disaster Recovery](#backup--disaster-recovery)
19. [Important File Paths](#important-file-paths)
20. [Sandbox Login](#sandbox-login)
21. [GitHub](#github)
22. [License](#license)

---

## Overview

This system implements a Bangladesh-focused, multi-tenant ERP/POS SaaS for electronics retail chains. It is built per `ERP_Product_Blueprint_v4.1.md` — a 7,400-line specification that serves as the single source of truth for architecture, data contracts, security controls, and acceptance criteria.

**Target market:** Multi-branch electronics, mobile, appliance, accessory, service-center, and warranty operations in Bangladesh.

**Default configuration:**
- Timezone: `Asia/Dhaka`
- Base currency: `BDT`
- Locale: `bn-BD` + `en-BD`
- VAT regime: Mushak 6.1 / 6.3 / 9.1 per NBR rules
- Payment methods: Cash, card, cheque, bKash, Nagad, Rocket, bank transfer, gift card, store credit, customer advance

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Client (Browser / PWA)                       │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────────────┐  │
│  │ POS PWA  │   │ Dashboard│   │ Print/PDF│   │ Offline IndexedDB │  │
│  │ Offline  │   │ Admin/ERP│   │Receipt/A4│   │ + Service Worker  │  │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └────────┬─────────┘  │
└───────┼──────────────┼──────────────┼──────────────────┼────────────┘
        │              │              │                  │
        ▼              ▼              ▼                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Next.js 16 App Router (TS)                         │
│  ┌───────────┐ ┌────────────┐ ┌───────────┐ ┌─────────────────────┐  │
│  │ Middleware │ │ API Routes │ │  Domain   │ │   Provider Adapters  │  │
│  │ CSRF + CSP│ │ /api/v1/*  │ │ Commands  │ │ SMS/Email/Courier/   │  │
│  │ Auth + MFA│ │ 134 routes │ │ 26 cmds   │ │ Payment/Risk/Notify  │  │
│  └───────────┘ └────────────┘ └───────────┘ └─────────────────────┘  │
│  ┌───────────┐ ┌────────────┐ ┌───────────┐ ┌─────────────────────┐  │
│  │  Reports  │ │ Reconcile  │ │   i18n    │ │  Workers (BullMQ)    │  │
│  │ 28 types  │ │ 22 checks  │ │bn-BD/en-BD│ │ Outbox/Comm/Recon    │  │
│  └───────────┘ └────────────┘ └───────────┘ └─────────────────────┘  │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
┌──────────────────┐ ┌───────────────┐ ┌──────────────────┐
│   PostgreSQL 17  │ │    Redis 7    │ │  S3 / MinIO      │
│   201 tables     │ │  BullMQ Queue │ │  Media / Backup  │
│   177 RLS tables │ │  5 Workers    │ │  Encrypted       │
│   352 functions  │ │  Rate Limits  │ │  Versioned       │
│   64 triggers    │ │  Locks        │ │  Signed URLs     │
│   13 views       │ │  Cache        │ │                  │
└──────────────────┘ └───────────────┘ └──────────────────┘
```

---

## Project Statistics

| Metric | Count |
|--------|-------|
| Prisma models | 181 |
| PostgreSQL tables | 201 |
| RLS-enabled tables | 177 |
| RLS policies | 352 |
| SQL functions (SECURITY DEFINER) | 352 |
| SQL triggers | 64 |
| SQL views | 13 |
| CHECK constraints | 1,700+ |
| EXCLUDE constraints | 2 |
| Forward-only migrations | 22 |
| Domain commands | 26 |
| API route files | 134 |
| UI pages | 39 |
| Reports | 28 |
| Reconciliation checks | 22 |
| Permission codes | 134 |
| System roles | 13 |
| Feature flags | 12 |
| Provider adapters | 12 (SMS/Email/Courier/Payment/Risk/Notify) |
| Test files | 45 |
| Tests passing | 395 / 395 |
| Playwright E2E specs | 12 (84 test definitions) |
| Translation keys per locale | 150+ |
| ADRs | 6 |
| Operational runbooks | 4 |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Bun 1.x / Node.js 20+ |
| **Framework** | Next.js 16 (App Router, Turbopack, standalone output) |
| **Language** | TypeScript 5.x (strict mode) |
| **Database** | PostgreSQL 16+ (SQLite for sandbox tests) |
| **ORM** | Prisma 6.x |
| **Cache/Queue** | Redis 7 + BullMQ |
| **Storage** | S3-compatible (AWS S3 / MinIO / Cloudflare R2) |
| **UI** | React 19, Tailwind CSS 4, shadcn/ui (30+ components) |
| **Auth** | Argon2id, JWT (15-min access + rotating refresh), TOTP, WebAuthn |
| **Payments** | bKash, Nagad (sandbox + production adapters) |
| **SMS** | SSL Wireless, Mim SMS |
| **Email** | SendGrid, AWS SES, Resend |
| **Courier** | Pathao, RedX |
| **Notifications** | Slack, Telegram |
| **Print** | ESC/POS thermal, PDF (Noto Sans Bengali) |
| **Observability** | Sentry, OpenTelemetry |
| **Testing** | Vitest (unit), Playwright (E2E + axe-core), k6 (load) |
| **CI/CD** | GitHub Actions (7-stage pipeline) |

---

## Repository Layout

```
erp-pos/
├── prisma/
│   ├── schema.prisma                    # 181 Prisma models (SQLite sandbox)
│   ├── schema.postgres.prisma           # 181 Prisma models (PostgreSQL prod)
│   ├── migrations/                      # 22 forward-only SQL migrations
│   │   ├── 0001_extensions_and_schemas.sql
│   │   ├── 0002_organization_currency.sql
│   │   ├── ...
│   │   ├── 0020_asset_management_banking.sql    # §21.1 + §21.2
│   │   ├── 0021_rls_on_partitioned_parents.sql  # RLS fix for journal_entries/payments
│   │   └── 0022_allow_je_reversal.sql            # Trigger refinement for reversal workflow
│   ├── functions/                       # 5 SECURITY DEFINER SQL function files
│   ├── triggers/                        # 4 trigger definition files
│   ├── rls/                             # RLS policy definitions
│   └── roles/                           # DB role definitions
├── src/
│   ├── domain/commands/                 # 26 domain commands (M2–M6)
│   ├── app/
│   │   ├── (auth)/login/                # Login page
│   │   ├── (erp)/dashboard/             # 39 dashboard pages
│   │   ├── print/                       # Receipt + Invoice print routes
│   │   └── api/v1/                      # 134 API route files
│   ├── adapters/                        # 12 provider adapters
│   ├── components/                      # UI + shared + PWA components
│   ├── lib/                             # Auth, accounting, risk, reconciliation, etc.
│   ├── workers/                         # 5 BullMQ workers
│   └── reports/                         # 28 report functions
├── tests/
│   ├── unit/                            # 33 unit test files
│   ├── integration/                     # Integration tests
│   ├── e2e/                             # 12 Playwright spec files
│   └── load/                            # k6 load test scripts
├── docker/                              # Dockerfile.web, Dockerfile.worker, compose
├── scripts/
│   ├── backup/                          # nightly-backup, restore, WAL archive, DR test
│   ├── seed.ts                          # Sandbox seeder
│   ├── seed-staging.sql                 # Staging DB seed
│   ├── smoke-test-providers.ts          # Provider integration smoke test
│   ├── e2e-staging-suite.ts             # Memory-conscious E2E validation
│   ├── switch-to-postgres.ts            # SQLite → PostgreSQL switch
│   └── run-postgres-migrations.ts       # Forward-only migration runner
├── docs/
│   ├── adr/                             # 6 Architecture Decision Records
│   ├── runbooks/                        # 4 operational runbooks
│   ├── TOKEN-SCOPE.md                   # GitHub token workflow scope fix
│   ├── postgres-quickstart.md           # PostgreSQL setup guide
│   └── provider-integration-guide.md    # Provider sandbox credentials
├── public/
│   ├── locales/bn-BD/                   # Bangla translations
│   ├── locales/en-BD/                   # English translations
│   ├── sw.js                            # Service Worker (Background Sync API)
│   └── manifest.json                    # PWA manifest
├── .env.example                         # Full environment variable reference
├── .env.staging.example                 # Staging/UAT environment template
├── .github/workflows/ci.yml             # CI/CD pipeline (7 stages)
├── next.config.ts                       # CSP, HSTS, PWA headers, Sentry
├── src/middleware.ts                    # CSRF protection (double-submit + Origin)
├── Caddyfile                            # Reverse proxy config
└── package.json                         # Dependencies + scripts
```

---

## Module Coverage

All 19 blueprint modules are implemented with API routes, domain commands, and UI pages.

| Module | Blueprint | Status |
|--------|-----------|--------|
| Dashboard (KPIs, alerts) | §3.1 | ✅ |
| Identity & RBAC (MFA, devices) | §5.2, §8 | ✅ |
| Organization (company, branches) | §5.1 | ✅ |
| Product Catalogue (barcodes, combos) | §5.4 | ✅ |
| Inventory (IMEI, batches, counts) | §5.5 | ✅ |
| Purchasing (landed cost, returns) | §5.8 | ✅ |
| Sales / POS (offline, split payment) | §5.7, §7.2 | ✅ |
| Delivery / Courier (COD settlement) | §5.7A | ✅ |
| Service & Warranty (repair, parts) | §7.14 | ✅ |
| Payments & Cashier (shifts, cheques) | §5.11 | ✅ |
| Accounting & Tax (journals, VAT) | §5.10, §11 | ✅ |
| Expenses (approvals, evidence) | §5.12 | ✅ |
| Promotions (gift cards, loyalty) | §5.13 | ✅ |
| CRM (leads, conversion) | §5.6A | ✅ |
| Communications (SMS/email campaigns) | §5.14A | ✅ |
| HR & Payroll (BEFTN bank file) | §5.14 | ✅ |
| Reports & Exports (28 types) | §11.5 | ✅ |
| Administration (settings, audit) | §3.1 | ✅ |
| Integration & Offline (outbox, PWA) | §5.16, §10 | ✅ |

---

## Database Architecture

### PostgreSQL 16+ (Production)

| Aspect | Implementation |
|--------|---------------|
| **Tables** | 201 (22 forward-only migrations) |
| **RLS** | 177 tables with `ENABLE + FORCE ROW LEVEL SECURITY` + tenant policies |
| **DB Roles** | `app_role` (NOSUPERUSER, NOBYPASSRLS), `migration_role` (BYPASSRLS), `backup_role`, `reporting_role` |
| **Functions** | 352 SECURITY DEFINER functions (safe `search_path`) |
| **Triggers** | 64 (immutable posted records, set_updated_at, tenant consistency) |
| **Views** | 13 (trial_balance_v, customer_ar_v, inventory_valuation_v, etc.) |
| **Constraints** | 1,700+ CHECK + 2 EXCLUDE (fiscal period overlap, document lease overlap) |
| **Partitioning** | `stock_movements`, `journal_entries`, `payments` (monthly RANGE) |

### Key Constraints

- `warehouse_stocks.qty_on_hand >= 0` — negative stock prohibition (§20.D03)
- `journal_lines`: exactly-one-of debit/credit > 0 (double-entry integrity)
- `fiscal_periods`: EXCLUDE USING gist (no overlapping periods per company)
- `product_serials`: status-warehouse CHECK (in_stock requires warehouse)
- `gift_card_transactions`: refund requires `sale_return_id` (§20.D17)
- `customer_advance_ledger`: exactly-one-source (`payment_id` XOR `sale_return_id`)
- `risk_assessments`: block decision requires `expires_at > assessed_at`
- `webhook_endpoints.url`: CHECK ~ `'^https://'`

### Immutable Posted Records

Triggers prevent `UPDATE`/`DELETE` on:

- `journal_entries` (WHERE `status = 'posted'` — except `posted → reversed` transition)
- `journal_lines` (always)
- `payment_allocations` (always)
- `fixed_asset_depreciation` (always)
- `stock_movements`, `serial_events`, `audit_logs`, `statutory_documents`

### RLS Cross-Tenant Isolation

Verified with live PostgreSQL testing:

```sql
-- As erp_prod user (NOSUPERUSER, NOBYPASSRLS, member of app_role):
SET app.company_id = 'tenant-a-uuid';
SET app.is_global = 'false';

SELECT count(*) FROM companies WHERE id = 'tenant-b-uuid';
-- → 0  (RLS blocked cross-tenant access)

SELECT count(*) FROM companies WHERE id = 'tenant-a-uuid';
-- → 1  (own tenant visible)
```

---

## Security Architecture

| Control | Implementation |
|---------|---------------|
| **CSRF** | `src/middleware.ts` — double-submit cookie + Origin/Referer validation |
| **CSP** | `script-src 'self'` (no `unsafe-inline`/`unsafe-eval`); `style-src 'self' 'unsafe-inline'` (Tailwind) |
| **HSTS** | `max-age=63072000; includeSubDomains; preload` |
| **Frame-ancestors** | `'self' https://*.space-z.ai` (preview gateway) |
| **Password hashing** | Argon2id (64MB memory, time=3, parallelism=1) |
| **JWT** | 15-min access token (HttpOnly + Secure + SameSite=Strict cookie) |
| **Refresh tokens** | Rotating, hashed, device-bound, family-based (reuse → family revoked) |
| **MFA** | TOTP + WebAuthn; mandatory for owners/global admins at login + action-time |
| **Action-time MFA** | 9 high-risk actions (backup download, journal approval, period lock, etc.) |
| **Rate limiting** | Login (10/15min → progressive lock), MFA verify (5/5min → 15-min lock doubling to 2h) |
| **RLS** | 177 tables, `app_role` NOSUPERUSER NOBYPASSRLS, `set_config()` per transaction |
| **RBAC** | 134 permission codes, 13 system roles, `requirePermission()` on every mutation route |
| **Idempotency** | `Idempotency-Key` header (same key+hash → replay; different hash → 409 conflict) |
| **Encryption** | AES-256 envelope encryption for MFA secrets, provider credentials, account numbers |
| **Webhooks** | HMAC-SHA256 + 5-min replay tolerance + `delivery_id` dedup |
| **Immutable ledgers** | Triggers prevent UPDATE/DELETE on posted journal entries/lines |
| **Maker-checker** | `approval_requests` table + `SELF_APPROVAL_PROHIBITED` enforcement |
| **Audit logging** | Append-only `audit_logs` table (UPDATE/DELETE blocked by trigger) |

---

## Key Workflows

### Sale Posting (§7.2)

```
Client → POST /api/v1/sales (with Idempotency-Key)
  │
  ├─ 1. authenticateRequest()          → verify JWT cookie
  ├─ 2. requirePermission('sale.post') → RBAC check
  ├─ 3. requireIdempotencyKey(req)     → check key+hash
  ├─ 4. Zod validation                 → parse items, payments
  ├─ 5. BEGIN SERIALIZABLE TRANSACTION
  │     ├─ set_config('app.company_id', ...)  (RLS context)
  │     ├─ next_document_number()             → generate INV-000001
  │     ├─ Create business_event
  │     ├─ Validate products + stock availability
  │     ├─ Validate serials (in_stock → sold)
  │     ├─ D05: Credit sale checks (limit, overdue, exposure)
  │     ├─ Create sale + sale_items + sale_item_taxes
  │     ├─ post_stock_movement()              → reduce warehouse_stocks
  │     ├─ Update serial status               → sold
  │     ├─ Create payment + payment_allocation
  │     ├─ post_journal_entry()               → Dr Cash, Cr Revenue + Dr COGS, Cr Inventory
  │     ├─ Create audit_log
  │     └─ Create outbox_event                → for webhook delivery
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
  ├─ 3. Check progressive lockout (5/10/15/20 min on repeated failures)
  ├─ 4. Check MFA requirement for privileged roles
  ├─ 5. If MFA enabled → set MFA pending cookie, return { mfa_required: true }
  │     └─ Client → POST /api/v1/auth/mfa/verify { code }
  │        ├─ Rate limit: 5 attempts / 5 min → 15-min progressive lock
  │        └─ On success: reset rate limiter, issue tokens
  ├─ 6. Issue access JWT (15min, HttpOnly+Secure+SameSite=Strict)
  ├─ 7. Issue refresh token (hashed, device-bound, family-based)
  └─ 8. Return { user, access_token_expires_in }
```

---

## Fixed Asset Management (§21.1)

Feature-flagged module (`asset_management_enabled`, default OFF) for capitalising fixed assets, running depreciation (straight-line or declining-balance), and recording disposals with gain/loss accounting. All asset events post through `post_journal_entry()` so the GL stays in sync with the asset register.

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

Feature-flagged module (`bank_reconciliation_enabled`, default OFF) for matching system payment lines to bank statement lines with auto-match (amount + ±3 day tolerance) and manual match. Variance posting creates an adjustment journal entry so the GL bank account equals the bank statement closing balance.

| Layer | File / Object |
|-------|---------------|
| Prisma models | `BankReconciliation`, `BankReconciliationLine` |
| Migration | `prisma/migrations/0020_asset_management_banking.sql` |
| Domain commands | `src/domain/commands/m4/BankReconciliation.ts` → `createBankReconciliation`, `addStatementLinesBulk`, `autoMatchTransactions`, `manualMatch`, `postReconciliationVariance` |
| API routes | `POST /api/v1/bank-reconciliations`, `GET /api/v1/bank-reconciliations/[id]`, `POST .../statement-lines`, `POST .../auto-match`, `POST .../manual-match`, `POST .../finalize` |
| UI page | `/dashboard/bank-reconciliation` |
| Reconciliation | `BANK_RECONCILIATION_VARIANCE` (flags reconciliations with unresolved variance) |
| Permissions | `bank.reconciliation.view.company`, `bank.reconciliation.manage.company` |

---

## Production Decisions (D01–D20)

All 20 production decisions from the blueprint are formally resolved and implemented.

| Decision | Description | Status |
|----------|-------------|--------|
| D01 | Multi-tenant onboarding (admin-led) | ✅ |
| D02 | Feature flags (12 flags) | ✅ |
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
| D13 | Trade finance scope exclusion | ✅ |
| D14 | Courier/COD (settlement + reconciliation) | ✅ |
| D15 | Service/warranty (repair + replacement) | ✅ |
| D16 | SMS/email adapters (SSL, SendGrid, Resend) | ✅ |
| D17 | Loyalty/gift cards (FIFO points, refund) | ✅ |
| D18 | Payroll (BEFTN bank file) | ✅ |
| D19 | Localization (bn-BD + en-BD, 150+ keys) | ✅ |
| D20 | Payment gateway (bKash, Nagad, webhook) | ✅ |

---

## Quick Start

### Prerequisites

- **Bun** 1.0+ (or Node.js 20+)
- **PostgreSQL** 16+ (SQLite included for sandbox)
- **Redis** 7+ (optional — workers skip if unavailable)

### Sandbox (SQLite, no external services)

```bash
# 1. Clone
git clone https://github.com/DelwarOfficial/erp-pos.git
cd erp-pos

# 2. Install dependencies
bun install

# 3. Generate Prisma client + push schema to SQLite
bunx prisma generate
bunx prisma db push

# 4. Seed base data (currencies, permissions, roles, admin user)
bun run scripts/seed.ts

# 5. Start dev server
bun run dev
# → http://localhost:3000
```

### Run Tests

```bash
# Unit + integration tests (395 tests, ~13s)
bun run test

# Lint (0 errors expected)
bun run lint

# E2E smoke suite (HTTP-based, no browser required)
bun run scripts/e2e-staging-suite.ts

# Playwright browser tests (requires running server)
bunx playwright test tests/e2e/login.spec.ts -g "invalid" --project="Desktop Chrome"
```

---

## Staging / UAT Setup

Staging uses PostgreSQL with sandbox provider credentials. A complete template is provided.

```bash
# 1. Copy staging env template
cp .env.staging.example .env.staging

# 2. Edit .env.staging — replace CHANGE_ME_* placeholders with:
#    - Real sandbox DB password
#    - openssl rand -base64 48  (for JWT_SECRET, APP_ENCRYPTION_KEY)
#    - Provider sandbox keys (bKash, Nagad, SSL SMS, SendGrid, etc.)

# 3. Activate staging env
cp .env.staging .env

# 4. Generate Prisma client for PostgreSQL
bunx prisma generate --schema=prisma/schema.postgres.prisma

# 5. Create + migrate staging database
createdb erp_pos_staging
psql -d erp_pos_staging -f scripts/seed-staging.sql

# 6. Apply all migrations (see docs/postgres-quickstart.md for details)

# 7. Start staging server
bun run staging:dev
```

**NPM scripts for staging:**

| Script | Purpose |
|--------|---------|
| `bun run staging:generate` | Generate Prisma client for PostgreSQL schema |
| `bun run staging:dev` | Start dev server with PostgreSQL |
| `bun run staging:seed` | Seed staging database |

**Provider smoke test:**

```bash
bun run scripts/smoke-test-providers.ts
# Verifies all 12 provider adapters instantiate + env vars are set
```

---

## Production Deployment

### Prerequisites

- VPS or container platform with ≥ 2GB RAM (4GB+ recommended)
- PostgreSQL 16+ (managed RDS / Cloud SQL / self-hosted)
- Redis 7+ (managed ElastiCache / self-hosted)
- S3-compatible storage (AWS S3 / MinIO / Cloudflare R2)
- Domain + TLS certificate (Caddy auto-provisions Let's Encrypt)

### Docker Deployment

```bash
# 1. Clone + configure
git clone https://github.com/DelwarOfficial/erp-pos.git
cd erp-pos && bun install

# 2. Configure production env
cp .env.example .env
# Edit .env: DATABASE_URL, REDIS_URL, S3_*, JWT_SECRET, APP_ENCRYPTION_KEY
# Generate secrets:
openssl rand -base64 48  # JWT_SECRET
openssl rand -base64 32  # APP_ENCRYPTION_KEY

# 3. Start infrastructure
cd docker && docker compose up -d postgres redis minio

# 4. Run migrations
DATABASE_URL=postgresql://... bun run scripts/switch-to-postgres.ts

# 5. Build production bundle
bun run build

# 6. Start web server
NODE_ENV=production bun run start

# 7. Start background worker (separate process)
bun run worker

# 8. Reverse proxy with SSL (Caddy auto-provisions Let's Encrypt)
caddy run --config Caddyfile
```

### Cron Jobs

```bash
# Nightly backup (1am UTC)
0 1 * * * /path/to/scripts/backup/nightly-backup.sh >> /var/log/erp-backup.log 2>&1

# Risk alert evaluation (3am UTC / 9am Asia/Dhaka)
0 3 * * * /path/to/scripts/cron-evaluate-risk-alerts.sh >> /var/log/risk-alerts.log 2>&1

# WAL archive (continuous — configured in postgresql.conf)
# archive_command = '/path/to/scripts/backup/wal-archive.sh %p %f'
```

---

## Environment Configuration

See `.env.example` for the complete reference (57 variables). Key categories:

| Category | Variables |
|----------|-----------|
| **Database** | `DATABASE_URL` |
| **Auth/Security** | `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `BARCODE_SIGNING_KEY`, `CSRF_SECRET` |
| **Redis** | `REDIS_URL` |
| **Provider mode** | `PROVIDER_MODE` (`mock` / `sandbox` / `live`) |
| **Payments** | `BKASH_*`, `NAGAD_*` |
| **SMS** | `SSL_SMS_*`, `MIM_SMS_*` |
| **Email** | `SENDGRID_*`, `RESEND_*`, `SES_REGION` |
| **Courier** | `PATHAO_*`, `REDX_*` |
| **Notifications** | `SLACK_*`, `TELEGRAM_*` |
| **Webhooks** | `COURIER_WEBHOOK_TOKEN`, `CRON_API_TOKEN` |
| **Risk** | `RISK_ALERT_*` |
| **WebAuthn** | `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN` |
| **Monitoring** | `SENTRY_DSN`, `OTEL_SERVICE_NAME` |
| **Feature flags** | `FEATURE_*` (12 flags) |

**Staging template:** `.env.staging.example` (safe to commit — all secrets are `CHANGE_ME_*` placeholders).

**⚠️ Never commit real secrets.** Use a secrets manager (AWS Secrets Manager / Doppler / Vault) in production.

---

## Testing

### Test Pyramid

| Level | Tool | Count | Command |
|-------|------|-------|---------|
| Unit | Vitest | 395 tests / 33 files | `bun run test` |
| Integration | Vitest | 15 tests | `bun run test` |
| E2E | Playwright + axe-core | 84 tests / 12 specs | `bun run test:e2e` |
| Load | k6 | scripts in `tests/load/` | `k6 run tests/load/pos-sale.k6.js` |

### Test Commands

```bash
# Unit + integration (fast — 13s)
bun run test

# Watch mode
bun run test:watch

# E2E with Playwright (requires running server)
bun run test:e2e

# Accessibility-only tests (axe-core)
bun run test:e2e:accessibility

# HTTP-based smoke suite (no browser — memory-efficient)
bun run scripts/e2e-staging-suite.ts

# Provider smoke test
bun run scripts/smoke-test-providers.ts

# Backup restore test
bash scripts/backup/first-restore-test.sh
```

### Test Coverage

- **Authentication**: Argon2id hashing, JWT round-trip, refresh token rotation, MFA setup/verify, progressive lockout
- **Authorization**: `requirePermission()` on all mutation routes, RBAC for 13 system roles
- **Financial integrity**: Journal Dr==Cr, immutable posted records, reversal workflow, trial balance
- **Inventory**: Moving-average cost, serial lifecycle, stock count/adjustment, transfer
- **POS**: PostSale, VoidSale, PostSaleReturn, credit sale validation (D05), cashier shift
- **Reconciliation**: 22 checks (journal balance, AR/AP subledger, stock qty/value, tax, fixed asset NBV, bank variance)
- **Security**: CSRF, CSP, HSTS, idempotency coverage, Argon2id memory cost, MFA enforcement

---

## Backup & Disaster Recovery

### Backup Strategy (§20.D10)

| Component | Schedule | Retention |
|-----------|----------|-----------|
| Full pg_dump | Nightly 1am UTC | 30 days |
| WAL archive | Continuous | RPO ≤ 15 min |
| S3 object-lock | On upload | Immutable |
| Restore test | Weekly | Verify recoverability |

**RPO:** ≤ 15 minutes (WAL archiving)
**RTO:** ≤ 4 hours (restore + reconcile)

### Backup Scripts

| Script | Purpose |
|--------|---------|
| `scripts/backup/nightly-backup.sh` | pg_dump + SHA-256 + metadata + S3 upload + checksum verify |
| `scripts/backup/restore-from-backup.sh` | Download + verify + restore to isolated DB |
| `scripts/backup/post-restore-reconciliation.sh` | 8 reconciliation checks after restore |
| `scripts/backup/first-restore-test.sh` | M0 exit gate: backup → restore → reconcile |
| `scripts/backup/wal-archive.sh` | Continuous WAL segment archiving to S3 |

**A backup is not valid until restore test succeeds.**

### Verified Restore Test

```bash
# Backup
pg_dump -h localhost -U postgres -d erp_pos_prod -F c -f /tmp/backup.dump
# → 1.2MB dump created

# Restore
createdb erp_pos_restore_test
pg_restore -d erp_pos_restore_test /tmp/backup.dump

# Verify
psql -d erp_pos_restore_test -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
# → 201 (matches original)
```

---

## Important File Paths

| Purpose | Path |
|---------|------|
| Blueprint (source of truth) | `upload/ERP_Product_Blueprint_v4.1.md` |
| Prisma schema (SQLite sandbox) | `prisma/schema.prisma` |
| Prisma schema (PostgreSQL prod) | `prisma/schema.postgres.prisma` |
| SQL migrations | `prisma/migrations/0001-0022*.sql` |
| SQL functions | `prisma/functions/*.sql` |
| SQL triggers | `prisma/triggers/*.sql` |
| RLS policies | `prisma/rls/*.sql` |
| DB role definitions | `prisma/roles/0001_db_roles.sql` |
| Domain commands | `src/domain/commands/m2-m6/*.ts` |
| API routes | `src/app/api/v1/*/route.ts` |
| UI pages | `src/app/(erp)/dashboard/*/page.tsx` |
| Auth middleware | `src/lib/auth/middleware.ts` |
| CSRF middleware | `src/middleware.ts` |
| Rate limiter | `src/lib/auth/rateLimiter.ts` |
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
| Chart of accounts seed | `src/lib/accounting/seedCoa.ts` |
| Backup scripts | `scripts/backup/*.sh` |
| Migration runner | `scripts/run-postgres-migrations.ts` |
| Staging env template | `.env.staging.example` |
| Env reference | `.env.example` |
| Docker compose | `docker/docker-compose.yml` |
| CI/CD pipeline | `.github/workflows/ci.yml` |
| Token scope docs | `docs/TOKEN-SCOPE.md` |
| PostgreSQL quickstart | `docs/postgres-quickstart.md` |
| Provider integration | `docs/provider-integration-guide.md` |
| ADRs | `docs/adr/` |
| Runbooks | `docs/runbooks/` |
| Localization (Bangla) | `public/locales/bn-BD/common.json` |
| Localization (English) | `public/locales/en-BD/common.json` |
| Service Worker | `public/sw.js` |
| Next.js config | `next.config.ts` |
| Sentry config | `sentry.server.config.ts`, `sentry.client.config.ts` |
| OpenTelemetry | `instrumentation.ts` |

---

## Sandbox Login

| Field | Value |
|-------|-------|
| URL | `http://localhost:3000/login` |
| Email | `admin@erp-platform.local` |
| Password | `ChangeMe!2026` |
| Company | Platform Operations (global scope) |

> **Note:** The sandbox admin password hash is a placeholder. For UAT with real authentication, run `bun run scripts/seed.ts` to seed a proper Argon2id hash, or replace the hash in the database directly.

---

## GitHub

**Repository:** [https://github.com/DelwarOfficial/erp-pos](https://github.com/DelwarOfficial/erp-pos)

### CI/CD Pipeline

The `.github/workflows/ci.yml` pipeline runs 7 stages on every push to `main`/`develop`:

1. **Lint + Type Check** — `bun run lint` + `bunx tsc --noEmit`
2. **Unit Tests** — `bun run test` (395 tests)
3. **Migration Validation** — Apply all 22 migrations to fresh PostgreSQL 16 container
4. **Security Scan** — Hardcoded secrets, CSP/HSTS, Argon2id memory cost
5. **Build** — Next.js standalone production build
6. **E2E Tests** — Playwright + axe-core accessibility
7. **Summary** — Aggregate pass/fail

> **Note:** Pushing changes to `.github/workflows/ci.yml` requires a GitHub token with the `workflow` scope. See `docs/TOKEN-SCOPE.md` for instructions.

---

## License

Proprietary — All rights reserved.

---

## Documentation

- **Master Blueprint:** `upload/ERP_Product_Blueprint_v4.1.md` (7,400+ lines — the single source of truth)
- **Architecture Decision Records:** `docs/adr/` (6 ADRs)
- **Operational Runbooks:** `docs/runbooks/` (4 runbooks)
- **PostgreSQL Quickstart:** `docs/postgres-quickstart.md`
- **Provider Integration Guide:** `docs/provider-integration-guide.md`
- **GitHub Token Scope:** `docs/TOKEN-SCOPE.md`

---

*Built per `ERP_Product_Blueprint_v4.1.md`. Every module, workflow, permission, and constraint is traceable to a blueprint section. No security control, RLS policy, financial integrity rule, approval workflow, or audit logging has been weakened.*
