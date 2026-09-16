# MariaDB migration runbook

MariaDB 11.8 is authoritative. PostgreSQL files and RLS references are historical only (see docs/adr/0007-mariadb-production-database.md). This runbook is not deployment authorization. Never test against production.

## Disposable rehearsal first

1. Verify commit, clean tree, locked dependencies and fresh disposable MariaDB 11.8 target.
2. Supply DATABASE_URL through protected local configuration. Print safe host/port/database classification only; never credentials or full URL. Do not source production environments.
3. Use locked Prisma version and explicit schema:

```bash
bun install --frozen-lockfile
bunx --no-install prisma validate --schema=prisma/mariadb/schema.prisma
bunx --no-install prisma generate --schema=prisma/mariadb/schema.prisma
bunx --no-install prisma migrate deploy --schema=prisma/mariadb/schema.prisma
bunx --no-install prisma migrate status --schema=prisma/mariadb/schema.prisma
```

4. Repeat deploy; require no pending migrations/errors. Compare constraints/indexes/triggers/routines/views with migration-managed definitions.
5. Run tenant/branch/RBAC, accounting, inventory, concurrency, rollback, browser and build tests.
6. Rehearse backup/restore using [backup-restore.md](backup-restore.md). Migration success alone is not readiness.

## Persistent deployment gate

Applied migrations are immutable. New forward-only MariaDB migrations only. Never reset/db push, rewrite history, or execute legacy PostgreSQL migration scripts. Rehearse DDL locking/duration/disk requirements and recovery strategy first.

Only after explicit operator authorization: verify target/commit; verify final backup; enforce approved write freeze where needed; run rehearsed migrate deploy; validate migration status and invariants; follow separately approved release/smoke plan. No secrets in logs; no DEFINER=root.

MariaDB tenant isolation uses application context and tenant-scoped/composite constraints. PostgreSQL RLS, EXCLUDE and SECURITY DEFINER assumptions do not apply.

## Failure handling

Stop on command errors/invariant mismatches. Never mark failed migrations applied to bypass failure. Application rollback does not undo committed MariaDB DDL. Restore into a new isolated database, reconcile, obtain explicit cutover approval. Never automatically overwrite persistent data.

## Recovery evidence

Binary-log PITR, immutable offsite backups and achieved RPO/RTO: **UNPROVEN** without dated executable rehearsal. No production commands were executed for this documentation change.
