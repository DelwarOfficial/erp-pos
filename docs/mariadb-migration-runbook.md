# MariaDB migration dry-run runbook

This runbook is dry-run only. It must not modify `prisma/prod.db`, production `.env`, the current SQLite `DATABASE_URL`, or final `rangpurt_erp`.

## 1. Resource stability

1. Run `scripts/cloudlinux-process-audit.sh` through SSH. It uses Bash built-ins and returns only Prisma/schema/query-engine executable name, PID, PPID, parent existence, state, and age.
2. Never terminate `node`, `next-server`, Passenger, or an unidentified process.
3. A Prisma engine may be terminated only after two observations confirm the same PID/start time, missing or init parent, and no active migration owner.
4. Send `TERM` to exact confirmed PIDs. Re-audit before considering `KILL`.
5. Prove three consecutive SSH execs and three Prisma version/schema commands complete without `EAGAIN`, fork errors, hangs, or leftover engines.

If SSH cannot create an exec/shell channel, request hosting/root intervention. Account-level cPanel APIs cannot safely identify PIDs.

## 2. Disposable database only

Use a database whose decoded name contains `dryrun`, such as `rangpurt_erp_dryrun2`. Tooling rejects final `rangpurt_erp` and common cPanel-prefixed equivalents.

```bash
export DATABASE_URL="$MARIADB_DRYRUN_URL"
export SHADOW_DATABASE_URL="$MARIADB_DRYRUN_SHADOW_URL"
bunx prisma@6.11.1 migrate deploy --schema=prisma/mariadb/schema.prisma
bunx prisma@6.11.1 migrate deploy --schema=prisma/mariadb/schema.prisma
bunx prisma@6.11.1 migrate status --schema=prisma/mariadb/schema.prisma
```

Second deploy must report no pending migrations. Capture durations and process audits before/after each command.

Never run `prisma migrate reset` or `prisma db push`.

## 3. Verified SQLite copy and ETL

Create a consistent copy with SQLite's backup mechanism while source remains unchanged. Record SHA-256. ETL refuses a source file named `prod.db` and requires the recorded digest.

```bash
MARIADB_DRYRUN_URL="$MARIADB_DRYRUN_URL" bun run scripts/mariadb/etl.ts \
  --source-copy /secure/path/prod-dryrun-copy.db \
  --source-sha256 "$SOURCE_COPY_SHA256"
```

For a deliberate ETL rerun against the validated disposable DB only:

```bash
MARIADB_DRYRUN_URL="$MARIADB_DRYRUN_URL" bun run scripts/mariadb/etl.ts \
  --source-copy /secure/path/prod-dryrun-copy.db \
  --source-sha256 "$SOURCE_COPY_SHA256" \
  --truncate-dryrun
```

Required: `failed_rows = 0`, every table source/target count equal.

## 4. Reconciliation and security

```bash
MARIADB_DRYRUN_URL="$MARIADB_DRYRUN_URL" bun run scripts/mariadb/reconcile.ts \
  --source-copy /secure/path/prod-dryrun-copy.db \
  --source-sha256 "$SOURCE_COPY_SHA256"
```

Required:

- `row_count_mismatches = 0`
- `uuid_changes = 0`
- `orphan_fks = 0`
- `cross_tenant_leakage = 0`
- `duplicate_document_numbers = 0`
- `posted_balance_variance = 0`
- `unexplained_financial_variance = 0`
- `unexplained_inventory_variance = 0`
- no reconciliation failures

Run tenant-isolation unit tests and ERP cross-tenant API tests. Both read and mutation attempts must fail for a foreign company ID.

## 5. Concurrency, query plans, E2E, build

```bash
MARIADB_DRYRUN_URL="$MARIADB_DRYRUN_URL" bun run scripts/mariadb/concurrency.ts
MARIADB_DRYRUN_URL="$MARIADB_DRYRUN_URL" bun run scripts/mariadb/explain.ts
bun run test:e2e
bun run build
```

Concurrency requires 100 completed, 100 unique, zero duplicates, contiguous values. EXPLAIN requires zero material full scans. Run complete ERP E2E against dry-run MariaDB, not production.

## 6. Rollback rehearsal

Use a staging app process and copies only:

1. Start staging with a process-local `DATABASE_URL` pointing to dry-run MariaDB.
2. Run health, login, read-only ERP smoke, and one rollback-safe controlled transaction.
3. Stop staging.
4. Start staging with a process-local SQLite URL pointing to a verified SQLite copy.
5. Re-run health/login/smoke and compare expected control totals.
6. Record recovery time and verify no production file or environment changed.

Rollback rehearsal fails if either restart needs schema mutation, loses IDs, or produces a reconciliation variance.

## 7. Final gate

Final `rangpurt_erp` deploy and production cutover remain prohibited until every dry-run gate above is independently PASS. Only then follow the user-approved final sequence: final SQLite backup, write freeze, final ETL/reconciliation, environment cutover, restart, smoke, and controlled transaction.

Status remains:

```text
READY FOR FINAL DB: NO
READY FOR CUTOVER: NO
ERP LIVE ON MARIADB: NO
```
