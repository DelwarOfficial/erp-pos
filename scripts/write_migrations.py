#!/usr/bin/env python3
"""Write the actual migration SQL files from generated data."""
import json
import os

with open('/tmp/all_migrations.json') as f:
    ALL_MIGRATIONS = json.load(f)

JUNCTION_TABLES = {
    'purchase_receiving_item_serials': ('purchase_receiving_items', 'purchase_receiving_item_id'),
    'purchase_return_item_serials': ('purchase_return_items', 'purchase_return_item_id'),
    'landed_cost_allocations': ('landed_cost_documents', 'landed_cost_document_id'),
    'transfer_item_serials': ('transfer_items', 'transfer_item_id'),
    'sale_item_serials': ('sale_items', 'sale_item_id'),
    'sale_return_item_serials': ('sale_return_items', 'sale_return_item_id'),
    'courier_cod_settlement_items': ('courier_cod_settlements', 'settlement_id'),
    'user_notifications': ('notifications', 'notification_id'),
}

APPEND_ONLY_TABLES = {
    'stock_movement_batches', 'gift_card_transactions',
    'reward_point_transactions', 'risk_assessments', 'risk_assessment_outcomes',
    'courier_cod_settlements', 'courier_cod_settlement_items', 'warranty_claims',
}

MIGRATION_HEADERS = {
    '0011_m2_inventory_purchasing_tables.sql': """-- prisma/migrations/0011_m2_inventory_purchasing_tables.sql
-- §5.5A Stock Count + Adjustment
-- §5.6  Parties (already in 0010)
-- §5.8  Purchasing + Supplier Returns + Landed Cost
-- §5.9  Transfers
--
-- Adds the remaining M2 tables not already created in 0010.
-- Run AFTER 0010_inventory_purchasing_transfers.sql.
-- All tenant tables get RLS enabled + standard tenant policies.

BEGIN;
""",
    '0012_m3_pos_payments_tables.sql': """-- prisma/migrations/0012_m3_pos_payments_tables.sql
-- §5.7  POS / Sales / Quotations / Returns
-- §5.11 Payments / Cashiering / Installments / Gift Cards / Coupons / Reward Points
--
-- Adds M3 tables for point-of-sale, payments, refunds, loyalty, and gift cards.
-- payments table is partitioned (created in 0008); FKs to it are skipped
-- and enforced at the application layer.

BEGIN;
""",
    '0013_m4_accounting_tables.sql': """-- prisma/migrations/0013_m4_accounting_tables.sql
-- §5.10 Chart of Accounts / Financial Accounts
-- §5.12 Fiscal Periods / Journal Lines / Expenses / Account Transfers / Withholding
--
-- journal_entries is partitioned (created in 0008); FKs to it are skipped
-- and enforced at the application layer (post_journal_entry SECURITY DEFINER fn).

BEGIN;
""",
    '0014_m5_delivery_service_tables.sql': """-- prisma/migrations/0014_m5_delivery_service_tables.sql
-- §5.7A Delivery Orders / Courier Shipments / COD Settlements
-- §5.7A Service Requests / Service Events / Warranty Claims
--
-- Adds M5 tables for delivery, courier COD clearing, and service/warranty.

BEGIN;
""",
    '0015_m6_crm_hr_tables.sql': """-- prisma/migrations/0015_m6_crm_hr_tables.sql
-- §5.6A CRM (Leads, Activities, Sources, Statuses, Subjects)
-- §5.13 HR (Departments, Designations, Employees, Payroll, Holidays, Leave, Attendance)
-- §5.14 Notifications + Communication Consents/Campaigns
-- §5.14A Data Subject Requests (GDPR/PDPA)

BEGIN;
""",
    '0016_m7_integration_tables.sql': """-- prisma/migrations/0016_m7_integration_tables.sql
-- §5.16 Outbox / Webhooks / Import Jobs / Offline Sync / Outbound Messages
-- §5.16 Print Jobs + User Notifications + Legal Holds
-- WebAuthn (M0 Step 3 — DDL was missing; created here)
--
-- Adds M7 integration tables plus D09 (legal hold) and D12 (user notifications)
-- additions referenced in the audit gap worklog.

BEGIN;
""",
    '0017_gap_addition_tables.sql': """-- prisma/migrations/0017_gap_addition_tables.sql
-- Gap additions:
--   risk_threshold_changes  (audit log of risk threshold changes)
--   risk_assessments        (risk scoring records)
--   risk_assessment_outcomes (linkage of risk → sale/delivery outcome)
--   currency_revaluations   (§20.D12 multi-currency period-end revaluation)
--
-- currency_revaluations references journal_entries (partitioned). FKs skipped.

BEGIN;
""",
}

# Special constraints per-table (added via ALTER TABLE after CREATE TABLE)
SPECIAL_CONSTRAINTS = {
    'fiscal_periods': """
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
""",
    'financial_accounts': """
-- Split partial unique indexes on financial_accounts.name per §5.10
-- Either branch-scoped OR company-wide; both cannot share the same name.
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_accounts_name_company
  ON financial_accounts(company_id, name) WHERE branch_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_accounts_name_branch
  ON financial_accounts(company_id, branch_id, name) WHERE branch_id IS NOT NULL;
""",
    'gift_card_transactions': """
-- CHECK: refund entries must reference a sale_return (§5.11)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gift_card_transactions_refund_requires_return_chk' AND conrelid = 'gift_card_transactions'::regclass) THEN
    ALTER TABLE gift_card_transactions ADD CONSTRAINT gift_card_transactions_refund_requires_return_chk CHECK (entry_type <> 'refund' OR sale_return_id IS NOT NULL);
  END IF;
END $$;
""",
    'customer_advance_ledger': """
-- CHECK: exactly-one-source — payment_id XOR sale_return_id (§5.11)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_advance_ledger_exactly_one_source_chk' AND conrelid = 'customer_advance_ledger'::regclass) THEN
    ALTER TABLE customer_advance_ledger ADD CONSTRAINT customer_advance_ledger_exactly_one_source_chk CHECK (
    (payment_id IS NOT NULL AND sale_return_id IS NULL) OR
    (payment_id IS NULL AND sale_return_id IS NOT NULL)
  );
  END IF;
END $$;
""",
    'risk_assessments': """
-- CHECK: a 'block' decision must have an expiry (§5.16 risk)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_assessments_block_requires_expiry_chk' AND conrelid = 'risk_assessments'::regclass) THEN
    ALTER TABLE risk_assessments ADD CONSTRAINT risk_assessments_block_requires_expiry_chk CHECK (decision <> 'block' OR expires_at IS NOT NULL);
  END IF;
END $$;
""",
    'webhook_endpoints': """
-- CHECK: webhook URL must be HTTPS (§5.16)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_endpoints_url_https_chk' AND conrelid = 'webhook_endpoints'::regclass) THEN
    ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_endpoints_url_https_chk CHECK (url ~ '^https://');
  END IF;
END $$;
""",
    'product_serials': """
-- CHECK on product_serials (created in 0010) — added here as ALTER TABLE
-- Either in-stock/reserved (must have warehouse) or sold/scrapped (no warehouse req)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_serials_status_warehouse_chk' AND conrelid = 'product_serials'::regclass) THEN
    ALTER TABLE product_serials ADD CONSTRAINT product_serials_status_warehouse_chk CHECK (
    (status IN ('in_stock','reserved','in_transit','damaged','repair') AND current_warehouse_id IS NOT NULL) OR
    (status IN ('sold','scrapped','returned_to_supplier','replaced'))
  );
  END IF;
END $$;
""",
    'stock_adjustment_items': """
-- CHECK: variance = counted - expected (sanity check, not enforced since variance can be computed)
-- Actually we don't add a CHECK since counted may be null (blind count)
""",
    'purchases': """
-- CHECK: totals must be non-negative (§5.8)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchases_totals_nonnegative_chk' AND conrelid = 'purchases'::regclass) THEN
    ALTER TABLE purchases ADD CONSTRAINT purchases_totals_nonnegative_chk CHECK (subtotal >= 0 AND discount_total >= 0 AND tax_total >= 0 AND grand_total >= 0);
  END IF;
END $$;
""",
    'purchase_items': """
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
""",
    'purchase_return_items': """
-- Cross-table constraint: total qty_returned across all returns for a purchase_item
-- cannot exceed qty_received on the purchase_item. Enforced at the application layer
-- (no SQL CHECK possible since it requires summing across rows).
""",
    'sale_items': """
-- CHECK: quantities and amounts non-negative
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_qty_positive_chk' AND conrelid = 'sale_items'::regclass) THEN
    ALTER TABLE sale_items ADD CONSTRAINT sale_items_qty_positive_chk CHECK (qty > 0);
  END IF;
END $$;
""",
    'transfers': """
-- CHECK: from_warehouse_id <> to_warehouse_id (§5.9)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfers_diff_warehouses_chk' AND conrelid = 'transfers'::regclass) THEN
    ALTER TABLE transfers ADD CONSTRAINT transfers_diff_warehouses_chk CHECK (from_warehouse_id <> to_warehouse_id);
  END IF;
END $$;
""",
    'expenses': """
-- CHECK: amounts non-negative (§5.12)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_totals_nonnegative_chk' AND conrelid = 'expenses'::regclass) THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_totals_nonnegative_chk CHECK (subtotal >= 0 AND tax_total >= 0 AND grand_total >= 0);
  END IF;
END $$;
""",
    'currency_revaluations': """
-- CHECK: gain XOR loss (one must be 0)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'currency_revaluations_gain_xor_loss_chk' AND conrelid = 'currency_revaluations'::regclass) THEN
    ALTER TABLE currency_revaluations ADD CONSTRAINT currency_revaluations_gain_xor_loss_chk CHECK (
    (total_unrealized_gain = 0 AND total_unrealized_loss >= 0) OR
    (total_unrealized_loss = 0 AND total_unrealized_gain >= 0)
  );
  END IF;
END $$;
""",
}

def gen_rls_block(table_name, has_company=True):
    """Generate RLS enable + policies + grants for a table."""
    out = []
    out.append(f"-- RLS for {table_name}")
    out.append(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY;")
    out.append(f"ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY;")
    out.append("")
    # Idempotent policy creation
    if has_company:
        out.append(f"""DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = '{table_name}_tenant_read' AND tablename = '{table_name}') THEN
    EXECUTE 'CREATE POLICY {table_name}_tenant_read ON {table_name} FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = '{table_name}_tenant_write' AND tablename = '{table_name}') THEN
    EXECUTE 'CREATE POLICY {table_name}_tenant_write ON {table_name} FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;""")
    elif table_name in JUNCTION_TABLES:
        parent_table, parent_col = JUNCTION_TABLES[table_name]
        out.append(f"""DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = '{table_name}_tenant_read' AND tablename = '{table_name}') THEN
    EXECUTE 'CREATE POLICY {table_name}_tenant_read ON {table_name} FOR SELECT TO app_role USING (app_is_global() OR EXISTS (SELECT 1 FROM {parent_table} p WHERE p.id = {table_name}.{parent_col} AND p.company_id = app_company_id()));';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = '{table_name}_tenant_write' AND tablename = '{table_name}') THEN
    EXECUTE 'CREATE POLICY {table_name}_tenant_write ON {table_name} FOR ALL TO app_role USING (EXISTS (SELECT 1 FROM {parent_table} p WHERE p.id = {table_name}.{parent_col} AND p.company_id = app_company_id())) WITH CHECK (EXISTS (SELECT 1 FROM {parent_table} p WHERE p.id = {table_name}.{parent_col} AND p.company_id = app_company_id()));';
  END IF;
END $$;""")
    else:
        # No RLS — grant only
        out.append(f"-- No RLS policies (table has no company_id and no parent-table EXISTS check)")
    out.append("")
    # Grants
    if table_name in APPEND_ONLY_TABLES:
        out.append(f"GRANT SELECT, INSERT ON {table_name} TO app_role;")
    else:
        out.append(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table_name} TO app_role;")
    out.append(f"GRANT SELECT ON {table_name} TO backup_role;")
    out.append(f"GRANT SELECT ON {table_name} TO reporting_role;")
    out.append("")
    return "\n".join(out)


def gen_updated_at_trigger(table_name):
    """Generate trigger for set_updated_at on tables with updated_at column."""
    return f"""CREATE TRIGGER trg_{table_name}_updated_at
  BEFORE UPDATE ON {table_name}
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
"""


def gen_immutable_trigger(table_name):
    """Generate trigger to prevent UPDATE/DELETE on append-only tables."""
    return f"""DROP TRIGGER IF EXISTS trg_{table_name}_immutable ON {table_name};
CREATE TRIGGER trg_{table_name}_immutable
  BEFORE UPDATE OR DELETE ON {table_name}
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();
"""



# Pre-section additions (alter statements for tables created in earlier migrations)
PRE_SECTIONS = {
    '0011_m2_inventory_purchasing_tables.sql': """
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
""",
}

# FKs added at the end of specific migrations (cross-migration forward references)
DEFERRED_FK_ADDITIONS = {
    '0013_m4_accounting_tables.sql': """
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
""",
}

# Write each migration file
OUT_DIR = '/home/z/my-project/prisma/migrations'
for mf, tables in ALL_MIGRATIONS.items():
    out = []
    out.append(MIGRATION_HEADERS[mf])
    out.append("")
    # Inject pre-section statements (e.g., ALTER on tables from earlier migrations)
    if mf in PRE_SECTIONS:
        out.append(PRE_SECTIONS[mf].strip())
        out.append("")
    out.append("-- ============================================================================")
    out.append(f"-- TABLES ({len(tables)} tables)")
    out.append("-- ============================================================================")
    out.append("")
    
    for t in tables:
        tn = t['table_name']
        out.append(f"-- ============================================================================")
        out.append(f"-- {tn}")
        out.append(f"-- ============================================================================")
        # Skipped FK comments
        for col, target, ref in t.get('skipped_partitioned_fks', []):
            out.append(f"-- NOTE: FK to partitioned table {target}({ref}) on column '{col}' is enforced at the application layer.")
        for col, target, ref, on_delete in t.get('skipped_cross_migration_fks', []):
            out.append(f"-- NOTE: FK to {target}({ref}) on column '{col}' is added in a later migration (cross-migration forward reference).")
        out.append(t['create_sql'])
        out.append("")
        # Indexes
        for idx in t['indexes']:
            out.append(idx)
        out.append("")
        # Special constraints
        if tn in SPECIAL_CONSTRAINTS:
            out.append(SPECIAL_CONSTRAINTS[tn].strip())
            out.append("")
        # updated_at trigger
        if t['has_updated_at']:
            out.append(f"DROP TRIGGER IF EXISTS trg_{tn}_updated_at ON {tn};")
            out.append(gen_updated_at_trigger(tn).rstrip())
            out.append("")
        # Immutable trigger for append-only tables
        if tn in APPEND_ONLY_TABLES:
            out.append(f"-- {tn} is append-only (immutable after insert)")
            out.append(gen_immutable_trigger(tn).rstrip())
            out.append("")
    
    # RLS section
    out.append("")
    out.append("-- ============================================================================")
    out.append("-- ROW LEVEL SECURITY")
    out.append("-- ============================================================================")
    out.append("")
    for t in tables:
        tn = t['table_name']
        out.append(gen_rls_block(tn, has_company=t['has_company']))
    
    # Inject deferred FK additions (e.g., cross-migration forward references)
    if mf in DEFERRED_FK_ADDITIONS:
        out.append("")
        out.append(DEFERRED_FK_ADDITIONS[mf].strip())
        out.append("")
    
    out.append("COMMIT;")
    out.append("")
    
    # Write file
    fpath = os.path.join(OUT_DIR, mf)
    with open(fpath, 'w') as f:
        f.write("\n".join(out))
    print(f"Wrote {fpath} ({len(tables)} tables, {len(out)} lines)")

print("Done")
