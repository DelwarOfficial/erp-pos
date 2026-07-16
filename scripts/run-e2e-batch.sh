#!/bin/bash
# scripts/run-e2e-batch.sh — Runs E2E tests one spec at a time, saves results
cd /home/z/my-project

export E2E_BASE_URL=http://localhost:3000
export E2E_TESTING=true
export SKIP_WEBKIT=1
export JWT_SECRET="e2e-testing-jwt-secret-32-chars-minimum-2026"
export APP_ENCRYPTION_KEY="e2e-testing-encryption-key-32ch"

RESULTS_FILE="/tmp/e2e-results.txt"
> "$RESULTS_FILE"

SPECS=(
  "tests/e2e/login.spec.ts"
  "tests/e2e/accessibility.spec.ts"
  "tests/e2e/print-routes.spec.ts"
  "tests/e2e/pwa-offline.spec.ts"
  "tests/e2e/risk-tuning-page.spec.ts"
  "tests/e2e/uat-scenario-1-cashier.spec.ts"
  "tests/e2e/uat-scenario-2-inventory.spec.ts"
  "tests/e2e/uat-scenario-3-accountant.spec.ts"
  "tests/e2e/uat-scenario-4-service.spec.ts"
  "tests/e2e/uat-scenario-5-manager.spec.ts"
  "tests/e2e/uat-scenario-6-offline.spec.ts"
  "tests/e2e/uat-scenario-7-delivery.spec.ts"
)

TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_SKIP=0

for spec in "${SPECS[@]}"; do
  echo "=== Running: $spec ===" | tee -a "$RESULTS_FILE"
  
  # Run with 60s timeout per spec
  timeout 60 bunx playwright test "$spec" --reporter=line --project="Desktop Chrome" 2>&1 | tail -5 >> "$RESULTS_FILE"
  
  # Extract pass/fail count from output
  pass=$(grep -oP '\d+ passed' "$RESULTS_FILE" | tail -1 | grep -oP '^\d+' || echo "0")
  fail=$(grep -oP '\d+ failed' "$RESULTS_FILE" | tail -1 | grep -oP '^\d+' || echo "0")
  
  echo "  → ${pass} passed, ${fail} failed" | tee -a "$RESULTS_FILE"
  echo "" >> "$RESULTS_FILE"
  
  # Check if server is still running, restart if needed
  if ! curl -sS -o /dev/null http://localhost:3000/login 2>/dev/null; then
    echo "  → Server died, restarting..." | tee -a "$RESULTS_FILE"
    pkill -9 -f "server.js" 2>/dev/null
    sleep 2
    HOSTNAME=0.0.0.0 PORT=3000 NODE_ENV=production \
    JWT_SECRET="e2e-testing-jwt-secret-32-chars-minimum-2026" \
    APP_ENCRYPTION_KEY="e2e-testing-encryption-key-32ch" \
    E2E_TESTING=true nohup bun .next/standalone/server.js > /tmp/prod.log 2>&1 &
    sleep 8
  fi
done

echo "=== E2E BATCH COMPLETE ===" | tee -a "$RESULTS_FILE"
echo "Results saved to $RESULTS_FILE"
