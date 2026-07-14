-- prisma/triggers/0002_prevent_posted_record_mutation.sql
-- §16 prevent_posted_record_mutation()
--  Posted journal_entries, journal_lines, stock_movements, serial_events,
-- payment_allocations, statutory_documents cannot be UPDATEd or DELETEd.
-- Corrections use reversal/return/refund/compensating entry.

CREATE OR REPLACE FUNCTION prevent_posted_record_mutation() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Cannot modify posted record (%) — use reversal/return/refund', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$;

-- Apply to posted accounting records (M4 tables — triggers created here for forward reference)
-- CREATE TRIGGER trg_journal_entries_immutable
--   BEFORE UPDATE OR DELETE ON journal_entries
--   FOR EACH ROW WHEN (OLD.status = 'posted')
--   EXECUTE FUNCTION prevent_posted_record_mutation();
--
-- CREATE TRIGGER trg_journal_lines_immutable
--   BEFORE UPDATE OR DELETE ON journal_lines
--   FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();
--
-- CREATE TRIGGER trg_stock_movements_immutable
--   BEFORE UPDATE OR DELETE ON stock_movements
--   FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();

-- Statutory documents (M0)
CREATE TRIGGER trg_statutory_documents_immutable
  BEFORE UPDATE OR DELETE ON statutory_documents
  FOR EACH ROW WHEN (OLD.status IN ('issued', 'filed'))
  EXECUTE FUNCTION prevent_posted_record_mutation();

-- Audit logs: never UPDATE or DELETE (append-only)
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (INSERT/SELECT allowed; UPDATE/DELETE forbidden) — attempted %', TG_OP
    USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER trg_audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER trg_audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
