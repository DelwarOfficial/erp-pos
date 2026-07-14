#!/usr/bin/env bash
# scripts/backup/first-restore-test.sh
# M0 task 11 exit gate: "Run first restore test" per §20.D10.
# A backup is not considered valid until a restore test succeeds.
#
# This script:
#   1. Runs a backup
#   2. Restores it to an isolated database
#   3. Runs post-restore reconciliation (row counts, journal balance, etc.)
#   4. Reports PASS/FAIL
#
# Usage: scripts/backup/first-restore-test.sh

set -euo pipefail

cd /home/z/my-project

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

log "═══════════════════════════════════════════════════════════"
log "  M0 Exit Gate — First Restore Test"
log "═══════════════════════════════════════════════════════════"

# ── Step 1: Run backup ──
log "[1/3] Running backup..."
bash scripts/backup/nightly-backup.sh 2>&1 | tail -20
BACKUP_ID=$(ls -t /tmp/erp-backups/*.dump 2>/dev/null | head -1 | sed 's/.*-\([0-9T]*Z\)\.dump/\1/' | sed 's/erp_pos-//')
if [ -z "$BACKUP_ID" ]; then
  log "  ✗ No backup file found after backup script"
  exit 1
fi
log "  ✓ Backup completed: ${BACKUP_ID}"

# ── Step 2: Restore to isolated DB ──
log ""
log "[2/3] Restoring to isolated database..."
bash scripts/backup/restore-from-backup.sh "$BACKUP_ID" 2>&1 | tail -20

# ── Step 3: Post-restore reconciliation ──
log ""
log "[3/3] Post-restore reconciliation..."
bash scripts/backup/post-restore-reconciliation.sh 2>&1 | tail -30
RESULT=$?

if [ $RESULT -eq 0 ]; then
  log ""
  log "═══════════════════════════════════════════════════════════"
  log "  ✓ M0 EXIT GATE PASSED — First restore test succeeded"
  log "═══════════════════════════════════════════════════════════"
  exit 0
else
  log ""
  log "═══════════════════════════════════════════════════════════"
  log "  ✗ M0 EXIT GATE FAILED — Restore test did not pass"
  log "═══════════════════════════════════════════════════════════"
  exit 1
fi
