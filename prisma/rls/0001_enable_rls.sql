-- prisma/rls/0001_enable_rls.sql
-- Enable Row-Level Security on every tenant-scoped table.
--  FORCE RLS ensures even the table owner is subject to policies.
--
--  After ENABLE + FORCE, the app_role (which BYPASSRLS=false) will see only
--  rows where the policy evaluates true. The policy reads
--  current_setting('app.company_id', true) which the application sets via
--  SELECT set_config('app.company_id', $1, true) at the start of every
--  transaction.
-- 
--  Platform-level tables (currencies, permissions, configuration_definitions,
--  supported_languages) are NOT RLS-enabled — they are global reference data.

BEGIN;

-- M0 tables
ALTER TABLE companies             ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches              ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_domains       ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_branch_access    ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashier_device_pins   ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_sequences    ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_number_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory_documents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_return_periods    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_epochs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;

-- M1 tables
ALTER TABLE categories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands                ENABLE ROW LEVEL SECURITY;
ALTER TABLE units                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_groups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_media_links    ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_barcodes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_unit_options  ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_combo_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_policies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_prices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_codes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_components        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_code_components   ENABLE ROW LEVEL SECURITY;
ALTER TABLE withholding_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuration_values  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_languages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags         ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_targets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_report_filters  ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_export_jobs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_templates ENABLE ROW LEVEL SECURITY;

-- FORCE RLS — even table owners are subject to policies.
-- This prevents a misconfigured migration from accidentally bypassing RLS.
ALTER TABLE companies             FORCE ROW LEVEL SECURITY;
ALTER TABLE branches              FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouses            FORCE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates        FORCE ROW LEVEL SECURITY;
ALTER TABLE company_domains       FORCE ROW LEVEL SECURITY;
ALTER TABLE users                 FORCE ROW LEVEL SECURITY;
ALTER TABLE roles                 FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE user_roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE user_branch_access    FORCE ROW LEVEL SECURITY;
ALTER TABLE devices               FORCE ROW LEVEL SECURITY;
ALTER TABLE cashier_device_pins   FORCE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens        FORCE ROW LEVEL SECURITY;
ALTER TABLE security_events       FORCE ROW LEVEL SECURITY;
ALTER TABLE document_sequences    FORCE ROW LEVEL SECURITY;
ALTER TABLE document_number_leases FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_requests  FORCE ROW LEVEL SECURITY;
ALTER TABLE business_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs            FORCE ROW LEVEL SECURITY;
ALTER TABLE approval_requests     FORCE ROW LEVEL SECURITY;
ALTER TABLE statutory_documents   FORCE ROW LEVEL SECURITY;
ALTER TABLE tax_return_periods    FORCE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_runs   FORCE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_findings FORCE ROW LEVEL SECURITY;
ALTER TABLE recovery_epochs       FORCE ROW LEVEL SECURITY;
ALTER TABLE integration_credentials FORCE ROW LEVEL SECURITY;

ALTER TABLE categories            FORCE ROW LEVEL SECURITY;
ALTER TABLE brands                FORCE ROW LEVEL SECURITY;
ALTER TABLE units                 FORCE ROW LEVEL SECURITY;
ALTER TABLE customer_groups      FORCE ROW LEVEL SECURITY;
ALTER TABLE products              FORCE ROW LEVEL SECURITY;
ALTER TABLE media_assets          FORCE ROW LEVEL SECURITY;
ALTER TABLE entity_media_links    FORCE ROW LEVEL SECURITY;
ALTER TABLE product_barcodes      FORCE ROW LEVEL SECURITY;
ALTER TABLE product_unit_options  FORCE ROW LEVEL SECURITY;
ALTER TABLE product_combo_items   FORCE ROW LEVEL SECURITY;
ALTER TABLE discount_policies     FORCE ROW LEVEL SECURITY;
ALTER TABLE product_prices        FORCE ROW LEVEL SECURITY;
ALTER TABLE tax_codes             FORCE ROW LEVEL SECURITY;
ALTER TABLE tax_components        FORCE ROW LEVEL SECURITY;
ALTER TABLE tax_code_components   FORCE ROW LEVEL SECURITY;
ALTER TABLE withholding_rules     FORCE ROW LEVEL SECURITY;
ALTER TABLE configuration_values  FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_profiles          FORCE ROW LEVEL SECURITY;
ALTER TABLE document_templates    FORCE ROW LEVEL SECURITY;
ALTER TABLE company_languages     FORCE ROW LEVEL SECURITY;
ALTER TABLE translation_overrides FORCE ROW LEVEL SECURITY;
ALTER TABLE feature_flags         FORCE ROW LEVEL SECURITY;
ALTER TABLE dashboard_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE sales_targets         FORCE ROW LEVEL SECURITY;
ALTER TABLE saved_report_filters  FORCE ROW LEVEL SECURITY;
ALTER TABLE report_export_jobs    FORCE ROW LEVEL SECURITY;
ALTER TABLE support_tickets       FORCE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE communication_templates FORCE ROW LEVEL SECURITY;

COMMIT;
