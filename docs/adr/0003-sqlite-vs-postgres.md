# ADR 0003 — SQLite vs PostgreSQL 16

**Status:** Accepted (sandbox only — temporary)
**Date:** 2026-07-10
**Blueprint reference:** §1 Technical Stack, §4 Database Schema Rules

## Context

The blueprint mandates PostgreSQL 16+ with:
- Partial unique indexes (`WHERE branch_id IS NULL` / `IS NOT NULL`)
- EXCLUDE USING gist constraints (for `document_number_leases` overlapping ranges, `fiscal_periods` overlapping dates)
- RLS policies on every tenant-scoped table
- CHECK constraints with subqueries (tenant consistency)
- Partitioning (monthly RANGE on `stock_movements.effective_at`, `journal_entries.entry_date`, etc.)
- SECURITY DEFINER functions with safe `search_path`
- JSONB columns with GIN indexes
- INET type for IP addresses
- gen_random_uuid() via pgcrypto

The sandbox provides only **SQLite** via Prisma.

## Decision

We proceed with SQLite in the sandbox, with documented limitations. The Prisma schema strips `@db.*` native type annotations (SQLite rejects them) but preserves column names, nullability, indexes, and unique constraints. Application code enforces the constraints that SQLite cannot.

| Blueprint feature | SQLite sandbox behavior |
|---|---|
| Partial unique indexes | Enforced in app code (`nextDocumentNumber` checks for existing sequence) |
| EXCLUDE USING gist | Enforced in app code (`leaseDocumentNumbers` checks for overlap) |
| RLS | Emulated via Prisma client extension (see ADR 0002) |
| CHECK with subqueries (tenant consistency) | Enforced in app code (validate `companyId` matches before insert) |
| Partitioning | Not implemented in sandbox (M4+) |
| SECURITY DEFINER functions | Emulated as TypeScript functions in `src/lib/` |
| JSONB + GIN | Stored as TEXT, parsed via JSON.parse |
| INET | Stored as TEXT (IPv4/IPv6 string) |
| gen_random_uuid() | Prisma `@default(uuid())` uses crypto.randomUUID() |

## Consequences

- Schema validation tests must verify application-enforced constraints (e.g., "two company-wide sequences cannot coexist").
- Performance characteristics differ — SQLite is single-writer; production Postgres supports concurrent SERIALIZABLE transactions.
- The `prisma/migrations/` folder is currently empty. Production deployment requires writing forward-only SQL migrations with the full Postgres DDL (constraints, RLS, partitions, indexes).

## Blueprint deviation

This is a **temporary sandbox deviation**. The schema design (column names, types, indexes, constraints) mirrors the blueprint exactly so that the production migration is a 1:1 translation. The sandbox can run the application for development and demo purposes; production requires the full Postgres 16 deployment.
