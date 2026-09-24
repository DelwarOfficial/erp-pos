-- Two invariants that existed only in application code, or only on the
-- PostgreSQL target, and so were unenforced on the production database.
--
-- F-25  Negative stock. prisma/migrations/0010_inventory_purchasing_transfers.sql
--       carries CHECK (qty_on_hand >= 0) and CHECK (qty_reserved <= qty_on_hand).
--       The MariaDB invariants migration carried neither, so the only guard was
--       src/domain/inventory/stockMovement.ts -- while the go-live checklist
--       recorded "Negative-stock CHECK enforced -- verified".
--
-- F-26  Journal balance. There was a per-line CHECK that a line is debit XOR
--       credit, and no entry-level constraint at all: 56 triggers enforced
--       immutability and tenant consistency, none checked that an entry
--       balances. Any path writing journal_lines outside postJournalEntry could
--       leave the ledger permanently unbalanced with nothing detecting it.
--
-- A CHECK cannot span rows and MariaDB has no deferred constraints, so the
-- entry-level invariant is expressed in three parts:
--
--   1. the header declares what the entry must sum to and how many lines it has
--   2. a CHECK enforces that the declaration itself balances and is non-trivial
--   3. a trigger on journal_lines verifies the lines match the declaration once
--      the declared number of lines exists
--
-- journal_lines is append-only (trg_journallines_immutable_upd / _del), so
-- INSERT is the only path that can change an entry's sums. An entry that never
-- reaches its declared line count stays detectably incomplete rather than
-- silently unbalanced.

-- ── F-25: negative stock ────────────────────────────────────────────────────
--
-- ALTER validates existing rows: if this fails, the database already holds
-- negative stock and that must be reconciled before the constraint can exist.
ALTER TABLE `warehouse_stocks`
  ADD CONSTRAINT `warehouse_stocks_on_hand_nonnegative_chk`
    CHECK (`qty_on_hand` >= 0),
  ADD CONSTRAINT `warehouse_stocks_reserved_within_on_hand_chk`
    CHECK (`qty_reserved` <= `qty_on_hand`);

-- ── F-26: declared totals on the entry header ───────────────────────────────
ALTER TABLE `journal_entries`
  ADD COLUMN `total_debit` DECIMAL(65, 30) NOT NULL DEFAULT 0,
  ADD COLUMN `total_credit` DECIMAL(65, 30) NOT NULL DEFAULT 0,
  ADD COLUMN `line_count` INTEGER NOT NULL DEFAULT 0;

-- The append-only trigger rejects any UPDATE to a posted entry, which is
-- exactly its job; a migration is the privileged context in which a protected
-- table is restructured. Drop it, backfill a truthful declaration from the
-- lines that already exist, then restore it covering the new columns as well.
DROP TRIGGER `trg_journal_entries_immutable_upd`;

UPDATE `journal_entries` je
SET
  je.`total_debit` = COALESCE((SELECT SUM(jl.`debit_base`) FROM `journal_lines` jl WHERE jl.`journal_entry_id` = je.`id`), 0),
  je.`total_credit` = COALESCE((SELECT SUM(jl.`credit_base`) FROM `journal_lines` jl WHERE jl.`journal_entry_id` = je.`id`), 0),
  je.`line_count` = COALESCE((SELECT COUNT(*) FROM `journal_lines` jl WHERE jl.`journal_entry_id` = je.`id`), 0);

-- Restored verbatim, with total_debit, total_credit and line_count added to the
-- protected set: a posted entry's declaration must be as immutable as the rest
-- of it, or the invariant could be edited away after the fact.
CREATE TRIGGER `trg_journal_entries_immutable_upd` BEFORE UPDATE ON `journal_entries`
FOR EACH ROW
BEGIN
IF OLD.status IN ('posted', 'reversed') AND NOT (
    OLD.status = 'posted'
    AND NEW.status = 'reversed'
    AND OLD.company_id <=> NEW.company_id
    AND OLD.entry_no <=> NEW.entry_no
    AND OLD.event_id <=> NEW.event_id
    AND OLD.posting_kind <=> NEW.posting_kind
    AND OLD.entry_date <=> NEW.entry_date
    AND OLD.posting_date <=> NEW.posting_date
    AND OLD.source_type <=> NEW.source_type
    AND OLD.source_id <=> NEW.source_id
    AND OLD.currency_code <=> NEW.currency_code
    AND OLD.exchange_rate <=> NEW.exchange_rate
    AND OLD.description <=> NEW.description
    AND OLD.reversal_of_entry_id <=> NEW.reversal_of_entry_id
    AND OLD.created_by <=> NEW.created_by
    AND OLD.posted_by <=> NEW.posted_by
    AND OLD.posted_at <=> NEW.posted_at
    AND OLD.created_at <=> NEW.created_at
    AND OLD.total_debit <=> NEW.total_debit
    AND OLD.total_credit <=> NEW.total_credit
    AND OLD.line_count <=> NEW.line_count
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POSTED_JOURNAL_IMMUTABLE';
  END IF;
END;

-- An entry with no lines at all predates this constraint and cannot be
-- described by it; it is left at zero and excluded by the CHECK below.
ALTER TABLE `journal_entries`
  ADD CONSTRAINT `journal_entries_balanced_chk`
    CHECK (`total_debit` = `total_credit`),
  ADD CONSTRAINT `journal_entries_line_count_chk`
    CHECK (`line_count` = 0 OR `line_count` >= 2);

-- ── F-26: the lines must match the declaration ──────────────────────────────
CREATE TRIGGER `trg_journallines_balance_ins` AFTER INSERT ON `journal_lines`
FOR EACH ROW
BEGIN
  DECLARE declared_debit DECIMAL(65, 30);
  DECLARE declared_credit DECIMAL(65, 30);
  DECLARE declared_lines INT;
  DECLARE actual_debit DECIMAL(65, 30);
  DECLARE actual_credit DECIMAL(65, 30);
  DECLARE actual_lines INT;

  SELECT je.`total_debit`, je.`total_credit`, je.`line_count`
    INTO declared_debit, declared_credit, declared_lines
    FROM `journal_entries` je WHERE je.`id` = NEW.`journal_entry_id`;

  -- Entries written before this migration declare nothing; leave them alone.
  IF declared_lines > 0 THEN
    SELECT COUNT(*), COALESCE(SUM(jl.`debit_base`), 0), COALESCE(SUM(jl.`credit_base`), 0)
      INTO actual_lines, actual_debit, actual_credit
      FROM `journal_lines` jl WHERE jl.`journal_entry_id` = NEW.`journal_entry_id`;

    -- No partial state may exceed what the entry says it will be.
    IF actual_lines > declared_lines OR actual_debit > declared_debit OR actual_credit > declared_credit THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'JOURNAL_ENTRY_EXCEEDS_DECLARED_TOTALS';
    END IF;

    -- On the last declared line the entry is complete and must match exactly.
    IF actual_lines = declared_lines
       AND (actual_debit <> declared_debit OR actual_credit <> declared_credit) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'JOURNAL_ENTRY_UNBALANCED';
    END IF;
  END IF;
END;
