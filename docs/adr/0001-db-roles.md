# ADR 0001 — Database Roles

**Status:** Accepted (sandbox adaptation)
**Date:** 2026-07-10
**Blueprint reference:** §6 rule 9, M0 task 4

## Context

The blueprint mandates four distinct PostgreSQL roles with strict separation of privileges:

| Role | Purpose | Bypass RLS? |
|------|---------|-------------|
| `app_role` | Application runtime (NOSUPERUSER, NOBYPASSRLS) | No |
| `migration_role` | Forward-only migrations only | Yes |
| `backup_role` | Nightly pg_dump + WAL archive | Read-only |
| `reporting_role` | Read-only OLAP queries | No |

The application role must NOT be able to bypass RLS, disable triggers, or alter schema. This is a non-negotiable control (§20.0).

## Decision

In the **sandbox** (SQLite), only a single connection role exists. We emulate the production separation by convention:

1. `src/lib/db/index.ts` — the unrestricted client. Only `scripts/seed.ts`, `prisma/migrations/*`, and platform_operations cross-tenant queries import this directly.
2. `src/lib/db/tenantClient.ts` — the tenant-isolated client (Prisma extension that injects `companyId`). All tenant-scoped application code imports this.
3. `src/lib/db/transaction.ts` — `withTenant()` wraps every business mutation in a Serializable transaction with the tenant context on AsyncLocalStorage.

In **production** (Postgres 16), the same source code will run unchanged; only `datasource db { url = ... }` in `schema.prisma` switches to a Postgres URL, and the connection string uses `app_role` credentials. RLS policies will be created via `prisma/migrations/*.sql` files (added in M1).

## Consequences

- The sandbox cannot enforce RLS at the database level — a bug in the Prisma extension could leak data across tenants. We mitigate with cross-tenant isolation tests (see `tests/unit/idempotency.test.ts` and future `tests/integration/rls.test.ts`).
- Production deployment requires a separate migration phase to create the four roles + RLS policies before the first tenant is onboarded.

## Blueprint deviation

This is a sandbox-only deviation. Production deployment MUST use the four-role model with RLS policies per §8.2.
