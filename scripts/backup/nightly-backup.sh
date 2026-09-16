#!/usr/bin/env bash
# MariaDB logical backup. No upload, retention deletion or PITR claim.
set -euo pipefail
umask 077
: "${MARIADB_DEFAULTS_FILE:?Protected absolute client option file required}"
: "${DB_NAME:?Explicit source database required}"
: "${BACKUP_WORK_DIR:?Dedicated encrypted backup directory required}"
[[ "$MARIADB_DEFAULTS_FILE" = /* && -r "$MARIADB_DEFAULTS_FILE" ]]
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]]
command -v mariadb-dump >/dev/null
command -v sha256sum >/dev/null
mkdir -p -- "$BACKUP_WORK_DIR"
work=$(mktemp -d "$BACKUP_WORK_DIR/mariadb-backup-XXXXXXXX")
# Failed artifacts remain private for diagnosis; never published as complete.
mariadb-dump --defaults-extra-file="$MARIADB_DEFAULTS_FILE" \
  --skip-force --single-transaction --quick --routines --events --triggers --hex-blob \
  --skip-add-drop-table "$DB_NAME" > "$work/database.sql.partial"
test -s "$work/database.sql.partial"
mv -- "$work/database.sql.partial" "$work/database.sql"
(cd "$work" && sha256sum database.sql > database.sql.sha256)
printf '%s\n' 'format=mariadb-logical-v1' "source_database=$DB_NAME" \
  "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  'pitr=UNPROVEN' > "$work/manifest.txt"
printf '%s\n' 'complete' > "$work/COMPLETE"
printf 'Logical backup complete: %s\n' "$work"
printf '%s\n' 'Restore, encryption, offsite retention and PITR remain separate verification gates.'
