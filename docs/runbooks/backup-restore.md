# Backup & Restore Runbook

Per §20.D10 + §14.1 — RPO ≤ 15 min (WAL), RTO ≤ 4h, encrypted, immutable, restore-tested.

## Overview

The backup system has 3 components:

1. **Nightly logical backup** (`scripts/backup/nightly-backup.sh`)
   - Runs `pg_dump` as `backup_role` (BYPASSRLS, read-only)
   - Computes SHA-256 checksum
   - Records metadata (DB version, schema migrations, row counts, encryption key version)
   - Uploads to S3/MinIO with object-lock (immutable)
   - Verifies checksum after upload

2. **Continuous WAL archiving** (`scripts/backup/wal-archive.sh`)
   - Called by PostgreSQL's `archive_command`
   - Uploads each WAL segment to S3 with immutable object-lock
   - RPO ≤ 15 minutes (depends on `archive_timeout` setting)

3. **Restore + reconciliation** (`scripts/backup/restore-from-backup.sh` + `post-restore-reconciliation.sh`)
   - Downloads backup from S3
   - Verifies checksum
   - Restores to isolated database
   - Runs 8 reconciliation checks (schema, tables, journal balance, AR, stock, RLS, functions, triggers)

## Setup

### 1. Configure backup_role

```sql
-- backup_role needs BYPASSRLS to dump all tenant data
ALTER ROLE backup_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO backup_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_role;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO backup_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO backup_role;
```

### 2. Configure PostgreSQL for WAL archiving

In `postgresql.conf`:
```conf
wal_level = replica
archive_mode = on
archive_command = '/home/z/my-project/scripts/backup/wal-archive.sh %p %f'
archive_timeout = '15min'  # forces WAL segment switch every 15 min
```

Restart PostgreSQL after changing these settings.

### 3. Configure S3/MinIO bucket with object-lock

```bash
# Create bucket with object-lock enabled
aws s3api create-bucket \
  --bucket erp-pos-backups \
  --object-lock-enabled-for-bucket \
  --endpoint-url http://localhost:9000

# Set default retention to 30 days
aws s3api put-object-lock-configuration \
  --bucket erp-pos-backups \
  --object-lock-configuration '{
    "ObjectLockEnabled": "Enabled",
    "Rule": {
      "DefaultRetention": {
        "Mode": "COMPLIANCE",
        "Days": 30
      }
    }
  }' \
  --endpoint-url http://localhost:9000
```

### 4. Set environment variables

```bash
# .env
BACKUP_ROLE=backup_role
BACKUP_PASSWORD=<secure-password>
BACKUP_S3_BUCKET=erp-pos-backups
BACKUP_S3_PREFIX=nightly
BACKUP_RETENTION_DAYS=30
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
```

### 5. Schedule nightly backup

```bash
crontab -e
# Add: nightly backup at 1am UTC
0 1 * * * /home/z/my-project/scripts/backup/nightly-backup.sh >> /var/log/erp-backup.log 2>&1
```

## Recovery Procedure (§14.1)

### 1. Declare incident + freeze writes

```bash
# Block new connections (if app is still running)
psql -U postgres -c "ALTER DATABASE erp_pos WITH ALLOW_CONNECTIONS false;"
```

### 2. Select safe recovery point

Identify the backup ID + target time from backup metadata in S3.

### 3. Restore base backup + replay WAL

```bash
# Restore to isolated database first (don't overwrite production yet)
scripts/backup/restore-from-backup.sh <backup-id> --target-time "2026-07-14 03:30:00+00"
```

### 4. Verify object storage + schema version

```bash
scripts/backup/post-restore-reconciliation.sh
```

### 5. Run full post-restore reconciliation

The reconciliation script checks:
- Schema migrations applied (10)
- Tables in public schema (79)
- Journal balance (0 unbalanced entries)
- AR subledger vs GL (diff = 0)
- Stock quantity vs movements (0 mismatches)
- RLS policies (65 tables)
- SECURITY DEFINER functions (343)
- Triggers (24)

### 6. Review provider + offline-device transactions

Check for:
- Pending outbox events that weren't delivered
- Offline device commands that may need re-bootstrap
- Provider payments in unknown state

### 7. Open read-only for validation

```bash
psql -U postgres -c "ALTER DATABASE erp_pos WITH ALLOW_CONNECTIONS true;"
# App runs in read-only mode (feature flag)
```

### 8. Resume writes after incident-owner approval

```bash
# Switch app back to read-write mode
# Increment recovery epoch
psql -U postgres -c "UPDATE companies SET recovery_epoch = recovery_epoch + 1;"
```

### 9. Record every manual replay/reconciliation in audit

All restore actions are logged to `audit_logs` and `security_events`.

## Testing

### First restore test (M0 task 11 exit gate)

```bash
scripts/backup/first-restore-test.sh
```

This runs the full backup → restore → reconciliation pipeline and reports PASS/FAIL.
**A backup is not considered valid until a restore test succeeds.**

### Monthly restore test

Schedule a monthly cron job to run `first-restore-test.sh` and alert on failure.

### Quarterly DR exercise

Run `scripts/dr-exercise.sh` — declares incident, restores to isolated env, runs reconciliation, verifies RTO ≤ 4h, increments recovery epoch, documents findings.

## Backup Metadata

Each backup records:
- `backup_id` — timestamp-based unique ID
- `timestamp` — when the backup was taken
- `database` — source database name
- `db_version` — PostgreSQL version
- `schema_migrations_applied` — count of applied migrations
- `encryption_key_version` — which encryption key was used
- `checksum` — SHA-256 of the backup file
- `size_bytes` — file size
- `dump_duration_seconds` — how long pg_dump took
- `row_counts` — JSON object with row counts for key tables
- `backup_role` — which role performed the backup
- `retention_days` — how long to keep the backup

## Retention

- **Nightly backups**: 30 days (configurable via `BACKUP_RETENTION_DAYS`)
- **WAL archive**: 7 days (allows point-in-time recovery within last week)
- **Monthly full backup**: 1 year (first backup of each month is retained longer)
- **Legal hold**: backups under legal hold are never deleted until hold is released

## Security

- `backup_role` has BYPASSRLS but is NOSUPERUSER + NOCREATEDB + NOCREATEROLE
- Backup credentials are separate from app/migration credentials
- S3 bucket has object-lock enabled (COMPLIANCE mode — cannot be deleted even by root)
- Backup download requires MFA + approval (per §6 rule 16)
- Production restore requires platform operations + incident declaration
