# MariaDB backup and restore

MariaDB 11.8 is authoritative. Scripts create logical SQL backups and restore into a **new local disposable database**. Production execution requires separate authorization.

## Prerequisites

- Matching MariaDB clients (`mariadb-dump`, `mariadb`), Bash, SHA-256 tools.
- Protected absolute client option file (0600), provisioned outside Git. Never pass passwords on command lines or print file contents.
- Dedicated encrypted storage. Scripts set private permissions but do not implement encryption, offsite upload, immutability, retention or scheduling.
- Least-privilege backup account able to export tables, views, routines, events and triggers.
- InnoDB business tables; no concurrent DDL during backup. Single-transaction does not give consistent snapshots of nontransactional tables.
- Restore trusted SQL only: routines/events are executable. Isolate restore server, disable event scheduler and restrict restore account to target database. Do not restore with global/root privileges.

## Logical backup

Set `MARIADB_DEFAULTS_FILE`, `DB_NAME`, `BACKUP_WORK_DIR` through protected operator configuration:

```bash
bash scripts/backup/nightly-backup.sh
```

Unique directory contains database.sql, SHA-256 checksum, manifest, final COMPLETE marker. Dump errors exit nonzero without COMPLETE. Failed private artifacts remain for diagnosis. Checksums detect corruption, not malicious modification; authenticate storage separately.

## Disposable restore

Set `MARIADB_DEFAULTS_FILE`, `RESTORE_DB_NAME` (ending _disposable), `RESTORE_PORT` for an isolated local MariaDB 11.8 server:

```bash
bash scripts/backup/restore-from-backup.sh /secure/backups/mariadb-backup-XXXXXXXX
```

Script forces loopback TCP, checks checksum, rejects existing targets, never drops databases and stops on SQL errors. Failed partial target remains for diagnosis; retry with a new target.

Import success is not recovery approval. Compare all table counts/UUIDs, migration checksums, orphan/tenant FKs, views/routines/triggers/events, posted debit/credit totals, subledgers and stock quantities/valuation. Run auth and critical browser workflows and application reconciliation; reject any CHECK_ERROR. Record duration and discrepancies. Legacy PostgreSQL post-restore and WAL scripts do not apply.

## Binary logs / PITR

**PITR: UNPROVEN.** Scripts do not archive/replay binary logs or record coordinated binlog position. No achieved RPO/RTO follows from a logical dump.

Required evidence: binary-log retention, exact coordinated backup GTID/file-position, authenticated encrypted offsite log continuity, isolated mariadb-binlog replay stopping before incident, no gaps/double application, final reconciliation. Server changes and recovery/cutover require separate approval.

## Verification status

Runtime backup/restore, offsite encryption/immutability, reconciliation, PITR and achieved RPO/RTO remain **UNPROVEN until dated disposable rehearsal evidence**. Historical PostgreSQL results do not verify MariaDB.
