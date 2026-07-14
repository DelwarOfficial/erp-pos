-- prisma/migrations/0009_grants.sql
-- Grant privileges to app_role / backup_role / reporting_role.
-- app_role: full DML on all tenant tables (subject to RLS).
-- backup_role: SELECT on all tables for pg_dump.
-- reporting_role: SELECT on all tables (subject to RLS).

BEGIN;

-- Helper: grant DML on a table to app_role, SELECT to backup/reporting
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      -- Global (no RLS)
      'currencies','permissions','configuration_definitions','supported_languages',
      -- M0 tenant tables
      'companies','branches','warehouses','exchange_rates','company_domains',
      'users','roles','role_permissions','user_roles','user_branch_access',
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
      'tax_codes','tax_components','tax_code_components','withholding_rules',
      'configuration_values','pos_profiles','document_templates',
      'company_languages','translation_overrides','feature_flags',
      'dashboard_preferences','sales_targets','saved_report_filters',
      'report_export_jobs','support_tickets','support_ticket_messages',
      'communication_templates'
    ])
  LOOP
    -- app_role: full DML (subject to RLS policies)
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_role;', tbl);

    -- EXCEPT audit_logs: append-only — app_role gets SELECT + INSERT only
    IF tbl = 'audit_logs' THEN
      EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM app_role;', tbl);
      EXECUTE format('GRANT SELECT, INSERT ON %I TO app_role;', tbl);
    END IF;

    -- backup_role: SELECT only (for pg_dump)
    EXECUTE format('GRANT SELECT ON %I TO backup_role;', tbl);

    -- reporting_role: SELECT only (subject to RLS)
    EXECUTE format('GRANT SELECT ON %I TO reporting_role;', tbl);
  END LOOP;
END $$;

-- Grant USAGE on sequences (for gen_random_uuid-backed SERIAL-like columns
-- where applicable — most UUIDs use gen_random_uuid() in DEFAULT, no sequence needed).
-- If any sequences exist, grant USAGE, SELECT to app_role.

-- Grant EXECUTE on SECURITY DEFINER functions to app_role
GRANT EXECUTE ON FUNCTION next_document_number(UUID, UUID, VARCHAR, SMALLINT, VARCHAR, SMALLINT) TO app_role;
GRANT EXECUTE ON FUNCTION post_journal_entry(UUID, UUID, DATE, VARCHAR, JSONB, VARCHAR, UUID, UUID) TO app_role;
GRANT EXECUTE ON FUNCTION partition_management(VARCHAR, INTEGER) TO app_role;

-- Grant EXECUTE on the helper functions
GRANT EXECUTE ON FUNCTION app_company_id() TO app_role;
GRANT EXECUTE ON FUNCTION app_company_id() TO reporting_role;
GRANT EXECUTE ON FUNCTION app_is_global() TO app_role;
GRANT EXECUTE ON FUNCTION app_is_global() TO reporting_role;

-- Schema privileges
GRANT USAGE ON SCHEMA public TO app_role;
GRANT USAGE ON SCHEMA public TO backup_role;
GRANT USAGE ON SCHEMA public TO reporting_role;

COMMIT;
