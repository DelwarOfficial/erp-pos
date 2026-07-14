#!/usr/bin/env bash
# scripts/security/rls-penetration-test.sh
# RLS penetration test per §17.3 + §20.0 control 1.
#
# Tests that cross-tenant access fails even with application filters removed.
# Runs against the local Postgres validation database.

set -uo pipefail

PG_BIN="${PG_BIN:-/home/z/my-project/.local/deps/usr/lib/postgresql/17/bin}"
PSQL="$PG_BIN/psql"
DB="erp_pos_validate"

echo "═══════════════════════════════════════════════════════════════════════"
echo "  RLS Penetration Test"
echo "═══════════════════════════════════════════════════════════════════════"

PASS=0
FAIL=0

test_case() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name (expected: $expected, got: $actual)"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "→ Test 1: app_role with NO company_id set — should see 0 rows"
RESULT=$($PSQL -h /tmp -U app_role -d $DB -t -A -c "
  SELECT count(*) FROM users;" 2>&1 | tr -d '[:space:]')
test_case "no_context_users" "0" "$RESULT"

RESULT=$($PSQL -h /tmp -U app_role -d $DB -t -A -c "
  SELECT count(*) FROM products;" 2>&1 | tr -d '[:space:]')
test_case "no_context_products" "0" "$RESULT"

RESULT=$($PSQL -h /tmp -U app_role -d $DB -t -A -c "
  SELECT count(*) FROM warehouse_stocks;" 2>&1 | tr -d '[:space:]')
test_case "no_context_warehouse_stocks" "0" "$RESULT"

echo ""
echo "→ Test 2: app_role with wrong company context — cannot see other tenant rows"
RESULT=$($PSQL -h /tmp -U app_role -d $DB -t -A -c "
  SELECT set_config('app.company_id', 'ffffffff-ffff-ffff-ffff-ffffffffffff', true);
  SELECT set_config('app.is_global', 'false', true);
  SELECT count(*) FROM companies;" 2>&1 | tail -1 | tr -d '[:space:]')
test_case "wrong_company_sees_zero" "0" "$RESULT"

echo ""
echo "→ Test 3: app_role with is_global=true — can see all companies"
RESULT=$($PSQL -h /tmp -U app_role -d $DB -t -A -c "
  SELECT set_config('app.company_id', '00000000-0000-0000-0000-000000000001', true);
  SELECT set_config('app.is_global', 'true', true);
  SELECT count(*) FROM companies;" 2>&1 | tail -1 | tr -d '[:space:]')
if [ "$RESULT" -gt 0 ] 2>/dev/null; then
  echo "  ✓ global_sees_companies (count: $RESULT)"
  PASS=$((PASS + 1))
else
  echo "  ✗ global_sees_companies (got: $RESULT)"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "→ Test 4: audit_logs cannot be UPDATEd"
UPDATE_RESULT=$($PSQL -h /tmp -U app_role -d $DB -c "
  SELECT set_config('app.company_id', '00000000-0000-0000-0000-000000000001', true);
  UPDATE audit_logs SET action='hacked' WHERE action='test.action';" 2>&1)
if echo "$UPDATE_RESULT" | grep -qi "error\|Cannot modify"; then
  echo "  ✓ audit_log UPDATE blocked"
  PASS=$((PASS + 1))
else
  echo "  ✗ audit_log UPDATE NOT blocked"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "→ Test 5: audit_logs cannot be DELETEd"
DELETE_RESULT=$($PSQL -h /tmp -U app_role -d $DB -c "
  SELECT set_config('app.company_id', '00000000-0000-0000-0000-000000000001', true);
  DELETE FROM audit_logs WHERE action='test.action';" 2>&1)
if echo "$DELETE_RESULT" | grep -qi "error\|Cannot modify"; then
  echo "  ✓ audit_log DELETE blocked"
  PASS=$((PASS + 1))
else
  echo "  ✗ audit_log DELETE NOT blocked"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "→ Test 6: stock_movements cannot be UPDATEd (immutable ledger)"
UPDATE_RESULT=$($PSQL -h /tmp -U app_role -d $DB -c "
  SELECT set_config('app.company_id', '00000000-0000-0000-0000-000000000001', true);
  UPDATE stock_movements SET movement_type='hacked' WHERE 1=1;" 2>&1)
if echo "$UPDATE_RESULT" | grep -qi "error\|Cannot modify"; then
  echo "  ✓ stock_movement UPDATE blocked"
  PASS=$((PASS + 1))
else
  echo "  ✗ stock_movement UPDATE NOT blocked"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
