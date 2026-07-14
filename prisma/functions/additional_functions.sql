-- prisma/functions/post_stock_movement.sql
-- §16 post_stock_movement()
-- Posts a stock movement with negative-stock check, moving-average cost recalculation,
-- and warehouse_stocks projection update. SECURITY DEFINER, safe search_path.

CREATE OR REPLACE FUNCTION post_stock_movement(
  p_company_id    UUID,
  p_event_id      UUID,
  p_event_line_no INTEGER,
  p_warehouse_id  UUID,
  p_product_id    UUID,
  p_movement_type VARCHAR,
  p_qty_delta     DECIMAL(18,4),
  p_unit_cost     DECIMAL(18,6),
  p_reference_type VARCHAR,
  p_reference_id  UUID,
  p_created_by    UUID,
  p_stock_bucket  VARCHAR DEFAULT 'on_hand',
  p_source_line_id UUID DEFAULT NULL,
  p_effective_at  TIMESTAMPTZ DEFAULT now(),
  p_metadata      JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE (movement_id UUID, qty_on_hand_before DECIMAL, qty_on_hand_after DECIMAL, mac_before DECIMAL, mac_after DECIMAL)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stock_id UUID;
  v_qty_on_hand DECIMAL(18,4) := 0;
  v_mac DECIMAL(18,6) := 0;
  v_qty_damaged DECIMAL(18,4) := 0;
  v_qty_in_transit DECIMAL(18,4) := 0;
  v_new_qty DECIMAL(18,4);
  v_new_mac DECIMAL(18,6);
  v_total_cost_delta DECIMAL(24,6);
  v_movement_id UUID;
  v_is_inbound BOOLEAN;
  v_is_outbound BOOLEAN;
BEGIN
  -- Validate tenant context
  IF current_setting('app.company_id', true)::uuid <> p_company_id THEN
    RAISE EXCEPTION 'Tenant context mismatch in post_stock_movement' USING ERRCODE = '42704';
  END IF;

  -- Lock or create warehouse_stocks row
  SELECT id, qty_on_hand, moving_average_cost, qty_damaged, qty_in_transit_out
  INTO v_stock_id, v_qty_on_hand, v_mac, v_qty_damaged, v_qty_in_transit
  FROM warehouse_stocks
  WHERE company_id = p_company_id AND warehouse_id = p_warehouse_id AND product_id = p_product_id
  FOR UPDATE;

  IF v_stock_id IS NULL THEN
    INSERT INTO warehouse_stocks (company_id, warehouse_id, product_id, qty_on_hand, qty_reserved, qty_in_transit_out, qty_damaged, moving_average_cost, version)
    VALUES (p_company_id, p_warehouse_id, p_product_id, 0, 0, 0, 0, 0, 0)
    RETURNING id INTO v_stock_id;
    v_qty_on_hand := 0; v_mac := 0; v_qty_damaged := 0; v_qty_in_transit := 0;
  END IF;

  -- Compute new quantities per bucket
  IF p_stock_bucket = 'on_hand' THEN
    v_new_qty := v_qty_on_hand + p_qty_delta;
    -- Negative-stock prohibition (§20.D03)
    IF v_new_qty < 0 THEN
      RAISE EXCEPTION 'Insufficient stock: on_hand=%, requested=%', v_qty_on_hand, ABS(p_qty_delta)
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF p_stock_bucket = 'damaged' THEN
    v_qty_damaged := v_qty_damaged + p_qty_delta;
    v_new_qty := v_qty_on_hand;
  ELSIF p_stock_bucket = 'in_transit' THEN
    v_qty_in_transit := v_qty_in_transit + p_qty_delta;
    v_new_qty := v_qty_on_hand;
  ELSE
    v_new_qty := v_qty_on_hand + p_qty_delta;
  END IF;

  -- Moving-average cost recalculation
  v_is_inbound := p_movement_type IN ('purchase_receive','sale_return_receive','transfer_receive','adjustment_in','opening_stock','stock_count_gain');
  v_is_outbound := p_movement_type IN ('sale_issue','transfer_dispatch','adjustment_out','purchase_return_issue','stock_count_loss');
  v_new_mac := v_mac;

  IF v_is_inbound AND p_stock_bucket = 'on_hand' AND (v_qty_on_hand + ABS(p_qty_delta)) > 0 THEN
    v_new_mac := ((v_qty_on_hand * v_mac) + (ABS(p_qty_delta) * p_unit_cost)) / (v_qty_on_hand + ABS(p_qty_delta));
  END IF;

  v_total_cost_delta := p_qty_delta * CASE WHEN v_is_outbound THEN v_mac ELSE p_unit_cost END;

  -- Insert stock_movement (immutable ledger)
  INSERT INTO stock_movements (
    company_id, event_id, event_line_no, warehouse_id, product_id, stock_bucket,
    movement_type, qty_delta, unit_cost, total_cost_delta,
    reference_type, reference_id, source_line_id, effective_at, posted_at, created_by, metadata
  ) VALUES (
    p_company_id, p_event_id, p_event_line_no, p_warehouse_id, p_product_id, p_stock_bucket,
    p_movement_type, p_qty_delta, CASE WHEN v_is_outbound THEN v_mac ELSE p_unit_cost END, v_total_cost_delta,
    p_reference_type, p_reference_id, p_source_line_id, p_effective_at, now(), p_created_by, p_metadata
  )
  RETURNING id INTO v_movement_id;

  -- Update warehouse_stocks
  UPDATE warehouse_stocks SET
    qty_on_hand = v_new_qty,
    qty_damaged = v_qty_damaged,
    qty_in_transit_out = v_qty_in_transit,
    moving_average_cost = v_new_mac,
    version = version + 1,
    updated_at = now()
  WHERE id = v_stock_id;

  RETURN QUERY SELECT v_movement_id, v_qty_on_hand, v_new_qty, v_mac, v_new_mac;
END;
$$;

GRANT EXECUTE ON FUNCTION post_stock_movement TO app_role;

-- ──────────────────────────────────────────────────────────────────────
-- validate_serial_transition
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_serial_transition(
  p_from_status VARCHAR,
  p_to_status VARCHAR
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed TEXT[];
BEGIN
  v_allowed := CASE p_from_status
    WHEN 'in_stock' THEN ARRAY['reserved','sold','in_transit','damaged','returned_to_supplier','scrapped']::TEXT[]
    WHEN 'reserved' THEN ARRAY['in_stock','sold','damaged']::TEXT[]
    WHEN 'sold' THEN ARRAY['in_stock','returned_to_supplier']::TEXT[]
    WHEN 'in_transit' THEN ARRAY['in_stock','damaged']::TEXT[]
    WHEN 'damaged' THEN ARRAY['in_stock','repair','scrapped']::TEXT[]
    WHEN 'repair' THEN ARRAY['in_stock','scrapped']::TEXT[]
    ELSE ARRAY[]::TEXT[]
  END;

  IF p_from_status <> p_to_status AND NOT (p_to_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'Invalid serial transition: % → %', p_from_status, p_to_status
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_serial_transition TO app_role;

-- ──────────────────────────────────────────────────────────────────────
-- validate_delivery_transition
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_delivery_transition(
  p_from_status VARCHAR,
  p_to_status VARCHAR
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed TEXT[];
BEGIN
  v_allowed := CASE p_from_status
    WHEN 'pending' THEN ARRAY['packing','cancelled']::TEXT[]
    WHEN 'packing' THEN ARRAY['ready','pending','cancelled']::TEXT[]
    WHEN 'ready' THEN ARRAY['dispatched','pending','cancelled']::TEXT[]
    WHEN 'dispatched' THEN ARRAY['in_transit','cancelled']::TEXT[]
    WHEN 'in_transit' THEN ARRAY['delivered','failed','returned']::TEXT[]
    ELSE ARRAY[]::TEXT[]
  END;

  IF p_from_status <> p_to_status AND NOT (p_to_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'Invalid delivery transition: % → %', p_from_status, p_to_status
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_delivery_transition TO app_role;

-- ──────────────────────────────────────────────────────────────────────
-- validate_service_transition
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_service_transition(
  p_from_status VARCHAR,
  p_to_status VARCHAR
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed TEXT[];
BEGIN
  v_allowed := CASE p_from_status
    WHEN 'received' THEN ARRAY['diagnosing','cancelled']::TEXT[]
    WHEN 'diagnosing' THEN ARRAY['awaiting_customer_approval','received','cancelled']::TEXT[]
    WHEN 'awaiting_customer_approval' THEN ARRAY['approved','received','cancelled']::TEXT[]
    WHEN 'approved' THEN ARRAY['in_repair','cancelled']::TEXT[]
    WHEN 'in_repair' THEN ARRAY['awaiting_parts','ready','unrepairable']::TEXT[]
    WHEN 'awaiting_parts' THEN ARRAY['in_repair','cancelled']::TEXT[]
    WHEN 'ready' THEN ARRAY['delivered','cancelled']::TEXT[]
    ELSE ARRAY[]::TEXT[]
  END;

  IF p_from_status <> p_to_status AND NOT (p_to_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'Invalid service transition: % → %', p_from_status, p_to_status
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_service_transition TO app_role;

-- ──────────────────────────────────────────────────────────────────────
-- validate_payment_allocations (deferred sum check)
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_payment_allocations(
  p_payment_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment_amount DECIMAL(18,2);
  v_total_allocated DECIMAL(18,2);
BEGIN
  SELECT amount INTO v_payment_amount FROM payments WHERE id = p_payment_id;
  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_total_allocated
  FROM payment_allocations WHERE payment_id = p_payment_id;

  IF v_total_allocated > v_payment_amount + 0.01 THEN
    RAISE EXCEPTION 'Payment allocation exceeds payment amount: allocated=%, payment=%', v_total_allocated, v_payment_amount
      USING ERRCODE = 'P0001';
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_payment_allocations TO app_role;

-- ──────────────────────────────────────────────────────────────────────
-- validate_cheque_transition
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_cheque_transition(
  p_from_status VARCHAR,
  p_to_status VARCHAR
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed TEXT[];
BEGIN
  v_allowed := CASE p_from_status
    WHEN 'not_applicable' THEN ARRAY['pending_clearance']::TEXT[]
    WHEN 'pending_clearance' THEN ARRAY['cleared','bounced','cancelled']::TEXT[]
    ELSE ARRAY[]::TEXT[]
  END;

  IF p_from_status <> p_to_status AND NOT (p_to_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'Invalid cheque transition: % → %', p_from_status, p_to_status
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_cheque_transition TO app_role;

-- ──────────────────────────────────────────────────────────────────────
-- validate_warranty_replacement
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_warranty_replacement(
  p_serial_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status VARCHAR;
BEGIN
  SELECT status INTO v_status FROM product_serials WHERE id = p_serial_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Serial not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'in_stock' THEN
    RAISE EXCEPTION 'Replacement serial must be in_stock (current: %)', v_status
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_warranty_replacement TO app_role;

-- ──────────────────────────────────────────────────────────────────────
-- reverse_journal_entry
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reverse_journal_entry(
  p_entry_id UUID,
  p_reversed_by UUID,
  p_reason TEXT
) RETURNS TABLE (reversal_entry_id UUID, entry_no VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_original RECORD;
  v_entry_no VARCHAR;
  v_reversal_id UUID;
  v_line_no SMALLINT := 1;
BEGIN
  SELECT * INTO v_original FROM journal_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journal entry not found' USING ERRCODE = 'P0002'; END IF;
  IF v_original.status = 'reversed' THEN RAISE EXCEPTION 'Already reversed' USING ERRCODE = 'P0001'; END IF;

  -- Generate entry number
  SELECT document_number INTO v_entry_no
  FROM next_document_number(current_setting('app.company_id', true)::uuid, NULL, 'JOURNAL', EXTRACT(YEAR FROM v_original.entry_date)::SMALLINT, 'JE-');

  -- Create reversal header
  INSERT INTO journal_entries (
    company_id, entry_no, event_id, posting_kind, entry_date, posting_date,
    source_type, source_id, currency_code, exchange_rate, description, status,
    reversal_of_entry_id, created_by, posted_by, posted_at
  ) VALUES (
    v_original.company_id, v_entry_no, v_original.event_id, v_original.posting_kind || '_reversal',
    v_original.entry_date, now(), 'journal_reversal', p_entry_id::text,
    v_original.currency_code, v_original.exchange_rate,
    'REVERSAL of ' || v_original.entry_no || ': ' || p_reason, 'posted',
    p_entry_id, p_reversed_by, p_reversed_by, now()
  )
  RETURNING id INTO v_reversal_id;

  -- Create reversed lines (swap debit/credit)
  INSERT INTO journal_lines (company_id, journal_entry_id, line_no, branch_id, chart_of_account_id, financial_account_id, customer_id, supplier_id, product_id, debit_base, credit_base, memo)
  SELECT company_id, v_reversal_id, ROW_NUMBER() OVER (ORDER BY line_no), branch_id, chart_of_account_id, financial_account_id, customer_id, supplier_id, product_id, credit_base, debit_base, 'Reversal: ' || COALESCE(memo, '')
  FROM journal_lines WHERE journal_entry_id = p_entry_id;

  -- Mark original as reversed
  UPDATE journal_entries SET status = 'reversed' WHERE id = p_entry_id;

  RETURN QUERY SELECT v_reversal_id, v_entry_no;
END;
$$;

GRANT EXECUTE ON FUNCTION reverse_journal_entry TO app_role;

-- ──────────────────────────────────────────────────────────────────────
-- post_account_adjustment (wrapper around post_journal_entry)
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION post_account_adjustment(
  p_company_id UUID,
  p_branch_id UUID,
  p_entry_date DATE,
  p_description VARCHAR,
  p_lines JSONB,
  p_created_by UUID
) RETURNS TABLE (journal_entry_id UUID, entry_no VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Delegate to post_journal_entry with posting_kind='account_adjustment'
  RETURN QUERY
  SELECT * FROM post_journal_entry(
    p_company_id, p_branch_id, p_entry_date, p_description, p_lines,
    'account_adjustment', 'manual', 'manual', p_created_by
  );
END;
$$;

GRANT EXECUTE ON FUNCTION post_account_adjustment TO app_role;

-- ──────────────────────────────────────────────────────────────────────
-- post_courier_cod_settlement
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION post_courier_cod_settlement(
  p_company_id UUID,
  p_branch_id UUID,
  p_courier_code VARCHAR,
  p_settlement_date DATE,
  p_financial_account_id UUID,
  p_gross_cod DECIMAL(18,2),
  p_fee_amount DECIMAL(18,2),
  p_adjustment_amount DECIMAL(18,2),
  p_created_by UUID
) RETURNS TABLE (settlement_id UUID, journal_entry_no VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_net_received DECIMAL(18,2);
  v_reference_no VARCHAR;
  v_settlement_id UUID;
  v_fa_coa UUID;
  v_policies RECORD;
  v_je_result RECORD;
BEGIN
  v_net_received := p_gross_cod - p_fee_amount + p_adjustment_amount;

  SELECT document_number INTO v_reference_no
  FROM next_document_number(p_company_id, p_branch_id, 'COD_SETTLEMENT', EXTRACT(YEAR FROM p_settlement_date)::SMALLINT, 'CS-');

  INSERT INTO courier_cod_settlements (
    company_id, branch_id, reference_no, courier_code, settlement_date,
    gross_cod_amount, fee_amount, adjustment_amount, net_received_amount,
    status, financial_account_id, created_by, posted_at
  ) VALUES (
    p_company_id, p_branch_id, v_reference_no, p_courier_code, p_settlement_date,
    p_gross_cod, p_fee_amount, p_adjustment_amount, v_net_received,
    'posted', p_financial_account_id, p_created_by, now()
  )
  RETURNING id INTO v_settlement_id;

  -- Get GL accounts
  SELECT chart_of_account_id INTO v_fa_coa FROM financial_accounts WHERE id = p_financial_account_id;
  SELECT * INTO v_policies FROM accounting_policies WHERE company_id = p_company_id;

  -- Post journal: Dr Cash/Bank (net), Dr Courier Fee, Dr/Cr Adjustment, Cr COD Receivable
  PERFORM post_journal_entry(
    p_company_id, p_branch_id, p_settlement_date,
    'COD Settlement ' || v_reference_no,
    jsonb_build_array(
      jsonb_build_object('account_id', v_fa_coa, 'debit', v_net_received, 'credit', 0, 'memo', 'Net received from ' || p_courier_code),
      jsonb_build_object('account_id', v_policies.courier_clearing_account_id, 'debit', p_fee_amount, 'credit', 0, 'memo', 'Courier fee'),
      CASE WHEN p_adjustment_amount > 0 THEN jsonb_build_object('account_id', v_policies.courier_clearing_account_id, 'debit', p_adjustment_amount, 'credit', 0, 'memo', 'Settlement adjustment')
           WHEN p_adjustment_amount < 0 THEN jsonb_build_object('account_id', v_policies.courier_clearing_account_id, 'debit', 0, 'credit', ABS(p_adjustment_amount), 'memo', 'Settlement adjustment')
           ELSE NULL END,
      jsonb_build_object('account_id', v_policies.courier_clearing_account_id, 'debit', 0, 'credit', p_gross_cod, 'memo', 'COD clearing')
    ),
    'courier_cod_settlement', 'courier_cod_settlement', v_settlement_id::text, p_created_by
  );

  RETURN QUERY SELECT v_settlement_id, v_reference_no;
END;
$$;

GRANT EXECUTE ON FUNCTION post_courier_cod_settlement TO app_role;

-- ──────────────────────────────────────────────────────────────────────
-- validate_combo_graph
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_combo_graph(
  p_company_id UUID,
  p_combo_product_id UUID,
  p_component_product_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_combo_type VARCHAR;
  v_component_type VARCHAR;
BEGIN
  IF p_combo_product_id = p_component_product_id THEN
    RAISE EXCEPTION 'Combo product cannot reference itself' USING ERRCODE = 'P0001';
  END IF;

  SELECT product_type INTO v_combo_type FROM products WHERE id = p_combo_product_id AND company_id = p_company_id;
  IF v_combo_type IS NULL THEN RAISE EXCEPTION 'Combo product not found' USING ERRCODE = 'P0002'; END IF;
  IF v_combo_type <> 'combo' THEN RAISE EXCEPTION 'Product is not a combo type' USING ERRCODE = 'P0001'; END IF;

  SELECT product_type INTO v_component_type FROM products WHERE id = p_component_product_id AND company_id = p_company_id;
  IF v_component_type = 'combo' THEN RAISE EXCEPTION 'Nested combos are not allowed' USING ERRCODE = 'P0001'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_combo_graph TO app_role;

-- ──────────────────────────────────────────────────────────────────────
-- post_landed_cost
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION post_landed_cost(
  p_company_id UUID,
  p_purchase_id UUID,
  p_cost_type VARCHAR,
  p_currency_code CHAR(3),
  p_exchange_rate DECIMAL(18,6),
  p_amount DECIMAL(18,2),
  p_allocation_method VARCHAR,
  p_created_by UUID
) RETURNS TABLE (landed_cost_id UUID, reference_no VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base_amount DECIMAL(18,2);
  v_reference_no VARCHAR;
  v_landed_cost_id UUID;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be > 0' USING ERRCODE = 'P0001'; END IF;
  v_base_amount := p_amount * p_exchange_rate;

  SELECT document_number INTO v_reference_no
  FROM next_document_number(p_company_id, NULL, 'LANDED_COST', EXTRACT(YEAR FROM now())::SMALLINT, 'LC-');

  INSERT INTO landed_cost_documents (
    company_id, purchase_id, reference_no, cost_type, currency_code, exchange_rate,
    amount, base_amount, allocation_method, status, created_by
  ) VALUES (
    p_company_id, p_purchase_id, v_reference_no, p_cost_type, p_currency_code, p_exchange_rate,
    p_amount, v_base_amount, p_allocation_method, 'posted', p_created_by
  )
  RETURNING id INTO v_landed_cost_id;

  RETURN QUERY SELECT v_landed_cost_id, v_reference_no;
END;
$$;

GRANT EXECUTE ON FUNCTION post_landed_cost TO app_role;

-- ──────────────────────────────────────────────────────────────────────
-- expire_held_sale_reservations
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION expire_held_sale_reservations()
 RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, company_id, warehouse_id, product_id
    FROM stock_reservations
    WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE stock_reservations SET status = 'expired', released_at = now() WHERE id = r.id;
    UPDATE warehouse_stocks SET qty_reserved = qty_reserved - (
      SELECT qty FROM stock_reservations WHERE id = r.id
    ), version = version + 1, updated_at = now()
    WHERE company_id = r.company_id AND warehouse_id = r.warehouse_id AND product_id = r.product_id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION expire_held_sale_reservations TO app_role;
