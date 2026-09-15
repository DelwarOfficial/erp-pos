# ADR 0007 — MariaDB 11.8.x Is Authoritative Production Database

**Status:** Accepted
**Date:** 2026-09-15
**Blueprint reference:** §1, §4, §8.2, §14, §15, §16, §20.D10, §20.D11
**Supersedes:** PostgreSQL-only implementation assumptions in Blueprint v4.1 (§1.3, §8.2, §15, §16, D10/D11 mechanism text). Does NOT supersede product, workflow, accounting, permission, report, or acceptance requirements.

## Decision

MariaDB 11.8.x (within approved 11.x production line, pinned to supported patched release) is the authoritative production system of record.

- Production Prisma provider: `mysql` (`prisma/mariadb/schema.prisma`).
- Sandbox remains SQLite (`prisma/schema.prisma`).
- Legacy `prisma/schema.postgres.prisma` and `prisma/migrations/00*.sql` (PostgreSQL) are historical reference only, not deployment authority.
- Ordered MariaDB migrations under `prisma/mariadb/migrations/` are production authority.

## Reason

Implemented and deployed ERP uses MariaDB: production schema, migrations, Prisma provider, constraints, triggers, backup procedures, and operational verification are MariaDB-native. Blueprint v4.1 was written around PostgreSQL 16+ and PostgreSQL Row-Level Security. Reconciliation aligns document mechanism with reality without redesigning product.

## Preserves (unchanged outcomes)

- multi-tenancy, company isolation, branch isolation
- transactional integrity, atomic business commands
- double-entry accounting, immutable ledgers
- idempotency, auditability, reconciliation
- concurrency safety, backup/restore requirements
- security requirements, RBAC, maker-checker
- module scope, workflows, UI, API behavior, reports
- Bangladesh legal/tax, D01–D20 business decisions

## PostgreSQL RLS Is Not Available in MariaDB

No claim is made that MariaDB provides native RLS, `set_config`/`current_setting`, `FORCE RLS`, `BYPASSRLS`, or PostgreSQL role semantics.

Equivalent tenant isolation is implemented using layered controls:

1. `company_id` on every tenant-owned table (junction exemptions per §0 rule 8 only).
2. `branch_id` where branch-owned or resolvable via branch-owned warehouse/account.
3. Tenant-aware composite FKs preventing cross-company links, conceptually `(company_id, fk) REFERENCES parent(company_id, id)` where structurally appropriate.
4. Tenant-aware UNIQUE constraints including `company_id` where business uniqueness is tenant-local.
5. Mandatory resolved application request scope (company, user, branch IDs, global-admin flag) before tenant data access.
6. Centralized tenant-scoped data-access layer; no route/domain command intentionally runs tenant-owned queries without resolved context except explicitly audited platform-global admin operations.
7. RBAC + branch authorization on every operation; tenant filtering never replaces permission checks.
8. DB CHECK/FK/UNIQUE/trigger enforcement as defense in depth.
9. Executable cross-tenant read/write penetration tests (A cannot read/update/delete/reference B; branch-limited user denied foreign branch; global behavior explicit + audited).
10. Security regression tests in CI against disposable MariaDB.
11. Restricted DB credentials: runtime application account has no administrative, schema-modification, user-management, or arbitrary FILE privileges; migration credentials never used by runtime; backup credentials least-privilege.
12. No unrestricted tenant-blind application queries for business data.

## Type / Mechanism Mappings (summary; blueprint §4 governs)

- UUID: application-generated UUID strings (CHAR(36)) or approved MariaDB-compatible strategy; `gen_random_uuid()` is historical PG syntax.
- Timestamps: `DATETIME(3)`/`TIMESTAMP` as defined by MariaDB schema, stored and interpreted in UTC; business-local dates remain `DATE`; rendering uses company timezone.
- JSONB → MariaDB `JSON`; typed-schema validation before COMMIT preserved; money/stock/accounting lifecycle never JSON-only.
- `BYTEA` → `BLOB`/`VARBINARY`; `INET` → validated `VARCHAR`; PG enums → CHECK/reference-table/application enums per implemented schema.
- `GIN`/`GiST`/partial-unique/`EXCLUDE`/expression indexes: restated as MariaDB-compatible enforcement (composite UNIQUE, generated columns, FULLTEXT where needed, transactional overlap check + trigger where no direct equivalent). Invariant preserved, syntax replaced.
- `SECURITY DEFINER`/`search_path`: replaced by MariaDB trigger discipline + transactional domain commands with least-privilege accounts. Balanced-journal, immutability, numbering, idempotency outcomes unchanged.
- Partitioning: PostgreSQL declarative RANGE is not assumed; MariaDB-native partitioning is evidence-based (thresholds in D11 retained as activation policy; if not yet implemented, gap is explicit, not claimed).
- Backup: `pg_dump`/`pgBackRest`/WAL/PITR wording replaced by `mariadb-dump` logical backup + binary-log/PITR strategy where evidenced; encrypted, off-server, checksummed, restore-tested, RPO/RTO targets unchanged. No binlog/PITR claim without evidence.
- Concurrency: InnoDB row-level locking, `SELECT ... FOR UPDATE`, unique-constraint race prevention, atomic UPDATE, deterministic lock order, bounded deadlock retries, idempotent retries. `SERIALIZABLE` naming replaced by outcome-preserving MariaDB/InnoDB controls unless workflow explicitly requires stronger isolation.

## Consequences

- All blueprint readers must apply §4 MariaDB interpretation rule when reading §5 column types.
- Audit prompt (`MASTER_GAP_AUDIT_PROMPT.md`) evaluates outcome-based MariaDB controls, not PG mechanism names.
- Support/Loyalty incompleteness (if any) remains visible; this ADR hides nothing.
