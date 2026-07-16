#!/bin/bash
# scripts/run-full-e2e.sh — Runs ALL Playwright E2E tests with server restarts
# Designed for memory-constrained environments (4GB sandbox)
# Restarts the production server before each spec to avoid OOM

cd /home/z/my-project

export E2E_BASE_URL=http://localhost:3000
export E2E_TESTING=true
export SKIP_WEBKIT=1
export JWT_SECRET="e2e-testing-jwt-secret-32-chars-minimum-2026"
export APP_ENCRYPTION_KEY="e2e-testing-encryption-key-32ch"

RESULTS="/tmp/e2e-full-results.txt"
> "$RESULTS"

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

start_server() {
  pkill -9 -f "server.js" 2>/dev/null
  sleep 2
  HOSTNAME=0.0.0.0 PORT=3000 NODE_ENV=production \
  JWT_SECRET="$JWT_SECRET" \
  APP_ENCRYPTION_KEY="$APP_ENCRYPTION_KEY" \
  E2E_TESTING=true nohup bun .next/standalone/server.js > /tmp/prod.log 2>&1 &
  
  # Wait for server to be ready (max 10s)
  for i in $(seq 1 10); do
    if curl -sS -o /dev/null http://localhost:3000/login 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

for spec in "${SPECS[@]}"; do
  echo "=== Running: $spec ===" | tee -a "$RESULTS"
  
  # Start fresh server
  start_server
  
  if ! curl -sS -o /dev/null http://localhost:3000/login 2>/dev/null; then
    echo "  → SERVER FAILED TO START" | tee -a "$RESULTS"
    TOTAL_FAIL=$((TOTAL_FAIL + 5))  # Assume ~5 tests per spec
    continue
  fi
  
  # Run spec with 90s timeout
  OUTPUT=$(timeout 90 bunx playwright test "$spec" --reporter=line --project="Desktop Chrome" 2>&1)
  
  # Extract pass/fail counts
  PASS=$(echo "$OUTPUT" | grep -oP '\d+ passed' | tail -1 | grep -oP '^\d+' || echo "0")
  FAIL=$(echo "$OUTPUT" | grep -oP '\d+ failed' | tail -1 | grep -oP '^\d+' || echo "0")
  
  TOTAL_PASS=$((TOTAL_PASS + PASS))
  TOTAL_FAIL=$((TOTAL_FAIL + FAIL))
  
  echo "  → ${PASS} passed, ${FAIL} failed" | tee -a "$RESULTS"
  
  # Show first error if any
  if [ "$FAIL" -gt 0 ]; then
    echo "$OUTPUT" | grep -E "Error:|TimeoutError|✘" | head -2 >> "$RESULTS"
  fi
  
  # Kill server to free memory
  pkill -9 -f "server.js" 2>/dev/null
  sleep 2
done

echo "" | tee -a "$RESULTS"
echo "═══════════════════════════════════════════════════" | tee -a "$RESULTS"
echo "  FULL E2E RESULTS: PASS=$TOTAL_PASS  FAIL=$TOTAL_FAIL  TOTAL=$((TOTAL_PASS + TOTAL_FAIL))" | tee -a "$RESULTS"
echo "═══════════════════════════════════════════════════" | tee -a "$RESULTS"
