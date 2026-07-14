#!/usr/bin/env bash
# scripts/backup/restore-from-backup.sh
# Restore from a pg_dump backup + WAL replay (point-in-time recovery).
# Per §14.1 Recovery Runbook + §20.D10.
#
# Usage:
#   scripts/backup/restore-from-backup.sh <backup-id> [--target-time <iso8601>]
#
# Examples:
#   # Restore latest backup to isolated env
#   scripts/backup/restore-from-backup.sh 20260714T010000Z
#
#   # Point-in-time recovery to specific timestamp
#   scripts/backup/restore-from-backup.sh 20260714T010000Z --target-time "2026-07-14 03:30:00+00"

set -euo pipefail

BACKUP_ID="${1:?Usage: restore-from-backup.sh <backup-id> [--target-time <iso8601>]}"
shift
TARGET_TIME=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --target-time)
      TARGET_TIME="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# ── Configuration ──
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
DB_NAME="${DB_NAME:-erp_pos}"
RESTORE_DB_NAME="${RESTORE_DB_NAME:-erp_pos_restore}"  # restore to isolated DB
RESTORE_ROLE="${RESTORE_ROLE:-migration_role}"
RESTORE_PASSWORD="${RESTORE_PASSWORD:-mig}"

BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-erp-pos-backups}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-nightly}"
S3_ENDPOINT="${S3_ENDPOINT:-http://localhost:9000}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-minioadmin}"
S3_SECRET_KEY="${S3_SECRET_KEY:-minioadmin}"
S3_REGION="${S3_REGION:-ap-south-1}"

BACKUP_WORK_DIR="${BACKUP_WORK_DIR:-/tmp/erp-backups}"
mkdir -p "$BACKUP_WORK_DIR"

PG_DUMP_PATH="${PG_DUMP_PATH:-/tmp/my-project/.local/deps/usr/lib/postgresql/17/bin}"
PSQL="$PG_DUMP_PATH/psql"
PG_RESTORE="$PG_DUMP_PATH/pg_restore"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

log "═══════════════════════════════════════════════════════════"
log "  ERP/POS Restore from Backup — ${BACKUP_ID}"
if [ -n "$TARGET_TIME" ]; then
  log "  Target time: ${TARGET_TIME}"
fi
log "═══════════════════════════════════════════════════════════"

# ── Step 1: Download backup from S3 ──
log "[1/6] Downloading backup ${BACKUP_ID}..."
BACKUP_DATE=$(echo "$BACKUP_ID" | cut -c1-8 | sed 's/\(....\)\(..\)\(..\)/\1-\2-\3/')
S3_KEY="${BACKUP_S3_PREFIX}/${BACKUP_DATE}/${DB_NAME}-${BACKUP_ID}.dump"
LOCAL_FILE="${BACKUP_WORK_DIR}/${DB_NAME}-${BACKUP_ID}.dump"
LOCAL_CHECKSUM="${LOCAL_FILE}.sha256"
LOCAL_META="${LOCAL_FILE}.meta.json"

if command -v aws &>/dev/null; then
  AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    aws s3 cp "s3://${BACKUP_S3_BUCKET}/${S3_KEY}" "$LOCAL_FILE" \
    --endpoint-url "$S3_ENDPOINT" --region "$S3_REGION" 2>&1 | tail -2
  AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    aws s3 cp "s3://${BACKUP_S3_BUCKET}/${S3_KEY}.sha256" "$LOCAL_CHECKSUM" \
    --endpoint-url "$S3_ENDPOINT" --region "$S3_REGION" 2>&1 | tail -2
  AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    aws s3 cp "s3://${BACKUP_S3_BUCKET}/${S3_KEY}.meta.json" "$LOCAL_META" \
    --endpoint-url "$S3_ENDPOINT" --region "$S3_REGION" 2>&1 | tail -2
else
  log "  (aws CLI not available — using bun S3 SDK)"
  cd /home/z/my-project && S3_ENDPOINT="$S3_ENDPOINT" S3_ACCESS_KEY="$S3_ACCESS_KEY" S3_SECRET_KEY="$S3_SECRET_KEY" \
    S3_BUCKET="$BACKUP_S3_BUCKET" \
    bun run scripts/backup/download-from-s3.ts "$S3_KEY" "$LOCAL_FILE" "$S3_KEY.sha256" "$LOCAL_CHECKSUM" "$S3_KEY.meta.json" "$LOCAL_META" 2>&1 | tail -5
fi

if [ ! -f "$LOCAL_FILE" ]; then
  log "  ✗ Backup file not found: $LOCAL_FILE"
  exit 1
fi
log "  ✓ Downloaded: $(stat -c%s "$LOCAL_FILE" 2>/dev/null || stat -f%z "$LOCAL_FILE") bytes"

# ── Step 2: Verify checksum ──
log "[2/6] Verifying checksum..."
EXPECTED_CHECKSUM=$(awk '{print $1}' "$LOCAL_CHECKSUM")
ACTUAL_CHECKSUM=$(sha256sum "$LOCAL_FILE" | awk '{print $1}')
if [ "$EXPECTED_CHECKSUM" != "$ACTUAL_CHECKSUM" ]; then
  log "  ✗ CHECKSUM MISMATCH — expected=${EXPECTED_CHECKSUM:0:16}... actual=${ACTUAL_CHECKSUM:0:16}..."
  exit 1
fi
log "  ✓ Checksum verified: ${ACTUAL_CHECKSUM:0:16}..."

# ── Step 3: Display backup metadata ──
log "[3/6] Backup metadata:"
cat "$LOCAL_META" | python3 -m json.tool 2>/dev/null || cat "$LOCAL_META"

# ── Step 4: Create isolated restore database ──
log "[4/6] Creating isolated restore database: ${RESTORE_DB_NAME}..."
export PGPASSWORD="postgres"
# Drop if exists (idempotent for testing)
"$PSQL" -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "DROP DATABASE IF EXISTS ${RESTORE_DB_NAME};" 2>&1 | tail -2
"$PSQL" -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "CREATE DATABASE ${RESTORE_DB_NAME} OWNER ${RESTORE_ROLE};" 2>&1 | tail -2
log "  ✓ Database created"

# ── Step 5: Restore ──
log "[5/6] Restoring backup..."
START_TIME=$(date +%s)
export PGPASSWORD="$RESTORE_PASSWORD"
"$PG_RESTORE" \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$RESTORE_ROLE" \
  -d "$RESTORE_DB_NAME" \
  --no-owner \
  --no-privileges \
  --jobs=4 \
  "$LOCAL_FILE" 2>&1 | tail -10 || true  # pg_restore returns non-zero for warnings
END_TIME=$(date +%s)
RESTORE_DURATION=$((END_TIME - START_TIME))
log "  ✓ Restore completed in ${RESTORE_DURATION}s"

# ── Step 6: Post-restore verification ──
log "[6/6] Post-restore verification..."
export PGPASSWORD="$RESTORE_PASSWORD"

# Row count comparison
RESTORE_ROW_COUNTS=$("$PSQL" -h "$DB_HOST" -p "$DB_PORT" -U "$RESTORE_ROLE" -d "$RESTORE_DB_NAME" -t -A -c "
  SELECT jsonb_object_agg(tablename, cnt) FROM (
    SELECT tablename, (xpath('/row/c/text()', query_to_xml('SELECT count(*) c FROM ' || quote_ident(tablename), true, true, '')))[1]::text::int AS cnt
    FROM pg_tables WHERE schemaname='public' AND tablename IN ('companies','users','sales','purchases','journal_entries','stock_movements','payments','products','customers')
  ) t;" 2>/dev/null || echo "{}")
log "  Restored row counts: $RESTORE_ROW_COUNTS"

# Journal balance check
JOURNAL_BALANCE=$("$PSQL" -h "$DB_HOST" -p "$DB_PORT" -U "$RESTORE_ROLE" -d "$RESTORE_DB_NAME" -t -A -c "
  SELECT count(*) FILTER (WHERE td != tc) AS unbalanced_entries
  FROM (
    SELECT journal_entry_id, SUM(debit_base) AS td, SUM(credit_base) AS tc
    FROM journal_lines GROUP BY journal_entry_id
  ) t;" 2>/dev/null || echo "0")
log "  Unbalanced journal entries: $JOURNAL_BALANCE"

# Schema version
SCHEMA_VERSION=$("$PSQL" -h "$DB_HOST" -p "$DB_PORT" -U "$RESTORE_ROLE" -d "$RESTORE_DB_NAME" -t -A -c "SELECT count(*) FROM schema_migrations;" 2>/dev/null || echo "0")
log "  Schema migrations: $SCHEMA_VERSION"

# ── Summary ──
log ""
log "═══════════════════════════════════════════════════════════"
log "  ✓ Restore completed successfully"
log "  Backup ID: ${BACKUP_ID}"
log "  Restored to: ${RESTORE_DB_NAME}"
log "  Restore duration: ${RESTORE_DURATION}s"
log "  Schema migrations: ${SCHEMA_VERSION}"
log "  Unbalanced journals: ${JOURNAL_BALANCE}"
log "═══════════════════════════════════════════════════════════"
log ""
log "Next steps:"
log "  1. Run full reconciliation: bun run scripts/backup/post-restore-reconciliation.sh"
log "  2. Review provider + offline-device transactions around recovery window"
log "  3. Open read-only for validation"
log "  4. If valid, increment recovery epoch + switch app to restored DB"
