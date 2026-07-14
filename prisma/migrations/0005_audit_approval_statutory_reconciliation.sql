-- prisma/migrations/0005_audit_approval_statutory_reconciliation.sql
-- §5.15 Audit, Approval, Statutory, and Reconciliation

BEGIN;

-- ============================================================================
-- audit_logs (append-only — app_role has INSERT/SELECT only, never UPDATE/DELETE)
-- ============================================================================
CREATE TABLE audit_logs (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  user_id        UUID         REFERENCES users(id),
  device_id      UUID         REFERENCES devices(id),
  correlation_id UUID         NOT NULL,
  action         VARCHAR(100) NOT NULL,
  entity_type    VARCHAR(60)  NOT NULL,
  entity_id      UUID         NOT NULL,
  before_value   JSONB,
  after_value    JSONB,
  client_ip      INET,
  sync_ip        INET,
  user_agent     TEXT,
  occurred_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_company    ON audit_logs(company_id);
CREATE INDEX idx_audit_logs_user       ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_device     ON audit_logs(device_id);
CREATE INDEX idx_audit_logs_corr       ON audit_logs(correlation_id);
CREATE INDEX idx_audit_logs_action     ON audit_logs(action);
CREATE INDEX idx_audit_logs_entity     ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_occurred   ON audit_logs(occurred_at);
CREATE INDEX idx_audit_logs_before_gin ON audit_logs USING GIN (before_value);
CREATE INDEX idx_audit_logs_after_gin  ON audit_logs USING GIN (after_value);

-- Revoke UPDATE/DELETE from app_role — append-only
-- (Granted in 0009_grants.sql)

-- ============================================================================
-- approval_requests (maker-checker)
-- CHECK: approved_by IS NULL OR approved_by <> requested_by (segregation of duties)
-- ============================================================================
CREATE TABLE approval_requests (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id     UUID         REFERENCES branches(id),
  request_type  VARCHAR(50)  NOT NULL
                CHECK (request_type IN (
                  'balance_adjustment','stock_adjustment','backdate','sale_void',
                  'discount_override','expense','purchase_return','negative_stock',
                  'fefo_override','account_transfer','cheque_action',
                  'warranty_replacement','payroll_post','courier_settlement',
                  'cashier_variance','return_refund','credit_limit_override',
                  'period_unlock','tax_rule_change','integration_secret_rotate','other'
                )),
  reference_type VARCHAR(60) NOT NULL,
  reference_id   UUID        NOT NULL,
  requested_by   UUID        NOT NULL REFERENCES users(id),
  approved_by    UUID        REFERENCES users(id),
  status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected','cancelled','expired')),
  reason         TEXT         NOT NULL,
  payload        JSONB        NOT NULL,
  requested_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ,
  waived_by      UUID         REFERENCES users(id),
  waiver_reason  TEXT,
  CHECK (approved_by IS NULL OR approved_by <> requested_by)
);
CREATE INDEX idx_approval_requests_company   ON approval_requests(company_id);
CREATE INDEX idx_approval_requests_branch    ON approval_requests(branch_id);
CREATE INDEX idx_approval_requests_type      ON approval_requests(request_type);
CREATE INDEX idx_approval_requests_reference ON approval_requests(reference_type, reference_id);
CREATE INDEX idx_approval_requests_requested ON approval_requests(requested_by);
CREATE INDEX idx_approval_requests_approved  ON approval_requests(approved_by);
CREATE INDEX idx_approval_requests_status    ON approval_requests(status);
CREATE INDEX idx_approval_requests_at        ON approval_requests(requested_at);
CREATE INDEX idx_approval_requests_payload   ON approval_requests USING GIN (payload);

-- ============================================================================
-- statutory_documents
-- ============================================================================
CREATE TABLE statutory_documents (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id        UUID         NOT NULL REFERENCES branches(id),
  document_type    VARCHAR(40)  NOT NULL
                   CHECK (document_type IN ('VAT_6_3','VAT_6_1','VAT_6_2','VAT_9_1','withholding_certificate','other')),
  document_no      VARCHAR(80)  NOT NULL,
  source_type      VARCHAR(50)  NOT NULL,
  source_id        UUID         NOT NULL,
  issue_date       DATE         NOT NULL,
  tax_period_start DATE,
  tax_period_end   DATE,
  payload_snapshot JSONB        NOT NULL,
  object_key       VARCHAR(500),
  status           VARCHAR(20)  NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','issued','replaced','cancelled','filed')),
  replacement_of_id UUID        REFERENCES statutory_documents(id),
  issued_by        UUID         REFERENCES users(id),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(company_id, document_type, document_no)
);
CREATE INDEX idx_stat_docs_company  ON statutory_documents(company_id);
CREATE INDEX idx_stat_docs_branch   ON statutory_documents(branch_id);
CREATE INDEX idx_stat_docs_type     ON statutory_documents(document_type);
CREATE INDEX idx_stat_docs_source   ON statutory_documents(source_type, source_id);
CREATE INDEX idx_stat_docs_issue    ON statutory_documents(issue_date);
CREATE INDEX idx_stat_docs_status   ON statutory_documents(status);
CREATE INDEX idx_stat_docs_payload  ON statutory_documents USING GIN (payload_snapshot);

-- ============================================================================
-- tax_return_periods
-- ============================================================================
CREATE TABLE tax_return_periods (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  period_start        DATE         NOT NULL,
  period_end          DATE         NOT NULL CHECK (period_end >= period_start),
  return_type         VARCHAR(30)  NOT NULL DEFAULT 'VAT_9_1'
                      CHECK (return_type IN ('VAT_9_1','withholding','other')),
  status              VARCHAR(20)  NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','prepared','reviewed','filed','amended')),
  prepared_document_id UUID        REFERENCES statutory_documents(id),
  filed_at            TIMESTAMPTZ,
  filed_reference     VARCHAR(120),
  UNIQUE(company_id, return_type, period_start, period_end)
);
CREATE INDEX idx_tax_return_periods_company ON tax_return_periods(company_id);
CREATE INDEX idx_tax_return_periods_status  ON tax_return_periods(status);

-- ============================================================================
-- reconciliation_runs
-- ============================================================================
CREATE TABLE reconciliation_runs (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  run_type     VARCHAR(40)  NOT NULL DEFAULT 'nightly'
               CHECK (run_type IN ('nightly','manual','pre_close','post_restore')),
  started_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status       VARCHAR(20)  NOT NULL DEFAULT 'running'
               CHECK (status IN ('running','passed','failed','partial')),
  initiated_by UUID         REFERENCES users(id),
  summary      JSONB        NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_recon_runs_company  ON reconciliation_runs(company_id);
CREATE INDEX idx_recon_runs_type     ON reconciliation_runs(run_type);
CREATE INDEX idx_recon_runs_started  ON reconciliation_runs(started_at);
CREATE INDEX idx_recon_runs_status   ON reconciliation_runs(status);
CREATE INDEX idx_recon_runs_summary  ON reconciliation_runs USING GIN (summary);

-- ============================================================================
-- reconciliation_findings
-- ============================================================================
CREATE TABLE reconciliation_findings (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID          NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  reconciliation_run_id UUID        NOT NULL REFERENCES reconciliation_runs(id),
  check_code          VARCHAR(80)   NOT NULL,
  severity            VARCHAR(20)   NOT NULL DEFAULT 'info'
                      CHECK (severity IN ('info','warning','high','critical')),
  branch_id           UUID          REFERENCES branches(id),
  reference_type      VARCHAR(60),
  reference_id        UUID,
  expected_value      DECIMAL(24,6),
  actual_value        DECIMAL(24,6),
  variance            DECIMAL(24,6),
  details             JSONB         NOT NULL DEFAULT '{}'::jsonb,
  status              VARCHAR(20)   NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','acknowledged','resolved','false_positive')),
  resolved_by         UUID          REFERENCES users(id),
  resolved_at         TIMESTAMPTZ
);
CREATE INDEX idx_recon_findings_company ON reconciliation_findings(company_id);
CREATE INDEX idx_recon_findings_run     ON reconciliation_findings(reconciliation_run_id);
CREATE INDEX idx_recon_findings_check   ON reconciliation_findings(check_code);
CREATE INDEX idx_recon_findings_sev     ON reconciliation_findings(severity);
CREATE INDEX idx_recon_findings_branch  ON reconciliation_findings(branch_id);
CREATE INDEX idx_recon_findings_ref     ON reconciliation_findings(reference_id);
CREATE INDEX idx_recon_findings_status  ON reconciliation_findings(status);
CREATE INDEX idx_recon_findings_details ON reconciliation_findings USING GIN (details);

-- ============================================================================
-- integration_credentials
-- ============================================================================
CREATE TABLE integration_credentials (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  provider              VARCHAR(60)  NOT NULL,
  label                 VARCHAR(100) NOT NULL,
  credential_ciphertext BYTEA        NOT NULL,
  key_version           SMALLINT     NOT NULL,
  status                VARCHAR(20)  NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','disabled','expired')),
  last_rotated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by            UUID         NOT NULL REFERENCES users(id),
  UNIQUE(company_id, provider, label)
);
CREATE INDEX idx_integration_creds_company ON integration_credentials(company_id);
CREATE INDEX idx_integration_creds_status  ON integration_credentials(status);

COMMIT;
