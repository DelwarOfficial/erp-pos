-- prisma/rls/0002_tenant_policies.sql
-- RLS policies for every tenant-scoped table.
-- 
--  Pattern: each table gets two policies:
--    1. "tenant_read"  — SELECT where company_id = current_setting('app.company_id')::uuid
--    2. "tenant_write" — INSERT/UPDATE/DELETE with same check
-- 
--  The application sets 'app.company_id' via:
--    SELECT set_config('app.company_id', $1, true)  -- true = local to transaction
-- 
--  Platform operations (is_global=true) bypasses the tenant filter via a
--  separate policy when 'app.is_global' = 'true'.

BEGIN;

-- Helper function: read the current tenant from session
CREATE OR REPLACE FUNCTION app_company_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app_is_global() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(NULLIF(current_setting('app.is_global', true), '')::boolean, false);
$$;

-- ============================================================================
-- M0 tables
-- ============================================================================

-- companies: special — platform_operations (is_global=true) can read all; otherwise only own
CREATE POLICY companies_tenant_read ON companies
  FOR SELECT TO app_role
  USING (app_is_global() OR id = app_company_id());

CREATE POLICY companies_tenant_write ON companies
  FOR ALL TO app_role
  USING (app_is_global() OR id = app_company_id())
  WITH CHECK (app_is_global() OR id = app_company_id());

-- For all other tables, use the standard pattern
-- NOTE: junction tables (role_permissions, user_roles, user_branch_access, tax_code_components)
-- don't have company_id — they're handled separately below via parent-table EXISTS checks.
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'branches','warehouses','exchange_rates','company_domains',
      'users','roles',
      'devices','cashier_device_pins','refresh_tokens','security_events',
      'document_sequences','document_number_leases','idempotency_requests',
      'business_events','document_exchange_rates',
      'audit_logs','approval_requests','statutory_documents','tax_return_periods',
      'reconciliation_runs','reconciliation_findings','recovery_epochs',
      'integration_credentials',
      -- M1
      'categories','brands','units','customer_groups','products','media_assets',
      'entity_media_links','product_barcodes','product_unit_options',
      'product_combo_items','discount_policies','product_prices',
      'tax_codes','tax_components','withholding_rules',
      'configuration_values','pos_profiles','document_templates',
      'company_languages','translation_overrides','feature_flags',
      'dashboard_preferences','sales_targets','saved_report_filters',
      'report_export_jobs','support_tickets','support_ticket_messages',
      'communication_templates'
    ])
  LOOP
    -- Read policy: app_role can read rows in own company OR if is_global
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());',
      tbl || '_tenant_read', tbl
    );

    -- Write policy: app_role can write rows in own company only (no global writes
    -- except for companies table handled above)
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO app_role USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());',
      tbl || '_tenant_write', tbl
    );
  END LOOP;
END $$;

-- ============================================================================
-- Junction tables (no company_id column) — RLS via parent-table EXISTS check
-- ============================================================================

-- role_permissions: parent is roles (which has company_id)
CREATE POLICY role_permissions_tenant_read ON role_permissions
  FOR SELECT TO app_role
  USING (
    app_is_global() OR
    EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND r.company_id = app_company_id())
  );
CREATE POLICY role_permissions_tenant_write ON role_permissions
  FOR ALL TO app_role
  USING (
    EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND r.company_id = app_company_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND r.company_id = app_company_id())
  );

-- user_roles: parent is users (which has company_id)
CREATE POLICY user_roles_tenant_read ON user_roles
  FOR SELECT TO app_role
  USING (
    app_is_global() OR
    EXISTS (SELECT 1 FROM users u WHERE u.id = user_roles.user_id AND u.company_id = app_company_id())
  );
CREATE POLICY user_roles_tenant_write ON user_roles
  FOR ALL TO app_role
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = user_roles.user_id AND u.company_id = app_company_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users u WHERE u.id = user_roles.user_id AND u.company_id = app_company_id())
  );

-- user_branch_access: parent is users
CREATE POLICY user_branch_access_tenant_read ON user_branch_access
  FOR SELECT TO app_role
  USING (
    app_is_global() OR
    EXISTS (SELECT 1 FROM users u WHERE u.id = user_branch_access.user_id AND u.company_id = app_company_id())
  );
CREATE POLICY user_branch_access_tenant_write ON user_branch_access
  FOR ALL TO app_role
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = user_branch_access.user_id AND u.company_id = app_company_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users u WHERE u.id = user_branch_access.user_id AND u.company_id = app_company_id())
  );

-- tax_code_components: parent is tax_codes
CREATE POLICY tax_code_components_tenant_read ON tax_code_components
  FOR SELECT TO app_role
  USING (
    app_is_global() OR
    EXISTS (SELECT 1 FROM tax_codes tc WHERE tc.id = tax_code_components.tax_code_id AND tc.company_id = app_company_id())
  );
CREATE POLICY tax_code_components_tenant_write ON tax_code_components
  FOR ALL TO app_role
  USING (
    EXISTS (SELECT 1 FROM tax_codes tc WHERE tc.id = tax_code_components.tax_code_id AND tc.company_id = app_company_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM tax_codes tc WHERE tc.id = tax_code_components.tax_code_id AND tc.company_id = app_company_id())
  );

COMMIT;
