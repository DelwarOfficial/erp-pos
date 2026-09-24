-- F-26: enforce the double-entry invariant in the database.
--
-- There was a per-line CHECK that a line is debit XOR credit, and no
-- entry-level constraint at all. The balance rule lived entirely in
-- postJournalEntry, so any path writing journal_lines outside it -- a repair
-- script, a bulk import, a raw query -- could leave the ledger permanently
-- unbalanced with nothing detecting it.
--
-- PostgreSQL is the historical target (ADR 0007 moved production to MariaDB)
-- and its journal schema has diverged from the application's, so this mirrors
-- the MariaDB invariant rather than sharing a definition with it. The MariaDB
-- version is prisma/mariadb/migrations/20260924000100_ledger_and_stock_invariants.
--
-- Postgres does support deferred constraints, so the enforcement here is the
-- stronger form: the check runs once, at COMMIT, against the finished entry.
-- No declared totals are needed on the header.

BEGIN;

CREATE OR REPLACE FUNCTION assert_journal_entry_balanced() RETURNS TRIGGER AS $$
DECLARE
  entry_key UUID;
  total_debit NUMERIC;
  total_credit NUMERIC;
  line_count INT;
BEGIN
  entry_key := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

  SELECT COUNT(*), COALESCE(SUM(debit_base), 0), COALESCE(SUM(credit_base), 0)
    INTO line_count, total_debit, total_credit
    FROM journal_lines
   WHERE journal_entry_id = entry_key;

  -- Every line of the entry was removed: nothing left to balance.
  IF line_count = 0 THEN
    RETURN NULL;
  END IF;

  IF line_count < 2 THEN
    RAISE EXCEPTION 'JOURNAL_ENTRY_TOO_FEW_LINES: entry % has % line(s)', entry_key, line_count;
  END IF;

  IF total_debit <> total_credit THEN
    RAISE EXCEPTION 'JOURNAL_ENTRY_UNBALANCED: entry % has debit % and credit %',
      entry_key, total_debit, total_credit;
  END IF;

  IF total_debit = 0 THEN
    RAISE EXCEPTION 'JOURNAL_ENTRY_EMPTY: entry % sums to zero', entry_key;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- DEFERRABLE INITIALLY DEFERRED is what makes this workable: postJournalEntry
-- inserts the lines one at a time, so an immediate check would fail on the
-- first line of every entry ever posted.
DROP TRIGGER IF EXISTS trg_journal_lines_balanced ON journal_lines;
CREATE CONSTRAINT TRIGGER trg_journal_lines_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION assert_journal_entry_balanced();

COMMIT;

-- ──────────────────────────────────────────────────────────────────────────
-- Verification
-- ──────────────────────────────────────────────────────────────────────────
SELECT '=== Journal balance constraint installed ===' AS info;
SELECT tgname, tgdeferrable, tginitdeferred
FROM pg_trigger
WHERE tgname = 'trg_journal_lines_balanced';
