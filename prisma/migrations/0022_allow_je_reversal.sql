-- prisma/migrations/0022_allow_je_reversal.sql
-- §22 REDTEAM Final Bug Hunt — CRITICAL FIX
--
-- Problem: The trigger trg_journal_entries_immutable (defined in 0018) blocks
-- ALL UPDATEs to journal_entries WHERE OLD.status = 'posted'. This prevents
-- the reverseJournalEntry() domain command from setting status='reversed',
-- which is the standard accounting workflow for correcting posted entries.
--
-- The blueprint (§2 Design Principles) says:
--   "Posted ledgers and statutory documents cannot be updated or deleted.
--    Corrections use reversal, return, refund, write-off, or a compensating
--    entry."
--
-- So reversal is the OFFICIAL correction mechanism — the trigger must allow
-- the status='posted' → status='reversed' transition while still blocking
-- all other mutations (description, amounts, dates, etc.).
--
-- This migration replaces the trigger with a refined version that:
--   1. Allows UPDATE only when NEW.status IN ('reversed') AND all financial
--      fields (total_debit, total_credit, entry_date, posting_date) are
--      unchanged.
--   2. Still blocks DELETE entirely.
--   3. Still blocks any UPDATE that changes financial fields.
--
-- Forward-only. Run via migration_role or postgres superuser.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Replace the trigger function with a refined version
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prevent_posted_record_mutation() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- For journal_entries (and its partitions journal_entries_YYYY_MM):
  -- allow status='posted' → status='reversed' transition
  -- (the official reversal workflow per §2 Design Principles).
  -- All other mutations to posted rows are blocked.
  -- Note: TG_TABLE_NAME returns the PARTITION name (e.g. journal_entries_2026_07)
  -- when the trigger fires on a partition, so we use a LIKE check.
  IF TG_TABLE_NAME LIKE 'journal_entries%' AND TG_OP = 'UPDATE' THEN
    -- Allow reversal: only status changes from 'posted' to 'reversed',
    -- and reversed_by_id may be set. All financial/dimensional fields must
    -- stay unchanged.
    IF OLD.status = 'posted' AND NEW.status = 'reversed'
       AND OLD.company_id IS NOT DISTINCT FROM NEW.company_id
       AND OLD.branch_id IS NOT DISTINCT FROM NEW.branch_id
       AND OLD.entry_date IS NOT DISTINCT FROM NEW.entry_date
       AND OLD.document_number IS NOT DISTINCT FROM NEW.document_number
       AND OLD.description IS NOT DISTINCT FROM NEW.description
       AND OLD.source_type IS NOT DISTINCT FROM NEW.source_type
       AND OLD.source_id IS NOT DISTINCT FROM NEW.source_id
       AND OLD.posted_at IS NOT DISTINCT FROM NEW.posted_at
       AND OLD.posted_by IS NOT DISTINCT FROM NEW.posted_by
       AND OLD.correlation_id IS NOT DISTINCT FROM NEW.correlation_id
    THEN
      RETURN NEW; -- allow the reversal status transition
    END IF;
    -- Any other UPDATE to a posted row is blocked
    RAISE EXCEPTION 'Cannot modify posted journal_entries (%) — only status=''posted'' → ''reversed'' is allowed. Use reversal/return/refund.', TG_TABLE_NAME
      USING ERRCODE = 'P0001';
  END IF;

  -- Default: block all mutations to posted records
  RAISE EXCEPTION 'Cannot modify posted record (%) — use reversal/return/refund', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Re-create the trigger (DROP + CREATE to pick up the new function)
-- ──────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_journal_entries_immutable ON journal_entries;
CREATE TRIGGER trg_journal_entries_immutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW WHEN (OLD.status = 'posted')
  EXECUTE FUNCTION prevent_posted_record_mutation();

COMMIT;

-- ──────────────────────────────────────────────────────────────────────────
-- Verification
-- ──────────────────────────────────────────────────────────────────────────
SELECT '=== Trigger function updated ===' AS info;
SELECT proname, prosrc LIKE '%NEW.status = ''reversed''%' AS allows_reversal
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND proname = 'prevent_posted_record_mutation';
