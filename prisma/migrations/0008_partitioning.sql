-- prisma/migrations/0008_partitioning.sql
-- §20.D11 Partitioning, Archival, Retention, and Deletion
--  Monthly RANGE partitioning on high-volume tables.

BEGIN;

-- ============================================================================
-- stock_movements (M2) — partition by effective_at, monthly
-- ============================================================================
-- Parent table created here; partitions created by partition_management()
-- function and a scheduled job that creates next month's partition ahead of time.

CREATE TABLE stock_movements (
  id            UUID         NOT NULL DEFAULT gen_random_uuid(),
  company_id    UUID         NOT NULL,
  warehouse_id  UUID         NOT NULL,
  product_id    UUID         NOT NULL,
  movement_type VARCHAR(30)  NOT NULL,
  quantity      DECIMAL(18,4) NOT NULL,
  unit_cost     DECIMAL(18,6) NOT NULL DEFAULT 0,
  reference_type VARCHAR(60) NOT NULL,
  reference_id  UUID         NOT NULL,
  effective_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  business_event_id UUID     NOT NULL,
  PRIMARY KEY (id, effective_at)
) PARTITION BY RANGE (effective_at);

CREATE INDEX idx_stock_movements_company_warehouse_product
  ON stock_movements(company_id, warehouse_id, product_id);
CREATE INDEX idx_stock_movements_reference
  ON stock_movements(reference_type, reference_id);

-- Create current + next 3 months partitions
CREATE TABLE stock_movements_2026_07 PARTITION OF stock_movements
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE stock_movements_2026_08 PARTITION OF stock_movements
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE stock_movements_2026_09 PARTITION OF stock_movements
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE stock_movements_2026_10 PARTITION OF stock_movements
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

-- ============================================================================
-- journal_entries (M4) — partition by entry_date, monthly
-- ============================================================================
CREATE TABLE journal_entries (
  id              UUID         NOT NULL DEFAULT gen_random_uuid(),
  company_id      UUID         NOT NULL,
  branch_id       UUID         NOT NULL,
  entry_date      DATE         NOT NULL,
  description     VARCHAR(500) NOT NULL,
  document_number VARCHAR(40)  NOT NULL,
  source_type     VARCHAR(60)  NOT NULL,
  source_id       UUID         NOT NULL,
  correlation_id  UUID         NOT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'posted',
  posted_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  posted_by       UUID,
  reversed_by_id  UUID,
  reversal_of_id  UUID,
  PRIMARY KEY (id, entry_date)
) PARTITION BY RANGE (entry_date);

CREATE INDEX idx_journal_entries_company_branch_date
  ON journal_entries(company_id, branch_id, entry_date);
CREATE INDEX idx_journal_entries_source
  ON journal_entries(source_type, source_id);

CREATE TABLE journal_entries_2026_07 PARTITION OF journal_entries
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE journal_entries_2026_08 PARTITION OF journal_entries
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- ============================================================================
-- payments (M3) — partition by business_date, monthly
-- ============================================================================
CREATE TABLE payments (
  id              UUID         NOT NULL DEFAULT gen_random_uuid(),
  company_id      UUID         NOT NULL,
  branch_id       UUID         NOT NULL,
  business_date   DATE         NOT NULL,
  payment_method  VARCHAR(30)  NOT NULL,
  amount          DECIMAL(18,2) NOT NULL,
  currency_code   CHAR(3)      NOT NULL,
  payment_status  VARCHAR(20)  NOT NULL DEFAULT 'pending',
  cheque_status   VARCHAR(20)  NOT NULL DEFAULT 'not_applicable',
  method_reference VARCHAR(150),
  PRIMARY KEY (id, business_date)
) PARTITION BY RANGE (business_date);

CREATE TABLE payments_2026_07 PARTITION OF payments
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- ============================================================================
-- audit_logs — partition by occurred_at, monthly
-- ============================================================================
-- (Re-create as partitioned — drop the existing non-partitioned table first
-- in production; sandbox migration does not include this restructure.)
-- For greenfield production deployment, audit_logs would be partitioned from
-- the start. See 0005_audit_approval_statutory_reconciliation.sql for the
-- non-partitioned version (kept for sandbox compat).

-- ============================================================================
-- outbox_events (M7) — partition by occurred_at, monthly
-- ============================================================================
-- Created in M7.

-- ============================================================================
-- partition_management() — creates next month's partition ahead of time
-- ============================================================================
CREATE OR REPLACE FUNCTION partition_management(
  p_table_name VARCHAR,
  p_months_ahead INTEGER DEFAULT 3
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now DATE := date_trunc('month', now())::date;
  v_month DATE;
  v_partition_name VARCHAR;
  v_start VARCHAR;
  v_end VARCHAR;
BEGIN
  FOR i IN 1..p_months_ahead LOOP
    v_month := (v_now + (i || ' months')::interval)::date;
    v_partition_name := p_table_name || '_' || to_char(v_month, 'YYYY_MM');
    v_start := to_char(v_month, 'YYYY-MM-DD');
    v_end := to_char(v_month + interval '1 month', 'YYYY-MM-DD');

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L);',
      v_partition_name, p_table_name, v_start, v_end
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION partition_management(VARCHAR, INTEGER) TO app_role;

COMMIT;
