-- prisma/migrations/0002_organization_currency.sql
-- §5.1 Organization and Currency
-- Forward-only. Run via migration_role (BYPASSRLS).

BEGIN;

-- ============================================================================
-- currencies (global reference, NOT tenant-scoped)
-- ============================================================================
CREATE TABLE currencies (
  code            CHAR(3)      PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  decimal_places  SMALLINT     NOT NULL DEFAULT 2 CHECK (decimal_places BETWEEN 0 AND 6),
  is_active       BOOLEAN      NOT NULL DEFAULT true
);

-- ============================================================================
-- companies (tenant root)
-- ============================================================================
CREATE TABLE companies (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name               VARCHAR(200) NOT NULL,
  display_name             VARCHAR(200) NOT NULL,
  code                     VARCHAR(30)  NOT NULL UNIQUE,
  base_currency_code       CHAR(3)      NOT NULL REFERENCES currencies(code),
  timezone                 VARCHAR(64)  NOT NULL DEFAULT 'Asia/Dhaka',
  country_code             CHAR(2)      NOT NULL DEFAULT 'BD',
  bin                      VARCHAR(30)  UNIQUE,
  tin                      VARCHAR(30)  UNIQUE,
  vat_registered           BOOLEAN      NOT NULL DEFAULT false,
  status                   VARCHAR(20)  NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','suspended','closed')),
  default_locale           VARCHAR(20)  NOT NULL DEFAULT 'bn-BD',
  date_format              VARCHAR(30)  NOT NULL DEFAULT 'dd MMM yyyy',
  fiscal_year_start_month  SMALLINT     NOT NULL DEFAULT 7 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_companies_status ON companies(status);

-- ============================================================================
-- branches
-- ============================================================================
CREATE TABLE branches (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name         VARCHAR(200) NOT NULL,
  code         VARCHAR(20)  NOT NULL,
  phone        VARCHAR(30),
  email        VARCHAR(150),
  address      TEXT,
  bin_override VARCHAR(30),
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(company_id, code)
);
CREATE INDEX idx_branches_company_active ON branches(company_id, is_active);

-- ============================================================================
-- warehouses
-- ============================================================================
CREATE TABLE warehouses (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id      UUID         NOT NULL REFERENCES branches(id),
  name           VARCHAR(200) NOT NULL,
  code           VARCHAR(30)  NOT NULL,
  warehouse_type VARCHAR(20)  NOT NULL DEFAULT 'retail'
                 CHECK (warehouse_type IN ('retail','central','repair','damaged','transit')),
  is_active      BOOLEAN      NOT NULL DEFAULT true,
  UNIQUE(company_id, code),
  UNIQUE(company_id, branch_id, name)
);
CREATE INDEX idx_warehouses_company ON warehouses(company_id);
CREATE INDEX idx_warehouses_branch  ON warehouses(branch_id);
CREATE INDEX idx_warehouses_type    ON warehouses(warehouse_type);

-- ============================================================================
-- exchange_rates
-- ============================================================================
CREATE TABLE exchange_rates (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  currency_code CHAR(3)      NOT NULL REFERENCES currencies(code),
  rate_date     DATE         NOT NULL,
  rate_to_base  DECIMAL(18,6) NOT NULL CHECK (rate_to_base > 0),
  source        VARCHAR(100) NOT NULL,
  approved_by   UUID,  -- FK to users added in 0003_identity.sql (forward ref)
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(company_id, currency_code, rate_date)
);
CREATE INDEX idx_exchange_rates_company  ON exchange_rates(company_id);
CREATE INDEX idx_exchange_rates_currency ON exchange_rates(currency_code);

-- Add FK to users once that table exists (deferred)
-- ALTER TABLE exchange_rates ADD CONSTRAINT fk_exchange_rates_approved_by
--   FOREIGN KEY (approved_by) REFERENCES users(id);

-- ============================================================================
-- company_domains
-- ============================================================================
CREATE TABLE company_domains (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  hostname              VARCHAR(253) NOT NULL,
  domain_type           VARCHAR(20)  NOT NULL DEFAULT 'platform_subdomain'
                        CHECK (domain_type IN ('platform_subdomain','custom')),
  verification_token_hash VARCHAR(255),
  verified_at           TIMESTAMPTZ,
  tls_status            VARCHAR(20)  NOT NULL DEFAULT 'pending'
                        CHECK (tls_status IN ('pending','active','error')),
  is_primary            BOOLEAN      NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- UNIQUE on lower(hostname) — Postgres doesn't allow UNIQUE(expression) inline,
-- so use a unique index on the expression.
CREATE UNIQUE INDEX idx_company_domains_hostname_lower
  ON company_domains (LOWER(hostname));
CREATE INDEX idx_company_domains_company    ON company_domains(company_id);
CREATE INDEX idx_company_domains_type       ON company_domains(domain_type);
CREATE INDEX idx_company_domains_tls_status ON company_domains(tls_status);
CREATE INDEX idx_company_domains_is_primary ON company_domains(is_primary);

-- Partial unique: exactly one active primary domain per company
CREATE UNIQUE INDEX idx_company_domains_primary_active
  ON company_domains(company_id)
  WHERE is_primary = true AND tls_status = 'active';

COMMIT;
