-- 0018_journal_payment_immutable_triggers.sql
-- Apply prevent_posted_record_mutation trigger to journal_entries, journal_lines, payment_allocations.
-- Per §20.0 Architecture Control #3 — posted ledgers are IMMUTABLE.

-- Journal entries: immutable once status='posted'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='journal_entries') THEN
    DROP TRIGGER IF EXISTS trg_journal_entries_immutable ON journal_entries;
    CREATE TRIGGER trg_journal_entries_immutable
      BEFORE UPDATE OR DELETE ON journal_entries
      FOR EACH ROW WHEN (OLD.status = 'posted')
      EXECUTE FUNCTION prevent_posted_record_mutation();
  END IF;
END $$;

-- Journal lines: immutable (always — no draft state for lines)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='journal_lines') THEN
    DROP TRIGGER IF EXISTS trg_journal_lines_immutable ON journal_lines;
    CREATE TRIGGER trg_journal_lines_immutable
      BEFORE UPDATE OR DELETE ON journal_lines
      FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();
  END IF;
END $$;

-- Payment allocations: immutable (always)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='payment_allocations') THEN
    DROP TRIGGER IF EXISTS trg_payment_allocations_immutable ON payment_allocations;
    CREATE TRIGGER trg_payment_allocations_immutable
      BEFORE UPDATE OR DELETE ON payment_allocations
      FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();
  END IF;
END $$;

-- Also add journal_lines exactly-one-of debit/credit CHECK (§4 rule 1 + M4 task 1)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='journal_lines') THEN
    ALTER TABLE journal_lines
      ADD CONSTRAINT journal_lines_debit_xor_credit_chk
      CHECK ((debit_base > 0 AND credit_base = 0) OR (debit_base = 0 AND credit_base > 0));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add missing schema CHECKs (§4 rules)
-- supplier_advance_ledger exactly-one-source CHECK
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='supplier_advance_ledger') THEN
    ALTER TABLE supplier_advance_ledger
      ADD CONSTRAINT supplier_advance_exactly_one_source_chk
      CHECK (
        (payment_id IS NOT NULL)::int +
        (purchase_return_id IS NOT NULL)::int = 1
      );
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- transfer_items: qty_dispatched <= qty_requested, qty_received <= qty_dispatched
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='transfer_items') THEN
    ALTER TABLE transfer_items
      ADD CONSTRAINT transfer_items_qty_dispatched_chk CHECK (qty_dispatched <= qty_requested);
    ALTER TABLE transfer_items
      ADD CONSTRAINT transfer_items_qty_received_chk CHECK (qty_received <= qty_dispatched);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- stock_budget_leases: qty_consumed <= qty_granted
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='stock_budget_leases') THEN
    ALTER TABLE stock_budget_leases
      ADD CONSTRAINT stock_budget_qty_consumed_chk CHECK (qty_consumed <= qty_granted);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- risk_assessments: expires_at > assessed_at
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='risk_assessments') THEN
    ALTER TABLE risk_assessments
      ADD CONSTRAINT risk_assessments_expires_after_assessed_chk
      CHECK (expires_at > assessed_at);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
