-- prisma/functions/missing_functions.sql
-- The 9 missing SECURITY DEFINER functions per §16 + prompt rule 9.
-- All functions: LANGUAGE plpgsql, SECURITY DEFINER, SET search_path = public, pg_temp.
-- Owned by function_owner (non-login role). EXECUTE granted to app_role.

-- ══════════════════════════════════════════════════════════════════════
-- 1. validate_typed_configuration
--    Validates that a JSONB configuration value conforms to the registered
--    schema in configuration_definitions. Called as a BEFORE INSERT/UPDATE
--    trigger on configuration_values, or directly by the app before COMMIT.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION validate_typed_configuration(
  p_config_key VARCHAR,
  p_value JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_def RECORD;
  v_schema JSONB;
  v_expected_type VARCHAR;
  v_actual_type VARCHAR;
  v_req VARCHAR;
BEGIN
  SELECT * INTO v_def FROM configuration_definitions WHERE key = p_config_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuration key % is not registered in configuration_definitions', p_config_key
      USING ERRCODE = 'P0001';
  END IF;

  IF v_def.json_schema IS NULL OR v_def.json_schema = '' THEN
    RETURN true;
  END IF;

  BEGIN
    v_schema := v_def.json_schema::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN true;
  END;

  IF v_schema ? 'required' AND jsonb_typeof(v_schema->'required') = 'array' THEN
    FOR v_req IN SELECT jsonb_array_elements_text(v_schema->'required') LOOP
      IF NOT (p_value ? v_req) THEN
        RAISE EXCEPTION 'Configuration % missing required field: %', p_config_key, v_req
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  IF v_schema ? 'type' THEN
    v_expected_type := v_schema->>'type';
    v_actual_type := jsonb_typeof(p_value);
    IF v_expected_type = 'object' AND v_actual_type != 'object' THEN
      RAISE EXCEPTION 'Configuration % must be a JSON object, got %', p_config_key, v_actual_type USING ERRCODE = 'P0001';
    ELSIF v_expected_type = 'array' AND v_actual_type != 'array' THEN
      RAISE EXCEPTION 'Configuration % must be a JSON array, got %', p_config_key, v_actual_type USING ERRCODE = 'P0001';
    ELSIF v_expected_type = 'string' AND v_actual_type != 'string' THEN
      RAISE EXCEPTION 'Configuration % must be a JSON string, got %', p_config_key, v_actual_type USING ERRCODE = 'P0001';
    ELSIF v_expected_type = 'boolean' AND v_actual_type != 'boolean' THEN
      RAISE EXCEPTION 'Configuration % must be a JSON boolean, got %', p_config_key, v_actual_type USING ERRCODE = 'P0001';
    ELSIF v_expected_type = 'number' AND v_actual_type != 'number' THEN
      RAISE EXCEPTION 'Configuration % must be a JSON number, got %', p_config_key, v_actual_type USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_typed_configuration TO app_role;

-- ══════════════════════════════════════════════════════════════════════
-- 2. validate_fefo_override
--    Validates that a FEFO (First-Expiry-First-Out) override has an approved
--    approval_request. Called before posting a stock movement that overrides
--    the natural FEFO order.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION validate_fefo_override(
  p_company_id UUID,
  p_warehouse_id UUID,
  p_product_id UUID,
  p_batch_id UUID,
  p_override_reason VARCHAR
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product RECORD;
  v_batch RECORD;
  v_earlier_batch RECORD;
  v_approval RECORD;
BEGIN
  -- Only applies to products with batch tracking enabled
  SELECT track_batches INTO v_product FROM products WHERE id = p_product_id AND company_id = p_company_id;
  IF NOT FOUND OR NOT v_product.track_batches THEN
    RETURN true; -- FEFO doesn't apply to non-batch products
  END IF;

  -- Get the batch being issued
  SELECT * INTO v_batch FROM product_batches WHERE id = p_batch_id AND product_id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch % not found for product %', p_batch_id, p_product_id USING ERRCODE = 'P0001';
  END IF;

  -- Check if there are earlier-expiring batches with available stock
  SELECT * INTO v_earlier_batch
  FROM product_batches
  WHERE product_id = p_product_id
    AND warehouse_id = p_warehouse_id
    AND expiry_date IS NOT NULL
    AND expiry_date < v_batch.expiry_date
    AND qty_on_hand > 0
  ORDER BY expiry_date ASC
  LIMIT 1;

  -- If no earlier batch exists, no override needed
  IF NOT FOUND THEN
    RETURN true;
  END IF;

  -- Override is needed — require an approved approval_request
  SELECT * INTO v_approval
  FROM approval_requests
  WHERE company_id = p_company_id
    AND request_type = 'fefo_override'
    AND entity_type = 'product_batch'
    AND entity_id = p_batch_id
    AND status = 'approved'
  ORDER BY resolved_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FEFO override requires approved approval_request (earlier batch % expires %, issuing batch % expires %)',
      v_earlier_batch.id, v_earlier_batch.expiry_date, v_batch.id, v_batch.expiry_date
      USING ERRCODE = 'P0001';
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_fefo_override TO app_role;

-- ══════════════════════════════════════════════════════════════════════
-- 3. validate_accounting_policies
--    Conditional CHECKs: if purchasing module is enabled, grni_account_id
--    must be non-null; if service module is enabled, service_cogs_account_id
--    + repair_wip_account_id must be non-null; if cheques are used,
--    cheque_clearing_account_id must be non-null.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION validate_accounting_policies(
  p_company_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy RECORD;
  v_purchasing_enabled BOOLEAN := false;
  v_service_enabled BOOLEAN := false;
  v_cheques_used BOOLEAN := false;
  v_ff RECORD;
BEGIN
  SELECT * INTO v_policy FROM accounting_policies WHERE company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accounting policies not configured for company %', p_company_id USING ERRCODE = 'P0001';
  END IF;

  -- Check feature flags
  SELECT * INTO v_ff FROM feature_flags WHERE company_id = p_company_id AND flag_key = 'purchase_module';
  IF FOUND AND v_ff.enabled THEN v_purchasing_enabled := true; END IF;

  SELECT * INTO v_ff FROM feature_flags WHERE company_id = p_company_id AND flag_key = 'service_desk';
  IF FOUND AND v_ff.enabled THEN v_service_enabled := true; END IF;

  -- Check if any payments use cheque method
  PERFORM 1 FROM payments WHERE company_id = p_company_id AND payment_method = 'cheque' LIMIT 1;
  IF FOUND THEN v_cheques_used := true; END IF;

  -- Conditional validations
  IF v_purchasing_enabled AND v_policy.grni_account_id IS NULL THEN
    RAISE EXCEPTION 'Purchasing module is enabled but grni_account_id is not set' USING ERRCODE = 'P0001';
  END IF;

  IF v_service_enabled AND v_policy.service_cogs_account_id IS NULL THEN
    RAISE EXCEPTION 'Service module is enabled but service_cogs_account_id is not set' USING ERRCODE = 'P0001';
  END IF;

  IF v_service_enabled AND v_policy.repair_wip_account_id IS NULL THEN
    RAISE EXCEPTION 'Service module is enabled but repair_wip_account_id is not set' USING ERRCODE = 'P0001';
  END IF;

  IF v_cheques_used AND v_policy.cheque_clearing_account_id IS NULL THEN
    RAISE EXCEPTION 'Cheques are used but cheque_clearing_account_id is not set' USING ERRCODE = 'P0001';
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_accounting_policies TO app_role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. validate_landed_cost_allocation
--    Validates that landed cost allocation method is valid and amounts
--    sum to the total landed cost document amount.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION validate_landed_cost_allocation(
  p_landed_cost_doc_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doc RECORD;
  v_total_allocated DECIMAL(18,2);
  v_valid_methods VARCHAR[] := ARRAY['quantity', 'value', 'weight', 'manual'];
  v_method VARCHAR;
BEGIN
  SELECT * INTO v_doc FROM landed_cost_documents WHERE id = p_landed_cost_doc_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Landed cost document % not found', p_landed_cost_doc_id USING ERRCODE = 'P0001';
  END IF;

  -- Validate allocation method
  IF NOT (v_doc.allocation_method = ANY(v_valid_methods)) THEN
    RAISE EXCEPTION 'Invalid allocation method: % (must be quantity/value/weight/manual)', v_doc.allocation_method
      USING ERRCODE = 'P0001';
  END IF;

  -- Sum allocated amounts
  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_total_allocated
  FROM landed_cost_allocations WHERE landed_cost_document_id = p_landed_cost_doc_id;

  -- Check that total allocated equals total document amount (within 0.01 tolerance)
  IF ABS(v_total_allocated - v_doc.total_amount) > 0.01 THEN
    RAISE EXCEPTION 'Landed cost allocation mismatch: allocated % vs document total %',
      v_total_allocated, v_doc.total_amount USING ERRCODE = 'P0001';
  END IF;

  -- Each allocation line must reference a valid purchase item
  PERFORM 1
  FROM landed_cost_allocations lca
  LEFT JOIN purchase_items pi ON pi.id = lca.purchase_item_id
  WHERE lca.landed_cost_document_id = p_landed_cost_doc_id
    AND pi.id IS NULL;
  IF FOUND THEN
    RAISE EXCEPTION 'One or more allocation lines reference invalid purchase items' USING ERRCODE = 'P0001';
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_landed_cost_allocation TO app_role;

-- ══════════════════════════════════════════════════════════════════════
-- 5. post_gift_card_refund
--    Restores gift card balance with sale_return_id required.
--    Posts a gift_card_transactions row with entry_type='refund'.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION post_gift_card_refund(
  p_company_id UUID,
  p_gift_card_id UUID,
  p_amount DECIMAL(18,2),
  p_sale_return_id UUID,
  p_event_id UUID,
  p_created_by UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_txn_id UUID;
  v_gift_card RECORD;
BEGIN
  -- Validate gift card exists and belongs to company
  SELECT * INTO v_gift_card FROM gift_cards WHERE id = p_gift_card_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card % not found', p_gift_card_id USING ERRCODE = 'P0001';
  END IF;

  -- sale_return_id is REQUIRED for refunds (§20.D17)
  IF p_sale_return_id IS NULL THEN
    RAISE EXCEPTION 'Gift card refund requires sale_return_id (§20.D17)' USING ERRCODE = 'P0001';
  END IF;

  -- Validate amount is positive
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Refund amount must be positive' USING ERRCODE = 'P0001';
  END IF;

  -- Create the refund transaction (amount_delta is positive — restores balance)
  INSERT INTO gift_card_transactions (
    id, company_id, gift_card_id, entry_type, amount_delta,
    sale_return_id, event_id, created_by, created_at
  ) VALUES (
    gen_random_uuid(), p_company_id, p_gift_card_id, 'refund', p_amount,
    p_sale_return_id, p_event_id, p_created_by, now()
  )
  RETURNING id INTO v_txn_id;

  -- Reactivate gift card if it was fully redeemed
  IF v_gift_card.status = 'redeemed' THEN
    UPDATE gift_cards SET status = 'active' WHERE id = p_gift_card_id;
  END IF;

  RETURN v_txn_id;
END;
$$;

GRANT EXECUTE ON FUNCTION post_gift_card_refund TO app_role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. validate_currency_account_match
--    Validates that payment currency matches financial account currency.
--    Allows payment in base currency to any account; foreign-currency
--    payments must go to a matching-currency account.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION validate_currency_account_match(
  p_payment_currency VARCHAR,
  p_financial_account_id UUID,
  p_company_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account RECORD;
  v_base_currency VARCHAR;
BEGIN
  SELECT * INTO v_account FROM financial_accounts
  WHERE id = p_financial_account_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Financial account % not found', p_financial_account_id USING ERRCODE = 'P0001';
  END IF;

  -- Get company base currency
  SELECT base_currency_code INTO v_base_currency FROM companies WHERE id = p_company_id;
  IF v_base_currency IS NULL THEN v_base_currency := 'BDT'; END IF;

  -- If payment is in base currency, allow any account
  IF p_payment_currency = v_base_currency THEN
    RETURN true;
  END IF;

  -- Foreign-currency payment: account currency must match
  IF v_account.currency_code != p_payment_currency THEN
    RAISE EXCEPTION 'Currency mismatch: payment is % but account % is % (base: %)',
      p_payment_currency, v_account.name, v_account.currency_code, v_base_currency
      USING ERRCODE = 'P0001';
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_currency_account_match TO app_role;

-- ══════════════════════════════════════════════════════════════════════
-- 7. post_store_credit_from_return
--    Creates a customer_advance_ledger store_credit_issued entry for a
--    sale return refund issued as store credit.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION post_store_credit_from_return(
  p_company_id UUID,
  p_customer_id UUID,
  p_sale_return_id UUID,
  p_amount DECIMAL(18,2),
  p_event_id UUID,
  p_created_by UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ledger_id UUID;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Store credit amount must be positive' USING ERRCODE = 'P0001';
  END IF;

  IF p_sale_return_id IS NULL THEN
    RAISE EXCEPTION 'Store credit from return requires sale_return_id' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO customer_advance_ledger (
    id, company_id, customer_id, entry_type, amount, balance_after,
    sale_return_id, event_id, created_by, created_at
  ) VALUES (
    gen_random_uuid(), p_company_id, p_customer_id, 'store_credit_issued', p_amount, p_amount,
    p_sale_return_id, p_event_id, p_created_by, now()
  )
  RETURNING id INTO v_ledger_id;

  RETURN v_ledger_id;
END;
$$;

GRANT EXECUTE ON FUNCTION post_store_credit_from_return TO app_role;

-- ══════════════════════════════════════════════════════════════════════
-- 8. post_opening_stock
--    Posts opening stock movements for a warehouse. Sets initial qty_on_hand
--    and moving_average_cost. Creates warehouse_stocks row if not exists.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION post_opening_stock(
  p_company_id UUID,
  p_warehouse_id UUID,
  p_product_id UUID,
  p_qty DECIMAL(18,4),
  p_unit_cost DECIMAL(18,6),
  p_event_id UUID,
  p_created_by UUID
) RETURNS TABLE (movement_id UUID, qty_on_hand DECIMAL, mac DECIMAL)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stock_id UUID;
  v_movement_id UUID;
  v_new_qty DECIMAL(18,4);
  v_new_mac DECIMAL(18,6);
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'Opening stock quantity must be positive' USING ERRCODE = 'P0001';
  END IF;

  -- Lock or create warehouse_stocks row
  INSERT INTO warehouse_stocks (id, company_id, warehouse_id, product_id, qty_on_hand, qty_reserved, moving_average_cost, version, updated_at)
  VALUES (gen_random_uuid(), p_company_id, p_warehouse_id, p_product_id, 0, 0, 0, 1, now())
  ON CONFLICT (company_id, warehouse_id, product_id) DO NOTHING
  RETURNING id INTO v_stock_id;

  IF v_stock_id IS NULL THEN
    SELECT id INTO v_stock_id FROM warehouse_stocks
    WHERE company_id = p_company_id AND warehouse_id = p_warehouse_id AND product_id = p_product_id
    FOR UPDATE;
  END IF;

  -- Calculate new qty + MAC (opening stock = inbound, recalculates MAC)
  v_new_qty := p_qty; -- opening stock starts fresh
  v_new_mac := p_unit_cost;

  -- Update warehouse_stocks
  UPDATE warehouse_stocks
  SET qty_on_hand = v_new_qty,
      moving_average_cost = v_new_mac,
      version = version + 1,
      updated_at = now()
  WHERE id = v_stock_id;

  -- Post stock movement
  INSERT INTO stock_movements (
    id, company_id, event_id, event_line_no, warehouse_id, product_id,
    stock_bucket, movement_type, qty_delta, unit_cost, total_cost_delta,
    reference_type, reference_id, effective_at, posted_at, created_by
  ) VALUES (
    gen_random_uuid(), p_company_id, p_event_id, 1, p_warehouse_id, p_product_id,
    'on_hand', 'opening_stock', p_qty, p_unit_cost, p_qty * p_unit_cost,
    'opening_stock', p_event_id, now(), now(), p_created_by
  )
  RETURNING id INTO v_movement_id;

  RETURN QUERY SELECT v_movement_id, v_new_qty, v_new_mac;
END;
$$;

GRANT EXECUTE ON FUNCTION post_opening_stock TO app_role;

-- ══════════════════════════════════════════════════════════════════════
-- 9. post_account_transfer
--    Two-account lock in canonical UUID order; same-currency
--    (from_amount=to_amount, rate=1) vs cross-currency (realized gain/loss).
--    Posts a journal entry with the transfer + any FX gain/loss.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION post_account_transfer(
  p_company_id UUID,
  p_from_account_id UUID,
  p_to_account_id UUID,
  p_from_amount DECIMAL(18,2),
  p_to_amount DECIMAL(18,2),
  p_exchange_rate DECIMAL(18,6),
  p_description VARCHAR,
  p_event_id UUID,
  p_created_by UUID,
  p_branch_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from_account RECORD;
  v_to_account RECORD;
  v_transfer_id UUID;
  v_journal_id UUID;
  v_is_same_currency BOOLEAN;
  v_fx_gain_loss DECIMAL(18,2) := 0;
  v_first_id UUID;
  v_second_id UUID;
  v_from_coa_id UUID;
  v_to_coa_id UUID;
  v_line_no INTEGER := 1;
BEGIN
  -- Validate accounts exist and belong to company
  SELECT * INTO v_from_account FROM financial_accounts WHERE id = p_from_account_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'From account % not found', p_from_account_id USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_to_account FROM financial_accounts WHERE id = p_to_account_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'To account % not found', p_to_account_id USING ERRCODE = 'P0001';
  END IF;

  -- Cannot transfer to the same account
  IF p_from_account_id = p_to_account_id THEN
    RAISE EXCEPTION 'Cannot transfer to the same account' USING ERRCODE = 'P0001';
  END IF;

  -- Determine same vs cross currency
  v_is_same_currency := (v_from_account.currency_code = v_to_account.currency_code);

  -- Validate amounts
  IF p_from_amount <= 0 OR p_to_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amounts must be positive' USING ERRCODE = 'P0001';
  END IF;

  IF v_is_same_currency AND p_from_amount != p_to_amount THEN
    RAISE EXCEPTION 'Same-currency transfer requires from_amount = to_amount' USING ERRCODE = 'P0001';
  END IF;

  -- Lock accounts in canonical UUID order (prevent deadlocks)
  IF p_from_account_id < p_to_account_id THEN
    v_first_id := p_from_account_id;
    v_second_id := p_to_account_id;
  ELSE
    v_first_id := p_to_account_id;
    v_second_id := p_from_account_id;
  END IF;
  PERFORM 1 FROM financial_accounts WHERE id = v_first_id FOR UPDATE;
  PERFORM 1 FROM financial_accounts WHERE id = v_second_id FOR UPDATE;

  -- Get chart of account IDs for journal lines
  SELECT chart_of_account_id INTO v_from_coa_id FROM financial_accounts WHERE id = p_from_account_id;
  SELECT chart_of_account_id INTO v_to_coa_id FROM financial_accounts WHERE id = p_to_account_id;

  -- Calculate FX gain/loss for cross-currency
  IF NOT v_is_same_currency THEN
    -- FX gain/loss = to_amount (in base) - from_amount (in base)
    -- Simplified: assumes from_amount is already in base currency
    v_fx_gain_loss := p_to_amount - (p_from_amount * p_exchange_rate);
  END IF;

  -- Create account_transfer record
  INSERT INTO account_transfers (
    id, company_id, from_financial_account_id, to_financial_account_id,
    from_amount, to_amount, exchange_rate, description, status,
    event_id, branch_id, created_by, created_at
  ) VALUES (
    gen_random_uuid(), p_company_id, p_from_account_id, p_to_account_id,
    p_from_amount, p_to_amount, p_exchange_rate, p_description, 'posted',
    p_event_id, p_branch_id, p_created_by, now()
  )
  RETURNING id INTO v_transfer_id;

  -- Post journal entry
  INSERT INTO journal_entries (
    id, company_id, entry_no, event_id, posting_kind, entry_date, posting_date,
    source_type, source_id, currency_code, exchange_rate, description,
    status, created_by, posted_by, posted_at, created_at
  ) VALUES (
    gen_random_uuid(), p_company_id,
    'AT-' || to_char(now(), 'YYYYMMDDHH24MISSMS'),
    p_event_id, 'account_transfer', now(), now(),
    'account_transfer', v_transfer_id,
    v_from_account.currency_code, COALESCE(p_exchange_rate, 1),
    p_description, 'posted', p_created_by, p_created_by, now(), now()
  )
  RETURNING id INTO v_journal_id;

  -- Journal lines: Cr From account, Dr To account
  INSERT INTO journal_lines (
    id, company_id, journal_entry_id, line_no, branch_id,
    chart_of_account_id, financial_account_id,
    debit_base, credit_base, memo
  ) VALUES (
    gen_random_uuid(), p_company_id, v_journal_id, v_line_no, p_branch_id,
    v_from_coa_id, p_from_account_id,
    0, p_from_amount, 'Transfer out'
  );
  v_line_no := v_line_no + 1;

  INSERT INTO journal_lines (
    id, company_id, journal_entry_id, line_no, branch_id,
    chart_of_account_id, financial_account_id,
    debit_base, credit_base, memo
  ) VALUES (
    gen_random_uuid(), p_company_id, v_journal_id, v_line_no, p_branch_id,
    v_to_coa_id, p_to_account_id,
    p_to_amount, 0, 'Transfer in'
  );

  -- If cross-currency with FX gain/loss, post a third line
  IF v_fx_gain_loss != 0 THEN
    v_line_no := v_line_no + 1;
    DECLARE
      v_fx_account_id UUID;
    BEGIN
      SELECT exchange_gain_loss_account_id INTO v_fx_account_id
      FROM accounting_policies WHERE company_id = p_company_id;
      IF v_fx_account_id IS NULL THEN
        RAISE EXCEPTION 'exchange_gain_loss_account_id not configured for company %', p_company_id USING ERRCODE = 'P0001';
      END IF;

      IF v_fx_gain_loss > 0 THEN
        -- Gain: Cr FX gain/loss
        INSERT INTO journal_lines (
          id, company_id, journal_entry_id, line_no, branch_id,
          chart_of_account_id, debit_base, credit_base, memo
        ) VALUES (
          gen_random_uuid(), p_company_id, v_journal_id, v_line_no, p_branch_id,
          v_fx_account_id, 0, v_fx_gain_loss, 'FX gain'
        );
      ELSE
        -- Loss: Dr FX gain/loss
        INSERT INTO journal_lines (
          id, company_id, journal_entry_id, line_no, branch_id,
          chart_of_account_id, debit_base, credit_base, memo
        ) VALUES (
          gen_random_uuid(), p_company_id, v_journal_id, v_line_no, p_branch_id,
          v_fx_account_id, ABS(v_fx_gain_loss), 0, 'FX loss'
        );
      END IF;
    END;
  END IF;

  RETURN v_transfer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION post_account_transfer TO app_role;
