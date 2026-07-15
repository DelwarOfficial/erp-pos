-- prisma/migrations/0013_m4_accounting_tables.sql
-- §5.10 Chart of Accounts / Financial Accounts
-- §5.12 Fiscal Periods / Journal Lines / Expenses / Account Transfers / Withholding
--
-- journal_entries is partitioned (created in 0008); FKs to it are skipped
-- and enforced at the application layer (post_journal_entry SECURITY DEFINER fn).

BEGIN;


-- ============================================================================
-- TABLES (12 tables)
-- ============================================================================

-- ============================================================================
-- chart_of_accounts
-- ============================================================================
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  code VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  account_class VARCHAR DEFAULT 'asset' NOT NULL CHECK (account_class IN ('asset','liability','equity','revenue','expense')),
  account_subtype VARCHAR NOT NULL,
  parent_id UUID,
  normal_balance VARCHAR DEFAULT 'D' NOT NULL CHECK (normal_balance IN ('D','C')),
  allow_manual_posting BOOLEAN DEFAULT false NOT NULL,
  is_control_account BOOLEAN DEFAULT false NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  CONSTRAINT fk_chart_of_accounts_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_chart_of_accounts_parent_id FOREIGN KEY (parent_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT uq_chart_of_accounts_company_id_code UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_company_id ON chart_of_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_account_class ON chart_of_accounts(account_class);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_account_subtype ON chart_of_accounts(account_subtype);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_parent_id ON chart_of_accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_is_control_account ON chart_of_accounts(is_control_account);

-- ============================================================================
-- financial_accounts
-- ============================================================================
CREATE TABLE IF NOT EXISTS financial_accounts (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID,
  chart_of_account_id UUID NOT NULL,
  name VARCHAR NOT NULL,
  account_type VARCHAR DEFAULT 'cash' NOT NULL CHECK (account_type IN ('cash','bank','mobile_wallet','clearing')),
  currency_code CHAR(3) DEFAULT 'BDT' NOT NULL,
  account_number_masked VARCHAR,
  account_number_encrypted BYTEA,
  account_number_key_version INTEGER DEFAULT 1 NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  CONSTRAINT fk_financial_accounts_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_financial_accounts_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_financial_accounts_chart_of_account_id FOREIGN KEY (chart_of_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_financial_accounts_currency_code FOREIGN KEY (currency_code) REFERENCES currencies(code) ON DELETE RESTRICT,
  CONSTRAINT uq_financial_accounts_company_id_chart_of_account_id UNIQUE (company_id, chart_of_account_id)
);

CREATE INDEX IF NOT EXISTS idx_financial_accounts_company_id ON financial_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_financial_accounts_branch_id ON financial_accounts(branch_id);
CREATE INDEX IF NOT EXISTS idx_financial_accounts_account_type ON financial_accounts(account_type);

-- Split partial unique indexes on financial_accounts.name per §5.10
-- Either branch-scoped OR company-wide; both cannot share the same name.
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_accounts_name_company
  ON financial_accounts(company_id, name) WHERE branch_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_accounts_name_branch
  ON financial_accounts(company_id, branch_id, name) WHERE branch_id IS NOT NULL;

-- ============================================================================
-- fiscal_periods
-- ============================================================================
CREATE TABLE IF NOT EXISTS fiscal_periods (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  period_name VARCHAR NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status VARCHAR DEFAULT 'open' NOT NULL CHECK (status IN ('open','soft_locked','locked')),
  locked_by UUID,
  locked_at TIMESTAMPTZ,
  CONSTRAINT fk_fiscal_periods_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_fiscal_periods_locked_by FOREIGN KEY (locked_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_fiscal_periods_company_id_period_name UNIQUE (company_id, period_name)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_periods_company_id ON fiscal_periods(company_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_periods_status ON fiscal_periods(status);
CREATE INDEX IF NOT EXISTS idx_fiscal_periods_period_start ON fiscal_periods(period_start);
CREATE INDEX IF NOT EXISTS idx_fiscal_periods_period_end ON fiscal_periods(period_end);

-- EXCLUDE constraint: prevent overlapping fiscal periods (§5.12)
-- Requires btree_gist extension (created in 0001)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_periods_no_overlap' AND conrelid = 'fiscal_periods'::regclass) THEN
    ALTER TABLE fiscal_periods ADD CONSTRAINT fiscal_periods_no_overlap EXCLUDE USING gist (company_id WITH =, period_start WITH <>, period_end WITH <>)
  WHERE (status <> 'cancelled');
  END IF;
END $$;

-- CHECK: period_end >= period_start
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_periods_period_order_chk' AND conrelid = 'fiscal_periods'::regclass) THEN
    ALTER TABLE fiscal_periods ADD CONSTRAINT fiscal_periods_period_order_chk CHECK (period_end >= period_start);
  END IF;
END $$;

-- ============================================================================
-- journal_lines
-- ============================================================================
-- NOTE: FK to partitioned table journal_entries(id) on column 'journal_entry_id' is enforced at the application layer.
CREATE TABLE IF NOT EXISTS journal_lines (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  journal_entry_id UUID NOT NULL,
  line_no INTEGER NOT NULL,
  branch_id UUID,
  chart_of_account_id UUID NOT NULL,
  financial_account_id UUID,
  customer_id UUID,
  supplier_id UUID,
  product_id UUID,
  debit_base DECIMAL(18,2) DEFAULT 0 NOT NULL,
  credit_base DECIMAL(18,2) DEFAULT 0 NOT NULL,
  amount_currency DECIMAL(18,2),
  currency_code CHAR(3),
  memo VARCHAR,
  CONSTRAINT fk_journal_lines_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_lines_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_lines_chart_of_account_id FOREIGN KEY (chart_of_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_lines_financial_account_id FOREIGN KEY (financial_account_id) REFERENCES financial_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_lines_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_lines_supplier_id FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_lines_product_id FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_lines_currency_code FOREIGN KEY (currency_code) REFERENCES currencies(code) ON DELETE RESTRICT,
  CONSTRAINT uq_journal_lines_journal_entry_id_line_no UNIQUE (journal_entry_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_company_id ON journal_lines(company_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_journal_entry_id ON journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_branch_id ON journal_lines(branch_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_chart_of_account_id ON journal_lines(chart_of_account_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_financial_account_id ON journal_lines(financial_account_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_customer_id ON journal_lines(customer_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_supplier_id ON journal_lines(supplier_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_product_id ON journal_lines(product_id);

-- ============================================================================
-- accounting_policies
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounting_policies (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  inventory_account_id UUID NOT NULL,
  cogs_account_id UUID NOT NULL,
  sales_revenue_account_id UUID NOT NULL,
  ar_account_id UUID NOT NULL,
  ap_account_id UUID NOT NULL,
  customer_advance_account_id UUID NOT NULL,
  supplier_advance_account_id UUID NOT NULL,
  purchase_variance_account_id UUID NOT NULL,
  gift_card_liability_account_id UUID NOT NULL,
  reward_expense_account_id UUID,
  branch_clearing_account_id UUID,
  inventory_damage_account_id UUID,
  inventory_write_off_account_id UUID,
  exchange_gain_loss_account_id UUID,
  courier_clearing_account_id UUID,
  service_cogs_account_id UUID,
  repair_wip_account_id UUID,
  cheque_clearing_account_id UUID,
  rounding_account_id UUID,
  grni_account_id UUID,
  opening_balance_equity_account_id UUID,
  impairment_allowance_account_id UUID,
  cheque_bounce_fee_account_id UUID,
  CONSTRAINT fk_accounting_policies_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_accounting_policies_inventory_account_id FOREIGN KEY (inventory_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_accounting_policies_cogs_account_id FOREIGN KEY (cogs_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_accounting_policies_sales_revenue_account_id FOREIGN KEY (sales_revenue_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_accounting_policies_ar_account_id FOREIGN KEY (ar_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_accounting_policies_ap_account_id FOREIGN KEY (ap_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_accounting_policies_customer_advance_account_id FOREIGN KEY (customer_advance_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_accounting_policies_supplier_advance_account_id FOREIGN KEY (supplier_advance_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_accounting_policies_purchase_variance_account_id FOREIGN KEY (purchase_variance_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_accounting_policies_gift_card_liability_account_id FOREIGN KEY (gift_card_liability_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT uq_accounting_policies_company_id UNIQUE (company_id)
);


-- ============================================================================
-- expense_categories
-- ============================================================================
CREATE TABLE IF NOT EXISTS expense_categories (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  name VARCHAR NOT NULL,
  expense_account_id UUID NOT NULL,
  requires_approval BOOLEAN DEFAULT true NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  CONSTRAINT fk_expense_categories_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_expense_categories_expense_account_id FOREIGN KEY (expense_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT uq_expense_categories_company_id_name UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_company_id ON expense_categories(company_id);

-- ============================================================================
-- expenses
-- ============================================================================
-- NOTE: FK to partitioned table journal_entries(id) on column 'journal_entry_id' is enforced at the application layer.
CREATE TABLE IF NOT EXISTS expenses (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  reference_no VARCHAR NOT NULL,
  client_txn_id UUID NOT NULL,
  supplier_id UUID,
  payee_name VARCHAR,
  status VARCHAR DEFAULT 'draft' NOT NULL CHECK (status IN ('draft','pending_approval','approved','posted','rejected','voided')),
  expense_date TIMESTAMPTZ NOT NULL,
  currency_code CHAR(3) DEFAULT 'BDT' NOT NULL,
  exchange_rate DECIMAL(18,6) DEFAULT 1 NOT NULL,
  subtotal DECIMAL(18,2) DEFAULT 0 NOT NULL,
  tax_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  grand_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  base_grand_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  description VARCHAR NOT NULL,
  requested_by UUID NOT NULL,
  approved_by UUID,
  approval_request_id UUID,
  journal_entry_id UUID,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_expenses_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_expenses_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_expenses_supplier_id FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_expenses_currency_code FOREIGN KEY (currency_code) REFERENCES currencies(code) ON DELETE RESTRICT,
  CONSTRAINT fk_expenses_requested_by FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_expenses_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_expenses_company_id_reference_no UNIQUE (company_id, reference_no),
  CONSTRAINT uq_expenses_company_id_client_txn_id UNIQUE (company_id, client_txn_id)
);

CREATE INDEX IF NOT EXISTS idx_expenses_company_id ON expenses(company_id);
CREATE INDEX IF NOT EXISTS idx_expenses_branch_id ON expenses(branch_id);
CREATE INDEX IF NOT EXISTS idx_expenses_supplier_id ON expenses(supplier_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date);

-- CHECK: amounts non-negative (§5.12)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_totals_nonnegative_chk' AND conrelid = 'expenses'::regclass) THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_totals_nonnegative_chk CHECK (subtotal >= 0 AND tax_total >= 0 AND grand_total >= 0);
  END IF;
END $$;

-- ============================================================================
-- expense_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS expense_items (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  expense_id UUID NOT NULL,
  line_no INTEGER NOT NULL,
  expense_category_id UUID NOT NULL,
  description VARCHAR NOT NULL,
  amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  tax_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  base_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  CONSTRAINT fk_expense_items_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_expense_items_expense_id FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_expense_items_expense_category_id FOREIGN KEY (expense_category_id) REFERENCES expense_categories(id) ON DELETE RESTRICT,
  CONSTRAINT uq_expense_items_expense_id_line_no UNIQUE (expense_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_expense_items_company_id ON expense_items(company_id);
CREATE INDEX IF NOT EXISTS idx_expense_items_expense_id ON expense_items(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_items_expense_category_id ON expense_items(expense_category_id);

-- ============================================================================
-- expense_item_taxes
-- ============================================================================
CREATE TABLE IF NOT EXISTS expense_item_taxes (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  expense_item_id UUID NOT NULL,
  tax_component_id UUID NOT NULL,
  component_code_snapshot VARCHAR NOT NULL,
  rate_snapshot DECIMAL(18,6) NOT NULL,
  taxable_base DECIMAL(18,2) NOT NULL,
  tax_amount DECIMAL(18,2) NOT NULL,
  recoverable_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  CONSTRAINT fk_expense_item_taxes_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_expense_item_taxes_expense_item_id FOREIGN KEY (expense_item_id) REFERENCES expense_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_expense_item_taxes_tax_component_id FOREIGN KEY (tax_component_id) REFERENCES tax_components(id) ON DELETE RESTRICT,
  CONSTRAINT uq_expense_item_taxes_expense_item_id_tax_component_id UNIQUE (expense_item_id, tax_component_id)
);

CREATE INDEX IF NOT EXISTS idx_expense_item_taxes_company_id ON expense_item_taxes(company_id);
CREATE INDEX IF NOT EXISTS idx_expense_item_taxes_expense_item_id ON expense_item_taxes(expense_item_id);

-- ============================================================================
-- expense_attachments
-- ============================================================================
CREATE TABLE IF NOT EXISTS expense_attachments (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  expense_id UUID NOT NULL,
  object_key VARCHAR NOT NULL,
  file_name VARCHAR NOT NULL,
  mime_type VARCHAR NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 VARCHAR NOT NULL,
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_expense_attachments_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_expense_attachments_expense_id FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_expense_attachments_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_expense_attachments_company_id_object_key UNIQUE (company_id, object_key)
);

CREATE INDEX IF NOT EXISTS idx_expense_attachments_company_id ON expense_attachments(company_id);
CREATE INDEX IF NOT EXISTS idx_expense_attachments_expense_id ON expense_attachments(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_attachments_sha256 ON expense_attachments(sha256);

-- ============================================================================
-- account_transfers
-- ============================================================================
-- NOTE: FK to partitioned table journal_entries(id) on column 'journal_entry_id' is enforced at the application layer.
CREATE TABLE IF NOT EXISTS account_transfers (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  reference_no VARCHAR NOT NULL,
  client_txn_id UUID NOT NULL,
  from_financial_account_id UUID NOT NULL,
  to_financial_account_id UUID NOT NULL,
  from_currency_code CHAR(3) NOT NULL,
  to_currency_code CHAR(3) NOT NULL,
  from_amount DECIMAL(18,2) NOT NULL,
  to_amount DECIMAL(18,2) NOT NULL,
  exchange_rate DECIMAL(18,6) DEFAULT 1 NOT NULL,
  transfer_fee DECIMAL(18,2) DEFAULT 0 NOT NULL,
  status VARCHAR DEFAULT 'draft' NOT NULL CHECK (status IN ('draft','approved','posted','reversed','cancelled')),
  business_date TIMESTAMPTZ NOT NULL,
  journal_entry_id UUID,
  approval_request_id UUID,
  reversal_of_id UUID,
  notes VARCHAR,
  created_by UUID NOT NULL,
  approved_by UUID,
  posted_at TIMESTAMPTZ,
  CONSTRAINT fk_account_transfers_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_account_transfers_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_account_transfers_from_financial_account_id FOREIGN KEY (from_financial_account_id) REFERENCES financial_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_account_transfers_to_financial_account_id FOREIGN KEY (to_financial_account_id) REFERENCES financial_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_account_transfers_from_currency_code FOREIGN KEY (from_currency_code) REFERENCES currencies(code) ON DELETE RESTRICT,
  CONSTRAINT fk_account_transfers_to_currency_code FOREIGN KEY (to_currency_code) REFERENCES currencies(code) ON DELETE RESTRICT,
  CONSTRAINT fk_account_transfers_reversal_of_id FOREIGN KEY (reversal_of_id) REFERENCES account_transfers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_account_transfers_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_account_transfers_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_account_transfers_company_id_reference_no UNIQUE (company_id, reference_no),
  CONSTRAINT uq_account_transfers_company_id_client_txn_id UNIQUE (company_id, client_txn_id)
);

CREATE INDEX IF NOT EXISTS idx_account_transfers_company_id ON account_transfers(company_id);
CREATE INDEX IF NOT EXISTS idx_account_transfers_status ON account_transfers(status);
CREATE INDEX IF NOT EXISTS idx_account_transfers_business_date ON account_transfers(business_date);

-- ============================================================================
-- withholding_transactions
-- ============================================================================
-- NOTE: FK to partitioned table payments(id) on column 'payment_id' is enforced at the application layer.
CREATE TABLE IF NOT EXISTS withholding_transactions (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  payment_id UUID NOT NULL,
  withholding_rule_id UUID NOT NULL,
  supplier_id UUID,
  customer_id UUID,
  taxable_base DECIMAL(18,2) NOT NULL,
  rate_snapshot DECIMAL(18,6) NOT NULL,
  withheld_amount DECIMAL(18,2) NOT NULL,
  certificate_no VARCHAR,
  remittance_status VARCHAR DEFAULT 'pending' NOT NULL CHECK (remittance_status IN ('pending','remitted','reversed')),
  remitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_withholding_transactions_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_withholding_transactions_withholding_rule_id FOREIGN KEY (withholding_rule_id) REFERENCES withholding_rules(id) ON DELETE RESTRICT,
  CONSTRAINT fk_withholding_transactions_supplier_id FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_withholding_transactions_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_withholding_transactions_company_id ON withholding_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_withholding_transactions_payment_id ON withholding_transactions(payment_id);
CREATE INDEX IF NOT EXISTS idx_withholding_transactions_withholding_rule_id ON withholding_transactions(withholding_rule_id);
CREATE INDEX IF NOT EXISTS idx_withholding_transactions_remittance_status ON withholding_transactions(remittance_status);


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- RLS for chart_of_accounts
ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'chart_of_accounts_tenant_read' AND tablename = 'chart_of_accounts') THEN
    EXECUTE 'CREATE POLICY chart_of_accounts_tenant_read ON chart_of_accounts FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'chart_of_accounts_tenant_write' AND tablename = 'chart_of_accounts') THEN
    EXECUTE 'CREATE POLICY chart_of_accounts_tenant_write ON chart_of_accounts FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON chart_of_accounts TO app_role;
GRANT SELECT ON chart_of_accounts TO backup_role;
GRANT SELECT ON chart_of_accounts TO reporting_role;

-- RLS for financial_accounts
ALTER TABLE financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_accounts FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'financial_accounts_tenant_read' AND tablename = 'financial_accounts') THEN
    EXECUTE 'CREATE POLICY financial_accounts_tenant_read ON financial_accounts FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'financial_accounts_tenant_write' AND tablename = 'financial_accounts') THEN
    EXECUTE 'CREATE POLICY financial_accounts_tenant_write ON financial_accounts FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON financial_accounts TO app_role;
GRANT SELECT ON financial_accounts TO backup_role;
GRANT SELECT ON financial_accounts TO reporting_role;

-- RLS for fiscal_periods
ALTER TABLE fiscal_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_periods FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fiscal_periods_tenant_read' AND tablename = 'fiscal_periods') THEN
    EXECUTE 'CREATE POLICY fiscal_periods_tenant_read ON fiscal_periods FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fiscal_periods_tenant_write' AND tablename = 'fiscal_periods') THEN
    EXECUTE 'CREATE POLICY fiscal_periods_tenant_write ON fiscal_periods FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON fiscal_periods TO app_role;
GRANT SELECT ON fiscal_periods TO backup_role;
GRANT SELECT ON fiscal_periods TO reporting_role;

-- RLS for journal_lines
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'journal_lines_tenant_read' AND tablename = 'journal_lines') THEN
    EXECUTE 'CREATE POLICY journal_lines_tenant_read ON journal_lines FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'journal_lines_tenant_write' AND tablename = 'journal_lines') THEN
    EXECUTE 'CREATE POLICY journal_lines_tenant_write ON journal_lines FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON journal_lines TO app_role;
GRANT SELECT ON journal_lines TO backup_role;
GRANT SELECT ON journal_lines TO reporting_role;

-- RLS for accounting_policies
ALTER TABLE accounting_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_policies FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'accounting_policies_tenant_read' AND tablename = 'accounting_policies') THEN
    EXECUTE 'CREATE POLICY accounting_policies_tenant_read ON accounting_policies FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'accounting_policies_tenant_write' AND tablename = 'accounting_policies') THEN
    EXECUTE 'CREATE POLICY accounting_policies_tenant_write ON accounting_policies FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON accounting_policies TO app_role;
GRANT SELECT ON accounting_policies TO backup_role;
GRANT SELECT ON accounting_policies TO reporting_role;

-- RLS for expense_categories
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'expense_categories_tenant_read' AND tablename = 'expense_categories') THEN
    EXECUTE 'CREATE POLICY expense_categories_tenant_read ON expense_categories FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'expense_categories_tenant_write' AND tablename = 'expense_categories') THEN
    EXECUTE 'CREATE POLICY expense_categories_tenant_write ON expense_categories FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON expense_categories TO app_role;
GRANT SELECT ON expense_categories TO backup_role;
GRANT SELECT ON expense_categories TO reporting_role;

-- RLS for expenses
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'expenses_tenant_read' AND tablename = 'expenses') THEN
    EXECUTE 'CREATE POLICY expenses_tenant_read ON expenses FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'expenses_tenant_write' AND tablename = 'expenses') THEN
    EXECUTE 'CREATE POLICY expenses_tenant_write ON expenses FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON expenses TO app_role;
GRANT SELECT ON expenses TO backup_role;
GRANT SELECT ON expenses TO reporting_role;

-- RLS for expense_items
ALTER TABLE expense_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'expense_items_tenant_read' AND tablename = 'expense_items') THEN
    EXECUTE 'CREATE POLICY expense_items_tenant_read ON expense_items FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'expense_items_tenant_write' AND tablename = 'expense_items') THEN
    EXECUTE 'CREATE POLICY expense_items_tenant_write ON expense_items FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON expense_items TO app_role;
GRANT SELECT ON expense_items TO backup_role;
GRANT SELECT ON expense_items TO reporting_role;

-- RLS for expense_item_taxes
ALTER TABLE expense_item_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_item_taxes FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'expense_item_taxes_tenant_read' AND tablename = 'expense_item_taxes') THEN
    EXECUTE 'CREATE POLICY expense_item_taxes_tenant_read ON expense_item_taxes FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'expense_item_taxes_tenant_write' AND tablename = 'expense_item_taxes') THEN
    EXECUTE 'CREATE POLICY expense_item_taxes_tenant_write ON expense_item_taxes FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON expense_item_taxes TO app_role;
GRANT SELECT ON expense_item_taxes TO backup_role;
GRANT SELECT ON expense_item_taxes TO reporting_role;

-- RLS for expense_attachments
ALTER TABLE expense_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_attachments FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'expense_attachments_tenant_read' AND tablename = 'expense_attachments') THEN
    EXECUTE 'CREATE POLICY expense_attachments_tenant_read ON expense_attachments FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'expense_attachments_tenant_write' AND tablename = 'expense_attachments') THEN
    EXECUTE 'CREATE POLICY expense_attachments_tenant_write ON expense_attachments FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON expense_attachments TO app_role;
GRANT SELECT ON expense_attachments TO backup_role;
GRANT SELECT ON expense_attachments TO reporting_role;

-- RLS for account_transfers
ALTER TABLE account_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_transfers FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'account_transfers_tenant_read' AND tablename = 'account_transfers') THEN
    EXECUTE 'CREATE POLICY account_transfers_tenant_read ON account_transfers FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'account_transfers_tenant_write' AND tablename = 'account_transfers') THEN
    EXECUTE 'CREATE POLICY account_transfers_tenant_write ON account_transfers FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON account_transfers TO app_role;
GRANT SELECT ON account_transfers TO backup_role;
GRANT SELECT ON account_transfers TO reporting_role;

-- RLS for withholding_transactions
ALTER TABLE withholding_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE withholding_transactions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'withholding_transactions_tenant_read' AND tablename = 'withholding_transactions') THEN
    EXECUTE 'CREATE POLICY withholding_transactions_tenant_read ON withholding_transactions FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'withholding_transactions_tenant_write' AND tablename = 'withholding_transactions') THEN
    EXECUTE 'CREATE POLICY withholding_transactions_tenant_write ON withholding_transactions FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON withholding_transactions TO app_role;
GRANT SELECT ON withholding_transactions TO backup_role;
GRANT SELECT ON withholding_transactions TO reporting_role;


-- ============================================================================
-- DEFERRED CROSS-MIGRATION FK ADDITIONS
-- ============================================================================
-- cashier_shifts.cash_account_id -> financial_accounts (forward reference from 0012)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cashier_shifts_cash_account_id') THEN
    ALTER TABLE cashier_shifts
      ADD CONSTRAINT fk_cashier_shifts_cash_account_id
      FOREIGN KEY (cash_account_id) REFERENCES financial_accounts(id) ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;
