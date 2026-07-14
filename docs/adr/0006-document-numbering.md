# ADR 0006 — Document Numbering

**Status:** Accepted
**Date:** 2026-07-10
**Blueprint reference:** §5.3 document_sequences, §16 next_document_number()

## Context

The blueprint specifies a SQL function `next_document_number(...)` that:
1. Locks the `document_sequences` row `FOR UPDATE` inside the parent transaction.
2. Reads `next_number`.
3. Increments it.
4. Returns the formatted document number (`prefix + zero-padded number`).
5. If the parent transaction commits, the increment persists. If it rolls back, the increment is undone.

Two partial unique indexes enforce one sequence per `(company_id, document_type, fiscal_year)` where `branch_id IS NULL`, and one per `(company_id, branch_id, document_type, fiscal_year)` where `branch_id IS NOT NULL`.

## Decision

Implementation in `src/lib/numbering/index.ts`:

1. `nextDocumentNumber(tx, params)` runs inside the caller's Prisma transaction.
2. Finds the existing sequence row by `(companyId, branchId|null, documentType, fiscalYear)`.
3. If not found, creates it with `nextNumber: 2n` (we are about to issue #1) and returns `1n`.
4. If found, atomically `UPDATE ... SET nextNumber = nextNumber + 1` and returns the pre-increment value.
5. Formats: `prefix + String(nextNumber).padStart(padding, '0')`.

The Prisma `update({ data: { nextNumber: { increment: 1 } } })` call holds a row-level write lock for the duration of the transaction — equivalent to `FOR UPDATE` in Postgres. SQLite serializes writes via its single-writer lock, so concurrent transactions cannot corrupt the sequence.

### Offline leases

`leaseDocumentNumbers(tx, params)` allocates a contiguous range for offline POS use:
1. Finds the max `range_end` for `(companyId, documentType, prefix)`.
2. Allocates `[maxEnd+1, maxEnd+count]` and inserts a `document_number_leases` row.
3. Returns `{ rangeStart, rangeEnd, nextNumber, leaseId }`.

In Postgres production, the `EXCLUDE USING gist` constraint prevents overlapping ranges. In SQLite, the app-code "find max + 1" approach is equivalent for sequential leases but cannot detect concurrent overlap (mitigated by SQLite's single-writer serialization).

## Blueprint compliance

- ✓ Atomic sequence increment inside parent transaction
- ✓ Rollback undoes the increment (tested in `tests/unit/numbering.test.ts`)
- ✓ Distinct sequences for company-wide vs branch-scoped
- ✓ Padding configurable (default 6)
- ✓ Prefix combined with padded number
- ⚠ Partial unique indexes: enforced in app code, not at DB level (SQLite limitation)

## Production migration

Postgres migration will:
1. Create the two partial unique indexes (`WHERE branch_id IS NULL` and `WHERE branch_id IS NOT NULL`).
2. Create the `EXCLUDE USING gist` constraint on `document_number_leases`.
3. Convert `nextDocumentNumber()` to a SECURITY DEFINER SQL function with `FOR UPDATE` row lock.
