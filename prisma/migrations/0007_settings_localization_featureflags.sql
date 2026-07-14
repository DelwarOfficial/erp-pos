-- prisma/migrations/0007_settings_localization_featureflags.sql
-- §5.14A Configuration, Feature Flags, Templates, Translations, POS Profiles,
--  Notifications, Support, Reports

BEGIN;

-- ============================================================================
-- configuration_definitions (global, NOT tenant-scoped)
-- ============================================================================
CREATE TABLE configuration_definitions (
  key            VARCHAR(120) PRIMARY KEY,
  module         VARCHAR(50)  NOT NULL,
  value_type     VARCHAR(20)  NOT NULL CHECK (value_type IN ('string','integer','decimal','boolean','json')),
  json_schema    JSONB,
  allowed_scopes TEXT[]       NOT NULL,
  is_secret      BOOLEAN      NOT NULL DEFAULT false,
  default_value  JSONB,
  description    TEXT         NOT NULL
);
CREATE INDEX idx_config_defs_module ON configuration_definitions(module);

-- ============================================================================
-- configuration_values
-- ============================================================================
CREATE TABLE configuration_values (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  definition_key VARCHAR(120) NOT NULL REFERENCES configuration_definitions(key),
  scope_type     VARCHAR(20)  NOT NULL DEFAULT 'company'
                 CHECK (scope_type IN ('company','branch','warehouse','pos_profile','user')),
  scope_id       UUID         NOT NULL,
  value          JSONB        NOT NULL,
  version        INTEGER      NOT NULL DEFAULT 1,
  updated_by     UUID         NOT NULL REFERENCES users(id),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(company_id, definition_key, scope_type, scope_id)
);
CREATE INDEX idx_config_values_company    ON configuration_values(company_id);
CREATE INDEX idx_config_values_definition ON configuration_values(definition_key);
CREATE INDEX idx_config_values_scope      ON configuration_values(scope_type, scope_id);
CREATE INDEX idx_config_values_value_gin  ON configuration_values USING GIN (value);

-- ============================================================================
-- document_templates (MUST come before pos_profiles which references it)
-- ============================================================================
CREATE TABLE document_templates (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  template_type  VARCHAR(30)  NOT NULL
                 CHECK (template_type IN ('receipt80','a4_invoice','quotation','warranty_card','service_receipt','barcode_sheet','statutory')),
  name           VARCHAR(150) NOT NULL,
  locale         VARCHAR(20)  NOT NULL,
  version        INTEGER      NOT NULL DEFAULT 1,
  template_schema JSONB       NOT NULL,
  is_active      BOOLEAN      NOT NULL DEFAULT true,
  approved_by    UUID         REFERENCES users(id),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(company_id, template_type, name, locale, version)
);
CREATE INDEX idx_doc_templates_company ON document_templates(company_id);
CREATE INDEX idx_doc_templates_type    ON document_templates(template_type);
CREATE INDEX idx_doc_templates_locale  ON document_templates(locale);
CREATE INDEX idx_doc_templates_active  ON document_templates(is_active);
CREATE INDEX idx_doc_templates_schema  ON document_templates USING GIN (template_schema);

-- ============================================================================
-- pos_profiles (references document_templates above)
-- ============================================================================
CREATE TABLE pos_profiles (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id              UUID         NOT NULL REFERENCES branches(id),
  name                   VARCHAR(120) NOT NULL,
  default_warehouse_id   UUID         NOT NULL REFERENCES warehouses(id),
  default_customer_id    UUID,  -- FK to customers added in M2
  receipt_template_id    UUID         REFERENCES document_templates(id),
  invoice_template_id    UUID         REFERENCES document_templates(id),
  hold_reservation_minutes SMALLINT   NOT NULL DEFAULT 15 CHECK (hold_reservation_minutes BETWEEN 0 AND 120),
  allow_due_sale         BOOLEAN      NOT NULL DEFAULT false,
  require_customer_for_due BOOLEAN    NOT NULL DEFAULT true,
  printer_mode           VARCHAR(20)  NOT NULL DEFAULT 'browser'
                         CHECK (printer_mode IN ('browser','escpos_bridge','system')),
  is_active              BOOLEAN      NOT NULL DEFAULT true,
  UNIQUE(company_id, branch_id, name)
);
CREATE INDEX idx_pos_profiles_company ON pos_profiles(company_id);
CREATE INDEX idx_pos_profiles_branch  ON pos_profiles(branch_id);
CREATE INDEX idx_pos_profiles_active  ON pos_profiles(is_active);

-- ============================================================================
-- supported_languages (global)
-- ============================================================================
CREATE TABLE supported_languages (
  locale        VARCHAR(20) PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  native_name   VARCHAR(100) NOT NULL,
  text_direction VARCHAR(3)  NOT NULL DEFAULT 'ltr' CHECK (text_direction IN ('ltr','rtl')),
  is_active     BOOLEAN      NOT NULL DEFAULT true
);

-- ============================================================================
-- company_languages
-- ============================================================================
CREATE TABLE company_languages (
  company_id UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  locale     VARCHAR(20) NOT NULL REFERENCES supported_languages(locale),
  is_default BOOLEAN     NOT NULL DEFAULT false,
  is_enabled BOOLEAN     NOT NULL DEFAULT true,
  PRIMARY KEY (company_id, locale)
);
CREATE INDEX idx_company_languages_locale ON company_languages(locale);

-- ============================================================================
-- translation_overrides
-- ============================================================================
CREATE TABLE translation_overrides (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  locale          VARCHAR(20)  NOT NULL REFERENCES supported_languages(locale),
  translation_key VARCHAR(200) NOT NULL,
  translated_value TEXT        NOT NULL,
  updated_by      UUID         NOT NULL REFERENCES users(id),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(company_id, locale, translation_key)
);
CREATE INDEX idx_translation_overrides_company ON translation_overrides(company_id);
CREATE INDEX idx_translation_overrides_locale  ON translation_overrides(locale);
CREATE INDEX idx_translation_overrides_key     ON translation_overrides(translation_key);

-- ============================================================================
-- feature_flags
-- ============================================================================
CREATE TABLE feature_flags (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  flag_key      VARCHAR(100) NOT NULL,
  enabled       BOOLEAN      NOT NULL DEFAULT false,
  rollout_rules JSONB        NOT NULL DEFAULT '{}'::jsonb,
  updated_by    UUID         NOT NULL REFERENCES users(id),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(company_id, flag_key)
);
CREATE INDEX idx_feature_flags_company ON feature_flags(company_id);
CREATE INDEX idx_feature_flags_enabled ON feature_flags(enabled);

-- ============================================================================
-- dashboard_preferences
-- ============================================================================
CREATE TABLE dashboard_preferences (
  user_id            UUID         PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_id         UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  widget_layout      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  default_date_range VARCHAR(30)  NOT NULL DEFAULT 'today',
  default_branch_ids UUID[]       NOT NULL DEFAULT '{}',
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_dashboard_prefs_company ON dashboard_preferences(company_id);

-- ============================================================================
-- sales_targets
-- Two partial uniques handle nullable user_id (branch-level vs salesperson)
-- ============================================================================
CREATE TABLE sales_targets (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id       UUID         NOT NULL REFERENCES branches(id),
  user_id         UUID         REFERENCES users(id),
  period_start    DATE         NOT NULL,
  period_end      DATE         NOT NULL CHECK (period_end >= period_start),
  target_amount   DECIMAL(18,2) NOT NULL DEFAULT 0 CHECK (target_amount >= 0),
  target_quantity DECIMAL(18,4) CHECK (target_quantity IS NULL OR target_quantity >= 0),
  created_by      UUID         NOT NULL REFERENCES users(id)
);
CREATE INDEX idx_sales_targets_company ON sales_targets(company_id);
CREATE INDEX idx_sales_targets_branch  ON sales_targets(branch_id);
CREATE INDEX idx_sales_targets_user    ON sales_targets(user_id);
CREATE INDEX idx_sales_targets_from    ON sales_targets(period_start);
CREATE INDEX idx_sales_targets_to      ON sales_targets(period_end);

CREATE UNIQUE INDEX idx_sales_targets_branch_level
  ON sales_targets(company_id, branch_id, period_start, period_end)
  WHERE user_id IS NULL;
CREATE UNIQUE INDEX idx_sales_targets_salesperson
  ON sales_targets(company_id, branch_id, user_id, period_start, period_end)
  WHERE user_id IS NOT NULL;

-- ============================================================================
-- saved_report_filters
-- ============================================================================
CREATE TABLE saved_report_filters (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  user_id     UUID         NOT NULL REFERENCES users(id),
  report_code VARCHAR(80)  NOT NULL,
  name        VARCHAR(150) NOT NULL,
  filter_json JSONB        NOT NULL,
  is_shared   BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(user_id, report_code, name)
);
CREATE INDEX idx_saved_report_filters_company ON saved_report_filters(company_id);
CREATE INDEX idx_saved_report_filters_user    ON saved_report_filters(user_id);
CREATE INDEX idx_saved_report_filters_report  ON saved_report_filters(report_code);

-- ============================================================================
-- report_export_jobs
-- ============================================================================
CREATE TABLE report_export_jobs (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  requested_by   UUID         NOT NULL REFERENCES users(id),
  report_code    VARCHAR(80)  NOT NULL,
  format         VARCHAR(10)  NOT NULL DEFAULT 'pdf' CHECK (format IN ('pdf','csv','xlsx')),
  filter_json    JSONB        NOT NULL,
  data_cutoff_at TIMESTAMPTZ  NOT NULL,
  status         VARCHAR(20)  NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','completed','failed','expired')),
  output_media_id UUID        REFERENCES media_assets(id),
  error_summary  TEXT,
  expires_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_report_export_company ON report_export_jobs(company_id);
CREATE INDEX idx_report_export_user    ON report_export_jobs(requested_by);
CREATE INDEX idx_report_export_report  ON report_export_jobs(report_code);
CREATE INDEX idx_report_export_status  ON report_export_jobs(status);
CREATE INDEX idx_report_export_expires ON report_export_jobs(expires_at);

-- ============================================================================
-- support_tickets
-- ============================================================================
CREATE TABLE support_tickets (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  reference_no VARCHAR(60) NOT NULL,
  subject     VARCHAR(250) NOT NULL,
  priority    VARCHAR(20)  NOT NULL DEFAULT 'normal'
              CHECK (priority IN ('low','normal','high','urgent')),
  status      VARCHAR(20)  NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','in_progress','waiting','resolved','closed')),
  opened_by   UUID         NOT NULL REFERENCES users(id),
  assigned_to UUID         REFERENCES users(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  closed_at   TIMESTAMPTZ,
  UNIQUE(company_id, reference_no)
);
CREATE INDEX idx_support_tickets_company ON support_tickets(company_id);
CREATE INDEX idx_support_tickets_prio    ON support_tickets(priority);
CREATE INDEX idx_support_tickets_status  ON support_tickets(status);
CREATE INDEX idx_support_tickets_opener  ON support_tickets(opened_by);
CREATE INDEX idx_support_tickets_assign  ON support_tickets(assigned_to);
CREATE INDEX idx_support_tickets_created ON support_tickets(created_at);

-- ============================================================================
-- support_ticket_messages
-- ============================================================================
CREATE TABLE support_ticket_messages (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  support_ticket_id UUID        NOT NULL REFERENCES support_tickets(id),
  author_user_id   UUID         NOT NULL REFERENCES users(id),
  body             TEXT         NOT NULL,
  is_internal      BOOLEAN      NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_support_msgs_company ON support_ticket_messages(company_id);
CREATE INDEX idx_support_msgs_ticket  ON support_ticket_messages(support_ticket_id);
CREATE INDEX idx_support_msgs_author  ON support_ticket_messages(author_user_id);
CREATE INDEX idx_support_msgs_created ON support_ticket_messages(created_at);

-- ============================================================================
-- communication_templates
-- ============================================================================
CREATE TABLE communication_templates (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code             VARCHAR(60)  NOT NULL,
  channel          VARCHAR(20)  NOT NULL DEFAULT 'sms'
                   CHECK (channel IN ('sms','email','push','in_app')),
  purpose          VARCHAR(30)  NOT NULL DEFAULT 'transactional'
                   CHECK (purpose IN ('transactional','marketing','internal')),
  locale           VARCHAR(20)  NOT NULL REFERENCES supported_languages(locale),
  subject_template VARCHAR(300),
  body_template    TEXT         NOT NULL,
  allowed_tokens   TEXT[]       NOT NULL DEFAULT '{}',
  version          INTEGER      NOT NULL DEFAULT 1,
  is_active        BOOLEAN      NOT NULL DEFAULT true,
  approved_by      UUID         REFERENCES users(id),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(company_id, code)
);
CREATE INDEX idx_comm_templates_company ON communication_templates(company_id);
CREATE INDEX idx_comm_templates_channel ON communication_templates(channel);
CREATE INDEX idx_comm_templates_purpose ON communication_templates(purpose);
CREATE INDEX idx_comm_templates_locale  ON communication_templates(locale);
CREATE INDEX idx_comm_templates_active  ON communication_templates(is_active);

COMMIT;
