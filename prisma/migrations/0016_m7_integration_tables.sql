-- prisma/migrations/0016_m7_integration_tables.sql
-- §5.16 Outbox / Webhooks / Import Jobs / Offline Sync / Outbound Messages
-- §5.16 Print Jobs + User Notifications + Legal Holds
-- WebAuthn (M0 Step 3 — DDL was missing; created here)
--
-- Adds M7 integration tables plus D09 (legal hold) and D12 (user notifications)
-- additions referenced in the audit gap worklog.

BEGIN;


-- ============================================================================
-- TABLES (13 tables)
-- ============================================================================

-- ============================================================================
-- outbox_events
-- ============================================================================
CREATE TABLE IF NOT EXISTS outbox_events (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  business_event_id UUID NOT NULL,
  event_name VARCHAR NOT NULL,
  aggregate_type VARCHAR NOT NULL,
  aggregate_id UUID NOT NULL,
  payload VARCHAR DEFAULT '{}' NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  attempt_count INTEGER DEFAULT 0 NOT NULL,
  max_attempts INTEGER DEFAULT 10 NOT NULL,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  status VARCHAR DEFAULT 'pending' NOT NULL CHECK (status IN ('pending','published','dead_letter','skipped')),
  dead_lettered_at TIMESTAMPTZ,
  dead_letter_reason VARCHAR,
  last_error VARCHAR,
  CONSTRAINT fk_outbox_events_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_outbox_events_business_event_id FOREIGN KEY (business_event_id) REFERENCES business_events(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_company_id ON outbox_events(company_id);
CREATE INDEX IF NOT EXISTS idx_outbox_events_status ON outbox_events(status);
CREATE INDEX IF NOT EXISTS idx_outbox_events_next_attempt_at ON outbox_events(next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outbox_events_published_at ON outbox_events(published_at);

-- ============================================================================
-- webhook_endpoints
-- ============================================================================
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  url VARCHAR NOT NULL,
  secret_ciphertext BYTEA NOT NULL,
  subscribed_events VARCHAR DEFAULT '[]' NOT NULL,
  status VARCHAR DEFAULT 'active' NOT NULL CHECK (status IN ('active','disabled')),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_webhook_endpoints_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT uq_webhook_endpoints_company_id_url UNIQUE (company_id, url)
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_company_id ON webhook_endpoints(company_id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_status ON webhook_endpoints(status);

-- CHECK: webhook URL must be HTTPS (§5.16)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_endpoints_url_https_chk' AND conrelid = 'webhook_endpoints'::regclass) THEN
    ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_endpoints_url_https_chk CHECK (url ~ '^https://');
  END IF;
END $$;

-- ============================================================================
-- webhook_deliveries
-- ============================================================================
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  webhook_endpoint_id UUID NOT NULL,
  outbox_event_id UUID NOT NULL,
  delivery_id UUID NOT NULL,
  signature VARCHAR NOT NULL,
  timestamp_header VARCHAR NOT NULL,
  status VARCHAR DEFAULT 'pending' NOT NULL CHECK (status IN ('pending','delivered','failed','dead_letter')),
  attempt_count INTEGER DEFAULT 0 NOT NULL,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  last_attempted_at TIMESTAMPTZ,
  response_status INTEGER,
  response_body_excerpt VARCHAR,
  last_error VARCHAR,
  CONSTRAINT fk_webhook_deliveries_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_webhook_deliveries_webhook_endpoint_id FOREIGN KEY (webhook_endpoint_id) REFERENCES webhook_endpoints(id) ON DELETE RESTRICT,
  CONSTRAINT fk_webhook_deliveries_outbox_event_id FOREIGN KEY (outbox_event_id) REFERENCES outbox_events(id) ON DELETE RESTRICT,
  CONSTRAINT uq_webhook_deliveries_webhook_endpoint_id_outbox_event_id UNIQUE (webhook_endpoint_id, outbox_event_id),
  CONSTRAINT uq_webhook_deliveries_delivery_id UNIQUE (delivery_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_company_id ON webhook_deliveries(company_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_next_attempt_at ON webhook_deliveries(next_attempt_at);

-- ============================================================================
-- import_jobs
-- ============================================================================
CREATE TABLE IF NOT EXISTS import_jobs (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  job_type VARCHAR NOT NULL CHECK (job_type IN ('product','customer','supplier','sale_draft','transfer_draft','purchase','opening_stock')),
  file_name VARCHAR NOT NULL,
  object_key VARCHAR,
  file_sha256 VARCHAR,
  status VARCHAR DEFAULT 'uploaded' NOT NULL CHECK (status IN ('uploaded','validating','invalid','ready','importing','completed','partial','failed','cancelled')),
  total_rows INTEGER DEFAULT 0 NOT NULL,
  valid_rows INTEGER DEFAULT 0 NOT NULL,
  invalid_rows INTEGER DEFAULT 0 NOT NULL,
  committed_rows INTEGER,
  result_object_key VARCHAR,
  dry_run BOOLEAN DEFAULT true NOT NULL,
  duplicate_strategy VARCHAR CHECK (duplicate_strategy IN ('skip','update','fail')),
  control_totals VARCHAR,
  error_summary VARCHAR,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  CONSTRAINT fk_import_jobs_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_company_id ON import_jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
CREATE INDEX IF NOT EXISTS idx_import_jobs_file_sha256 ON import_jobs(file_sha256);

-- ============================================================================
-- import_job_errors
-- ============================================================================
CREATE TABLE IF NOT EXISTS import_job_errors (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  import_job_id UUID NOT NULL,
  row_number INTEGER NOT NULL,
  column_name VARCHAR,
  error_code VARCHAR,
  error_value VARCHAR,
  error_message VARCHAR NOT NULL,
  raw_row VARCHAR,
  CONSTRAINT fk_import_job_errors_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_import_job_errors_import_job_id FOREIGN KEY (import_job_id) REFERENCES import_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_import_job_errors_company_id ON import_job_errors(company_id);
CREATE INDEX IF NOT EXISTS idx_import_job_errors_import_job_id ON import_job_errors(import_job_id);
CREATE INDEX IF NOT EXISTS idx_import_job_errors_row_number ON import_job_errors(row_number);

-- ============================================================================
-- offline_sync_batches
-- ============================================================================
CREATE TABLE IF NOT EXISTS offline_sync_batches (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  device_id UUID NOT NULL,
  batch_number INTEGER NOT NULL,
  command_count INTEGER NOT NULL,
  synced_count INTEGER DEFAULT 0 NOT NULL,
  conflict_count INTEGER DEFAULT 0 NOT NULL,
  status VARCHAR DEFAULT 'processing' NOT NULL CHECK (status IN ('processing','completed','partial')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  CONSTRAINT fk_offline_sync_batches_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_offline_sync_batches_company_id ON offline_sync_batches(company_id);
CREATE INDEX IF NOT EXISTS idx_offline_sync_batches_device_id ON offline_sync_batches(device_id);
CREATE INDEX IF NOT EXISTS idx_offline_sync_batches_status ON offline_sync_batches(status);

-- ============================================================================
-- offline_commands
-- ============================================================================
CREATE TABLE IF NOT EXISTS offline_commands (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  device_id UUID NOT NULL,
  command_type VARCHAR NOT NULL CHECK (command_type IN ('cash_sale','held_sale_draft','shift_open','shift_close','customer_create','receipt_reprint')),
  sequence_number INTEGER NOT NULL,
  payload VARCHAR DEFAULT '{}' NOT NULL,
  payload_hash VARCHAR NOT NULL,
  idempotency_key VARCHAR NOT NULL,
  status VARCHAR DEFAULT 'pending' NOT NULL CHECK (status IN ('pending','synced','conflict','cancelled')),
  conflict_reason VARCHAR,
  synced_at TIMESTAMPTZ,
  sync_batch_id UUID,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_offline_commands_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT uq_offline_commands_device_id_sequence_number UNIQUE (device_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_offline_commands_company_id ON offline_commands(company_id);
CREATE INDEX IF NOT EXISTS idx_offline_commands_device_id ON offline_commands(device_id);
CREATE INDEX IF NOT EXISTS idx_offline_commands_status ON offline_commands(status);
CREATE INDEX IF NOT EXISTS idx_offline_commands_sync_batch_id ON offline_commands(sync_batch_id);

-- ============================================================================
-- outbound_messages
-- ============================================================================
CREATE TABLE IF NOT EXISTS outbound_messages (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  template_id UUID,
  campaign_recipient_id UUID,
  channel VARCHAR DEFAULT 'sms' NOT NULL CHECK (channel IN ('sms','email','push','whatsapp')),
  purpose VARCHAR DEFAULT 'transactional' NOT NULL CHECK (purpose IN ('transactional','marketing','internal')),
  destination_hash VARCHAR NOT NULL,
  destination_encrypted VARCHAR NOT NULL,
  encryption_key_version VARCHAR DEFAULT '1' NOT NULL,
  rendered_subject VARCHAR,
  rendered_body VARCHAR NOT NULL,
  provider_code VARCHAR,
  provider_message_id UUID,
  status VARCHAR DEFAULT 'queued' NOT NULL CHECK (status IN ('queued','sending','sent','delivered','failed','dead_letter')),
  attempt_count INTEGER DEFAULT 0 NOT NULL,
  next_attempt_at TIMESTAMPTZ,
  last_error_code VARCHAR,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_outbound_messages_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_outbound_messages_template_id FOREIGN KEY (template_id) REFERENCES communication_templates(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_outbound_messages_company_id ON outbound_messages(company_id);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_template_id ON outbound_messages(template_id);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_status ON outbound_messages(status);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_provider_message_id ON outbound_messages(provider_message_id);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_created_at ON outbound_messages(created_at);

-- ============================================================================
-- print_jobs
-- ============================================================================
CREATE TABLE IF NOT EXISTS print_jobs (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  print_type VARCHAR NOT NULL CHECK (print_type IN ('receipt80','a4_invoice','quotation','warranty_card','service_receipt','barcode_sheet','statutory')),
  entity_type VARCHAR NOT NULL,
  entity_id UUID NOT NULL,
  locale VARCHAR DEFAULT 'bn-BD' NOT NULL,
  status VARCHAR DEFAULT 'queued' NOT NULL CHECK (status IN ('queued','rendering','printed','failed')),
  printer_mode VARCHAR DEFAULT 'browser' NOT NULL CHECK (printer_mode IN ('browser','escpos_bridge','system')),
  output_media_id UUID,
  error_summary VARCHAR,
  requested_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  CONSTRAINT fk_print_jobs_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_print_jobs_requested_by FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_company_id ON print_jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_entity_type_entity_id ON print_jobs(entity_type, entity_id);

-- ============================================================================
-- user_notifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_notifications (
  PRIMARY KEY (notification_id, user_id),
  notification_id UUID NOT NULL,
  user_id UUID NOT NULL,
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  CONSTRAINT fk_user_notifications_notification_id FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_notifications_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_id ON user_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_user_notifications_read_at ON user_notifications(read_at);

-- ============================================================================
-- legal_holds
-- ============================================================================
CREATE TABLE IF NOT EXISTS legal_holds (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  entity_type VARCHAR NOT NULL,
  entity_id UUID NOT NULL,
  reason VARCHAR NOT NULL,
  declared_by UUID NOT NULL,
  declared_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  CONSTRAINT fk_legal_holds_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_legal_holds_declared_by FOREIGN KEY (declared_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_legal_holds_company_id ON legal_holds(company_id);
CREATE INDEX IF NOT EXISTS idx_legal_holds_entity_type_entity_id ON legal_holds(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_legal_holds_released_at ON legal_holds(released_at);

-- ============================================================================
-- webauthn_credentials
-- ============================================================================
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  user_id UUID NOT NULL,
  credential_id UUID NOT NULL,
  public_key BYTEA NOT NULL,
  counter INTEGER DEFAULT 0 NOT NULL,
  device_type VARCHAR,
  backed_up BOOLEAN DEFAULT false NOT NULL,
  transports VARCHAR DEFAULT '[]' NOT NULL,
  name VARCHAR,
  created_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT fk_webauthn_credentials_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_webauthn_credentials_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_webauthn_credentials_credential_id UNIQUE (credential_id)
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_company_id ON webauthn_credentials(company_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id ON webauthn_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_revoked_at ON webauthn_credentials(revoked_at);

-- ============================================================================
-- webauthn_challenges
-- ============================================================================
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  user_id UUID,
  challenge VARCHAR NOT NULL,
  action VARCHAR NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_webauthn_challenges_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_webauthn_challenges_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_company_id ON webauthn_challenges(company_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_user_id ON webauthn_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires_at ON webauthn_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_consumed_at ON webauthn_challenges(consumed_at);


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- RLS for outbox_events
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'outbox_events_tenant_read' AND tablename = 'outbox_events') THEN
    EXECUTE 'CREATE POLICY outbox_events_tenant_read ON outbox_events FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'outbox_events_tenant_write' AND tablename = 'outbox_events') THEN
    EXECUTE 'CREATE POLICY outbox_events_tenant_write ON outbox_events FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON outbox_events TO app_role;
GRANT SELECT ON outbox_events TO backup_role;
GRANT SELECT ON outbox_events TO reporting_role;

-- RLS for webhook_endpoints
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'webhook_endpoints_tenant_read' AND tablename = 'webhook_endpoints') THEN
    EXECUTE 'CREATE POLICY webhook_endpoints_tenant_read ON webhook_endpoints FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'webhook_endpoints_tenant_write' AND tablename = 'webhook_endpoints') THEN
    EXECUTE 'CREATE POLICY webhook_endpoints_tenant_write ON webhook_endpoints FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_endpoints TO app_role;
GRANT SELECT ON webhook_endpoints TO backup_role;
GRANT SELECT ON webhook_endpoints TO reporting_role;

-- RLS for webhook_deliveries
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'webhook_deliveries_tenant_read' AND tablename = 'webhook_deliveries') THEN
    EXECUTE 'CREATE POLICY webhook_deliveries_tenant_read ON webhook_deliveries FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'webhook_deliveries_tenant_write' AND tablename = 'webhook_deliveries') THEN
    EXECUTE 'CREATE POLICY webhook_deliveries_tenant_write ON webhook_deliveries FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_deliveries TO app_role;
GRANT SELECT ON webhook_deliveries TO backup_role;
GRANT SELECT ON webhook_deliveries TO reporting_role;

-- RLS for import_jobs
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'import_jobs_tenant_read' AND tablename = 'import_jobs') THEN
    EXECUTE 'CREATE POLICY import_jobs_tenant_read ON import_jobs FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'import_jobs_tenant_write' AND tablename = 'import_jobs') THEN
    EXECUTE 'CREATE POLICY import_jobs_tenant_write ON import_jobs FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON import_jobs TO app_role;
GRANT SELECT ON import_jobs TO backup_role;
GRANT SELECT ON import_jobs TO reporting_role;

-- RLS for import_job_errors
ALTER TABLE import_job_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_job_errors FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'import_job_errors_tenant_read' AND tablename = 'import_job_errors') THEN
    EXECUTE 'CREATE POLICY import_job_errors_tenant_read ON import_job_errors FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'import_job_errors_tenant_write' AND tablename = 'import_job_errors') THEN
    EXECUTE 'CREATE POLICY import_job_errors_tenant_write ON import_job_errors FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON import_job_errors TO app_role;
GRANT SELECT ON import_job_errors TO backup_role;
GRANT SELECT ON import_job_errors TO reporting_role;

-- RLS for offline_sync_batches
ALTER TABLE offline_sync_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_sync_batches FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'offline_sync_batches_tenant_read' AND tablename = 'offline_sync_batches') THEN
    EXECUTE 'CREATE POLICY offline_sync_batches_tenant_read ON offline_sync_batches FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'offline_sync_batches_tenant_write' AND tablename = 'offline_sync_batches') THEN
    EXECUTE 'CREATE POLICY offline_sync_batches_tenant_write ON offline_sync_batches FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON offline_sync_batches TO app_role;
GRANT SELECT ON offline_sync_batches TO backup_role;
GRANT SELECT ON offline_sync_batches TO reporting_role;

-- RLS for offline_commands
ALTER TABLE offline_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_commands FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'offline_commands_tenant_read' AND tablename = 'offline_commands') THEN
    EXECUTE 'CREATE POLICY offline_commands_tenant_read ON offline_commands FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'offline_commands_tenant_write' AND tablename = 'offline_commands') THEN
    EXECUTE 'CREATE POLICY offline_commands_tenant_write ON offline_commands FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON offline_commands TO app_role;
GRANT SELECT ON offline_commands TO backup_role;
GRANT SELECT ON offline_commands TO reporting_role;

-- RLS for outbound_messages
ALTER TABLE outbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_messages FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'outbound_messages_tenant_read' AND tablename = 'outbound_messages') THEN
    EXECUTE 'CREATE POLICY outbound_messages_tenant_read ON outbound_messages FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'outbound_messages_tenant_write' AND tablename = 'outbound_messages') THEN
    EXECUTE 'CREATE POLICY outbound_messages_tenant_write ON outbound_messages FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_messages TO app_role;
GRANT SELECT ON outbound_messages TO backup_role;
GRANT SELECT ON outbound_messages TO reporting_role;

-- RLS for print_jobs
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_jobs FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'print_jobs_tenant_read' AND tablename = 'print_jobs') THEN
    EXECUTE 'CREATE POLICY print_jobs_tenant_read ON print_jobs FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'print_jobs_tenant_write' AND tablename = 'print_jobs') THEN
    EXECUTE 'CREATE POLICY print_jobs_tenant_write ON print_jobs FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON print_jobs TO app_role;
GRANT SELECT ON print_jobs TO backup_role;
GRANT SELECT ON print_jobs TO reporting_role;

-- RLS for user_notifications
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notifications FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_notifications_tenant_read' AND tablename = 'user_notifications') THEN
    EXECUTE 'CREATE POLICY user_notifications_tenant_read ON user_notifications FOR SELECT TO app_role USING (app_is_global() OR EXISTS (SELECT 1 FROM notifications p WHERE p.id = user_notifications.notification_id AND p.company_id = app_company_id()));';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_notifications_tenant_write' AND tablename = 'user_notifications') THEN
    EXECUTE 'CREATE POLICY user_notifications_tenant_write ON user_notifications FOR ALL TO app_role USING (EXISTS (SELECT 1 FROM notifications p WHERE p.id = user_notifications.notification_id AND p.company_id = app_company_id())) WITH CHECK (EXISTS (SELECT 1 FROM notifications p WHERE p.id = user_notifications.notification_id AND p.company_id = app_company_id()));';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON user_notifications TO app_role;
GRANT SELECT ON user_notifications TO backup_role;
GRANT SELECT ON user_notifications TO reporting_role;

-- RLS for legal_holds
ALTER TABLE legal_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_holds FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'legal_holds_tenant_read' AND tablename = 'legal_holds') THEN
    EXECUTE 'CREATE POLICY legal_holds_tenant_read ON legal_holds FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'legal_holds_tenant_write' AND tablename = 'legal_holds') THEN
    EXECUTE 'CREATE POLICY legal_holds_tenant_write ON legal_holds FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON legal_holds TO app_role;
GRANT SELECT ON legal_holds TO backup_role;
GRANT SELECT ON legal_holds TO reporting_role;

-- RLS for webauthn_credentials
ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn_credentials FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'webauthn_credentials_tenant_read' AND tablename = 'webauthn_credentials') THEN
    EXECUTE 'CREATE POLICY webauthn_credentials_tenant_read ON webauthn_credentials FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'webauthn_credentials_tenant_write' AND tablename = 'webauthn_credentials') THEN
    EXECUTE 'CREATE POLICY webauthn_credentials_tenant_write ON webauthn_credentials FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON webauthn_credentials TO app_role;
GRANT SELECT ON webauthn_credentials TO backup_role;
GRANT SELECT ON webauthn_credentials TO reporting_role;

-- RLS for webauthn_challenges
ALTER TABLE webauthn_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn_challenges FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'webauthn_challenges_tenant_read' AND tablename = 'webauthn_challenges') THEN
    EXECUTE 'CREATE POLICY webauthn_challenges_tenant_read ON webauthn_challenges FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'webauthn_challenges_tenant_write' AND tablename = 'webauthn_challenges') THEN
    EXECUTE 'CREATE POLICY webauthn_challenges_tenant_write ON webauthn_challenges FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON webauthn_challenges TO app_role;
GRANT SELECT ON webauthn_challenges TO backup_role;
GRANT SELECT ON webauthn_challenges TO reporting_role;

COMMIT;
