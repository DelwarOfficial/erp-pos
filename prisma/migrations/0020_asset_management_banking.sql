-- prisma/migrations/0020_asset_management_banking.sql
-- AM-BR: Fixed Asset Management + Banking Reconciliation tables.
--
-- Tables:
--   fixed_assets                 — capitalised asset register
--   fixed_asset_categories       — depreciation default templates
--   fixed_asset_depreciation     — per-period depreciation run log
--   bank_reconciliations         — reconciliation header (statement vs system)
--   bank_reconciliation_lines    — system + statement line items with match status
--
-- All tenant tables get RLS (app_is_global OR company_id = app_company_id).
-- Grants: app_role full DML, backup_role + reporting_role SELECT.

BEGIN;

-- ============================================================================
-- fixed_asset_categories
-- ============================================================================
CREATE TABLE IF NOT EXISTS fixed_asset_categories (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  name VARCHAR NOT NULL,
  code VARCHAR NOT NULL,
  default_life_months INTEGER NOT NULL,
  default_method VARCHAR DEFAULT 'straight_line' NOT NULL,
  asset_account_id UUID NOT NULL,
  accum_dep_account_id UUID NOT NULL,
  dep_expense_account_id UUID NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  CONSTRAINT fk_fixed_asset_categories_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT uq_fixed_asset_categories_company_code UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_fixed_asset_categories_company_id ON fixed_asset_categories(company_id);

-- ============================================================================
-- fixed_assets
-- ============================================================================
CREATE TABLE IF NOT EXISTS fixed_assets (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  asset_code VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  description VARCHAR,
  category_id UUID,
  branch_id UUID,
  location VARCHAR,
  serial_number VARCHAR,
  purchase_date TIMESTAMPTZ NOT NULL,
  purchase_cost DECIMAL(18,2) NOT NULL,
  salvage_value DECIMAL(18,2) DEFAULT 0 NOT NULL,
  useful_life_months INTEGER NOT NULL,
  depreciation_method VARCHAR DEFAULT 'straight_line' NOT NULL,
  depreciation_rate DECIMAL(10,4) DEFAULT 0,
  accumulated_depreciation DECIMAL(18,2) DEFAULT 0 NOT NULL,
  net_book_value DECIMAL(18,2) NOT NULL,
  status VARCHAR DEFAULT 'active' NOT NULL,
  asset_account_id UUID NOT NULL,
  accum_dep_account_id UUID NOT NULL,
  dep_expense_account_id UUID NOT NULL,
  gain_loss_account_id UUID,
  disposed_at TIMESTAMPTZ,
  disposal_amount DECIMAL(18,2),
  disposal_method VARCHAR,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_fixed_assets_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_fixed_assets_category_id FOREIGN KEY (category_id) REFERENCES fixed_asset_categories(id),
  CONSTRAINT fk_fixed_assets_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT uq_fixed_assets_company_code UNIQUE (company_id, asset_code),
  CONSTRAINT fixed_assets_useful_life_chk CHECK (useful_life_months > 0),
  CONSTRAINT fixed_assets_nbv_nonneg_chk CHECK (net_book_value >= 0)
);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_company_id ON fixed_assets(company_id);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_status ON fixed_assets(status);

-- ============================================================================
-- fixed_asset_depreciation
-- ============================================================================
CREATE TABLE IF NOT EXISTS fixed_asset_depreciation (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  fixed_asset_id UUID NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  depreciation_amount DECIMAL(18,2) NOT NULL,
  accumulated_after DECIMAL(18,2) NOT NULL,
  net_book_value_after DECIMAL(18,2) NOT NULL,
  journal_entry_id UUID,
  event_id UUID NOT NULL,
  posted_at TIMESTAMPTZ NOT NULL,
  posted_by UUID NOT NULL,
  CONSTRAINT fk_fixed_asset_dep_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_fixed_asset_dep_asset_id FOREIGN KEY (fixed_asset_id) REFERENCES fixed_assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fixed_asset_dep_company_id ON fixed_asset_depreciation(company_id);
CREATE INDEX IF NOT EXISTS idx_fixed_asset_dep_asset_id ON fixed_asset_depreciation(fixed_asset_id);
CREATE INDEX IF NOT EXISTS idx_fixed_asset_dep_period_end ON fixed_asset_depreciation(period_end);

-- fixed_asset_depreciation is append-only (immutable after insert)
DROP TRIGGER IF EXISTS trg_fixed_asset_dep_immutable ON fixed_asset_depreciation;
CREATE TRIGGER trg_fixed_asset_dep_immutable
  BEFORE UPDATE OR DELETE ON fixed_asset_depreciation
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();

-- ============================================================================
-- bank_reconciliations
-- ============================================================================
CREATE TABLE IF NOT EXISTS bank_reconciliations (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  financial_account_id UUID NOT NULL,
  statement_date TIMESTAMPTZ NOT NULL,
  statement_opening_balance DECIMAL(18,2) NOT NULL,
  statement_closing_balance DECIMAL(18,2) NOT NULL,
  system_opening_balance DECIMAL(18,2) NOT NULL,
  system_closing_balance DECIMAL(18,2) NOT NULL,
  status VARCHAR DEFAULT 'draft' NOT NULL,
  matched_transactions INTEGER DEFAULT 0 NOT NULL,
  unmatched_system INTEGER DEFAULT 0 NOT NULL,
  unmatched_statement INTEGER DEFAULT 0 NOT NULL,
  variance DECIMAL(18,2) DEFAULT 0 NOT NULL,
  journal_entry_id UUID,
  reconciled_by UUID,
  reconciled_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_bank_rec_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bank_rec_financial_account_id FOREIGN KEY (financial_account_id) REFERENCES financial_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_company_id ON bank_reconciliations(company_id);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_financial_account_id ON bank_reconciliations(financial_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_status ON bank_reconciliations(status);

-- ============================================================================
-- bank_reconciliation_lines
-- ============================================================================
CREATE TABLE IF NOT EXISTS bank_reconciliation_lines (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  reconciliation_id UUID NOT NULL,
  line_type VARCHAR NOT NULL,
  transaction_date TIMESTAMPTZ NOT NULL,
  description VARCHAR NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  reference_no VARCHAR,
  payment_id UUID,
  matched_line_id UUID,
  match_status VARCHAR DEFAULT 'unmatched' NOT NULL,
  match_method VARCHAR,
  matched_by UUID,
  matched_at TIMESTAMPTZ,
  CONSTRAINT fk_bank_rec_lines_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bank_rec_lines_reconciliation_id FOREIGN KEY (reconciliation_id) REFERENCES bank_reconciliations(id) ON DELETE CASCADE,
  CONSTRAINT fk_bank_rec_lines_payment_id FOREIGN KEY (payment_id) REFERENCES payments(id)
);

CREATE INDEX IF NOT EXISTS idx_bank_rec_lines_company_id ON bank_reconciliation_lines(company_id);
CREATE INDEX IF NOT EXISTS idx_bank_rec_lines_reconciliation_id ON bank_reconciliation_lines(reconciliation_id);
CREATE INDEX IF NOT EXISTS idx_bank_rec_lines_match_status ON bank_reconciliation_lines(match_status);

-- ============================================================================
-- ROW LEVEL SECURITY (same pattern as 0017)
-- ============================================================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'fixed_asset_categories',
    'fixed_assets',
    'fixed_asset_depreciation',
    'bank_reconciliations',
    'bank_reconciliation_lines'
  ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);

    EXECUTE format(
      'DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = ''%s_tenant_read'' AND tablename = ''%s'') THEN EXECUTE ''CREATE POLICY %s_tenant_read ON %s FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());''; END IF; END $$;',
      tbl, tbl, tbl, tbl
    );
    EXECUTE format(
      'DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = ''%s_tenant_write'' AND tablename = ''%s'') THEN EXECUTE ''CREATE POLICY %s_tenant_write ON %s FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());''; END IF; END $$;',
      tbl, tbl, tbl, tbl
    );

    -- app_role: full DML (subject to RLS)
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_role;', tbl);
    -- backup_role + reporting_role: SELECT
    EXECUTE format('GRANT SELECT ON %I TO backup_role;', tbl);
    EXECUTE format('GRANT SELECT ON %I TO reporting_role;', tbl);
  END LOOP;
END $$;

COMMIT;
