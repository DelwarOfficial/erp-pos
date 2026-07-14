#!/usr/bin/env bash
# scripts/backup/wal-archive.sh
# Continuous WAL archiving to S3/MinIO with object-lock.
# Per §20.D10 — RPO ≤ 15 minutes via continuous WAL archiving.
#
# This script is called by PostgreSQL's archive_command setting in postgresql.conf:
#   archive_command = '/home/z/my-project/scripts/backup/wal-archive.sh %p %f'
#
# %p = full path to the WAL file to be archived
# %f = name of the WAL file
#
# The script uploads each WAL segment to S3 with immutable object-lock.
# Returns 0 on success (Postgres considers the segment safely archived).

set -euo pipefail

WAL_PATH="${1:?Usage: wal-archive.sh <wal_path> <wal_filename>}"
WAL_FILENAME="${2:?Usage: wal-archive.sh <wal_path> <wal_filename>}"

# ── Configuration ──
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-erp-pos-backups}"
WAL_S3_PREFIX="${WAL_S3_PREFIX:-wal-archive}"
S3_ENDPOINT="${S3_ENDPOINT:-http://localhost:9000}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-minioadmin}"
S3_SECRET_KEY="${S3_SECRET_KEY:-minioadmin}"
S3_REGION="${S3_REGION:-ap-south-1}"

S3_KEY="${WAL_S3_PREFIX}/${WAL_FILENAME}"

# Compute checksum for integrity verification
CHECKSUM=$(sha256sum "$WAL_PATH" | awk '{print $1}')

# Upload to S3
if command -v aws &>/dev/null; then
  AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    aws s3 cp "$WAL_PATH" "s3://${BACKUP_S3_BUCKET}/${S3_KEY}" \
    --endpoint-url "$S3_ENDPOINT" --region "$S3_REGION" \
    --metadata "checksum-sha256=${CHECKSUM}" 2>/dev/null
else
  # Fall back to curl + S3 API (simplified — production should use aws CLI)
  cd /home/z/my-project && \
    S3_ENDPOINT="$S3_ENDPOINT" S3_ACCESS_KEY="$S3_ACCESS_KEY" S3_SECRET_KEY="$S3_SECRET_KEY" \
    S3_BUCKET="$BACKUP_S3_BUCKET" S3_KEY="$S3_KEY" \
    WAL_PATH="$WAL_PATH" \
    bun run scripts/backup/upload-wal.ts 2>/dev/null
fi

RESULT=$?
if [ $RESULT -eq 0 ]; then
  # Log to stderr (stdout would interfere with archive_command)
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Archived WAL: ${WAL_FILENAME} (sha256: ${CHECKSUM:0:16}...)" >&2
  exit 0
else
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] FAILED to archive WAL: ${WAL_FILENAME}" >&2
  exit 1
fi
