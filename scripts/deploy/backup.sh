#!/usr/bin/env bash
# scripts/deploy/backup.sh — nightly logical backup of the production database.
#
#   - consistent dump (--single-transaction) with routines, triggers and events
#   - gzip, sha256 alongside, kept 14 days in $BACKUP_DIR
#   - copied offsite with rclone when BACKUP_RCLONE_REMOTE is set
#
# Cron (02:30 Asia/Dhaka = 20:30 UTC):
#   30 20 * * * bash /opt/erp-pos/scripts/deploy/backup.sh >> /var/log/erp-pos/backup.log 2>&1
# Restore rehearsal: docs/runbooks/vps-deploy.md, step 9. Prints no credentials.
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE=docker/.env.prod
COMPOSE=(docker compose -f docker/docker-compose.prod.yml --env-file "$ENV_FILE")
BACKUP_DIR="${BACKUP_DIR:-/var/backups/erp-pos}"
KEEP_DAYS="${KEEP_DAYS:-14}"
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

[ -r "$ENV_FILE" ] || { echo "[$(ts)] ERROR: $ENV_FILE not readable" >&2; exit 2; }
DB_NAME=$(grep -E '^DB_NAME=' "$ENV_FILE" | cut -d= -f2-)
REMOTE=$(grep -E '^BACKUP_RCLONE_REMOTE=' "$ENV_FILE" | cut -d= -f2- || true)
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
FILE="$BACKUP_DIR/${DB_NAME}-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

echo "[$(ts)] Backup of ${DB_NAME} starting"
# The root password is read inside the container from its own environment.
"${COMPOSE[@]}" exec -T mariadb sh -c 'exec mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --routines --triggers --events --hex-blob --databases "$MARIADB_DATABASE"' \
  | gzip -9 > "$FILE.partial"
mv "$FILE.partial" "$FILE"
sha256sum "$FILE" > "$FILE.sha256"
gzip -t "$FILE"
echo "[$(ts)] Wrote $(basename "$FILE") ($(du -h "$FILE" | cut -f1))"

if [ -n "$REMOTE" ]; then
  rclone copy "$FILE" "$REMOTE/" && rclone copy "$FILE.sha256" "$REMOTE/"
  echo "[$(ts)] Copied offsite to $REMOTE"
else
  echo "[$(ts)] WARNING: BACKUP_RCLONE_REMOTE not set: this backup is only on this VPS" >&2
fi
find "$BACKUP_DIR" -name "${DB_NAME}-*.sql.gz*" -mtime +"$KEEP_DAYS" -delete
echo "[$(ts)] Done"
