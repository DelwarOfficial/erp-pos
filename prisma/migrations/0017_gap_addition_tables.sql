-- prisma/migrations/0017_gap_addition_tables.sql
-- Gap additions:
--   risk_threshold_changes  (audit log of risk threshold changes)
--   risk_assessments        (risk scoring records)
--   risk_assessment_outcomes (linkage of risk → sale/delivery outcome)
--   currency_revaluations   (§20.D12 multi-currency period-end revaluation)
--
-- currency_revaluations references journal_entries (partitioned). FKs skipped.

BEGIN;


-- ============================================================================
-- TABLES (4 tables)
-- ============================================================================

-- ============================================================================
-- risk_threshold_changes
-- ============================================================================
CREATE TABLE IF NOT EXISTS risk_threshold_changes (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID,
  threshold_key VARCHAR NOT NULL,
  old_value VARCHAR,
  new_value VARCHAR NOT NULL,
  reason VARCHAR,
  changed_by UUID NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_risk_threshold_changes_company_id ON risk_threshold_changes(company_id);
CREATE INDEX IF NOT EXISTS idx_risk_threshold_changes_threshold_key ON risk_threshold_changes(threshold_key);
CREATE INDEX IF NOT EXISTS idx_risk_threshold_changes_changed_at ON risk_threshold_changes(changed_at);

-- ============================================================================
-- risk_assessments
-- ============================================================================
CREATE TABLE IF NOT EXISTS risk_assessments (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  provider_code VARCHAR NOT NULL,
  subject_type VARCHAR NOT NULL CHECK (subject_type IN ('customer','lead','sale','delivery')),
  subject_id UUID NOT NULL,
  request_event_id UUID NOT NULL,
  score DECIMAL(18,2),
  decision VARCHAR DEFAULT 'allow' NOT NULL CHECK (decision IN ('allow','review','block','unavailable')),
  reason_codes VARCHAR DEFAULT '[]' NOT NULL,
  provider_reference VARCHAR,
  sanitized_response VARCHAR DEFAULT '{}' NOT NULL,
  assessed_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_risk_assessments_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_risk_assessments_request_event_id FOREIGN KEY (request_event_id) REFERENCES business_events(id) ON DELETE RESTRICT,
  CONSTRAINT uq_risk_assessments_4952 UNIQUE (company_id, request_event_id, provider_code)
);

CREATE INDEX IF NOT EXISTS idx_risk_assessments_company_id ON risk_assessments(company_id);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_subject_type_subject_id ON risk_assessments(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_decision ON risk_assessments(decision);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_expires_at ON risk_assessments(expires_at);

-- CHECK: a 'block' decision must have an expiry (§5.16 risk)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_assessments_block_requires_expiry_chk' AND conrelid = 'risk_assessments'::regclass) THEN
    ALTER TABLE risk_assessments ADD CONSTRAINT risk_assessments_block_requires_expiry_chk CHECK (decision <> 'block' OR expires_at IS NOT NULL);
  END IF;
END $$;

-- risk_assessments is append-only (immutable after insert)
DROP TRIGGER IF EXISTS trg_risk_assessments_immutable ON risk_assessments;
CREATE TRIGGER trg_risk_assessments_immutable
  BEFORE UPDATE OR DELETE ON risk_assessments
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();

-- ============================================================================
-- risk_assessment_outcomes
-- ============================================================================
CREATE TABLE IF NOT EXISTS risk_assessment_outcomes (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  risk_assessment_id UUID NOT NULL,
  outcome_type VARCHAR NOT NULL CHECK (outcome_type IN ('completed','returned','charged_back','refunded','fraud_confirmed','no_issue')),
  outcome_notes VARCHAR,
  outcome_amount DECIMAL(18,2),
  recorded_by UUID,
  recorded_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_risk_assessment_outcomes_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_risk_assessment_outcomes_risk_assessment_id FOREIGN KEY (risk_assessment_id) REFERENCES risk_assessments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_risk_assessment_outcomes_company_id ON risk_assessment_outcomes(company_id);
CREATE INDEX IF NOT EXISTS idx_risk_assessment_outcomes_risk_assessment_id ON risk_assessment_outcomes(risk_assessment_id);
CREATE INDEX IF NOT EXISTS idx_risk_assessment_outcomes_outcome_type ON risk_assessment_outcomes(outcome_type);
CREATE INDEX IF NOT EXISTS idx_risk_assessment_outcomes_recorded_at ON risk_assessment_outcomes(recorded_at);

-- risk_assessment_outcomes is append-only (immutable after insert)
DROP TRIGGER IF EXISTS trg_risk_assessment_outcomes_immutable ON risk_assessment_outcomes;
CREATE TRIGGER trg_risk_assessment_outcomes_immutable
  BEFORE UPDATE OR DELETE ON risk_assessment_outcomes
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();

-- ============================================================================
-- currency_revaluations
-- ============================================================================
CREATE TABLE IF NOT EXISTS currency_revaluations (
  PRIMARY KEY (id),
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  company_id UUID NOT NULL,
  revaluation_date TIMESTAMPTZ NOT NULL,
  journal_entry_id UUID,
  reversal_journal_entry_id UUID,
  reversal_of_id UUID,
  total_unrealized_gain DECIMAL(18,2) DEFAULT 0 NOT NULL,
  total_unrealized_loss DECIMAL(18,2) DEFAULT 0 NOT NULL,
  period_end_rate DECIMAL(18,6) NOT NULL,
  currency_code CHAR(3) NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  reversed_at TIMESTAMPTZ,
  CONSTRAINT fk_currency_revaluations_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_currency_revaluations_company_id ON currency_revaluations(company_id);
CREATE INDEX IF NOT EXISTS idx_currency_revaluations_revaluation_date ON currency_revaluations(revaluation_date);
CREATE INDEX IF NOT EXISTS idx_currency_revaluations_currency_code ON currency_revaluations(currency_code);

-- CHECK: gain XOR loss (one must be 0)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'currency_revaluations_gain_xor_loss_chk' AND conrelid = 'currency_revaluations'::regclass) THEN
    ALTER TABLE currency_revaluations ADD CONSTRAINT currency_revaluations_gain_xor_loss_chk CHECK (
    (total_unrealized_gain = 0 AND total_unrealized_loss >= 0) OR
    (total_unrealized_loss = 0 AND total_unrealized_gain >= 0)
  );
  END IF;
END $$;


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- RLS for risk_threshold_changes
ALTER TABLE risk_threshold_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_threshold_changes FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'risk_threshold_changes_tenant_read' AND tablename = 'risk_threshold_changes') THEN
    EXECUTE 'CREATE POLICY risk_threshold_changes_tenant_read ON risk_threshold_changes FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'risk_threshold_changes_tenant_write' AND tablename = 'risk_threshold_changes') THEN
    EXECUTE 'CREATE POLICY risk_threshold_changes_tenant_write ON risk_threshold_changes FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON risk_threshold_changes TO app_role;
GRANT SELECT ON risk_threshold_changes TO backup_role;
GRANT SELECT ON risk_threshold_changes TO reporting_role;

-- RLS for risk_assessments
ALTER TABLE risk_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_assessments FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'risk_assessments_tenant_read' AND tablename = 'risk_assessments') THEN
    EXECUTE 'CREATE POLICY risk_assessments_tenant_read ON risk_assessments FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'risk_assessments_tenant_write' AND tablename = 'risk_assessments') THEN
    EXECUTE 'CREATE POLICY risk_assessments_tenant_write ON risk_assessments FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT ON risk_assessments TO app_role;
GRANT SELECT ON risk_assessments TO backup_role;
GRANT SELECT ON risk_assessments TO reporting_role;

-- RLS for risk_assessment_outcomes
ALTER TABLE risk_assessment_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_assessment_outcomes FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'risk_assessment_outcomes_tenant_read' AND tablename = 'risk_assessment_outcomes') THEN
    EXECUTE 'CREATE POLICY risk_assessment_outcomes_tenant_read ON risk_assessment_outcomes FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'risk_assessment_outcomes_tenant_write' AND tablename = 'risk_assessment_outcomes') THEN
    EXECUTE 'CREATE POLICY risk_assessment_outcomes_tenant_write ON risk_assessment_outcomes FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT ON risk_assessment_outcomes TO app_role;
GRANT SELECT ON risk_assessment_outcomes TO backup_role;
GRANT SELECT ON risk_assessment_outcomes TO reporting_role;

-- RLS for currency_revaluations
ALTER TABLE currency_revaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE currency_revaluations FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'currency_revaluations_tenant_read' AND tablename = 'currency_revaluations') THEN
    EXECUTE 'CREATE POLICY currency_revaluations_tenant_read ON currency_revaluations FOR SELECT TO app_role USING (app_is_global() OR company_id = app_company_id());';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'currency_revaluations_tenant_write' AND tablename = 'currency_revaluations') THEN
    EXECUTE 'CREATE POLICY currency_revaluations_tenant_write ON currency_revaluations FOR ALL TO app_role USING (app_is_global() OR company_id = app_company_id()) WITH CHECK (app_is_global() OR company_id = app_company_id());';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON currency_revaluations TO app_role;
GRANT SELECT ON currency_revaluations TO backup_role;
GRANT SELECT ON currency_revaluations TO reporting_role;

COMMIT;
