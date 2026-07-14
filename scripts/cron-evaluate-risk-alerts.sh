#!/usr/bin/env bash
# scripts/cron-evaluate-risk-alerts.sh
# Cron job script — triggers the risk alert evaluation endpoint daily.
#
# Setup (add to crontab with `crontab -e`):
#   # Run daily at 9am Asia/Dhaka (UTC 3am)
#   0 3 * * * /home/z/my-project/scripts/cron-evaluate-risk-alerts.sh >> /var/log/risk-alerts.log 2>&1
#
# Or using systemd timer / scheduled task / etc.
#
# Required env vars (set in .env or in the cron environment):
#   ERP_POS_BASE_URL — e.g. http://localhost:3000
#   ERP_POS_ADMIN_EMAIL — admin login email
#   ERP_POS_ADMIN_PASSWORD — admin login password

set -euo pipefail

BASE_URL="${ERP_POS_BASE_URL:-http://localhost:3000}"
ADMIN_EMAIL="${ERP_POS_ADMIN_EMAIL:-admin@erp-platform.local}"
ADMIN_PASSWORD="${ERP_POS_ADMIN_PASSWORD:-ChangeMe!2026}"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Risk alert evaluation starting..."

# 1. Login to get auth cookie
COOKIE=$(curl -s -c - -X POST "${BASE_URL}/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
  | grep erp_access | awk '{print $NF}')

if [ -z "$COOKIE" ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: Login failed"
  exit 1
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Login successful, triggering alert evaluation..."

# 2. Trigger alert evaluation
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/api/v1/admin/risk-alerts/evaluate" \
  -H "Content-Type: application/json" \
  -b "erp_access=${COOKIE}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] HTTP ${HTTP_CODE}"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Response: ${BODY}"

if [ "$HTTP_CODE" != "200" ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: Alert evaluation failed"
  exit 1
fi

# 3. Parse response
ALERTS_TRIGGERED=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('alertsTriggered', 0))" 2>/dev/null || echo "0")

if [ "$ALERTS_TRIGGERED" -gt 0 ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ✓ ${ALERTS_TRIGGERED} alert(s) triggered — emails + notifications sent"
else
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ✓ No alerts triggered — risk performance within thresholds"
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Done."
