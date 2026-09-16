#!/usr/bin/env bash
# New LOCAL disposable database only. Never drops a database.
set -euo pipefail
umask 077
: "${MARIADB_DEFAULTS_FILE:?Protected absolute client option file required}"
: "${RESTORE_DB_NAME:?Explicit disposable target required}"
: "${RESTORE_PORT:?Explicit local disposable server port required}"
backup_dir="${1:?Usage: restore-from-backup.sh <trusted-backup-directory>}"
[[ $# -eq 1 ]]
[[ "$MARIADB_DEFAULTS_FILE" = /* && -r "$MARIADB_DEFAULTS_FILE" ]]
[[ "$RESTORE_DB_NAME" =~ ^[A-Za-z0-9_]+_disposable$ ]]
[[ "$RESTORE_PORT" =~ ^[0-9]+$ ]]
[[ -f "$backup_dir/COMPLETE" && -s "$backup_dir/database.sql" ]]
expected=$(awk 'NR==1 {print $1}' "$backup_dir/database.sql.sha256")
[[ "$expected" =~ ^[a-f0-9]{64}$ ]]
actual=$(sha256sum "$backup_dir/database.sql" | awk '{print $1}')
[[ "$expected" = "$actual" ]] || { echo 'Backup checksum mismatch' >&2; exit 1; }
source_database=$(sed -n 's/^source_database=//p' "$backup_dir/manifest.txt")
[[ "$source_database" =~ ^[A-Za-z0-9_]+$ && "$source_database" != "$RESTORE_DB_NAME" ]]
client=(mariadb --defaults-extra-file="$MARIADB_DEFAULTS_FILE"
  --protocol=tcp --host=127.0.0.1 --port="$RESTORE_PORT" --batch --skip-column-names --skip-force --skip-reconnect)
version=$("${client[@]}" --execute='SELECT VERSION()')
[[ "$version" = *MariaDB* ]] || { echo 'MariaDB required' >&2; exit 1; }
exists=$("${client[@]}" --execute="SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$RESTORE_DB_NAME'")
[[ "$exists" = 0 ]] || { echo 'Target already exists; refusing overwrite' >&2; exit 1; }
# Trusted dump only. Use a restore account restricted to this target.
"${client[@]}" --execute="CREATE DATABASE \`$RESTORE_DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
"${client[@]}" --database="$RESTORE_DB_NAME" < "$backup_dir/database.sql"
tables=$("${client[@]}" --execute="SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$RESTORE_DB_NAME'")
[[ "$tables" -gt 0 ]] || { echo 'No restored tables' >&2; exit 1; }
printf 'Logical import complete. Restored tables: %s\n' "$tables"
printf '%s\n' 'NOT recovery approval: compare row counts, UUIDs, FKs, GL, stock, routines and triggers.'
