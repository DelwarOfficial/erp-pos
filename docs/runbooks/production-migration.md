# Production Migration Runbook (PostgreSQL 16)

**Status:** Ready for production deployment
**Date:** 2026-07-10
**Blueprint reference:** §1 Technical Stack, §6 Security/RBAC/RLS, §20.0 Architecture Controls

## Overview

This runbook describes how to deploy the ERP/POS system to a fresh PostgreSQL 16+ production environment. The sandbox runs on SQLite; production requires PostgreSQL 16+ with RLS, partial unique indexes, EXCLUDE constraints, partitioning, and the four-role privilege model.

## Pre-deployment checklist

- [ ] PostgreSQL 16+ provisioned (managed RDS/Cloud SQL or self-hosted)
- [ ] `pgcrypto`, `pg_trgm`, `btree_gist`, `uuid-ossp`, `citext` extensions available
- [ ] TLS configured on the DB connection
- [ ] Encrypted disk storage (EBS encryption / Cloud SQL encryption)
- [ ] WAL archiving destination provisioned (S3-equivalent with object-lock)
- [ ] Backup credential generated (separate from app/migration roles)
- [ ] `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `BARCODE_SIGNING_KEY` provisioned in secrets manager
- [ ] Application deployment image built (non-root container)

## Step 1 — Create DB roles

Run as the initial superuser (e.g., `postgres`):

```bash
# Use psql with parameter substitution for passwords
psql -h <host> -U postgres -d erp_pos \
  -v app_password="$APP_DB_PASSWORD" \
  -v migration_password="$MIGRATION_DB_PASSWORD" \
  -v backup_password="$BACKUP_DB_PASSWORD" \
  -v reporting_password="$REPORTING_DB_PASSWORD" \
  -f prisma/roles/0001_db_roles.sql
```

**Verify:**
```sql
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles
WHERE rolname IN ('app_role','migration_role','backup_role','reporting_role','function_owner');
```

Expected:
```
app_role        | f | f | t
migration_role  | f | t | t
backup_role     | f | f | t
reporting_role  | f | f | t
function_owner  | f | f | f
```

## Step 2 — Run forward-only migrations

Run as `migration_role` (BYPASSRLS):

```bash
for f in prisma/migrations/0001_extensions_and_schemas.sql \
         prisma/migrations/0002_organization_currency.sql \
         prisma/migrations/0003_identity_rbac_devices.sql \
         prisma/migrations/0004_numbering_events_idempotency.sql \
         prisma/migrations/0005_audit_approval_statutory_reconciliation.sql \
         prisma/migrations/0006_catalogue_pricing_tax.sql \
         prisma/migrations/0007_settings_localization_featureflags.sql \
         prisma/migrations/0008_partitioning.sql \
         prisma/migrations/0009_grants.sql; do
  PGPASSWORD="$MIGRATION_DB_PASSWORD" psql -h <host> -U migration_role -d erp_pos -f "$f"
done
```

## Step 3 — Create SQL functions and triggers

```bash
PGPASSWORD="$MIGRATION_DB_PASSWORD" psql -h <host> -U migration_role -d erp_pos \
  -f prisma/functions/next_document_number.sql
PGPASSWORD="$MIGRATION_DB_PASSWORD" psql -h <host> -U migration_role -d erp_pos \
  -f prisma/functions/post_journal_entry.sql
PGPASSWORD="$MIGRATION_DB_PASSWORD" psql -h <host> -U migration_role -d erp_pos \
  -f prisma/triggers/0001_set_updated_at.sql
PGPASSWORD="$MIGRATION_DB_PASSWORD" psql -h <host> -U migration_role -d erp_pos \
  -f prisma/triggers/0002_prevent_posted_record_mutation.sql
PGPASSWORD="$MIGRATION_DB_PASSWORD" psql -h <host> -U migration_role -d erp_pos \
  -f prisma/triggers/0003_tenant_consistency_checks.sql
```

## Step 4 — Enable RLS + create policies

```bash
PGPASSWORD="$MIGRATION_DB_PASSWORD" psql -h <host> -U migration_role -d erp_pos \
  -f prisma/rls/0001_enable_rls.sql
PGPASSWORD="$MIGRATION_DB_PASSWORD" psql -h <host> -U migration_role -d erp_pos \
  -f prisma/rls/0002_tenant_policies.sql
```

## Step 5 — Switch Prisma datasource

Update `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")  // postgresql://app_role:...@host:5432/erp_pos?schema=public
}
```

Re-add native type annotations (they were stripped for SQLite). The schema in this repo is the canonical reference; the production schema generator will produce the full DDL.

## Step 6 — Update transaction wrapper

`src/lib/db/transaction.ts` `withTenant()` must call `set_config()` at the start of every transaction:

```typescript
return db.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.company_id', ${ctx.companyId}, true)`;
  await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ''}, true)`;
  await tx.$executeRaw`SELECT set_config('app.branch_ids', ${ctx.branchIds.join(',')}, true)`;
  await tx.$executeRaw`SELECT set_config('app.is_global', ${ctx.isGlobal ? 'true' : 'false'}, true)`;
  return work(tx);
}, { isolationLevel: 'Serializable', timeout: 30_000 });
```

The Prisma client extension in `src/lib/db/tenantClient.ts` becomes a defense-in-depth layer (RLS is the real enforcement).

## Step 7 — Run seed

```bash
DATABASE_URL="postgresql://migration_role:...@host:5432/erp_pos" \
  bun run scripts/seed.ts
```

This creates the platform company, BDT currency, permission catalogue, system roles, and the first platform_operations admin.

## Step 8 — Verify RLS isolation

```sql
-- As app_role, with NO tenant context — should see 0 rows from tenant tables
SET app.company_id = '';
SET app.is_global = 'false';
SELECT count(*) FROM users;       -- expect 0
SELECT count(*) FROM products;    -- expect 0

-- Set tenant context
SET app.company_id = '<platform_company_id>';
SET app.is_global = 'true';
SELECT count(*) FROM users;       -- expect 1 (the platform admin)

-- Try to read another tenant — should see 0 rows even with app filter removed
SET app.company_id = '<tenant_a_id>';
SET app.is_global = 'false';
SELECT count(*) FROM users WHERE company_id = '<tenant_b_id>';  -- expect 0 (RLS blocks)
```

## Step 9 — Configure backup + WAL archive

```bash
# Nightly pg_dump (runs as backup_role)
pg_dump -h <host> -U backup_role -d erp_pos \
  --format=custom --compress=9 \
  --file=/backups/erp_pos_$(date +%Y%m%d_%H%M).dump

# Verify checksum
sha256sum /backups/erp_pos_*.dump > /backups/checksums.txt

# Upload to encrypted S3 with object-lock
aws s3 cp /backups/erp_pos_*.dump s3://erp-backups/ \
  --sse aws:kms --object-lock-mode COMPLIANCE --object-lock-retain-until-date $(date -d '+7 years' +%Y-%m-%d)
```

## Step 10 — First restore test (within 24h of go-live)

```bash
# Restore to isolated environment
PGPASSWORD="$RESTORE_DB_PASSWORD" pg_restore -h <isolated_host> -U postgres -d erp_pos_restore \
  --clean --if-exists /backups/erp_pos_<latest>.dump

# Run reconciliation
curl -X POST https://erp.example.com/api/v1/reconciliation/run \
  -H "Authorization: Bearer ..." \
  -d '{"run_type": "post_restore"}'
```

## Rollback

Migrations are forward-only. If a migration fails:
1. Do NOT attempt to roll back the migration — restore from the pre-migration backup instead.
2. Document the failure in `docs/adr/`.
3. Fix the migration SQL, re-run from the failed step forward.

For application-level rollback (code deployment):
1. The previous container image is still tagged in the registry.
2. Redeploy the previous image — DB schema is backward-compatible within a minor version.

## Post-deployment verification

- [ ] `GET /api/v1/health` returns `status: ok, db: reachable`
- [ ] Login as platform admin → see dashboard
- [ ] Onboard a test tenant → status=`suspended`
- [ ] Activate the test tenant → status=`active`
- [ ] Login as test tenant admin → see dashboard with no access to platform tenant data
- [ ] RLS penetration test: as app_role with tenant A context, query `users WHERE company_id = '<tenant_b>'` returns 0 rows
- [ ] Audit log entry created for the onboarding action
- [ ] Backup completes successfully + restore test passes
- [ ] All 49 unit tests pass against the production DB

## Operational runbooks (§18A.4)

See `docs/runbooks/` for incident-specific procedures:
- `user_compromise.md` — refresh token family revocation
- `device_compromise.md` — device revocation + recovery epoch
- `backup_restore_dr.md` — quarterly DR exercise (RTO ≤ 4h)
- `reconciliation_failure.md` — reconciliation finding triage
- `courier_cod_mismatch.md` — COD settlement variance (M5)
- `period_close_correction.md` — fiscal period unlock + adjustment (M4)
