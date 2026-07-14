-- prisma/migrations/0012_m3_pos_payments_tables.sql
-- §5.7  POS / Sales / Quotations / Returns
-- §5.11 Payments / Cashiering / Installments / Gift Cards / Coupons / Reward Points
--
-- Adds M3 tables for point-of-sale, payments, refunds, loyalty, and gift cards.
-- payments table is partitioned (created in 0008); FKs to it are skipped
-- and enforced at the application layer.

BEGIN;


-- ============================================================================
-- TABLES (22 tables)
-- ============================================================================

-- ============================================================================
-- cashier_shifts
-- ============================================================================
-- NOTE: FK to financial_accounts(id) on column 'cash_account_id' is added in a later migration (cross-migration forward reference).
CREATE TABLE IF NOT EXISTS cashier_shifts (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  cashier_id UUID NOT NULL,
  cash_account_id UUID NOT NULL,
  status VARCHAR DEFAULT 'open' NOT NULL CHECK (status IN ('open','closing','closed','approved')),
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  opening_float DECIMAL(18,2) DEFAULT 0 NOT NULL,
  expected_closing_cash DECIMAL(18,2),
  counted_closing_cash DECIMAL(18,2),
  variance DECIMAL(18,2),
  variance_reason VARCHAR,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_cashier_shifts_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cashier_shifts_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cashier_shifts_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cashier_shifts_cashier_id FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cashier_shifts_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_cashier_shifts_company_id ON cashier_shifts(company_id);
CREATE INDEX IF NOT EXISTS idx_cashier_shifts_branch_id ON cashier_shifts(branch_id);
CREATE INDEX IF NOT EXISTS idx_cashier_shifts_cashier_id ON cashier_shifts(cashier_id);
CREATE INDEX IF NOT EXISTS idx_cashier_shifts_cash_account_id ON cashier_shifts(cash_account_id);
CREATE INDEX IF NOT EXISTS idx_cashier_shifts_status ON cashier_shifts(status);
CREATE INDEX IF NOT EXISTS idx_cashier_shifts_opened_at ON cashier_shifts(opened_at);
CREATE INDEX IF NOT EXISTS idx_cashier_shifts_closed_at ON cashier_shifts(closed_at);

-- ============================================================================
-- cash_drawer_counts
-- ============================================================================
CREATE TABLE IF NOT EXISTS cash_drawer_counts (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  cashier_shift_id UUID NOT NULL,
  count_type VARCHAR DEFAULT 'opening' NOT NULL CHECK (count_type IN ('opening','spot','closing','recount')),
  counted_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  denomination_detail VARCHAR DEFAULT '{}' NOT NULL,
  counted_by UUID NOT NULL,
  counted_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_cash_drawer_counts_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cash_drawer_counts_cashier_shift_id FOREIGN KEY (cashier_shift_id) REFERENCES cashier_shifts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cash_drawer_counts_counted_by FOREIGN KEY (counted_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_cash_drawer_counts_company_id ON cash_drawer_counts(company_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_counts_cashier_shift_id ON cash_drawer_counts(cashier_shift_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_counts_count_type ON cash_drawer_counts(count_type);

-- ============================================================================
-- quotations
-- ============================================================================
CREATE TABLE IF NOT EXISTS quotations (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  reference_no VARCHAR NOT NULL,
  client_txn_id UUID NOT NULL,
  customer_id UUID,
  customer_name_snapshot VARCHAR,
  currency_code CHAR(3) DEFAULT 'BDT' NOT NULL,
  exchange_rate DECIMAL(18,6) DEFAULT 1 NOT NULL,
  status VARCHAR DEFAULT 'draft' NOT NULL CHECK (status IN ('draft','sent','accepted','rejected','expired','converted')),
  valid_until TIMESTAMPTZ,
  business_date TIMESTAMPTZ NOT NULL,
  subtotal DECIMAL(18,2) DEFAULT 0 NOT NULL,
  discount_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  tax_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  grand_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  notes VARCHAR,
  converted_sale_id UUID,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_quotations_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_quotations_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_quotations_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_quotations_currency_code FOREIGN KEY (currency_code) REFERENCES currencies(code) ON DELETE RESTRICT,
  CONSTRAINT uq_quotations_company_id_reference_no UNIQUE (company_id, reference_no),
  CONSTRAINT uq_quotations_company_id_client_txn_id UNIQUE (company_id, client_txn_id)
);

CREATE INDEX IF NOT EXISTS idx_quotations_company_id ON quotations(company_id);
CREATE INDEX IF NOT EXISTS idx_quotations_branch_id ON quotations(branch_id);
CREATE INDEX IF NOT EXISTS idx_quotations_customer_id ON quotations(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);
CREATE INDEX IF NOT EXISTS idx_quotations_business_date ON quotations(business_date);
CREATE INDEX IF NOT EXISTS idx_quotations_valid_until ON quotations(valid_until);

-- ============================================================================
-- quotation_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS quotation_items (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  quotation_id UUID NOT NULL,
  line_no INTEGER NOT NULL,
  product_id UUID NOT NULL,
  product_name_snapshot VARCHAR NOT NULL,
  product_code_snapshot VARCHAR NOT NULL,
  qty DECIMAL(18,4) NOT NULL,
  unit_price DECIMAL(18,2) NOT NULL,
  discount_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  tax_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  line_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  CONSTRAINT fk_quotation_items_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_quotation_items_quotation_id FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
  CONSTRAINT fk_quotation_items_product_id FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT uq_quotation_items_quotation_id_line_no UNIQUE (quotation_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_quotation_items_company_id ON quotation_items(company_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation_id ON quotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_product_id ON quotation_items(product_id);

-- ============================================================================
-- sales
-- ============================================================================
CREATE TABLE IF NOT EXISTS sales (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  reference_no VARCHAR NOT NULL,
  client_txn_id UUID NOT NULL,
  quotation_id UUID,
  customer_id UUID,
  customer_name_snapshot VARCHAR,
  customer_phone_snapshot VARCHAR,
  biller_id UUID NOT NULL,
  cashier_shift_id UUID,
  sale_status VARCHAR DEFAULT 'completed' NOT NULL CHECK (sale_status IN ('draft','held','completed','voided','partially_returned','returned')),
  currency_code CHAR(3) DEFAULT 'BDT' NOT NULL,
  exchange_rate DECIMAL(18,6) DEFAULT 1 NOT NULL,
  subtotal DECIMAL(18,2) DEFAULT 0 NOT NULL,
  discount_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  tax_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  shipping_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  grand_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  base_grand_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  sale_note VARCHAR,
  business_date TIMESTAMPTZ NOT NULL,
  offline_created_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  voided_by UUID,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_sales_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sales_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sales_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sales_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sales_currency_code FOREIGN KEY (currency_code) REFERENCES currencies(code) ON DELETE RESTRICT,
  CONSTRAINT fk_sales_biller_id FOREIGN KEY (biller_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sales_cashier_shift_id FOREIGN KEY (cashier_shift_id) REFERENCES cashier_shifts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sales_voided_by FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sales_quotation_id FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE RESTRICT,
  CONSTRAINT uq_sales_company_id_reference_no UNIQUE (company_id, reference_no),
  CONSTRAINT uq_sales_company_id_client_txn_id UNIQUE (company_id, client_txn_id),
  CONSTRAINT uq_sales_quotation_id UNIQUE (quotation_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_company_id ON sales(company_id);
CREATE INDEX IF NOT EXISTS idx_sales_branch_id ON sales(branch_id);
CREATE INDEX IF NOT EXISTS idx_sales_warehouse_id ON sales(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_biller_id ON sales(biller_id);
CREATE INDEX IF NOT EXISTS idx_sales_cashier_shift_id ON sales(cashier_shift_id);
CREATE INDEX IF NOT EXISTS idx_sales_sale_status ON sales(sale_status);
CREATE INDEX IF NOT EXISTS idx_sales_business_date ON sales(business_date);
CREATE INDEX IF NOT EXISTS idx_sales_posted_at ON sales(posted_at);

-- ============================================================================
-- sale_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS sale_items (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  sale_id UUID NOT NULL,
  line_no INTEGER NOT NULL,
  product_id UUID NOT NULL,
  product_name_snapshot VARCHAR NOT NULL,
  product_code_snapshot VARCHAR NOT NULL,
  unit_code_snapshot VARCHAR NOT NULL,
  qty DECIMAL(18,4) NOT NULL,
  unit_cost_snapshot DECIMAL(18,2) NOT NULL,
  unit_price_snapshot DECIMAL(18,2) NOT NULL,
  gross_amount DECIMAL(18,2) NOT NULL,
  discount_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  taxable_amount DECIMAL(18,2) NOT NULL,
  tax_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  line_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  warranty_months_snapshot INTEGER,
  inventory_issue_source VARCHAR DEFAULT 'sale' NOT NULL CHECK (inventory_issue_source IN ('sale','service_request','none')),
  CONSTRAINT fk_sale_items_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sale_items_sale_id FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sale_items_product_id FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT uq_sale_items_sale_id_line_no UNIQUE (sale_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_sale_items_company_id ON sale_items(company_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_inventory_issue_source ON sale_items(inventory_issue_source);

-- CHECK: quantities and amounts non-negative
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_qty_positive_chk' AND conrelid = 'sale_items'::regclass) THEN
    ALTER TABLE sale_items ADD CONSTRAINT sale_items_qty_positive_chk CHECK (qty > 0);
  END IF;
END $$;

-- ============================================================================
-- sale_item_taxes
-- ============================================================================
CREATE TABLE IF NOT EXISTS sale_item_taxes (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  sale_item_id UUID NOT NULL,
  tax_component_id UUID NOT NULL,
  component_code_snapshot VARCHAR NOT NULL,
  rate_snapshot DECIMAL(18,6) NOT NULL,
  taxable_base DECIMAL(18,2) NOT NULL,
  tax_amount DECIMAL(18,2) NOT NULL,
  CONSTRAINT fk_sale_item_taxes_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sale_item_taxes_sale_item_id FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sale_item_taxes_tax_component_id FOREIGN KEY (tax_component_id) REFERENCES tax_components(id) ON DELETE RESTRICT,
  CONSTRAINT uq_sale_item_taxes_sale_item_id_tax_component_id UNIQUE (sale_item_id, tax_component_id)
);

CREATE INDEX IF NOT EXISTS idx_sale_item_taxes_company_id ON sale_item_taxes(company_id);
CREATE INDEX IF NOT EXISTS idx_sale_item_taxes_sale_item_id ON sale_item_taxes(sale_item_id);
CREATE INDEX IF NOT EXISTS idx_sale_item_taxes_tax_component_id ON sale_item_taxes(tax_component_id);

-- ============================================================================
-- sale_item_serials
-- ============================================================================
CREATE TABLE IF NOT EXISTS sale_item_serials (
  PRIMARY KEY (sale_item_id, serial_id),
  sale_item_id UUID NOT NULL,
  serial_id UUID NOT NULL,
  CONSTRAINT fk_sale_item_serials_sale_item_id FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sale_item_serials_serial_id FOREIGN KEY (serial_id) REFERENCES product_serials(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_sale_item_serials_serial_id ON sale_item_serials(serial_id);

-- ============================================================================
-- sale_returns
-- ============================================================================
CREATE TABLE IF NOT EXISTS sale_returns (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  reference_no VARCHAR NOT NULL,
  client_txn_id UUID NOT NULL,
  sale_id UUID NOT NULL,
  status VARCHAR DEFAULT 'draft' NOT NULL CHECK (status IN ('draft','approved','posted','voided')),
  business_date TIMESTAMPTZ NOT NULL,
  disposition VARCHAR DEFAULT 'restock' NOT NULL CHECK (disposition IN ('restock','damaged','repair','scrap','mixed')),
  reason VARCHAR NOT NULL,
  subtotal_credit DECIMAL(18,2) DEFAULT 0 NOT NULL,
  tax_credit DECIMAL(18,2) DEFAULT 0 NOT NULL,
  total_credit DECIMAL(18,2) DEFAULT 0 NOT NULL,
  base_total_credit DECIMAL(18,2) DEFAULT 0 NOT NULL,
  refund_status VARCHAR DEFAULT 'not_required' NOT NULL CHECK (refund_status IN ('not_required','pending','partial','refunded')),
  approved_by UUID,
  posted_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_sale_returns_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sale_returns_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sale_returns_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sale_returns_sale_id FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sale_returns_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sale_returns_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_sale_returns_company_id_reference_no UNIQUE (company_id, reference_no),
  CONSTRAINT uq_sale_returns_company_id_client_txn_id UNIQUE (company_id, client_txn_id)
);

CREATE INDEX IF NOT EXISTS idx_sale_returns_company_id ON sale_returns(company_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_sale_id ON sale_returns(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_status ON sale_returns(status);
CREATE INDEX IF NOT EXISTS idx_sale_returns_business_date ON sale_returns(business_date);

-- ============================================================================
-- sale_return_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS sale_return_items (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  sale_return_id UUID NOT NULL,
  sale_item_id UUID NOT NULL,
  qty_returned DECIMAL(18,4) NOT NULL,
  unit_price_credit DECIMAL(18,2) NOT NULL,
  unit_cost_snapshot DECIMAL(18,2) NOT NULL,
  discount_credit DECIMAL(18,2) DEFAULT 0 NOT NULL,
  tax_credit DECIMAL(18,2) DEFAULT 0 NOT NULL,
  line_credit DECIMAL(18,2) DEFAULT 0 NOT NULL,
  condition VARCHAR DEFAULT 'resalable' NOT NULL CHECK (condition IN ('resalable','damaged','repair','scrap')),
  CONSTRAINT fk_sale_return_items_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sale_return_items_sale_return_id FOREIGN KEY (sale_return_id) REFERENCES sale_returns(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sale_return_items_sale_item_id FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_sale_return_items_company_id ON sale_return_items(company_id);
CREATE INDEX IF NOT EXISTS idx_sale_return_items_sale_return_id ON sale_return_items(sale_return_id);
CREATE INDEX IF NOT EXISTS idx_sale_return_items_sale_item_id ON sale_return_items(sale_item_id);

-- ============================================================================
-- sale_return_item_serials
-- ============================================================================
CREATE TABLE IF NOT EXISTS sale_return_item_serials (
  PRIMARY KEY (sale_return_item_id, serial_id),
  sale_return_item_id UUID NOT NULL,
  serial_id UUID NOT NULL,
  CONSTRAINT fk_sale_return_item_serials_sale_return_item_id FOREIGN KEY (sale_return_item_id) REFERENCES sale_return_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sale_return_item_serials_serial_id FOREIGN KEY (serial_id) REFERENCES product_serials(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_sale_return_item_serials_serial_id ON sale_return_item_serials(serial_id);

-- ============================================================================
-- payment_allocations
-- ============================================================================
-- NOTE: FK to partitioned table payments(id) on column 'payment_id' is enforced at the application layer.
CREATE TABLE IF NOT EXISTS payment_allocations (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  payment_id UUID NOT NULL,
  event_id UUID NOT NULL,
  event_line_no INTEGER NOT NULL,
  sale_id UUID,
  purchase_id UUID,
  allocation_source VARCHAR DEFAULT 'direct' NOT NULL CHECK (allocation_source IN ('direct','advance','store_credit','courier_cod')),
  allocated_amount DECIMAL(18,2) NOT NULL,
  allocated_base_amount DECIMAL(18,2) NOT NULL,
  allocated_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL,
  CONSTRAINT fk_payment_allocations_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_allocations_event_id FOREIGN KEY (event_id) REFERENCES business_events(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_allocations_sale_id FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_allocations_purchase_id FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_allocations_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_payment_allocations_company_id_event_id_event_line_no UNIQUE (company_id, event_id, event_line_no)
);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_company_id ON payment_allocations(company_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment_id ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_event_id ON payment_allocations(event_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_sale_id ON payment_allocations(sale_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_purchase_id ON payment_allocations(purchase_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_allocation_source ON payment_allocations(allocation_source);

-- ============================================================================
-- return_refund_allocations
-- ============================================================================
-- NOTE: FK to partitioned table payments(id) on column 'payment_id' is enforced at the application layer.
CREATE TABLE IF NOT EXISTS return_refund_allocations (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  payment_id UUID NOT NULL,
  sale_return_id UUID,
  purchase_return_id UUID,
  allocated_amount DECIMAL(18,2) NOT NULL,
  allocated_base_amount DECIMAL(18,2) NOT NULL,
  CONSTRAINT fk_return_refund_allocations_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_return_refund_allocations_sale_return_id FOREIGN KEY (sale_return_id) REFERENCES sale_returns(id) ON DELETE RESTRICT,
  CONSTRAINT uq_return_refund_allocations_payment_id UNIQUE (payment_id)
);

CREATE INDEX IF NOT EXISTS idx_return_refund_allocations_company_id ON return_refund_allocations(company_id);
CREATE INDEX IF NOT EXISTS idx_return_refund_allocations_payment_id ON return_refund_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_return_refund_allocations_sale_return_id ON return_refund_allocations(sale_return_id);
CREATE INDEX IF NOT EXISTS idx_return_refund_allocations_purchase_return_id ON return_refund_allocations(purchase_return_id);

-- ============================================================================
-- installments
-- ============================================================================
CREATE TABLE IF NOT EXISTS installments (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  sale_id UUID NOT NULL,
  installment_no INTEGER NOT NULL,
  due_date TIMESTAMPTZ NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  status VARCHAR DEFAULT 'scheduled' NOT NULL CHECK (status IN ('scheduled','cancelled')),
  CONSTRAINT fk_installments_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_installments_sale_id FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
  CONSTRAINT uq_installments_sale_id_installment_no UNIQUE (sale_id, installment_no)
);

CREATE INDEX IF NOT EXISTS idx_installments_company_id ON installments(company_id);
CREATE INDEX IF NOT EXISTS idx_installments_sale_id ON installments(sale_id);
CREATE INDEX IF NOT EXISTS idx_installments_due_date ON installments(due_date);
CREATE INDEX IF NOT EXISTS idx_installments_status ON installments(status);

-- ============================================================================
-- installment_allocations
-- ============================================================================
CREATE TABLE IF NOT EXISTS installment_allocations (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  installment_id UUID NOT NULL,
  payment_allocation_id UUID NOT NULL,
  allocated_amount DECIMAL(18,2) NOT NULL,
  allocated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_installment_allocations_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_installment_allocations_installment_id FOREIGN KEY (installment_id) REFERENCES installments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_installment_allocations_payment_allocation_id FOREIGN KEY (payment_allocation_id) REFERENCES payment_allocations(id) ON DELETE RESTRICT,
  CONSTRAINT uq_installment_allocations_payment_allocation_id UNIQUE (payment_allocation_id)
);

CREATE INDEX IF NOT EXISTS idx_installment_allocations_company_id ON installment_allocations(company_id);
CREATE INDEX IF NOT EXISTS idx_installment_allocations_installment_id ON installment_allocations(installment_id);

-- ============================================================================
-- gift_cards
-- ============================================================================
CREATE TABLE IF NOT EXISTS gift_cards (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  code VARCHAR NOT NULL,
  pin_hash VARCHAR,
  face_value DECIMAL(18,2) NOT NULL,
  status VARCHAR DEFAULT 'active' NOT NULL CHECK (status IN ('active','redeemed','expired','lost_replaced')),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  issued_by UUID NOT NULL,
  issued_sale_id UUID,
  CONSTRAINT fk_gift_cards_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_gift_cards_issued_by FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_gift_cards_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_gift_cards_company_id ON gift_cards(company_id);
CREATE INDEX IF NOT EXISTS idx_gift_cards_status ON gift_cards(status);

-- ============================================================================
-- gift_card_transactions
-- ============================================================================
CREATE TABLE IF NOT EXISTS gift_card_transactions (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  gift_card_id UUID NOT NULL,
  entry_type VARCHAR NOT NULL CHECK (entry_type IN ('issue','redeem','refund','expire','transfer','adjustment')),
  amount_delta DECIMAL(18,2) NOT NULL,
  sale_id UUID,
  sale_return_id UUID,
  event_id UUID,
  created_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL,
  CONSTRAINT fk_gift_card_transactions_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_gift_card_transactions_gift_card_id FOREIGN KEY (gift_card_id) REFERENCES gift_cards(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_gift_card_transactions_company_id ON gift_card_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_gift_card_transactions_gift_card_id ON gift_card_transactions(gift_card_id);
CREATE INDEX IF NOT EXISTS idx_gift_card_transactions_entry_type ON gift_card_transactions(entry_type);

-- CHECK: refund entries must reference a sale_return (§5.11)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gift_card_transactions_refund_requires_return_chk' AND conrelid = 'gift_card_transactions'::regclass) THEN
    ALTER TABLE gift_card_transactions ADD CONSTRAINT gift_card_transactions_refund_requires_return_chk CHECK (entry_type <> 'refund' OR sale_return_id IS NOT NULL);
  END IF;
END $$;

-- gift_card_transactions is append-only (immutable after insert)
DROP TRIGGER IF EXISTS trg_gift_card_transactions_immutable ON gift_card_transactions;
CREATE TRIGGER trg_gift_card_transactions_immutable
  BEFORE UPDATE OR DELETE ON gift_card_transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();

-- ============================================================================
-- coupons
-- ============================================================================
CREATE TABLE IF NOT EXISTS coupons (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  code VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  discount_type VARCHAR DEFAULT 'percentage' NOT NULL CHECK (discount_type IN ('percentage','fixed')),
  value DECIMAL(18,2) DEFAULT 0 NOT NULL,
  max_discount_amount DECIMAL(18,2),
  min_order_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  usage_limit INTEGER,
  usage_count INTEGER DEFAULT 0 NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_coupons_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT uq_coupons_company_id_code UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_coupons_company_id ON coupons(company_id);
CREATE INDEX IF NOT EXISTS idx_coupons_is_active ON coupons(is_active);

-- ============================================================================
-- coupon_redemptions
-- ============================================================================
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  coupon_id UUID NOT NULL,
  sale_id UUID NOT NULL,
  discount_amount DECIMAL(18,2) NOT NULL,
  redeemed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_coupon_redemptions_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_coupon_redemptions_coupon_id FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE RESTRICT,
  CONSTRAINT fk_coupon_redemptions_sale_id FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
  CONSTRAINT uq_coupon_redemptions_coupon_id_sale_id UNIQUE (coupon_id, sale_id)
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_company_id ON coupon_redemptions(company_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon_id ON coupon_redemptions(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_sale_id ON coupon_redemptions(sale_id);

-- ============================================================================
-- reward_point_transactions
-- ============================================================================
CREATE TABLE IF NOT EXISTS reward_point_transactions (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  entry_type VARCHAR NOT NULL CHECK (entry_type IN ('earn','redeem','expire','reverse')),
  points_delta INTEGER NOT NULL,
  sale_id UUID,
  event_id UUID,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_reward_point_transactions_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reward_point_transactions_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reward_point_transactions_sale_id FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_reward_point_transactions_company_id ON reward_point_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_reward_point_transactions_customer_id ON reward_point_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_reward_point_transactions_entry_type ON reward_point_transactions(entry_type);

-- reward_point_transactions is append-only (immutable after insert)
DROP TRIGGER IF EXISTS trg_reward_point_transactions_immutable ON reward_point_transactions;
CREATE TRIGGER trg_reward_point_transactions_immutable
  BEFORE UPDATE OR DELETE ON reward_point_transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();

-- ============================================================================
-- reward_point_consumptions
-- ============================================================================
CREATE TABLE IF NOT EXISTS reward_point_consumptions (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  earn_transaction_id UUID NOT NULL,
  consume_transaction_id UUID NOT NULL,
  points_consumed INTEGER NOT NULL,
  CONSTRAINT fk_reward_point_consumptions_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reward_point_consumptions_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reward_point_consumptions_earn_transaction_id FOREIGN KEY (earn_transaction_id) REFERENCES reward_point_transactions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reward_point_consumptions_consume_transaction_id FOREIGN KEY (consume_transaction_id) REFERENCES reward_point_transactions(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_reward_point_consumptions_company_id ON reward_point_consumptions(company_id);
CREATE INDEX IF NOT EXISTS idx_reward_point_consumptions_customer_id ON reward_point_consumptions(customer_id);

-- ============================================================================
-- customer_advance_ledger
-- ============================================================================
-- NOTE: FK to partitioned table payments(id) on column 'payment_id' is enforced at the application layer.
CREATE TABLE IF NOT EXISTS customer_advance_ledger (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  payment_id UUID,
  sale_return_id UUID,
  purchase_return_id UUID,
  payment_allocation_id UUID,
  entry_type VARCHAR NOT NULL CHECK (entry_type IN ('received','applied','refunded','reversed','store_credit_issued')),
  amount_delta DECIMAL(18,2) NOT NULL,
  base_amount_delta DECIMAL(18,2) NOT NULL,
  event_id UUID NOT NULL,
  event_line_no INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL,
  CONSTRAINT fk_customer_advance_ledger_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_customer_advance_ledger_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_customer_advance_ledger_sale_return_id FOREIGN KEY (sale_return_id) REFERENCES sale_returns(id) ON DELETE RESTRICT,
  CONSTRAINT fk_customer_advance_ledger_event_id FOREIGN KEY (event_id) REFERENCES business_events(id) ON DELETE RESTRICT,
  CONSTRAINT fk_customer_advance_ledger_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_customer_advance_ledger_company_id_event_id_event_line_no UNIQUE (company_id, event_id, event_line_no),
  CONSTRAINT uq_customer_advance_ledger_payment_allocation_id UNIQUE (payment_allocation_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_advance_ledger_company_id ON customer_advance_ledger(company_id);
CREATE INDEX IF NOT EXISTS idx_customer_advance_ledger_customer_id ON customer_advance_ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_advance_ledger_payment_id ON customer_advance_ledger(payment_id);
CREATE INDEX IF NOT EXISTS idx_customer_advance_ledger_sale_return_id ON customer_advance_ledger(sale_return_id);
CREATE INDEX IF NOT EXISTS idx_customer_advance_ledger_entry_type ON customer_advance_ledger(entry_type);

-- CHECK: exactly-one-source — payment_id XOR sale_return_id (§5.11)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_advance_ledger_exactly_one_source_chk' AND conrelid = 'customer_advance_ledger'::regclass) THEN
    ALTER TABLE customer_advance_ledger ADD CONSTRAINT customer_advance_ledger_exactly_one_source_chk CHECK (
    (payment_id IS NOT NULL AND sale_return_id IS NULL) OR
    (payment_id IS NULL AND sale_return_id IS NOT NULL)
  );
  END IF;
END $$;


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- RLS for cashier_shifts
ALTER TABLE cashier_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashier_shifts FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'cashier_shifts_tenant_read' AND tablename = 'cashier_shifts') THEN
    EXECUTE 'CREATE POLICY cashier_shifts_tenant_read ON cashier_shifts FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'cashier_shifts_tenant_write' AND tablename = 'cashier_shifts') THEN
    EXECUTE 'CREATE POLICY cashier_shifts_tenant_write ON cashier_shifts FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON cashier_shifts TO app_role;
GRANT SELECT ON cashier_shifts TO backup_role;
GRANT SELECT ON cashier_shifts TO reporting_role;

-- RLS for cash_drawer_counts
ALTER TABLE cash_drawer_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_drawer_counts FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'cash_drawer_counts_tenant_read' AND tablename = 'cash_drawer_counts') THEN
    EXECUTE 'CREATE POLICY cash_drawer_counts_tenant_read ON cash_drawer_counts FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'cash_drawer_counts_tenant_write' AND tablename = 'cash_drawer_counts') THEN
    EXECUTE 'CREATE POLICY cash_drawer_counts_tenant_write ON cash_drawer_counts FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON cash_drawer_counts TO app_role;
GRANT SELECT ON cash_drawer_counts TO backup_role;
GRANT SELECT ON cash_drawer_counts TO reporting_role;

-- RLS for quotations
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotations FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'quotations_tenant_read' AND tablename = 'quotations') THEN
    EXECUTE 'CREATE POLICY quotations_tenant_read ON quotations FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'quotations_tenant_write' AND tablename = 'quotations') THEN
    EXECUTE 'CREATE POLICY quotations_tenant_write ON quotations FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON quotations TO app_role;
GRANT SELECT ON quotations TO backup_role;
GRANT SELECT ON quotations TO reporting_role;

-- RLS for quotation_items
ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'quotation_items_tenant_read' AND tablename = 'quotation_items') THEN
    EXECUTE 'CREATE POLICY quotation_items_tenant_read ON quotation_items FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'quotation_items_tenant_write' AND tablename = 'quotation_items') THEN
    EXECUTE 'CREATE POLICY quotation_items_tenant_write ON quotation_items FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON quotation_items TO app_role;
GRANT SELECT ON quotation_items TO backup_role;
GRANT SELECT ON quotation_items TO reporting_role;

-- RLS for sales
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sales_tenant_read' AND tablename = 'sales') THEN
    EXECUTE 'CREATE POLICY sales_tenant_read ON sales FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sales_tenant_write' AND tablename = 'sales') THEN
    EXECUTE 'CREATE POLICY sales_tenant_write ON sales FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON sales TO app_role;
GRANT SELECT ON sales TO backup_role;
GRANT SELECT ON sales TO reporting_role;

-- RLS for sale_items
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sale_items_tenant_read' AND tablename = 'sale_items') THEN
    EXECUTE 'CREATE POLICY sale_items_tenant_read ON sale_items FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sale_items_tenant_write' AND tablename = 'sale_items') THEN
    EXECUTE 'CREATE POLICY sale_items_tenant_write ON sale_items FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON sale_items TO app_role;
GRANT SELECT ON sale_items TO backup_role;
GRANT SELECT ON sale_items TO reporting_role;

-- RLS for sale_item_taxes
ALTER TABLE sale_item_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_item_taxes FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sale_item_taxes_tenant_read' AND tablename = 'sale_item_taxes') THEN
    EXECUTE 'CREATE POLICY sale_item_taxes_tenant_read ON sale_item_taxes FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sale_item_taxes_tenant_write' AND tablename = 'sale_item_taxes') THEN
    EXECUTE 'CREATE POLICY sale_item_taxes_tenant_write ON sale_item_taxes FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON sale_item_taxes TO app_role;
GRANT SELECT ON sale_item_taxes TO backup_role;
GRANT SELECT ON sale_item_taxes TO reporting_role;

-- RLS for sale_item_serials
ALTER TABLE sale_item_serials ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_item_serials FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sale_item_serials_tenant_read' AND tablename = 'sale_item_serials') THEN
    EXECUTE 'CREATE POLICY sale_item_serials_tenant_read ON sale_item_serials FOR SELECT TO app_role USING (app_is_global() OR EXISTS (SELECT 1 FROM sale_items p WHERE p.id = sale_item_serials.sale_item_id AND p.company_id = app_company_id()));';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sale_item_serials_tenant_write' AND tablename = 'sale_item_serials') THEN
    EXECUTE 'CREATE POLICY sale_item_serials_tenant_write ON sale_item_serials FOR ALL TO app_role USING (EXISTS (SELECT 1 FROM sale_items p WHERE p.id = sale_item_serials.sale_item_id AND p.company_id = app_company_id())) WITH CHECK (EXISTS (SELECT 1 FROM sale_items p WHERE p.id = sale_item_serials.sale_item_id AND p.company_id = app_company_id()));';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON sale_item_serials TO app_role;
GRANT SELECT ON sale_item_serials TO backup_role;
GRANT SELECT ON sale_item_serials TO reporting_role;

-- RLS for sale_returns
ALTER TABLE sale_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_returns FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sale_returns_tenant_read' AND tablename = 'sale_returns') THEN
    EXECUTE 'CREATE POLICY sale_returns_tenant_read ON sale_returns FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sale_returns_tenant_write' AND tablename = 'sale_returns') THEN
    EXECUTE 'CREATE POLICY sale_returns_tenant_write ON sale_returns FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON sale_returns TO app_role;
GRANT SELECT ON sale_returns TO backup_role;
GRANT SELECT ON sale_returns TO reporting_role;

-- RLS for sale_return_items
ALTER TABLE sale_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_return_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sale_return_items_tenant_read' AND tablename = 'sale_return_items') THEN
    EXECUTE 'CREATE POLICY sale_return_items_tenant_read ON sale_return_items FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sale_return_items_tenant_write' AND tablename = 'sale_return_items') THEN
    EXECUTE 'CREATE POLICY sale_return_items_tenant_write ON sale_return_items FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON sale_return_items TO app_role;
GRANT SELECT ON sale_return_items TO backup_role;
GRANT SELECT ON sale_return_items TO reporting_role;

-- RLS for sale_return_item_serials
ALTER TABLE sale_return_item_serials ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_return_item_serials FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sale_return_item_serials_tenant_read' AND tablename = 'sale_return_item_serials') THEN
    EXECUTE 'CREATE POLICY sale_return_item_serials_tenant_read ON sale_return_item_serials FOR SELECT TO app_role USING (app_is_global() OR EXISTS (SELECT 1 FROM sale_return_items p WHERE p.id = sale_return_item_serials.sale_return_item_id AND p.company_id = app_company_id()));';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sale_return_item_serials_tenant_write' AND tablename = 'sale_return_item_serials') THEN
    EXECUTE 'CREATE POLICY sale_return_item_serials_tenant_write ON sale_return_item_serials FOR ALL TO app_role USING (EXISTS (SELECT 1 FROM sale_return_items p WHERE p.id = sale_return_item_serials.sale_return_item_id AND p.company_id = app_company_id())) WITH CHECK (EXISTS (SELECT 1 FROM sale_return_items p WHERE p.id = sale_return_item_serials.sale_return_item_id AND p.company_id = app_company_id()));';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON sale_return_item_serials TO app_role;
GRANT SELECT ON sale_return_item_serials TO backup_role;
GRANT SELECT ON sale_return_item_serials TO reporting_role;

-- RLS for payment_allocations
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'payment_allocations_tenant_read' AND tablename = 'payment_allocations') THEN
    EXECUTE 'CREATE POLICY payment_allocations_tenant_read ON payment_allocations FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'payment_allocations_tenant_write' AND tablename = 'payment_allocations') THEN
    EXECUTE 'CREATE POLICY payment_allocations_tenant_write ON payment_allocations FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON payment_allocations TO app_role;
GRANT SELECT ON payment_allocations TO backup_role;
GRANT SELECT ON payment_allocations TO reporting_role;

-- RLS for return_refund_allocations
ALTER TABLE return_refund_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_refund_allocations FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'return_refund_allocations_tenant_read' AND tablename = 'return_refund_allocations') THEN
    EXECUTE 'CREATE POLICY return_refund_allocations_tenant_read ON return_refund_allocations FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'return_refund_allocations_tenant_write' AND tablename = 'return_refund_allocations') THEN
    EXECUTE 'CREATE POLICY return_refund_allocations_tenant_write ON return_refund_allocations FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON return_refund_allocations TO app_role;
GRANT SELECT ON return_refund_allocations TO backup_role;
GRANT SELECT ON return_refund_allocations TO reporting_role;

-- RLS for installments
ALTER TABLE installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE installments FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'installments_tenant_read' AND tablename = 'installments') THEN
    EXECUTE 'CREATE POLICY installments_tenant_read ON installments FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'installments_tenant_write' AND tablename = 'installments') THEN
    EXECUTE 'CREATE POLICY installments_tenant_write ON installments FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON installments TO app_role;
GRANT SELECT ON installments TO backup_role;
GRANT SELECT ON installments TO reporting_role;

-- RLS for installment_allocations
ALTER TABLE installment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE installment_allocations FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'installment_allocations_tenant_read' AND tablename = 'installment_allocations') THEN
    EXECUTE 'CREATE POLICY installment_allocations_tenant_read ON installment_allocations FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'installment_allocations_tenant_write' AND tablename = 'installment_allocations') THEN
    EXECUTE 'CREATE POLICY installment_allocations_tenant_write ON installment_allocations FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON installment_allocations TO app_role;
GRANT SELECT ON installment_allocations TO backup_role;
GRANT SELECT ON installment_allocations TO reporting_role;

-- RLS for gift_cards
ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_cards FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'gift_cards_tenant_read' AND tablename = 'gift_cards') THEN
    EXECUTE 'CREATE POLICY gift_cards_tenant_read ON gift_cards FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'gift_cards_tenant_write' AND tablename = 'gift_cards') THEN
    EXECUTE 'CREATE POLICY gift_cards_tenant_write ON gift_cards FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON gift_cards TO app_role;
GRANT SELECT ON gift_cards TO backup_role;
GRANT SELECT ON gift_cards TO reporting_role;

-- RLS for gift_card_transactions
ALTER TABLE gift_card_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_card_transactions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'gift_card_transactions_tenant_read' AND tablename = 'gift_card_transactions') THEN
    EXECUTE 'CREATE POLICY gift_card_transactions_tenant_read ON gift_card_transactions FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'gift_card_transactions_tenant_write' AND tablename = 'gift_card_transactions') THEN
    EXECUTE 'CREATE POLICY gift_card_transactions_tenant_write ON gift_card_transactions FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT ON gift_card_transactions TO app_role;
GRANT SELECT ON gift_card_transactions TO backup_role;
GRANT SELECT ON gift_card_transactions TO reporting_role;

-- RLS for coupons
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'coupons_tenant_read' AND tablename = 'coupons') THEN
    EXECUTE 'CREATE POLICY coupons_tenant_read ON coupons FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'coupons_tenant_write' AND tablename = 'coupons') THEN
    EXECUTE 'CREATE POLICY coupons_tenant_write ON coupons FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON coupons TO app_role;
GRANT SELECT ON coupons TO backup_role;
GRANT SELECT ON coupons TO reporting_role;

-- RLS for coupon_redemptions
ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_redemptions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'coupon_redemptions_tenant_read' AND tablename = 'coupon_redemptions') THEN
    EXECUTE 'CREATE POLICY coupon_redemptions_tenant_read ON coupon_redemptions FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'coupon_redemptions_tenant_write' AND tablename = 'coupon_redemptions') THEN
    EXECUTE 'CREATE POLICY coupon_redemptions_tenant_write ON coupon_redemptions FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON coupon_redemptions TO app_role;
GRANT SELECT ON coupon_redemptions TO backup_role;
GRANT SELECT ON coupon_redemptions TO reporting_role;

-- RLS for reward_point_transactions
ALTER TABLE reward_point_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_point_transactions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'reward_point_transactions_tenant_read' AND tablename = 'reward_point_transactions') THEN
    EXECUTE 'CREATE POLICY reward_point_transactions_tenant_read ON reward_point_transactions FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'reward_point_transactions_tenant_write' AND tablename = 'reward_point_transactions') THEN
    EXECUTE 'CREATE POLICY reward_point_transactions_tenant_write ON reward_point_transactions FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT ON reward_point_transactions TO app_role;
GRANT SELECT ON reward_point_transactions TO backup_role;
GRANT SELECT ON reward_point_transactions TO reporting_role;

-- RLS for reward_point_consumptions
ALTER TABLE reward_point_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_point_consumptions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'reward_point_consumptions_tenant_read' AND tablename = 'reward_point_consumptions') THEN
    EXECUTE 'CREATE POLICY reward_point_consumptions_tenant_read ON reward_point_consumptions FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'reward_point_consumptions_tenant_write' AND tablename = 'reward_point_consumptions') THEN
    EXECUTE 'CREATE POLICY reward_point_consumptions_tenant_write ON reward_point_consumptions FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON reward_point_consumptions TO app_role;
GRANT SELECT ON reward_point_consumptions TO backup_role;
GRANT SELECT ON reward_point_consumptions TO reporting_role;

-- RLS for customer_advance_ledger
ALTER TABLE customer_advance_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_advance_ledger FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'customer_advance_ledger_tenant_read' AND tablename = 'customer_advance_ledger') THEN
    EXECUTE 'CREATE POLICY customer_advance_ledger_tenant_read ON customer_advance_ledger FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'customer_advance_ledger_tenant_write' AND tablename = 'customer_advance_ledger') THEN
    EXECUTE 'CREATE POLICY customer_advance_ledger_tenant_write ON customer_advance_ledger FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON customer_advance_ledger TO app_role;
GRANT SELECT ON customer_advance_ledger TO backup_role;
GRANT SELECT ON customer_advance_ledger TO reporting_role;

COMMIT;
