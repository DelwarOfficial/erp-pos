# ADR 0002 — RLS via Prisma Client Extension (Sandbox)

**Status:** Accepted (sandbox only)
**Date:** 2026-07-10
**Blueprint reference:** §6 rule 12, §8.2

## Context

The blueprint mandates PostgreSQL RLS on every tenant/sensitive table, with the application setting `set_config('app.company_id', ..., true)` inside every transaction. RLS policies then enforce row-level isolation even if application code forgets a `WHERE company_id = ?` clause.

The sandbox runs on **SQLite**, which has no RLS feature.

## Decision

We emulate RLS using a **Prisma client extension** (`src/lib/db/tenantClient.ts`):

1. The extension intercepts every `$allOperations` call.
2. For tenant-scoped models (see `TENANT_SCOPED_MODELS` set), if a `TenantContext` is set on `AsyncLocalStorage`, the extension injects `where.companyId = ctx.companyId` on reads and `data.companyId = ctx.companyId` on creates.
3. If no `TenantContext` is set (system/migration code), no filter is applied — equivalent to `migration_role` bypassing RLS.
4. `withTenant(ctx, work)` wraps the work in a Prisma transaction AND sets the context on AsyncLocalStorage, so all queries inside `work` are scoped.

## Limitations

- **Application-layer enforcement only.** A malicious or buggy query that constructs raw SQL bypassing Prisma would NOT be isolated. Production RLS is enforced inside Postgres and is immune to this.
- **No protection against UPDATE/DELETE without WHERE.** The extension only injects `companyId` into the where-clause; raw `db.user.deleteMany()` (no where) would still hit all rows in SQLite. In Postgres production, RLS would block this.
- **Cross-tenant FK constraints are not enforced at the DB level.** The blueprint's "tenant-consistency CHECKs" (§4 rule 5) require Postgres CHECK constraints with subqueries — SQLite does not support these.

## Production migration path

When moving to Postgres 16:

1. Create RLS policy files under `prisma/rls/*.sql` for every tenant-scoped table.
2. Add `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` on each table.
3. Update `withTenant()` to execute `SELECT set_config('app.company_id', $1, true)` at the start of every transaction.
4. Remove the Prisma client extension (or keep it as defense-in-depth — it's a no-op if RLS is active).
5. Add cross-tenant isolation tests that intentionally try to read another tenant's data without the application filter — they MUST fail at the DB level.

## Blueprint deviation

Sandbox-only. Production deployment MUST implement real RLS policies per §8.2.
