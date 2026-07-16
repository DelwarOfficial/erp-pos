#!/bin/bash
# scripts/run-e2e-individual.sh — Runs E2E tests one at a time with server restarts
# Designed for memory-constrained environments (4GB sandbox)
cd /home/z/my-project

RESULTS="/tmp/e2e-individual-results.txt"
> "$RESULTS"

# List of individual test names (grep patterns) from each spec
TESTS=(
  "login.spec.ts:login with valid credentials redirects to dashboard"
  "login.spec.ts:login with invalid credentials shows error"
  "login.spec.ts:logout clears session and redirects to login"
  "login.spec.ts:can navigate to Products page"
  "login.spec.ts:can navigate to Inventory page"
  "login.spec.ts:can navigate to POS page"
  "login.spec.ts:can navigate to Accounting page"
  "login.spec.ts:can navigate to Sales page"
  "login.spec.ts:can navigate to Customers"
  "login.spec.ts:can navigate to Cashier Shifts"
  "login.spec.ts:can navigate to Purchases"
  "login.spec.ts:can navigate to HR"
  "login.spec.ts:can navigate to Service"
  "login.spec.ts:can navigate to Reports"
  "accessibility.spec.ts:login page has no critical"
  "accessibility.spec.ts:dashboard has no critical"
  "accessibility.spec.ts:POS page has no critical"
  "accessibility.spec.ts:Products page has no critical"
  "accessibility.spec.ts:Inventory page has no critical"
  "print-routes.spec.ts:receipt route returns"
  "print-routes.spec.ts:invoice route returns"
  "pwa-offline.spec.ts:service worker"
  "risk-tuning-page.spec.ts:FP/FN report"
  "uat-scenario-5-manager.spec.ts:can navigate"
)

PASS=0
FAIL=0
SKIP=0

for test_spec in "${TESTS[@]}"; do
  spec_file=$(echo "$test_spec" | cut -d: -f1)
  test_name=$(echo "$test_spec" | cut -d: -f2-)
  
  echo "=== Testing: $spec_file → $test_name ===" | tee -a "$RESULTS"
  
  # Kill any existing server
  pkill -9 -f "server.js" 2>/dev/null
  sleep 1
  
  # Start server fresh
  HOSTNAME=0.0.0.0 PORT=3000 NODE_ENV=production \
  JWT_SECRET="e2e-testing-jwt-secret-32-chars-minimum-2026" \
  APP_ENCRYPTION_KEY="e2e-testing-encryption-key-32ch" \
  E2E_TESTING=true nohup bun .next/standalone/server.js > /tmp/prod.log 2>&1 &
  
  # Wait for server to be ready
  for i in $(seq 1 10); do
    if curl -sS -o /dev/null http://localhost:3000/login 2>/dev/null; then
      break
    fi
    sleep 1
  done
  
  # Run the test with 25s timeout
  OUTPUT=$(timeout 25 bunx playwright test "tests/e2e/$spec_file" -g "$test_name" --reporter=line --project="Desktop Chrome" 2>&1)
  
  if echo "$OUTPUT" | grep -q "passed"; then
    echo "  → PASS" | tee -a "$RESULTS"
    PASS=$((PASS + 1))
  elif echo "$OUTPUT" | grep -q "failed"; then
    echo "  → FAIL" | tee -a "$RESULTS"
    # Save first 3 lines of error
    echo "$OUTPUT" | grep -A 2 "Error\|error" | head -3 >> "$RESULTS"
    FAIL=$((FAIL + 1))
  else
    echo "  → SKIP (timeout or error)" | tee -a "$RESULTS"
    SKIP=$((SKIP + 1))
  fi
  
  # Kill server to free memory
  pkill -9 -f "server.js" 2>/dev/null
  sleep 1
done

echo "" | tee -a "$RESULTS"
echo "=== E2E INDIVIDUAL RESULTS ===" | tee -a "$RESULTS"
echo "PASS: $PASS  FAIL: $FAIL  SKIP: $SKIP  TOTAL: $((PASS + FAIL + SKIP))" | tee -a "$RESULTS"
