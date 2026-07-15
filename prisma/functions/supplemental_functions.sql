-- 9 missing SQL functions per §16 prompt rule 9.
-- These are SECURITY DEFINER validation functions that enforce the same
-- invariants the TypeScript domain commands check, but at the SQL level
-- as defense-in-depth. They raise exceptions on violation.

-- 1. post_service_part_consumption — validates service parts are available in repair warehouse
CREATE OR REPLACE FUNCTION post_service_part_consumption(
  p_company_id UUID, p_service_request_id UUID, p_product_id UUID,
  p_warehouse_id UUID, p_qty DECIMAL(18,4), p_unit_cost DECIMAL(18,6),
  p_event_id UUID, p_created_by UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_movement_id UUID; v_stock RECORD;
BEGIN
  SELECT * INTO v_stock FROM warehouse_stocks
  WHERE company_id = p_company_id AND warehouse_id = p_warehouse_id AND product_id = p_product_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No stock found for product in repair warehouse' USING ERRCODE = 'P0001'; END IF;
  IF v_stock.qty_on_hand < p_qty THEN RAISE EXCEPTION 'Insufficient stock in repair warehouse (have: %, need: %)', v_stock.qty_on_hand, p_qty USING ERRCODE = 'P0001'; END IF;
  -- Call post_stock_movement for the actual movement
  SELECT * INTO v_movement_id FROM post_stock_movement(
    p_company_id, p_event_id, 1, p_warehouse_id, p_product_id,
    'sale_issue', -p_qty, p_unit_cost, 'service_part', p_service_request_id, p_created_by
  );
  RETURN v_movement_id;
END;
$$;

-- 2. post_expense — posts expense with journal (delegates to post_journal_entry)
CREATE OR REPLACE FUNCTION post_expense(
  p_company_id UUID, p_expense_id UUID, p_journal_entry_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE expenses SET journal_entry_id = p_journal_entry_id, status = 'posted', posted_at = now()
  WHERE id = p_expense_id AND company_id = p_company_id;
  RETURN FOUND;
END;
$$;

-- 3. validate_translation_override — validates translation key exists + value not empty
CREATE OR REPLACE FUNCTION validate_translation_override(
  p_company_id UUID, p_locale VARCHAR(10), p_translation_key VARCHAR(200), p_translated_value TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_translated_value IS NULL OR trim(p_translated_value) = '' THEN
    RAISE EXCEPTION 'Translation override value cannot be empty for key %', p_translation_key USING ERRCODE = 'P0001';
  END IF;
  IF p_locale NOT IN ('bn-BD', 'en-BD') THEN
    RAISE EXCEPTION 'Unsupported locale: % (must be bn-BD or en-BD)', p_locale USING ERRCODE = 'P0001';
  END IF;
  RETURN true;
END;
$$;

-- 4. validate_return_quantities — validates return qty <= original sale qty - already returned
CREATE OR REPLACE FUNCTION validate_return_quantities(
  p_sale_id UUID, p_sale_item_id UUID, p_return_qty DECIMAL(18,4)
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_original_qty DECIMAL(18,4); v_already_returned DECIMAL(18,4);
BEGIN
  SELECT qty INTO v_original_qty FROM sale_items WHERE id = p_sale_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale item not found' USING ERRCODE = 'P0001'; END IF;
  SELECT COALESCE(SUM(qty), 0) INTO v_already_returned FROM sale_return_items WHERE sale_item_id = p_sale_item_id;
  IF p_return_qty > v_original_qty - v_already_returned THEN
    RAISE EXCEPTION 'Return qty % exceeds available (original: %, already returned: %)', p_return_qty, v_original_qty, v_already_returned USING ERRCODE = 'P0001';
  END IF;
  RETURN true;
END;
$$;

-- 5. validate_stock_count_posting — validates count variance is within tolerance
CREATE OR REPLACE FUNCTION validate_stock_count_posting(
  p_company_id UUID, p_stock_count_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_item RECORD;
BEGIN
  FOR v_item IN SELECT * FROM stock_count_items WHERE stock_count_id = p_stock_count_id LOOP
    IF v_item.counted_qty IS NULL THEN
      RAISE EXCEPTION 'Stock count item % has no counted quantity', v_item.id USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- 6. post_stock_adjustment — posts adjustment via post_stock_movement
CREATE OR REPLACE FUNCTION post_stock_adjustment(
  p_company_id UUID, p_warehouse_id UUID, p_product_id UUID,
  p_adjustment_type VARCHAR, p_qty_delta DECIMAL(18,4), p_reason VARCHAR,
  p_event_id UUID, p_created_by UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_movement_id UUID; v_movement_type VARCHAR;
BEGIN
  v_movement_type := CASE WHEN p_qty_delta > 0 THEN 'adjustment_in' ELSE 'adjustment_out' END;
  SELECT movement_id INTO v_movement_id FROM post_stock_movement(
    p_company_id, p_event_id, 1, p_warehouse_id, p_product_id,
    v_movement_type::VARCHAR, p_qty_delta, 0, 'stock_adjustment', p_reason, p_created_by
  );
  RETURN v_movement_id;
END;
$$;

-- 7. create_or_update_stock_reservation — creates/reserves stock
CREATE OR REPLACE FUNCTION create_or_update_stock_reservation(
  p_company_id UUID, p_warehouse_id UUID, p_product_id UUID,
  p_qty DECIMAL(18,4), p_expires_at TIMESTAMPTZ, p_created_by UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_reservation_id UUID; v_stock RECORD;
BEGIN
  SELECT * INTO v_stock FROM warehouse_stocks
  WHERE company_id = p_company_id AND warehouse_id = p_warehouse_id AND product_id = p_product_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No stock found' USING ERRCODE = 'P0001'; END IF;
  IF v_stock.qty_on_hand - v_stock.qty_reserved < p_qty THEN
    RAISE EXCEPTION 'Insufficient available stock (on_hand: %, reserved: %, requested: %)', v_stock.qty_on_hand, v_stock.qty_reserved, p_qty USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO stock_reservations (id, company_id, warehouse_id, product_id, qty, status, expires_at, created_at)
  VALUES (gen_random_uuid(), p_company_id, p_warehouse_id, p_product_id, p_qty, 'active', p_expires_at, now())
  RETURNING id INTO v_reservation_id;
  UPDATE warehouse_stocks SET qty_reserved = qty_reserved + p_qty WHERE id = v_stock.id;
  RETURN v_reservation_id;
END;
$$;

-- 8. consume_stock_reservation — marks reservation as consumed
CREATE OR REPLACE FUNCTION consume_stock_reservation(
  p_reservation_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_res RECORD;
BEGIN
  SELECT * INTO v_res FROM stock_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found' USING ERRCODE = 'P0001'; END IF;
  IF v_res.status != 'active' THEN RAISE EXCEPTION 'Reservation is not active (status: %)', v_res.status USING ERRCODE = 'P0001'; END IF;
  UPDATE stock_reservations SET status = 'consumed', consumed_at = now() WHERE id = p_reservation_id;
  UPDATE warehouse_stocks SET qty_reserved = qty_reserved - v_res.qty
  WHERE warehouse_id = v_res.warehouse_id AND product_id = v_res.product_id AND company_id = v_res.company_id;
  RETURN true;
END;
$$;

-- 9. reverse_stock_movement — creates opposite movement
CREATE OR REPLACE FUNCTION reverse_stock_movement(
  p_original_movement_id UUID, p_reason VARCHAR, p_created_by UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_orig RECORD; v_new_id UUID;
BEGIN
  SELECT * INTO v_orig FROM stock_movements WHERE id = p_original_movement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original movement not found' USING ERRCODE = 'P0001'; END IF;
  SELECT movement_id INTO v_new_id FROM post_stock_movement(
    v_orig.company_id, v_orig.event_id, v_orig.event_line_no + 1000,
    v_orig.warehouse_id, v_orig.product_id, 'reversal'::VARCHAR,
    -v_orig.qty_delta, v_orig.unit_cost, 'reversal', p_original_movement_id, p_created_by
  );
  RETURN v_new_id;
END;
$$;

-- Grant execute to app_role
GRANT EXECUTE ON FUNCTION post_service_part_consumption TO app_role;
GRANT EXECUTE ON FUNCTION post_expense TO app_role;
GRANT EXECUTE ON FUNCTION validate_translation_override TO app_role;
GRANT EXECUTE ON FUNCTION validate_return_quantities TO app_role;
GRANT EXECUTE ON FUNCTION validate_stock_count_posting TO app_role;
GRANT EXECUTE ON FUNCTION post_stock_adjustment TO app_role;
GRANT EXECUTE ON FUNCTION create_or_update_stock_reservation TO app_role;
GRANT EXECUTE ON FUNCTION consume_stock_reservation TO app_role;
GRANT EXECUTE ON FUNCTION reverse_stock_movement TO app_role;
