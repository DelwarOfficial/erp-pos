-- prisma/migrations/0011_m2_inventory_purchasing_tables.sql
-- §5.5A Stock Count + Adjustment
-- §5.6  Parties (already in 0010)
-- §5.8  Purchasing + Supplier Returns + Landed Cost
-- §5.9  Transfers
--
-- Adds the remaining M2 tables not already created in 0010.
-- Run AFTER 0010_inventory_purchasing_transfers.sql.
-- All tenant tables get RLS enabled + standard tenant policies.

BEGIN;


-- ============================================================================
-- SPECIAL CONSTRAINT ON product_serials (created in 0010)
-- ============================================================================
-- CHECK: status X warehouse consistency (§5.5)
-- Either in-stock/reserved/transit/damaged/repair (must have warehouse)
-- or sold/scrapped/returned_to_supplier/replaced (warehouse optional).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_serials_status_warehouse_chk' AND conrelid = 'product_serials'::regclass) THEN
    ALTER TABLE product_serials
      ADD CONSTRAINT product_serials_status_warehouse_chk
      CHECK (
        (status IN ('in_stock','reserved','in_transit','damaged','repair') AND current_warehouse_id IS NOT NULL) OR
        (status IN ('sold','scrapped','returned_to_supplier','replaced'))
      );
  END IF;
END $$;

-- ============================================================================
-- TABLES (23 tables)
-- ============================================================================

-- ============================================================================
-- stock_counts
-- ============================================================================
CREATE TABLE IF NOT EXISTS stock_counts (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  reference_no VARCHAR NOT NULL,
  scope_type VARCHAR DEFAULT 'all' NOT NULL,
  category_id UUID,
  brand_id UUID,
  status VARCHAR DEFAULT 'draft' NOT NULL,
  blind_count BOOLEAN DEFAULT true NOT NULL,
  snapshot_at TIMESTAMPTZ,
  movement_freeze_policy VARCHAR DEFAULT 'warn' NOT NULL,
  notes VARCHAR,
  created_by UUID NOT NULL,
  reviewed_by UUID,
  posted_by UUID,
  created_at TIMESTAMPTZ NOT NULL,
  posted_at TIMESTAMPTZ,
  CONSTRAINT fk_stock_counts_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_counts_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_counts_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_counts_category_id FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_counts_brand_id FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE RESTRICT,
  CONSTRAINT uq_stock_counts_company_id_reference_no UNIQUE (company_id, reference_no)
);

CREATE INDEX IF NOT EXISTS idx_stock_counts_company_id ON stock_counts(company_id);
CREATE INDEX IF NOT EXISTS idx_stock_counts_branch_id ON stock_counts(branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_counts_warehouse_id ON stock_counts(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_counts_status ON stock_counts(status);

-- ============================================================================
-- stock_count_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS stock_count_items (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  stock_count_id UUID NOT NULL,
  product_id UUID NOT NULL,
  batch_id UUID,
  expected_quantity DECIMAL(18,4) NOT NULL,
  counted_quantity DECIMAL(18,4),
  variance_quantity DECIMAL(18,4),
  reason_code_id UUID,
  count_note VARCHAR,
  CONSTRAINT fk_stock_count_items_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_count_items_stock_count_id FOREIGN KEY (stock_count_id) REFERENCES stock_counts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_count_items_product_id FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_count_items_batch_id FOREIGN KEY (batch_id) REFERENCES product_batches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_count_items_reason_code_id FOREIGN KEY (reason_code_id) REFERENCES inventory_reason_codes(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_stock_count_items_company_id ON stock_count_items(company_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_items_stock_count_id ON stock_count_items(stock_count_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_items_product_id ON stock_count_items(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_items_batch_id ON stock_count_items(batch_id);

-- ============================================================================
-- stock_count_serials
-- ============================================================================
CREATE TABLE IF NOT EXISTS stock_count_serials (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  stock_count_item_id UUID NOT NULL,
  serial_id UUID,
  scanned_serial_number VARCHAR NOT NULL,
  expected_present BOOLEAN DEFAULT true NOT NULL,
  counted_present BOOLEAN DEFAULT false NOT NULL,
  resolution VARCHAR DEFAULT 'matched' NOT NULL,
  CONSTRAINT fk_stock_count_serials_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_count_serials_stock_count_item_id FOREIGN KEY (stock_count_item_id) REFERENCES stock_count_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_count_serials_serial_id FOREIGN KEY (serial_id) REFERENCES product_serials(id) ON DELETE RESTRICT,
  CONSTRAINT uq_stock_count_serials_49724 UNIQUE (stock_count_item_id, scanned_serial_number)
);

CREATE INDEX IF NOT EXISTS idx_stock_count_serials_company_id ON stock_count_serials(company_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_serials_stock_count_item_id ON stock_count_serials(stock_count_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_serials_serial_id ON stock_count_serials(serial_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_serials_resolution ON stock_count_serials(resolution);

-- ============================================================================
-- stock_adjustments
-- ============================================================================
CREATE TABLE IF NOT EXISTS stock_adjustments (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  reference_no VARCHAR NOT NULL,
  client_txn_id UUID NOT NULL,
  adjustment_type VARCHAR DEFAULT 'adjustment' NOT NULL,
  reason_code_id UUID NOT NULL,
  source_stock_count_id UUID,
  reversal_of_id UUID,
  status VARCHAR DEFAULT 'draft' NOT NULL,
  business_date TIMESTAMPTZ NOT NULL,
  notes VARCHAR NOT NULL,
  approval_request_id UUID,
  journal_entry_id UUID,
  created_by UUID NOT NULL,
  approved_by UUID,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_stock_adjustments_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustments_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustments_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustments_reason_code_id FOREIGN KEY (reason_code_id) REFERENCES inventory_reason_codes(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustments_source_stock_count_id FOREIGN KEY (source_stock_count_id) REFERENCES stock_counts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustments_reversal_of_id FOREIGN KEY (reversal_of_id) REFERENCES stock_adjustments(id) ON DELETE RESTRICT,
  CONSTRAINT uq_stock_adjustments_company_id_reference_no UNIQUE (company_id, reference_no),
  CONSTRAINT uq_stock_adjustments_company_id_client_txn_id UNIQUE (company_id, client_txn_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_company_id ON stock_adjustments(company_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_branch_id ON stock_adjustments(branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_warehouse_id ON stock_adjustments(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_adjustment_type ON stock_adjustments(adjustment_type);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_reason_code_id ON stock_adjustments(reason_code_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_source_stock_count_id ON stock_adjustments(source_stock_count_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_reversal_of_id ON stock_adjustments(reversal_of_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_status ON stock_adjustments(status);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_business_date ON stock_adjustments(business_date);

-- ============================================================================
-- stock_adjustment_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS stock_adjustment_items (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  stock_adjustment_id UUID NOT NULL,
  line_no INTEGER NOT NULL,
  product_id UUID NOT NULL,
  batch_id UUID,
  quantity_delta DECIMAL(18,4) NOT NULL,
  unit_cost_snapshot DECIMAL(18,2) NOT NULL,
  value_delta DECIMAL(18,2) NOT NULL,
  event_id UUID,
  CONSTRAINT fk_stock_adjustment_items_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustment_items_stock_adjustment_id FOREIGN KEY (stock_adjustment_id) REFERENCES stock_adjustments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustment_items_product_id FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustment_items_batch_id FOREIGN KEY (batch_id) REFERENCES product_batches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustment_items_event_id FOREIGN KEY (event_id) REFERENCES business_events(id) ON DELETE RESTRICT,
  CONSTRAINT uq_stock_adjustment_items_stock_adjustment_id_line_no UNIQUE (stock_adjustment_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_stock_adjustment_items_company_id ON stock_adjustment_items(company_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustment_items_stock_adjustment_id ON stock_adjustment_items(stock_adjustment_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustment_items_product_id ON stock_adjustment_items(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustment_items_batch_id ON stock_adjustment_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustment_items_event_id ON stock_adjustment_items(event_id);

-- CHECK: variance = counted - expected (sanity check, not enforced since variance can be computed)
-- Actually we don't add a CHECK since counted may be null (blind count)

-- ============================================================================
-- stock_adjustment_item_serials
-- ============================================================================
CREATE TABLE IF NOT EXISTS stock_adjustment_item_serials (
  PRIMARY KEY (stock_adjustment_item_id, serial_id),
  stock_adjustment_item_id UUID NOT NULL,
  serial_id UUID NOT NULL,
  resulting_status VARCHAR DEFAULT 'in_stock' NOT NULL,
  CONSTRAINT fk_stock_adjustment_item_serials_stock_adjustment_item_id FOREIGN KEY (stock_adjustment_item_id) REFERENCES stock_adjustment_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustment_item_serials_serial_id FOREIGN KEY (serial_id) REFERENCES product_serials(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_stock_adjustment_item_serials_serial_id ON stock_adjustment_item_serials(serial_id);

-- ============================================================================
-- stock_movement_batches
-- ============================================================================
-- NOTE: FK to partitioned table stock_movements(id) on column 'stock_movement_id' is enforced at the application layer.
CREATE TABLE IF NOT EXISTS stock_movement_batches (
  PRIMARY KEY (stock_movement_id, product_batch_id),
  stock_movement_id UUID NOT NULL,
  product_batch_id UUID NOT NULL,
  company_id UUID NOT NULL,
  qty DECIMAL(18,4) NOT NULL,
  override_reason VARCHAR,
  CONSTRAINT fk_stock_movement_batches_product_batch_id FOREIGN KEY (product_batch_id) REFERENCES product_batches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_movement_batches_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_stock_movement_batches_product_batch_id ON stock_movement_batches(product_batch_id);

-- stock_movement_batches is append-only (immutable after insert)
DROP TRIGGER IF EXISTS trg_stock_movement_batches_immutable ON stock_movement_batches;
CREATE TRIGGER trg_stock_movement_batches_immutable
  BEFORE UPDATE OR DELETE ON stock_movement_batches
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();

-- ============================================================================
-- stock_budget_leases
-- ============================================================================
CREATE TABLE IF NOT EXISTS stock_budget_leases (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  device_id UUID NOT NULL,
  product_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  qty_granted DECIMAL(18,4) NOT NULL,
  qty_consumed DECIMAL(18,4) DEFAULT 0 NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status VARCHAR DEFAULT 'active' NOT NULL CHECK (status IN ('active','exhausted','expired','revoked')),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_stock_budget_leases_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_budget_leases_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_budget_leases_device_id FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_budget_leases_product_id FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_budget_leases_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_stock_budget_leases_company_id ON stock_budget_leases(company_id);
CREATE INDEX IF NOT EXISTS idx_stock_budget_leases_device_id ON stock_budget_leases(device_id);
CREATE INDEX IF NOT EXISTS idx_stock_budget_leases_product_id ON stock_budget_leases(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_budget_leases_status ON stock_budget_leases(status);
CREATE INDEX IF NOT EXISTS idx_stock_budget_leases_expires_at ON stock_budget_leases(expires_at);

-- ============================================================================
-- purchases
-- ============================================================================
CREATE TABLE IF NOT EXISTS purchases (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  reference_no VARCHAR NOT NULL,
  supplier_invoice_no VARCHAR,
  supplier_id UUID NOT NULL,
  order_status VARCHAR DEFAULT 'draft' NOT NULL,
  invoice_status VARCHAR DEFAULT 'not_invoiced' NOT NULL,
  currency_code CHAR(3) DEFAULT 'BDT' NOT NULL,
  exchange_rate DECIMAL(18,6) DEFAULT 1 NOT NULL,
  order_date TIMESTAMPTZ NOT NULL,
  expected_date TIMESTAMPTZ,
  subtotal DECIMAL(18,2) DEFAULT 0 NOT NULL,
  discount_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  tax_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  landed_cost_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  grand_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  base_grand_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  notes VARCHAR,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_purchases_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchases_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchases_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchases_supplier_id FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchases_currency_code FOREIGN KEY (currency_code) REFERENCES currencies(code) ON DELETE RESTRICT,
  CONSTRAINT uq_purchases_company_id_reference_no UNIQUE (company_id, reference_no)
);

CREATE INDEX IF NOT EXISTS idx_purchases_company_id ON purchases(company_id);
CREATE INDEX IF NOT EXISTS idx_purchases_branch_id ON purchases(branch_id);
CREATE INDEX IF NOT EXISTS idx_purchases_warehouse_id ON purchases(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier_id ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_order_status ON purchases(order_status);
CREATE INDEX IF NOT EXISTS idx_purchases_order_date ON purchases(order_date);

-- CHECK: totals must be non-negative (§5.8)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchases_totals_nonnegative_chk' AND conrelid = 'purchases'::regclass) THEN
    ALTER TABLE purchases ADD CONSTRAINT purchases_totals_nonnegative_chk CHECK (subtotal >= 0 AND discount_total >= 0 AND tax_total >= 0 AND grand_total >= 0);
  END IF;
END $$;

-- ============================================================================
-- purchase_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS purchase_items (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  purchase_id UUID NOT NULL,
  line_no INTEGER NOT NULL,
  product_id UUID NOT NULL,
  product_name_snapshot VARCHAR NOT NULL,
  product_code_snapshot VARCHAR NOT NULL,
  qty_ordered DECIMAL(18,4) NOT NULL,
  qty_received DECIMAL(18,4) DEFAULT 0 NOT NULL,
  qty_returned DECIMAL(18,4) DEFAULT 0 NOT NULL,
  unit_cost DECIMAL(18,2) NOT NULL,
  allocated_landed_cost_per_unit DECIMAL(18,2) DEFAULT 0 NOT NULL,
  discount_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  tax_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  line_total DECIMAL(18,2) DEFAULT 0 NOT NULL,
  CONSTRAINT fk_purchase_items_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_items_purchase_id FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_items_product_id FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT uq_purchase_items_purchase_id_line_no UNIQUE (purchase_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_company_id ON purchase_items(company_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product_id ON purchase_items(product_id);

-- CHECK: qty_received <= qty_ordered (§5.8 receiving rule)
-- CHECK: qty_returned <= qty_received (§5.8 return rule)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_items_received_le_ordered_chk' AND conrelid = 'purchase_items'::regclass) THEN
    ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_received_le_ordered_chk CHECK (qty_received <= qty_ordered);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_items_returned_le_received_chk' AND conrelid = 'purchase_items'::regclass) THEN
    ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_returned_le_received_chk CHECK (qty_returned <= qty_received);
  END IF;
END $$;

-- ============================================================================
-- purchase_item_taxes
-- ============================================================================
CREATE TABLE IF NOT EXISTS purchase_item_taxes (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  purchase_item_id UUID NOT NULL,
  tax_component_id UUID NOT NULL,
  component_code_snapshot VARCHAR NOT NULL,
  rate_snapshot DECIMAL(18,6) NOT NULL,
  taxable_base DECIMAL(18,2) NOT NULL,
  tax_amount DECIMAL(18,2) NOT NULL,
  recoverable_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  CONSTRAINT fk_purchase_item_taxes_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_item_taxes_purchase_item_id FOREIGN KEY (purchase_item_id) REFERENCES purchase_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_item_taxes_tax_component_id FOREIGN KEY (tax_component_id) REFERENCES tax_components(id) ON DELETE RESTRICT,
  CONSTRAINT uq_purchase_item_taxes_purchase_item_id_tax_component_id UNIQUE (purchase_item_id, tax_component_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_item_taxes_company_id ON purchase_item_taxes(company_id);
CREATE INDEX IF NOT EXISTS idx_purchase_item_taxes_purchase_item_id ON purchase_item_taxes(purchase_item_id);
CREATE INDEX IF NOT EXISTS idx_purchase_item_taxes_tax_component_id ON purchase_item_taxes(tax_component_id);

-- ============================================================================
-- purchase_receivings
-- ============================================================================
CREATE TABLE IF NOT EXISTS purchase_receivings (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  purchase_id UUID NOT NULL,
  reference_no VARCHAR NOT NULL,
  client_txn_id UUID NOT NULL,
  receiving_status VARCHAR DEFAULT 'draft' NOT NULL,
  business_date TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  supplier_document_no VARCHAR,
  notes VARCHAR,
  posted_at TIMESTAMPTZ,
  received_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_purchase_receivings_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_receivings_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_receivings_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_receivings_purchase_id FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE RESTRICT,
  CONSTRAINT uq_purchase_receivings_company_id_reference_no UNIQUE (company_id, reference_no),
  CONSTRAINT uq_purchase_receivings_company_id_client_txn_id UNIQUE (company_id, client_txn_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_receivings_company_id ON purchase_receivings(company_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receivings_branch_id ON purchase_receivings(branch_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receivings_warehouse_id ON purchase_receivings(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receivings_purchase_id ON purchase_receivings(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receivings_receiving_status ON purchase_receivings(receiving_status);
CREATE INDEX IF NOT EXISTS idx_purchase_receivings_business_date ON purchase_receivings(business_date);

-- ============================================================================
-- purchase_receiving_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS purchase_receiving_items (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  purchase_receiving_id UUID NOT NULL,
  purchase_item_id UUID NOT NULL,
  line_no INTEGER NOT NULL,
  qty_received_now DECIMAL(18,4) NOT NULL,
  unit_cost_snapshot DECIMAL(18,2) NOT NULL,
  landed_cost_per_unit_snapshot DECIMAL(18,2) DEFAULT 0 NOT NULL,
  inventory_unit_cost DECIMAL(18,2) NOT NULL,
  batch_no VARCHAR,
  manufactured_at TIMESTAMPTZ,
  expiry_date TIMESTAMPTZ,
  CONSTRAINT fk_purchase_receiving_items_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_receiving_items_purchase_receiving_id FOREIGN KEY (purchase_receiving_id) REFERENCES purchase_receivings(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_receiving_items_purchase_item_id FOREIGN KEY (purchase_item_id) REFERENCES purchase_items(id) ON DELETE RESTRICT,
  CONSTRAINT uq_purchase_receiving_items_purchase_receiving_id_line_no UNIQUE (purchase_receiving_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_purchase_receiving_items_company_id ON purchase_receiving_items(company_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receiving_items_purchase_receiving_id ON purchase_receiving_items(purchase_receiving_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receiving_items_purchase_item_id ON purchase_receiving_items(purchase_item_id);

-- ============================================================================
-- purchase_receiving_item_serials
-- ============================================================================
CREATE TABLE IF NOT EXISTS purchase_receiving_item_serials (
  PRIMARY KEY (purchase_receiving_item_id, serial_id),
  purchase_receiving_item_id UUID NOT NULL,
  serial_id UUID NOT NULL,
  CONSTRAINT fk_purchase_receiving_item_serials_purchase_receiving_item_i FOREIGN KEY (purchase_receiving_item_id) REFERENCES purchase_receiving_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_receiving_item_serials_serial_id FOREIGN KEY (serial_id) REFERENCES product_serials(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_purchase_receiving_item_serials_serial_id ON purchase_receiving_item_serials(serial_id);

-- ============================================================================
-- purchase_returns
-- ============================================================================
CREATE TABLE IF NOT EXISTS purchase_returns (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  purchase_id UUID NOT NULL,
  supplier_id UUID NOT NULL,
  reference_no VARCHAR NOT NULL,
  client_txn_id UUID NOT NULL,
  status VARCHAR DEFAULT 'draft' NOT NULL CHECK (status IN ('draft','approved','posted','voided')),
  business_date TIMESTAMPTZ NOT NULL,
  supplier_credit_no VARCHAR,
  reason VARCHAR NOT NULL,
  subtotal_credit DECIMAL(18,2) DEFAULT 0 NOT NULL,
  tax_credit DECIMAL(18,2) DEFAULT 0 NOT NULL,
  total_credit DECIMAL(18,2) DEFAULT 0 NOT NULL,
  base_total_credit DECIMAL(18,2) DEFAULT 0 NOT NULL,
  refund_status VARCHAR DEFAULT 'not_required' NOT NULL,
  approved_by UUID,
  posted_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_purchase_returns_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_returns_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_returns_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_returns_purchase_id FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_returns_supplier_id FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  CONSTRAINT uq_purchase_returns_company_id_reference_no UNIQUE (company_id, reference_no),
  CONSTRAINT uq_purchase_returns_company_id_client_txn_id UNIQUE (company_id, client_txn_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_returns_company_id ON purchase_returns(company_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_branch_id ON purchase_returns(branch_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_warehouse_id ON purchase_returns(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase_id ON purchase_returns(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier_id ON purchase_returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_status ON purchase_returns(status);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_business_date ON purchase_returns(business_date);

-- ============================================================================
-- purchase_return_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS purchase_return_items (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  purchase_return_id UUID NOT NULL,
  purchase_item_id UUID NOT NULL,
  qty_returned DECIMAL(18,4) NOT NULL,
  supplier_unit_credit DECIMAL(18,2) NOT NULL,
  inventory_unit_cost DECIMAL(18,2) NOT NULL,
  tax_credit DECIMAL(18,2) DEFAULT 0 NOT NULL,
  line_credit DECIMAL(18,2) DEFAULT 0 NOT NULL,
  variance_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  CONSTRAINT fk_purchase_return_items_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_return_items_purchase_return_id FOREIGN KEY (purchase_return_id) REFERENCES purchase_returns(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_return_items_purchase_item_id FOREIGN KEY (purchase_item_id) REFERENCES purchase_items(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_purchase_return_items_company_id ON purchase_return_items(company_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_purchase_return_id ON purchase_return_items(purchase_return_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_purchase_item_id ON purchase_return_items(purchase_item_id);

-- Cross-table constraint: total qty_returned across all returns for a purchase_item
-- cannot exceed qty_received on the purchase_item. Enforced at the application layer
-- (no SQL CHECK possible since it requires summing across rows).

-- ============================================================================
-- purchase_return_item_serials
-- ============================================================================
CREATE TABLE IF NOT EXISTS purchase_return_item_serials (
  PRIMARY KEY (purchase_return_item_id, serial_id),
  purchase_return_item_id UUID NOT NULL,
  serial_id UUID NOT NULL,
  CONSTRAINT fk_purchase_return_item_serials_purchase_return_item_id FOREIGN KEY (purchase_return_item_id) REFERENCES purchase_return_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_return_item_serials_serial_id FOREIGN KEY (serial_id) REFERENCES product_serials(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_purchase_return_item_serials_serial_id ON purchase_return_item_serials(serial_id);

-- ============================================================================
-- landed_cost_documents
-- ============================================================================
CREATE TABLE IF NOT EXISTS landed_cost_documents (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  purchase_id UUID NOT NULL,
  reference_no VARCHAR NOT NULL,
  cost_type VARCHAR DEFAULT 'freight' NOT NULL CHECK (cost_type IN ('freight','insurance','customs','port','clearing','other')),
  supplier_id UUID,
  currency_code CHAR(3) DEFAULT 'BDT' NOT NULL,
  exchange_rate DECIMAL(18,6) DEFAULT 1 NOT NULL,
  amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  base_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  allocation_method VARCHAR DEFAULT 'quantity' NOT NULL CHECK (allocation_method IN ('quantity','value','weight','manual')),
  status VARCHAR DEFAULT 'draft' NOT NULL CHECK (status IN ('draft','posted','reversed')),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_landed_cost_documents_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_landed_cost_documents_purchase_id FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE RESTRICT,
  CONSTRAINT fk_landed_cost_documents_supplier_id FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_landed_cost_documents_currency_code FOREIGN KEY (currency_code) REFERENCES currencies(code) ON DELETE RESTRICT,
  CONSTRAINT uq_landed_cost_documents_company_id_reference_no UNIQUE (company_id, reference_no)
);

CREATE INDEX IF NOT EXISTS idx_landed_cost_documents_company_id ON landed_cost_documents(company_id);
CREATE INDEX IF NOT EXISTS idx_landed_cost_documents_purchase_id ON landed_cost_documents(purchase_id);
CREATE INDEX IF NOT EXISTS idx_landed_cost_documents_cost_type ON landed_cost_documents(cost_type);
CREATE INDEX IF NOT EXISTS idx_landed_cost_documents_supplier_id ON landed_cost_documents(supplier_id);
CREATE INDEX IF NOT EXISTS idx_landed_cost_documents_status ON landed_cost_documents(status);

-- ============================================================================
-- landed_cost_allocations
-- ============================================================================
CREATE TABLE IF NOT EXISTS landed_cost_allocations (
  PRIMARY KEY (landed_cost_document_id, purchase_item_id),
  landed_cost_document_id UUID NOT NULL,
  purchase_item_id UUID NOT NULL,
  allocated_base_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  CONSTRAINT fk_landed_cost_allocations_landed_cost_document_id FOREIGN KEY (landed_cost_document_id) REFERENCES landed_cost_documents(id) ON DELETE RESTRICT,
  CONSTRAINT fk_landed_cost_allocations_purchase_item_id FOREIGN KEY (purchase_item_id) REFERENCES purchase_items(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_landed_cost_allocations_purchase_item_id ON landed_cost_allocations(purchase_item_id);

-- ============================================================================
-- transfers
-- ============================================================================
CREATE TABLE IF NOT EXISTS transfers (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  reference_no VARCHAR NOT NULL,
  client_txn_id UUID NOT NULL,
  from_warehouse_id UUID NOT NULL,
  to_warehouse_id UUID NOT NULL,
  status VARCHAR DEFAULT 'draft' NOT NULL CHECK (status IN ('draft','pending','in_transit','completed','cancelled','returning','returned')),
  requested_by UUID NOT NULL,
  approved_by UUID,
  dispatched_by VARCHAR,
  received_by UUID,
  requested_at TIMESTAMPTZ NOT NULL,
  dispatched_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  cancellation_reason VARCHAR,
  notes VARCHAR,
  CONSTRAINT fk_transfers_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_transfers_from_warehouse_id FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_transfers_to_warehouse_id FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT uq_transfers_company_id_reference_no UNIQUE (company_id, reference_no),
  CONSTRAINT uq_transfers_company_id_client_txn_id UNIQUE (company_id, client_txn_id)
);

CREATE INDEX IF NOT EXISTS idx_transfers_company_id ON transfers(company_id);
CREATE INDEX IF NOT EXISTS idx_transfers_from_warehouse_id ON transfers(from_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to_warehouse_id ON transfers(to_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfers(status);
CREATE INDEX IF NOT EXISTS idx_transfers_dispatched_at ON transfers(dispatched_at);
CREATE INDEX IF NOT EXISTS idx_transfers_received_at ON transfers(received_at);

-- CHECK: from_warehouse_id <> to_warehouse_id (§5.9)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfers_diff_warehouses_chk' AND conrelid = 'transfers'::regclass) THEN
    ALTER TABLE transfers ADD CONSTRAINT transfers_diff_warehouses_chk CHECK (from_warehouse_id <> to_warehouse_id);
  END IF;
END $$;

-- ============================================================================
-- transfer_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS transfer_items (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  transfer_id UUID NOT NULL,
  line_no INTEGER NOT NULL,
  product_id UUID NOT NULL,
  qty_requested DECIMAL(18,4) NOT NULL,
  qty_dispatched DECIMAL(18,4) DEFAULT 0 NOT NULL,
  qty_received DECIMAL(18,4) DEFAULT 0 NOT NULL,
  unit_cost_snapshot DECIMAL(18,2),
  reservation_id UUID,
  CONSTRAINT fk_transfer_items_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_transfer_items_transfer_id FOREIGN KEY (transfer_id) REFERENCES transfers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_transfer_items_product_id FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_transfer_items_reservation_id FOREIGN KEY (reservation_id) REFERENCES stock_reservations(id) ON DELETE RESTRICT,
  CONSTRAINT uq_transfer_items_transfer_id_line_no UNIQUE (transfer_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_transfer_items_company_id ON transfer_items(company_id);
CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer_id ON transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_items_product_id ON transfer_items(product_id);
CREATE INDEX IF NOT EXISTS idx_transfer_items_reservation_id ON transfer_items(reservation_id);

-- ============================================================================
-- transfer_item_serials
-- ============================================================================
CREATE TABLE IF NOT EXISTS transfer_item_serials (
  PRIMARY KEY (transfer_item_id, serial_id),
  transfer_item_id UUID NOT NULL,
  serial_id UUID NOT NULL,
  CONSTRAINT fk_transfer_item_serials_transfer_item_id FOREIGN KEY (transfer_item_id) REFERENCES transfer_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_transfer_item_serials_serial_id FOREIGN KEY (serial_id) REFERENCES product_serials(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_transfer_item_serials_serial_id ON transfer_item_serials(serial_id);

-- ============================================================================
-- supplier_advance_ledger
-- ============================================================================
-- NOTE: FK to partitioned table payments(id) on column 'payment_id' is enforced at the application layer.
CREATE TABLE IF NOT EXISTS supplier_advance_ledger (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  supplier_id UUID NOT NULL,
  payment_id UUID,
  purchase_return_id UUID,
  payment_allocation_id UUID,
  entry_type VARCHAR NOT NULL CHECK (entry_type IN ('paid','applied','refunded','reversed','credit_issued')),
  amount_delta DECIMAL(18,2) NOT NULL,
  base_amount_delta DECIMAL(18,2) NOT NULL,
  event_id UUID NOT NULL,
  event_line_no INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL,
  CONSTRAINT fk_supplier_advance_ledger_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_advance_ledger_supplier_id FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_advance_ledger_purchase_return_id FOREIGN KEY (purchase_return_id) REFERENCES purchase_returns(id) ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_advance_ledger_event_id FOREIGN KEY (event_id) REFERENCES business_events(id) ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_advance_ledger_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_supplier_advance_ledger_company_id_event_id_event_line_no UNIQUE (company_id, event_id, event_line_no),
  CONSTRAINT uq_supplier_advance_ledger_payment_allocation_id UNIQUE (payment_allocation_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_advance_ledger_company_id ON supplier_advance_ledger(company_id);
CREATE INDEX IF NOT EXISTS idx_supplier_advance_ledger_supplier_id ON supplier_advance_ledger(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_advance_ledger_payment_id ON supplier_advance_ledger(payment_id);
CREATE INDEX IF NOT EXISTS idx_supplier_advance_ledger_entry_type ON supplier_advance_ledger(entry_type);


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- RLS for stock_counts
ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_counts FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stock_counts_tenant_read' AND tablename = 'stock_counts') THEN
    EXECUTE 'CREATE POLICY stock_counts_tenant_read ON stock_counts FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stock_counts_tenant_write' AND tablename = 'stock_counts') THEN
    EXECUTE 'CREATE POLICY stock_counts_tenant_write ON stock_counts FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON stock_counts TO app_role;
GRANT SELECT ON stock_counts TO backup_role;
GRANT SELECT ON stock_counts TO reporting_role;

-- RLS for stock_count_items
ALTER TABLE stock_count_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_count_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stock_count_items_tenant_read' AND tablename = 'stock_count_items') THEN
    EXECUTE 'CREATE POLICY stock_count_items_tenant_read ON stock_count_items FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stock_count_items_tenant_write' AND tablename = 'stock_count_items') THEN
    EXECUTE 'CREATE POLICY stock_count_items_tenant_write ON stock_count_items FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON stock_count_items TO app_role;
GRANT SELECT ON stock_count_items TO backup_role;
GRANT SELECT ON stock_count_items TO reporting_role;

-- RLS for stock_count_serials
ALTER TABLE stock_count_serials ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_count_serials FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stock_count_serials_tenant_read' AND tablename = 'stock_count_serials') THEN
    EXECUTE 'CREATE POLICY stock_count_serials_tenant_read ON stock_count_serials FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stock_count_serials_tenant_write' AND tablename = 'stock_count_serials') THEN
    EXECUTE 'CREATE POLICY stock_count_serials_tenant_write ON stock_count_serials FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON stock_count_serials TO app_role;
GRANT SELECT ON stock_count_serials TO backup_role;
GRANT SELECT ON stock_count_serials TO reporting_role;

-- RLS for stock_adjustments
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stock_adjustments_tenant_read' AND tablename = 'stock_adjustments') THEN
    EXECUTE 'CREATE POLICY stock_adjustments_tenant_read ON stock_adjustments FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stock_adjustments_tenant_write' AND tablename = 'stock_adjustments') THEN
    EXECUTE 'CREATE POLICY stock_adjustments_tenant_write ON stock_adjustments FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON stock_adjustments TO app_role;
GRANT SELECT ON stock_adjustments TO backup_role;
GRANT SELECT ON stock_adjustments TO reporting_role;

-- RLS for stock_adjustment_items
ALTER TABLE stock_adjustment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustment_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stock_adjustment_items_tenant_read' AND tablename = 'stock_adjustment_items') THEN
    EXECUTE 'CREATE POLICY stock_adjustment_items_tenant_read ON stock_adjustment_items FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stock_adjustment_items_tenant_write' AND tablename = 'stock_adjustment_items') THEN
    EXECUTE 'CREATE POLICY stock_adjustment_items_tenant_write ON stock_adjustment_items FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON stock_adjustment_items TO app_role;
GRANT SELECT ON stock_adjustment_items TO backup_role;
GRANT SELECT ON stock_adjustment_items TO reporting_role;

-- RLS for stock_adjustment_item_serials
ALTER TABLE stock_adjustment_item_serials ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustment_item_serials FORCE ROW LEVEL SECURITY;

-- No RLS policies (table has no company_id and no parent-table EXISTS check)

GRANT SELECT, INSERT, UPDATE, DELETE ON stock_adjustment_item_serials TO app_role;
GRANT SELECT ON stock_adjustment_item_serials TO backup_role;
GRANT SELECT ON stock_adjustment_item_serials TO reporting_role;

-- RLS for stock_movement_batches
ALTER TABLE stock_movement_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movement_batches FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stock_movement_batches_tenant_read' AND tablename = 'stock_movement_batches') THEN
    EXECUTE 'CREATE POLICY stock_movement_batches_tenant_read ON stock_movement_batches FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stock_movement_batches_tenant_write' AND tablename = 'stock_movement_batches') THEN
    EXECUTE 'CREATE POLICY stock_movement_batches_tenant_write ON stock_movement_batches FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT ON stock_movement_batches TO app_role;
GRANT SELECT ON stock_movement_batches TO backup_role;
GRANT SELECT ON stock_movement_batches TO reporting_role;

-- RLS for stock_budget_leases
ALTER TABLE stock_budget_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_budget_leases FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stock_budget_leases_tenant_read' AND tablename = 'stock_budget_leases') THEN
    EXECUTE 'CREATE POLICY stock_budget_leases_tenant_read ON stock_budget_leases FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stock_budget_leases_tenant_write' AND tablename = 'stock_budget_leases') THEN
    EXECUTE 'CREATE POLICY stock_budget_leases_tenant_write ON stock_budget_leases FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON stock_budget_leases TO app_role;
GRANT SELECT ON stock_budget_leases TO backup_role;
GRANT SELECT ON stock_budget_leases TO reporting_role;

-- RLS for purchases
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchases_tenant_read' AND tablename = 'purchases') THEN
    EXECUTE 'CREATE POLICY purchases_tenant_read ON purchases FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchases_tenant_write' AND tablename = 'purchases') THEN
    EXECUTE 'CREATE POLICY purchases_tenant_write ON purchases FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON purchases TO app_role;
GRANT SELECT ON purchases TO backup_role;
GRANT SELECT ON purchases TO reporting_role;

-- RLS for purchase_items
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchase_items_tenant_read' AND tablename = 'purchase_items') THEN
    EXECUTE 'CREATE POLICY purchase_items_tenant_read ON purchase_items FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchase_items_tenant_write' AND tablename = 'purchase_items') THEN
    EXECUTE 'CREATE POLICY purchase_items_tenant_write ON purchase_items FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_items TO app_role;
GRANT SELECT ON purchase_items TO backup_role;
GRANT SELECT ON purchase_items TO reporting_role;

-- RLS for purchase_item_taxes
ALTER TABLE purchase_item_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_item_taxes FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchase_item_taxes_tenant_read' AND tablename = 'purchase_item_taxes') THEN
    EXECUTE 'CREATE POLICY purchase_item_taxes_tenant_read ON purchase_item_taxes FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchase_item_taxes_tenant_write' AND tablename = 'purchase_item_taxes') THEN
    EXECUTE 'CREATE POLICY purchase_item_taxes_tenant_write ON purchase_item_taxes FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_item_taxes TO app_role;
GRANT SELECT ON purchase_item_taxes TO backup_role;
GRANT SELECT ON purchase_item_taxes TO reporting_role;

-- RLS for purchase_receivings
ALTER TABLE purchase_receivings ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_receivings FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchase_receivings_tenant_read' AND tablename = 'purchase_receivings') THEN
    EXECUTE 'CREATE POLICY purchase_receivings_tenant_read ON purchase_receivings FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchase_receivings_tenant_write' AND tablename = 'purchase_receivings') THEN
    EXECUTE 'CREATE POLICY purchase_receivings_tenant_write ON purchase_receivings FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_receivings TO app_role;
GRANT SELECT ON purchase_receivings TO backup_role;
GRANT SELECT ON purchase_receivings TO reporting_role;

-- RLS for purchase_receiving_items
ALTER TABLE purchase_receiving_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_receiving_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchase_receiving_items_tenant_read' AND tablename = 'purchase_receiving_items') THEN
    EXECUTE 'CREATE POLICY purchase_receiving_items_tenant_read ON purchase_receiving_items FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchase_receiving_items_tenant_write' AND tablename = 'purchase_receiving_items') THEN
    EXECUTE 'CREATE POLICY purchase_receiving_items_tenant_write ON purchase_receiving_items FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_receiving_items TO app_role;
GRANT SELECT ON purchase_receiving_items TO backup_role;
GRANT SELECT ON purchase_receiving_items TO reporting_role;

-- RLS for purchase_receiving_item_serials
ALTER TABLE purchase_receiving_item_serials ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_receiving_item_serials FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchase_receiving_item_serials_tenant_read' AND tablename = 'purchase_receiving_item_serials') THEN
    EXECUTE 'CREATE POLICY purchase_receiving_item_serials_tenant_read ON purchase_receiving_item_serials FOR SELECT TO app_role USING (app_is_global() OR EXISTS (SELECT 1 FROM purchase_receiving_items p WHERE p.id = purchase_receiving_item_serials.purchase_receiving_item_id AND p.company_id = app_company_id()));';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchase_receiving_item_serials_tenant_write' AND tablename = 'purchase_receiving_item_serials') THEN
    EXECUTE 'CREATE POLICY purchase_receiving_item_serials_tenant_write ON purchase_receiving_item_serials FOR ALL TO app_role USING (EXISTS (SELECT 1 FROM purchase_receiving_items p WHERE p.id = purchase_receiving_item_serials.purchase_receiving_item_id AND p.company_id = app_company_id())) WITH CHECK (EXISTS (SELECT 1 FROM purchase_receiving_items p WHERE p.id = purchase_receiving_item_serials.purchase_receiving_item_id AND p.company_id = app_company_id()));';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_receiving_item_serials TO app_role;
GRANT SELECT ON purchase_receiving_item_serials TO backup_role;
GRANT SELECT ON purchase_receiving_item_serials TO reporting_role;

-- RLS for purchase_returns
ALTER TABLE purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_returns FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchase_returns_tenant_read' AND tablename = 'purchase_returns') THEN
    EXECUTE 'CREATE POLICY purchase_returns_tenant_read ON purchase_returns FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchase_returns_tenant_write' AND tablename = 'purchase_returns') THEN
    EXECUTE 'CREATE POLICY purchase_returns_tenant_write ON purchase_returns FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_returns TO app_role;
GRANT SELECT ON purchase_returns TO backup_role;
GRANT SELECT ON purchase_returns TO reporting_role;

-- RLS for purchase_return_items
ALTER TABLE purchase_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_return_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchase_return_items_tenant_read' AND tablename = 'purchase_return_items') THEN
    EXECUTE 'CREATE POLICY purchase_return_items_tenant_read ON purchase_return_items FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchase_return_items_tenant_write' AND tablename = 'purchase_return_items') THEN
    EXECUTE 'CREATE POLICY purchase_return_items_tenant_write ON purchase_return_items FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_return_items TO app_role;
GRANT SELECT ON purchase_return_items TO backup_role;
GRANT SELECT ON purchase_return_items TO reporting_role;

-- RLS for purchase_return_item_serials
ALTER TABLE purchase_return_item_serials ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_return_item_serials FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchase_return_item_serials_tenant_read' AND tablename = 'purchase_return_item_serials') THEN
    EXECUTE 'CREATE POLICY purchase_return_item_serials_tenant_read ON purchase_return_item_serials FOR SELECT TO app_role USING (app_is_global() OR EXISTS (SELECT 1 FROM purchase_return_items p WHERE p.id = purchase_return_item_serials.purchase_return_item_id AND p.company_id = app_company_id()));';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchase_return_item_serials_tenant_write' AND tablename = 'purchase_return_item_serials') THEN
    EXECUTE 'CREATE POLICY purchase_return_item_serials_tenant_write ON purchase_return_item_serials FOR ALL TO app_role USING (EXISTS (SELECT 1 FROM purchase_return_items p WHERE p.id = purchase_return_item_serials.purchase_return_item_id AND p.company_id = app_company_id())) WITH CHECK (EXISTS (SELECT 1 FROM purchase_return_items p WHERE p.id = purchase_return_item_serials.purchase_return_item_id AND p.company_id = app_company_id()));';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_return_item_serials TO app_role;
GRANT SELECT ON purchase_return_item_serials TO backup_role;
GRANT SELECT ON purchase_return_item_serials TO reporting_role;

-- RLS for landed_cost_documents
ALTER TABLE landed_cost_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE landed_cost_documents FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'landed_cost_documents_tenant_read' AND tablename = 'landed_cost_documents') THEN
    EXECUTE 'CREATE POLICY landed_cost_documents_tenant_read ON landed_cost_documents FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'landed_cost_documents_tenant_write' AND tablename = 'landed_cost_documents') THEN
    EXECUTE 'CREATE POLICY landed_cost_documents_tenant_write ON landed_cost_documents FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON landed_cost_documents TO app_role;
GRANT SELECT ON landed_cost_documents TO backup_role;
GRANT SELECT ON landed_cost_documents TO reporting_role;

-- RLS for landed_cost_allocations
ALTER TABLE landed_cost_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE landed_cost_allocations FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'landed_cost_allocations_tenant_read' AND tablename = 'landed_cost_allocations') THEN
    EXECUTE 'CREATE POLICY landed_cost_allocations_tenant_read ON landed_cost_allocations FOR SELECT TO app_role USING (app_is_global() OR EXISTS (SELECT 1 FROM landed_cost_documents p WHERE p.id = landed_cost_allocations.landed_cost_document_id AND p.company_id = app_company_id()));';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'landed_cost_allocations_tenant_write' AND tablename = 'landed_cost_allocations') THEN
    EXECUTE 'CREATE POLICY landed_cost_allocations_tenant_write ON landed_cost_allocations FOR ALL TO app_role USING (EXISTS (SELECT 1 FROM landed_cost_documents p WHERE p.id = landed_cost_allocations.landed_cost_document_id AND p.company_id = app_company_id())) WITH CHECK (EXISTS (SELECT 1 FROM landed_cost_documents p WHERE p.id = landed_cost_allocations.landed_cost_document_id AND p.company_id = app_company_id()));';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON landed_cost_allocations TO app_role;
GRANT SELECT ON landed_cost_allocations TO backup_role;
GRANT SELECT ON landed_cost_allocations TO reporting_role;

-- RLS for transfers
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'transfers_tenant_read' AND tablename = 'transfers') THEN
    EXECUTE 'CREATE POLICY transfers_tenant_read ON transfers FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'transfers_tenant_write' AND tablename = 'transfers') THEN
    EXECUTE 'CREATE POLICY transfers_tenant_write ON transfers FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON transfers TO app_role;
GRANT SELECT ON transfers TO backup_role;
GRANT SELECT ON transfers TO reporting_role;

-- RLS for transfer_items
ALTER TABLE transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'transfer_items_tenant_read' AND tablename = 'transfer_items') THEN
    EXECUTE 'CREATE POLICY transfer_items_tenant_read ON transfer_items FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'transfer_items_tenant_write' AND tablename = 'transfer_items') THEN
    EXECUTE 'CREATE POLICY transfer_items_tenant_write ON transfer_items FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON transfer_items TO app_role;
GRANT SELECT ON transfer_items TO backup_role;
GRANT SELECT ON transfer_items TO reporting_role;

-- RLS for transfer_item_serials
ALTER TABLE transfer_item_serials ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_item_serials FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'transfer_item_serials_tenant_read' AND tablename = 'transfer_item_serials') THEN
    EXECUTE 'CREATE POLICY transfer_item_serials_tenant_read ON transfer_item_serials FOR SELECT TO app_role USING (app_is_global() OR EXISTS (SELECT 1 FROM transfer_items p WHERE p.id = transfer_item_serials.transfer_item_id AND p.company_id = app_company_id()));';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'transfer_item_serials_tenant_write' AND tablename = 'transfer_item_serials') THEN
    EXECUTE 'CREATE POLICY transfer_item_serials_tenant_write ON transfer_item_serials FOR ALL TO app_role USING (EXISTS (SELECT 1 FROM transfer_items p WHERE p.id = transfer_item_serials.transfer_item_id AND p.company_id = app_company_id())) WITH CHECK (EXISTS (SELECT 1 FROM transfer_items p WHERE p.id = transfer_item_serials.transfer_item_id AND p.company_id = app_company_id()));';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON transfer_item_serials TO app_role;
GRANT SELECT ON transfer_item_serials TO backup_role;
GRANT SELECT ON transfer_item_serials TO reporting_role;

-- RLS for supplier_advance_ledger
ALTER TABLE supplier_advance_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_advance_ledger FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'supplier_advance_ledger_tenant_read' AND tablename = 'supplier_advance_ledger') THEN
    EXECUTE 'CREATE POLICY supplier_advance_ledger_tenant_read ON supplier_advance_ledger FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'supplier_advance_ledger_tenant_write' AND tablename = 'supplier_advance_ledger') THEN
    EXECUTE 'CREATE POLICY supplier_advance_ledger_tenant_write ON supplier_advance_ledger FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_advance_ledger TO app_role;
GRANT SELECT ON supplier_advance_ledger TO backup_role;
GRANT SELECT ON supplier_advance_ledger TO reporting_role;

COMMIT;
