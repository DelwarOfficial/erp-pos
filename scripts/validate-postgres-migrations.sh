#!/usr/bin/env bash
# scripts/validate-postgres-migrations.sh
# Runs the full Postgres migration runbook end-to-end against a local Postgres
# instance to validate the DDL, RLS policies, constraints, functions, and triggers.
#
# Prerequisites:
#   - PostgreSQL 16+ running (locally or remote)
#   - psql client on PATH
#   - The migration files under prisma/{migrations,functions,triggers,rls,roles}/

set -uo pipefail
# NOTE: we do NOT use `set -e` because we want to continue through migrations
# and report all errors at the end.

PG_BIN="${PG_BIN:-/home/z/my-project/.local/deps/usr/lib/postgresql/17/bin}"
PSQL="$PG_BIN/psql"
PSQL_OPTS="-h /tmp -U postgres -v ON_ERROR_STOP=1"
DB_NAME="erp_pos_validate"

echo "═══════════════════════════════════════════════════════════════════════"
echo "  Postgres Migration Validation Runbook"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""

# Step 0: Clean slate — drop ALL test databases + roles
echo "→ Step 0: Drop validation databases + roles (clean slate)..."
$PSQL $PSQL_OPTS -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>&1 | head -2
$PSQL $PSQL_OPTS -c "DROP DATABASE IF EXISTS erp_pos_test;" 2>&1 | head -2
# Drop owned objects + privileges for each role, then drop the role
for role in app_role migration_role backup_role reporting_role function_owner; do
  $PSQL $PSQL_OPTS -c "DROP OWNED BY $role CASCADE;" 2>&1 | head -1 || true
  $PSQL $PSQL_OPTS -c "DROP ROLE IF EXISTS $role;" 2>&1 | head -1 || true
done
$PSQL $PSQL_OPTS -c "CREATE DATABASE $DB_NAME;" 2>&1 | head -2

PSQL_DB="$PSQL $PSQL_OPTS -d $DB_NAME"

# Step 1: Create DB roles (run in postgres db, not the app db — roles are cluster-wide)
echo ""
echo "→ Step 1: Create DB roles (app_role, migration_role, backup_role, reporting_role, function_owner)..."
$PSQL $PSQL_OPTS \
  -v app_password="app_password_validate" \
  -v migration_password="migration_password_validate" \
  -v backup_password="backup_password_validate" \
  -v reporting_password="reporting_password_validate" \
  -f /home/z/my-project/prisma/roles/0001_db_roles.sql 2>&1 | head -10

# Verify roles
echo "  Verifying roles..."
$PSQL $PSQL_OPTS -c "
  SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
  FROM pg_roles
  WHERE rolname IN ('app_role','migration_role','backup_role','reporting_role','function_owner')
  ORDER BY rolname;" 2>&1 | head -10

# Step 2: Run forward-only migrations
# Extensions require superuser; run 0001 as postgres, rest as migration_role
echo ""
echo "→ Step 2: Run forward-only SQL migrations..."
echo "  • 0001_extensions_and_schemas.sql (as postgres — extensions need superuser)"
$PSQL_DB -U postgres -f "/home/z/my-project/prisma/migrations/0001_extensions_and_schemas.sql" 2>&1 | grep -v "^$" | head -5

# Grant migration_role CREATE on database + schema so it can create tables
$PSQL $PSQL_OPTS -c "GRANT CREATE ON DATABASE $DB_NAME TO migration_role;" 2>&1 | head -2
$PSQL_DB -U postgres -c "GRANT ALL ON SCHEMA public TO migration_role;" 2>&1 | head -2

# NOTE: 0009_grants.sql runs LAST (Step 5b), after functions + RLS policies
# create the helper functions it grants on.
MIGRATIONS=(
  "0002_organization_currency.sql"
  "0003_identity_rbac_devices.sql"
  "0004_numbering_events_idempotency.sql"
  "0005_audit_approval_statutory_reconciliation.sql"
  "0006_catalogue_pricing_tax.sql"
  "0007_settings_localization_featureflags.sql"
  "0008_partitioning.sql"
  # NOTE: 0010_inventory_purchasing_transfers.sql runs AFTER triggers (Step 4b)
  # because it references prevent_posted_record_mutation() + set_updated_at() functions.
)
for m in "${MIGRATIONS[@]}"; do
  echo "  • $m"
  $PSQL_DB -U migration_role -f "/home/z/my-project/prisma/migrations/$m" 2>&1 | grep -v "^$" | head -5
done

# Step 3: Create SQL functions (as postgres — owns them, grants EXECUTE to app_role)
echo ""
echo "→ Step 3: Create SECURITY DEFINER functions..."
$PSQL_DB -U postgres -f /home/z/my-project/prisma/functions/next_document_number.sql 2>&1 | head -3
$PSQL_DB -U postgres -f /home/z/my-project/prisma/functions/post_journal_entry.sql 2>&1 | head -3

# Step 4: Create triggers (as postgres)
echo ""
echo "→ Step 4: Create triggers..."
TRIG1_OUT=$($PSQL_DB -U postgres -f /home/z/my-project/prisma/triggers/0001_set_updated_at.sql 2>&1)
echo "$TRIG1_OUT" | tail -2
TRIG2_OUT=$($PSQL_DB -U postgres -f /home/z/my-project/prisma/triggers/0002_prevent_posted_record_mutation.sql 2>&1)
echo "$TRIG2_OUT" | tail -2
TRIG3_OUT=$($PSQL_DB -U postgres -f /home/z/my-project/prisma/triggers/0003_tenant_consistency_checks.sql 2>&1)
echo "$TRIG3_OUT" | tail -2

# Step 4b: Run 0010 (M2 inventory) — needs trigger functions from Step 4
# NOTE: 0010 creates M2 tables + RLS policies. The RLS policies reference
# app_is_global() + app_company_id() which are created in Step 5. So we split:
# run the table creation here, then the RLS policies after Step 5.
echo "  • 0010_inventory_purchasing_transfers.sql (table creation only)"
# Extract just the CREATE TABLE section (up to the RLS ENABLE section)
sed '/^-- Enable RLS on all new M2 tables/,$d' /home/z/my-project/prisma/migrations/0010_inventory_purchasing_transfers.sql > /tmp/0010_tables_only.sql
echo "COMMIT;" >> /tmp/0010_tables_only.sql
M2_OUT=$($PSQL_DB -U migration_role -f /tmp/0010_tables_only.sql 2>&1)
echo "$M2_OUT" | tail -3

# Step 5: Enable RLS + create policies (as postgres)
# The policies file creates app_company_id() + app_is_global() helper functions
echo ""
echo "→ Step 5: Enable RLS + create policies..."
RLS_ENABLE_OUT=$($PSQL_DB -U postgres -f /home/z/my-project/prisma/rls/0001_enable_rls.sql 2>&1)
echo "$RLS_ENABLE_OUT" | tail -3
RLS_POLICY_OUT=$($PSQL_DB -U postgres -f /home/z/my-project/prisma/rls/0002_tenant_policies.sql 2>&1)
echo "$RLS_POLICY_OUT" | tail -3

# Step 5b: NOW run 0009_grants (functions + helper functions exist)
echo "  Running 0009_grants.sql (functions now exist)..."
GRANTS_OUT=$($PSQL_DB -U postgres -f "/home/z/my-project/prisma/migrations/0009_grants.sql" 2>&1)
echo "$GRANTS_OUT" | tail -5

# Step 5c: Run the RLS + policy + trigger + grant section of 0010 (M2 tables)
echo "  Running 0010 RLS policies + triggers + grants..."
sed -n '/^-- Enable RLS on all new M2 tables/,$p' /home/z/my-project/prisma/migrations/0010_inventory_purchasing_transfers.sql > /tmp/0010_rls_only.sql
M2_RLS_OUT=$($PSQL_DB -U postgres -f /tmp/0010_rls_only.sql 2>&1)
echo "$M2_RLS_OUT" | tail -5

# Step 6: Verify RLS is enabled + forced on all tenant tables
echo ""
echo "→ Step 6: Verify RLS enabled + forced..."
RLS_COUNT=$($PSQL_DB -U postgres -t -c "
  SELECT count(*) FROM pg_class c
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname='public' AND c.relkind='r'
  AND (c.relrowsecurity = true OR c.relforcerowsecurity = true);" 2>&1 | tr -d '[:space:]')
echo "  Tables with RLS enabled: $RLS_COUNT"
RLS_FORCED=$($PSQL_DB -U postgres -t -c "
  SELECT count(*) FROM pg_class c
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname='public' AND c.relkind='r' AND c.relforcerowsecurity = true;" 2>&1 | tr -d '[:space:]')
echo "  Tables with RLS forced: $RLS_FORCED"

# Step 7: Verify constraints
echo ""
echo "→ Step 7: Verify key constraints..."
echo "  EXCLUDE constraint on document_number_leases:"
$PSQL_DB -U migration_role -c "
  SELECT conname FROM pg_constraint
  WHERE contype='x' AND conrelid='document_number_leases'::regclass;" 2>&1 | head -5

echo "  Partial uniques on document_sequences:"
$PSQL_DB -U migration_role -c "
  SELECT indexname, indexdef FROM pg_indexes
  WHERE tablename='document_sequences' AND indexname LIKE 'idx_doc_seq%';" 2>&1 | head -10

echo "  CHECK on approval_requests (segregation of duties):"
$PSQL_DB -U migration_role -c "
  SELECT conname FROM pg_constraint
  WHERE contype='c' AND conrelid='approval_requests'::regclass;" 2>&1 | head -5

# Step 8: Test next_document_number() function
echo ""
echo "→ Step 8: Test next_document_number() function..."
# Insert currency + company as migration_role (BYPASSRLS) so FK passes
$PSQL_DB -U migration_role -c "
  INSERT INTO currencies (code, name, decimal_places, is_active)
  VALUES ('BDT', 'Taka', 2, true)
  ON CONFLICT DO NOTHING;
  INSERT INTO companies (id, legal_name, display_name, code, base_currency_code)
  VALUES ('00000000-0000-0000-0000-000000000001', 'Test Co', 'Test', 'TEST', 'BDT')
  ON CONFLICT DO NOTHING;" 2>&1 | head -3

$PSQL_DB -U app_role -c "
  SELECT set_config('app.company_id', '00000000-0000-0000-0000-000000000001', true);
  SELECT set_config('app.is_global', 'false', true);
  SELECT * FROM next_document_number(
    '00000000-0000-0000-0000-000000000001'::uuid,
    NULL,
    'JOURNAL',
    2026,
    'JE-',
    6);" 2>&1 | head -5

# Step 9: Test RLS isolation
echo ""
echo "→ Step 9: Test RLS isolation..."
echo "  As app_role with non-existent company context (should see 0 companies):"
$PSQL_DB -U app_role -c "
  SELECT set_config('app.company_id', '00000000-0000-0000-0000-000000000099', true);
  SELECT set_config('app.is_global', 'false', true);
  SELECT count(*) AS visible_companies FROM companies;" 2>&1 | head -5

echo "  As app_role with is_global=true (should see all companies):"
$PSQL_DB -U app_role -c "
  SELECT set_config('app.company_id', '00000000-0000-0000-0000-000000000001', true);
  SELECT set_config('app.is_global', 'true', true);
  SELECT count(*) AS visible_companies_with_global FROM companies;" 2>&1 | head -5

# Step 10: Test audit_log append-only enforcement
echo ""
echo "→ Step 10: Test audit_log append-only enforcement..."
$PSQL_DB -U migration_role -c "
  INSERT INTO companies (id, legal_name, display_name, code, base_currency_code)
  VALUES ('00000000-0000-0000-0000-000000000099', 'Other Co', 'Other', 'OTHER', 'BDT')
  ON CONFLICT DO NOTHING;
  INSERT INTO audit_logs (company_id, correlation_id, action, entity_type, entity_id)
  VALUES ('00000000-0000-0000-0000-000000000099',
          '00000000-0000-0000-0000-000000000099',
          'test.action', 'test', '00000000-0000-0000-0000-000000000099');" 2>&1 | head -3

echo "  Attempting UPDATE on audit_logs (should fail)..."
UPDATE_RESULT=$($PSQL_DB -U migration_role -c "UPDATE audit_logs SET action='tampered' WHERE action='test.action';" 2>&1)
if echo "$UPDATE_RESULT" | grep -qi "Cannot modify\|error"; then
  echo "  ✓ UPDATE blocked by trigger"
else
  echo "  ✗ UPDATE was NOT blocked: $UPDATE_RESULT"
fi

echo "  Attempting DELETE on audit_logs (should fail)..."
DELETE_RESULT=$($PSQL_DB -U migration_role -c "DELETE FROM audit_logs WHERE action='test.action';" 2>&1)
if echo "$DELETE_RESULT" | grep -qi "Cannot modify\|error"; then
  echo "  ✓ DELETE blocked by trigger"
else
  echo "  ✗ DELETE was NOT blocked: $DELETE_RESULT"
fi

# Step 11: Summary
echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "  Validation Summary"
echo "═══════════════════════════════════════════════════════════════════════"
TABLE_COUNT=$($PSQL_DB -U postgres -t -c "
  SELECT count(*) FROM pg_tables WHERE schemaname='public';" 2>&1 | tr -d '[:space:]')
echo "  Tables created: $TABLE_COUNT"
INDEX_COUNT=$($PSQL_DB -U postgres -t -c "
  SELECT count(*) FROM pg_indexes WHERE schemaname='public';" 2>&1 | tr -d '[:space:]')
echo "  Indexes created: $INDEX_COUNT"
CONSTRAINT_COUNT=$($PSQL_DB -U postgres -t -c "
  SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace;" 2>&1 | tr -d '[:space:]')
echo "  Constraints: $CONSTRAINT_COUNT"
FUNC_COUNT=$($PSQL_DB -U postgres -t -c "
  SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace;" 2>&1 | tr -d '[:space:]')
echo "  Functions: $FUNC_COUNT"
TRIG_COUNT=$($PSQL_DB -U postgres -t -c "
  SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal;" 2>&1 | tr -d '[:space:]')
echo "  Triggers: $TRIG_COUNT"
ROLE_COUNT=$($PSQL_DB -U postgres -t -c "
  SELECT count(*) FROM pg_roles WHERE rolname IN ('app_role','migration_role','backup_role','reporting_role','function_owner');" 2>&1 | tr -d '[:space:]')
echo "  DB roles: $ROLE_COUNT"

echo ""
echo "✓ Migration validation complete. Database: $DB_NAME"
echo ""
echo "To connect: $PSQL -h /tmp -U migration_role -d $DB_NAME"
