#!/usr/bin/env bash
# scripts/deploy/gen-secrets.sh — create docker/.env.prod with fresh secrets.
#
# Run ON THE VPS, once. Never overwrites an existing file (rotating
# APP_ENCRYPTION_KEY would make stored MFA seeds and credentials unreadable).
# Prints no secret values.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=docker/.env.prod
if [ -e "$OUT" ]; then
  echo "ERROR: $OUT already exists; not touching it. Edit it by hand, or move it away first if you really mean to start over." >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "ERROR: openssl is required" >&2; exit 2; }
rand() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48; }
umask 177
{
  sed -n '/^# ── You set these ──/,/^# ── gen-secrets.sh/p' docker/.env.prod.example | sed '$d'
  echo "# ── generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by gen-secrets.sh ──"
  for name in DB_PASSWORD DB_ROOT_PASSWORD REDIS_PASSWORD JWT_SECRET APP_ENCRYPTION_KEY BARCODE_SIGNING_KEY CRON_API_TOKEN; do
    echo "${name}=$(rand)"
  done
  sed -n '/^# ── Optional ──/,$p' docker/.env.prod.example
} > "$OUT"
chmod 600 "$OUT"
echo "Wrote $OUT (mode 600). Now set APP_DOMAIN and ACME_EMAIL in it, and DB_BUFFER_POOL for this server."
