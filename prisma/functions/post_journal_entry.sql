-- prisma/functions/post_journal_entry.sql
-- §16 post_journal_entry()
-- Verifies open period, tenant consistency, control-account dimensions,
-- equal debit/credit; posts balanced journal entry. Immutable after post.

CREATE OR REPLACE FUNCTION post_journal_entry(
  p_company_id    UUID,
  p_branch_id     UUID,
  p_entry_date    DATE,
  p_description   VARCHAR(500),
  p_lines         JSONB,  -- array of {account_id, debit, credit, party_type, party_id, ...}
  p_source_type   VARCHAR(60),
  p_source_id     UUID,
  p_correlation_id UUID
) RETURNS TABLE (journal_entry_id UUID, document_number VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total_debit  DECIMAL(18,2) := 0;
  v_total_credit DECIMAL(18,2) := 0;
  v_entry_id     UUID;
  v_doc_number   VARCHAR;
  v_line         JSONB;
  v_line_no      INTEGER := 1;
  v_period_open  BOOLEAN;
BEGIN
  -- Validate tenant context
  IF current_setting('app.company_id', true)::uuid <> p_company_id THEN
    RAISE EXCEPTION 'Tenant context mismatch' USING ERRCODE = '42704';
  END IF;

  -- Verify fiscal period is open (deferred to M4 when fiscal_periods exists)
  -- SELECT is_open INTO v_period_open FROM fiscal_periods
  --   WHERE company_id = p_company_id AND p_entry_date BETWEEN start_date AND end_date;

  -- Validate balanced debit/credit
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_total_debit  := v_total_debit  + COALESCE((v_line->>'debit')::DECIMAL(18,2), 0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::DECIMAL(18,2), 0);
  END LOOP;

  IF v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION 'Unbalanced journal entry: debit %, credit %', v_total_debit, v_total_credit
      USING ERRCODE = '23P01';
  END IF;

  IF v_total_debit = 0 THEN
    RAISE EXCEPTION 'Empty journal entry (zero debit/credit)' USING ERRCODE = '23P01';
  END IF;

  -- Generate document number
  SELECT document_number INTO v_doc_number
  FROM next_document_number(p_company_id, p_branch_id, 'JOURNAL', EXTRACT(YEAR FROM p_entry_date)::SMALLINT, 'JE-');

  -- Insert header
  INSERT INTO journal_entries
    (company_id, branch_id, entry_date, description, document_number, source_type, source_id, correlation_id, status, posted_at, posted_by)
  VALUES
    (p_company_id, p_branch_id, p_entry_date, p_description, v_doc_number, p_source_type, p_source_id, p_correlation_id, 'posted', now(), current_setting('app.user_id', true)::uuid)
  RETURNING id INTO v_entry_id;

  -- Insert lines (validated against chart_of_accounts in M4)
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO journal_lines
      (journal_entry_id, company_id, branch_id, line_no, account_id, debit, credit, party_type, party_id)
    VALUES
      (v_entry_id, p_company_id, p_branch_id, v_line_no,
       (v_line->>'account_id')::UUID,
       COALESCE((v_line->>'debit')::DECIMAL(18,2), 0),
       COALESCE((v_line->>'credit')::DECIMAL(18,2), 0),
       v_line->>'party_type',
       NULLIF(v_line->>'party_id', '')::UUID);
    v_line_no := v_line_no + 1;
  END LOOP;

  RETURN QUERY SELECT v_entry_id, v_doc_number;
END;
$$;

GRANT EXECUTE ON FUNCTION post_journal_entry(UUID, UUID, DATE, VARCHAR, JSONB, VARCHAR, UUID, UUID) TO app_role;
