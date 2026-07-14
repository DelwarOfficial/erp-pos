-- prisma/functions/next_document_number.sql
-- §16 next_document_number()
-- SECURITY DEFINER function owned by function_owner (non-login).
--  Safe search_path. EXECUTE granted only to app_role.
-- 
--  Locks the document_sequences row FOR UPDATE, increments next_number,
--  returns formatted prefix+padded-number. Rollback of the parent
--  transaction also rolls back the increment.

CREATE OR REPLACE FUNCTION next_document_number(
  p_company_id    UUID,
  p_branch_id     UUID,  -- may be NULL for company-wide sequences
  p_document_type VARCHAR(40),
  p_fiscal_year   SMALLINT,
  p_prefix        VARCHAR(20),
  p_padding       SMALLINT DEFAULT 6
) RETURNS TABLE (document_number VARCHAR, sequence_id UUID, next_number BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sequence_id UUID;
  v_next_number BIGINT;
  v_formatted   VARCHAR;
BEGIN
  -- Validate company context matches the calling app_role's session setting
  IF current_setting('app.company_id', true) IS NULL
     OR current_setting('app.company_id', true)::uuid <> p_company_id THEN
    RAISE EXCEPTION 'Company context mismatch in next_document_number' USING ERRCODE = '42704';
  END IF;

  -- Find existing sequence row (branch-specific or company-wide)
  SELECT id, next_number INTO v_sequence_id, v_next_number
  FROM document_sequences
  WHERE company_id = p_company_id
    AND (branch_id IS NOT DISTINCT FROM p_branch_id)
    AND document_type = p_document_type
    AND fiscal_year = p_fiscal_year
  FOR UPDATE;  -- row-level lock

  IF v_sequence_id IS NULL THEN
    -- Create new sequence
    INSERT INTO document_sequences
      (company_id, branch_id, document_type, fiscal_year, prefix, next_number, padding, version)
    VALUES
      (p_company_id, p_branch_id, p_document_type, p_fiscal_year, p_prefix, 2, p_padding, 1)
    RETURNING id, next_number INTO v_sequence_id, v_next_number;
    v_next_number := 1;
  ELSE
    -- Atomically increment
    UPDATE document_sequences
      SET next_number = next_number + 1, version = version + 1
    WHERE id = v_sequence_id
    RETURNING next_number INTO v_next_number;
    v_next_number := v_next_number - 1;  -- value before increment is the issued number
  END IF;

  v_formatted := p_prefix || lpad(v_next_number::text, p_padding, '0');

  RETURN QUERY SELECT v_formatted, v_sequence_id, v_next_number;
END;
$$;

GRANT EXECUTE ON FUNCTION next_document_number(UUID, UUID, VARCHAR, SMALLINT, VARCHAR, SMALLINT) TO app_role;
