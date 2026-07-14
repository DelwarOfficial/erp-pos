-- prisma/migrations/0014_m5_delivery_service_tables.sql
-- §5.7A Delivery Orders / Courier Shipments / COD Settlements
-- §5.7A Service Requests / Service Events / Warranty Claims
--
-- Adds M5 tables for delivery, courier COD clearing, and service/warranty.

BEGIN;


-- ============================================================================
-- TABLES (10 tables)
-- ============================================================================

-- ============================================================================
-- delivery_orders
-- ============================================================================
CREATE TABLE IF NOT EXISTS delivery_orders (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  sale_id UUID NOT NULL,
  reference_no VARCHAR NOT NULL,
  status VARCHAR DEFAULT 'pending' NOT NULL CHECK (status IN ('pending','packing','ready','dispatched','in_transit','delivered','failed','returned','cancelled')),
  recipient_name VARCHAR NOT NULL,
  recipient_phone VARCHAR NOT NULL,
  address_snapshot VARCHAR NOT NULL,
  district VARCHAR,
  area VARCHAR,
  delivery_method VARCHAR DEFAULT 'internal' NOT NULL CHECK (delivery_method IN ('internal','courier','pickup')),
  courier_code VARCHAR,
  cod_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  delivery_fee DECIMAL(18,2) DEFAULT 0 NOT NULL,
  expected_delivery_date TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  received_by_name VARCHAR,
  assigned_user_id UUID,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_delivery_orders_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_orders_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_orders_sale_id FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_orders_assigned_user_id FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_orders_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_delivery_orders_company_id_reference_no UNIQUE (company_id, reference_no)
);

CREATE INDEX IF NOT EXISTS idx_delivery_orders_company_id ON delivery_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_sale_id ON delivery_orders(sale_id);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_status ON delivery_orders(status);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_delivery_method ON delivery_orders(delivery_method);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_courier_code ON delivery_orders(courier_code);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_recipient_phone ON delivery_orders(recipient_phone);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_created_at ON delivery_orders(created_at);

-- ============================================================================
-- delivery_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS delivery_items (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  delivery_order_id UUID NOT NULL,
  sale_item_id UUID NOT NULL,
  quantity DECIMAL(18,4) NOT NULL,
  CONSTRAINT fk_delivery_items_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_items_delivery_order_id FOREIGN KEY (delivery_order_id) REFERENCES delivery_orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_items_sale_item_id FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE RESTRICT,
  CONSTRAINT uq_delivery_items_delivery_order_id_sale_item_id UNIQUE (delivery_order_id, sale_item_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_items_company_id ON delivery_items(company_id);
CREATE INDEX IF NOT EXISTS idx_delivery_items_delivery_order_id ON delivery_items(delivery_order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_items_sale_item_id ON delivery_items(sale_item_id);

-- ============================================================================
-- delivery_events
-- ============================================================================
CREATE TABLE IF NOT EXISTS delivery_events (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  delivery_order_id UUID NOT NULL,
  from_status VARCHAR,
  to_status VARCHAR NOT NULL,
  event_at TIMESTAMPTZ NOT NULL,
  provider_status VARCHAR,
  location_text VARCHAR,
  note VARCHAR,
  created_by UUID,
  CONSTRAINT fk_delivery_events_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_events_delivery_order_id FOREIGN KEY (delivery_order_id) REFERENCES delivery_orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_events_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_delivery_events_company_id ON delivery_events(company_id);
CREATE INDEX IF NOT EXISTS idx_delivery_events_delivery_order_id ON delivery_events(delivery_order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_events_to_status ON delivery_events(to_status);
CREATE INDEX IF NOT EXISTS idx_delivery_events_event_at ON delivery_events(event_at);

-- ============================================================================
-- courier_shipments
-- ============================================================================
CREATE TABLE IF NOT EXISTS courier_shipments (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  delivery_order_id UUID NOT NULL,
  integration_credential_id UUID NOT NULL,
  provider_shipment_id UUID,
  tracking_code VARCHAR,
  booking_status VARCHAR DEFAULT 'pending' NOT NULL CHECK (booking_status IN ('pending','booked','failed','cancelled')),
  label_media_id UUID,
  quoted_charge DECIMAL(18,2),
  final_charge DECIMAL(18,2),
  last_provider_status VARCHAR,
  last_synced_at TIMESTAMPTZ,
  sanitized_provider_data VARCHAR DEFAULT '{}' NOT NULL,
  CONSTRAINT fk_courier_shipments_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_courier_shipments_delivery_order_id FOREIGN KEY (delivery_order_id) REFERENCES delivery_orders(id) ON DELETE RESTRICT,
  CONSTRAINT uq_courier_shipments_delivery_order_id UNIQUE (delivery_order_id)
);

CREATE INDEX IF NOT EXISTS idx_courier_shipments_company_id ON courier_shipments(company_id);
CREATE INDEX IF NOT EXISTS idx_courier_shipments_booking_status ON courier_shipments(booking_status);
CREATE INDEX IF NOT EXISTS idx_courier_shipments_tracking_code ON courier_shipments(tracking_code);

-- ============================================================================
-- courier_cod_settlements
-- ============================================================================
-- NOTE: FK to partitioned table journal_entries(id) on column 'journal_entry_id' is enforced at the application layer.
CREATE TABLE IF NOT EXISTS courier_cod_settlements (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  reference_no VARCHAR NOT NULL,
  courier_code VARCHAR NOT NULL,
  settlement_date TIMESTAMPTZ NOT NULL,
  gross_cod_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  fee_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  adjustment_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  net_received_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  status VARCHAR DEFAULT 'draft' NOT NULL CHECK (status IN ('draft','reconciled','posted','reversed')),
  financial_account_id UUID NOT NULL,
  journal_entry_id UUID,
  created_by UUID NOT NULL,
  posted_at TIMESTAMPTZ,
  CONSTRAINT fk_courier_cod_settlements_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_courier_cod_settlements_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_courier_cod_settlements_financial_account_id FOREIGN KEY (financial_account_id) REFERENCES financial_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_courier_cod_settlements_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_courier_cod_settlements_company_id_reference_no UNIQUE (company_id, reference_no)
);

CREATE INDEX IF NOT EXISTS idx_courier_cod_settlements_company_id ON courier_cod_settlements(company_id);
CREATE INDEX IF NOT EXISTS idx_courier_cod_settlements_courier_code ON courier_cod_settlements(courier_code);
CREATE INDEX IF NOT EXISTS idx_courier_cod_settlements_status ON courier_cod_settlements(status);
CREATE INDEX IF NOT EXISTS idx_courier_cod_settlements_settlement_date ON courier_cod_settlements(settlement_date);

-- courier_cod_settlements is append-only (immutable after insert)
DROP TRIGGER IF EXISTS trg_courier_cod_settlements_immutable ON courier_cod_settlements;
CREATE TRIGGER trg_courier_cod_settlements_immutable
  BEFORE UPDATE OR DELETE ON courier_cod_settlements
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();

-- ============================================================================
-- courier_cod_settlement_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS courier_cod_settlement_items (
  PRIMARY KEY (settlement_id, delivery_order_id),
  settlement_id UUID NOT NULL,
  delivery_order_id UUID NOT NULL,
  cod_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  fee_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  adjustment_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  CONSTRAINT fk_courier_cod_settlement_items_settlement_id FOREIGN KEY (settlement_id) REFERENCES courier_cod_settlements(id) ON DELETE RESTRICT,
  CONSTRAINT fk_courier_cod_settlement_items_delivery_order_id FOREIGN KEY (delivery_order_id) REFERENCES delivery_orders(id) ON DELETE RESTRICT,
  CONSTRAINT uq_courier_cod_settlement_items_delivery_order_id UNIQUE (delivery_order_id)
);


-- courier_cod_settlement_items is append-only (immutable after insert)
DROP TRIGGER IF EXISTS trg_courier_cod_settlement_items_immutable ON courier_cod_settlement_items;
CREATE TRIGGER trg_courier_cod_settlement_items_immutable
  BEFORE UPDATE OR DELETE ON courier_cod_settlement_items
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();

-- ============================================================================
-- service_requests
-- ============================================================================
CREATE TABLE IF NOT EXISTS service_requests (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  repair_warehouse_id UUID,
  reference_no VARCHAR NOT NULL,
  customer_id UUID,
  sale_id UUID,
  service_sale_id UUID,
  serial_id UUID,
  service_type VARCHAR DEFAULT 'paid_repair' NOT NULL CHECK (service_type IN ('warranty','paid_repair','installation','inspection')),
  status VARCHAR DEFAULT 'received' NOT NULL CHECK (status IN ('received','diagnosing','awaiting_customer_approval','approved','in_repair','awaiting_parts','ready','delivered','unrepairable','cancelled')),
  issue_description VARCHAR NOT NULL,
  intake_condition VARCHAR,
  accessories_received VARCHAR,
  estimated_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  approved_amount DECIMAL(18,2),
  deposit_required_amount DECIMAL(18,2) DEFAULT 0 NOT NULL,
  promised_date TIMESTAMPTZ,
  warranty_eligible_snapshot BOOLEAN,
  warranty_expiry_snapshot TIMESTAMPTZ,
  created_by UUID NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ,
  CONSTRAINT fk_service_requests_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_service_requests_branch_id FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_service_requests_repair_warehouse_id FOREIGN KEY (repair_warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT fk_service_requests_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_service_requests_sale_id FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
  CONSTRAINT fk_service_requests_service_sale_id FOREIGN KEY (service_sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
  CONSTRAINT fk_service_requests_serial_id FOREIGN KEY (serial_id) REFERENCES product_serials(id) ON DELETE RESTRICT,
  CONSTRAINT fk_service_requests_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_service_requests_company_id_reference_no UNIQUE (company_id, reference_no),
  CONSTRAINT uq_service_requests_service_sale_id UNIQUE (service_sale_id)
);

CREATE INDEX IF NOT EXISTS idx_service_requests_company_id ON service_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_branch_id ON service_requests(branch_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_customer_id ON service_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_sale_id ON service_requests(sale_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_serial_id ON service_requests(serial_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_service_type ON service_requests(service_type);
CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests(status);
CREATE INDEX IF NOT EXISTS idx_service_requests_received_at ON service_requests(received_at);

-- ============================================================================
-- service_request_parts
-- ============================================================================
CREATE TABLE IF NOT EXISTS service_request_parts (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  service_request_id UUID NOT NULL,
  line_no INTEGER NOT NULL,
  product_id UUID NOT NULL,
  quantity DECIMAL(18,4) NOT NULL,
  unit_cost_snapshot DECIMAL(18,2) NOT NULL,
  unit_price DECIMAL(18,2) NOT NULL,
  warranty_covered BOOLEAN DEFAULT false NOT NULL,
  consumed_event_id UUID,
  CONSTRAINT fk_service_request_parts_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_service_request_parts_service_request_id FOREIGN KEY (service_request_id) REFERENCES service_requests(id) ON DELETE RESTRICT,
  CONSTRAINT fk_service_request_parts_product_id FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_service_request_parts_consumed_event_id FOREIGN KEY (consumed_event_id) REFERENCES business_events(id) ON DELETE RESTRICT,
  CONSTRAINT uq_service_request_parts_service_request_id_line_no UNIQUE (service_request_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_service_request_parts_company_id ON service_request_parts(company_id);
CREATE INDEX IF NOT EXISTS idx_service_request_parts_service_request_id ON service_request_parts(service_request_id);
CREATE INDEX IF NOT EXISTS idx_service_request_parts_product_id ON service_request_parts(product_id);

-- ============================================================================
-- service_events
-- ============================================================================
CREATE TABLE IF NOT EXISTS service_events (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  service_request_id UUID NOT NULL,
  event_type VARCHAR NOT NULL CHECK (event_type IN ('status_change','diagnosis','estimate','customer_approval','part_used','note','message','delivery')),
  event_data VARCHAR DEFAULT '{}' NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_service_events_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_service_events_service_request_id FOREIGN KEY (service_request_id) REFERENCES service_requests(id) ON DELETE RESTRICT,
  CONSTRAINT fk_service_events_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_service_events_company_id ON service_events(company_id);
CREATE INDEX IF NOT EXISTS idx_service_events_service_request_id ON service_events(service_request_id);
CREATE INDEX IF NOT EXISTS idx_service_events_event_type ON service_events(event_type);
CREATE INDEX IF NOT EXISTS idx_service_events_created_at ON service_events(created_at);

-- ============================================================================
-- warranty_claims
-- ============================================================================
CREATE TABLE IF NOT EXISTS warranty_claims (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  service_request_id UUID NOT NULL,
  claim_type VARCHAR DEFAULT 'repair' NOT NULL CHECK (claim_type IN ('repair','replace','refund','supplier_claim')),
  status VARCHAR DEFAULT 'draft' NOT NULL CHECK (status IN ('draft','submitted','approved','rejected','fulfilled','reversed')),
  eligibility_reason VARCHAR NOT NULL,
  replacement_serial_id UUID,
  supplier_reference VARCHAR,
  approval_request_id UUID,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ,
  CONSTRAINT fk_warranty_claims_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_warranty_claims_service_request_id FOREIGN KEY (service_request_id) REFERENCES service_requests(id) ON DELETE RESTRICT,
  CONSTRAINT fk_warranty_claims_replacement_serial_id FOREIGN KEY (replacement_serial_id) REFERENCES product_serials(id) ON DELETE RESTRICT,
  CONSTRAINT fk_warranty_claims_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_warranty_claims_service_request_id UNIQUE (service_request_id),
  CONSTRAINT uq_warranty_claims_replacement_serial_id UNIQUE (replacement_serial_id)
);

CREATE INDEX IF NOT EXISTS idx_warranty_claims_company_id ON warranty_claims(company_id);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_claim_type ON warranty_claims(claim_type);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_status ON warranty_claims(status);

-- warranty_claims is append-only (immutable after insert)
DROP TRIGGER IF EXISTS trg_warranty_claims_immutable ON warranty_claims;
CREATE TRIGGER trg_warranty_claims_immutable
  BEFORE UPDATE OR DELETE ON warranty_claims
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- RLS for delivery_orders
ALTER TABLE delivery_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_orders FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'delivery_orders_tenant_read' AND tablename = 'delivery_orders') THEN
    EXECUTE 'CREATE POLICY delivery_orders_tenant_read ON delivery_orders FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'delivery_orders_tenant_write' AND tablename = 'delivery_orders') THEN
    EXECUTE 'CREATE POLICY delivery_orders_tenant_write ON delivery_orders FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_orders TO app_role;
GRANT SELECT ON delivery_orders TO backup_role;
GRANT SELECT ON delivery_orders TO reporting_role;

-- RLS for delivery_items
ALTER TABLE delivery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'delivery_items_tenant_read' AND tablename = 'delivery_items') THEN
    EXECUTE 'CREATE POLICY delivery_items_tenant_read ON delivery_items FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'delivery_items_tenant_write' AND tablename = 'delivery_items') THEN
    EXECUTE 'CREATE POLICY delivery_items_tenant_write ON delivery_items FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_items TO app_role;
GRANT SELECT ON delivery_items TO backup_role;
GRANT SELECT ON delivery_items TO reporting_role;

-- RLS for delivery_events
ALTER TABLE delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_events FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'delivery_events_tenant_read' AND tablename = 'delivery_events') THEN
    EXECUTE 'CREATE POLICY delivery_events_tenant_read ON delivery_events FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'delivery_events_tenant_write' AND tablename = 'delivery_events') THEN
    EXECUTE 'CREATE POLICY delivery_events_tenant_write ON delivery_events FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_events TO app_role;
GRANT SELECT ON delivery_events TO backup_role;
GRANT SELECT ON delivery_events TO reporting_role;

-- RLS for courier_shipments
ALTER TABLE courier_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_shipments FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'courier_shipments_tenant_read' AND tablename = 'courier_shipments') THEN
    EXECUTE 'CREATE POLICY courier_shipments_tenant_read ON courier_shipments FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'courier_shipments_tenant_write' AND tablename = 'courier_shipments') THEN
    EXECUTE 'CREATE POLICY courier_shipments_tenant_write ON courier_shipments FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON courier_shipments TO app_role;
GRANT SELECT ON courier_shipments TO backup_role;
GRANT SELECT ON courier_shipments TO reporting_role;

-- RLS for courier_cod_settlements
ALTER TABLE courier_cod_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_cod_settlements FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'courier_cod_settlements_tenant_read' AND tablename = 'courier_cod_settlements') THEN
    EXECUTE 'CREATE POLICY courier_cod_settlements_tenant_read ON courier_cod_settlements FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'courier_cod_settlements_tenant_write' AND tablename = 'courier_cod_settlements') THEN
    EXECUTE 'CREATE POLICY courier_cod_settlements_tenant_write ON courier_cod_settlements FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT ON courier_cod_settlements TO app_role;
GRANT SELECT ON courier_cod_settlements TO backup_role;
GRANT SELECT ON courier_cod_settlements TO reporting_role;

-- RLS for courier_cod_settlement_items
ALTER TABLE courier_cod_settlement_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_cod_settlement_items FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'courier_cod_settlement_items_tenant_read' AND tablename = 'courier_cod_settlement_items') THEN
    EXECUTE 'CREATE POLICY courier_cod_settlement_items_tenant_read ON courier_cod_settlement_items FOR SELECT TO app_role USING (app_is_global() OR EXISTS (SELECT 1 FROM courier_cod_settlements p WHERE p.id = courier_cod_settlement_items.settlement_id AND p.company_id = app_company_id()));';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'courier_cod_settlement_items_tenant_write' AND tablename = 'courier_cod_settlement_items') THEN
    EXECUTE 'CREATE POLICY courier_cod_settlement_items_tenant_write ON courier_cod_settlement_items FOR ALL TO app_role USING (EXISTS (SELECT 1 FROM courier_cod_settlements p WHERE p.id = courier_cod_settlement_items.settlement_id AND p.company_id = app_company_id())) WITH CHECK (EXISTS (SELECT 1 FROM courier_cod_settlements p WHERE p.id = courier_cod_settlement_items.settlement_id AND p.company_id = app_company_id()));';
  END IF;
END $$;

GRANT SELECT, INSERT ON courier_cod_settlement_items TO app_role;
GRANT SELECT ON courier_cod_settlement_items TO backup_role;
GRANT SELECT ON courier_cod_settlement_items TO reporting_role;

-- RLS for service_requests
ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_requests FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_requests_tenant_read' AND tablename = 'service_requests') THEN
    EXECUTE 'CREATE POLICY service_requests_tenant_read ON service_requests FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_requests_tenant_write' AND tablename = 'service_requests') THEN
    EXECUTE 'CREATE POLICY service_requests_tenant_write ON service_requests FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON service_requests TO app_role;
GRANT SELECT ON service_requests TO backup_role;
GRANT SELECT ON service_requests TO reporting_role;

-- RLS for service_request_parts
ALTER TABLE service_request_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_request_parts FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_request_parts_tenant_read' AND tablename = 'service_request_parts') THEN
    EXECUTE 'CREATE POLICY service_request_parts_tenant_read ON service_request_parts FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_request_parts_tenant_write' AND tablename = 'service_request_parts') THEN
    EXECUTE 'CREATE POLICY service_request_parts_tenant_write ON service_request_parts FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON service_request_parts TO app_role;
GRANT SELECT ON service_request_parts TO backup_role;
GRANT SELECT ON service_request_parts TO reporting_role;

-- RLS for service_events
ALTER TABLE service_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_events FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_events_tenant_read' AND tablename = 'service_events') THEN
    EXECUTE 'CREATE POLICY service_events_tenant_read ON service_events FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_events_tenant_write' AND tablename = 'service_events') THEN
    EXECUTE 'CREATE POLICY service_events_tenant_write ON service_events FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON service_events TO app_role;
GRANT SELECT ON service_events TO backup_role;
GRANT SELECT ON service_events TO reporting_role;

-- RLS for warranty_claims
ALTER TABLE warranty_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_claims FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'warranty_claims_tenant_read' AND tablename = 'warranty_claims') THEN
    EXECUTE 'CREATE POLICY warranty_claims_tenant_read ON warranty_claims FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'warranty_claims_tenant_write' AND tablename = 'warranty_claims') THEN
    EXECUTE 'CREATE POLICY warranty_claims_tenant_write ON warranty_claims FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT ON warranty_claims TO app_role;
GRANT SELECT ON warranty_claims TO backup_role;
GRANT SELECT ON warranty_claims TO reporting_role;

COMMIT;
