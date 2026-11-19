#!/usr/bin/env bash
# scripts/cron-evaluate-risk-alerts.sh
# Cron job: run the daily risk alert evaluation.
#
# Calls POST /api/v1/cron/risk-alerts with the shared cron token
# (Authorization: Bearer $CRON_API_TOKEN). It does not log in as an
# administrator and holds no password. See docs/operations/cron-jobs.md.
#
# Required environment (set in the cron environment, never in this file):
#   ERP_POS_BASE_URL  — the app's base URL, e.g. https://erp.example.com
#   CRON_API_TOKEN    — the same value the server has in CRON_API_TOKEN
#
# Example crontab (09:00 Asia/Dhaka = 03:00 UTC):
#   0 3 * * * /opt/erp-pos/scripts/cron-evaluate-risk-alerts.sh >> /var/log/erp-pos/risk-alerts.log 2>&1

set -euo pipefail

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

if [ -z "${ERP_POS_BASE_URL:-}" ]; then
  echo "[$(ts)] ERROR: ERP_POS_BASE_URL is not set. Set it to the app's base URL." >&2
  exit 2
fi
if [ -z "${CRON_API_TOKEN:-}" ]; then
  echo "[$(ts)] ERROR: CRON_API_TOKEN is not set. Set it to the server's CRON_API_TOKEN value." >&2
  exit 2
fi

echo "[$(ts)] Risk alert evaluation starting..."

# The header is read from stdin (-H @-) so the token never appears in the
# process list or in this log.
RESPONSE=$(printf 'Authorization: Bearer %s\n' "$CRON_API_TOKEN" | curl -sS --max-time 120 -w "\n%{http_code}" \
  -X POST "${ERP_POS_BASE_URL%/}/api/v1/cron/risk-alerts" \
  -H @- -H 'Content-Type: application/json' -d '{}') || {
  echo "[$(ts)] ERROR: could not reach ${ERP_POS_BASE_URL%/}" >&2
  exit 1
}

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

case "$HTTP_CODE" in
  200) ;;
  401) echo "[$(ts)] ERROR: the server refused the cron token (HTTP 401). Check CRON_API_TOKEN matches the server." >&2; exit 1 ;;
  503) echo "[$(ts)] ERROR: the server has no CRON_API_TOKEN configured (HTTP 503)." >&2; exit 1 ;;
  *)   echo "[$(ts)] ERROR: alert evaluation failed (HTTP ${HTTP_CODE})." >&2; exit 1 ;;
esac

ALERTS_TRIGGERED=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('alertsTriggered', 0))" 2>/dev/null || echo "0")
echo "[$(ts)] Done: ${ALERTS_TRIGGERED} alert(s) triggered."
