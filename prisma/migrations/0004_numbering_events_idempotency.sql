-- prisma/migrations/0004_numbering_events_idempotency.sql
-- §5.3 Numbering, Events, and Idempotency
-- Includes the partial unique indexes and EXCLUDE constraint that SQLite
-- could not enforce.

BEGIN;

-- ============================================================================
-- document_sequences
-- Two partial unique indexes handle the nullable branch_id:
--   - one for company-wide sequences (branch_id IS NULL)
--   - one for branch-specific sequences (branch_id IS NOT NULL)
-- Without this split, PostgreSQL's NULL-distinctness would allow duplicate
-- company-wide sequences.
-- ============================================================================
CREATE TABLE document_sequences (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id     UUID         REFERENCES branches(id),
  document_type VARCHAR(40)  NOT NULL,
  fiscal_year   SMALLINT     NOT NULL,
  prefix        VARCHAR(20)  NOT NULL,
  next_number   BIGINT       NOT NULL CHECK (next_number > 0),
  padding       SMALLINT     NOT NULL DEFAULT 6 CHECK (padding BETWEEN 1 AND 12),
  version       INTEGER      NOT NULL DEFAULT 0
);
CREATE INDEX idx_doc_seq_company_type_year ON document_sequences(company_id, document_type, fiscal_year);
CREATE INDEX idx_doc_seq_branch_type_year  ON document_sequences(company_id, branch_id, document_type, fiscal_year);

-- Partial unique: company-wide sequences (branch_id IS NULL)
CREATE UNIQUE INDEX idx_doc_seq_company_wide
  ON document_sequences(company_id, document_type, fiscal_year)
  WHERE branch_id IS NULL;

-- Partial unique: branch-specific sequences (branch_id IS NOT NULL)
CREATE UNIQUE INDEX idx_doc_seq_branch_specific
  ON document_sequences(company_id, branch_id, document_type, fiscal_year)
  WHERE branch_id IS NOT NULL;

-- ============================================================================
-- document_number_leases
-- EXCLUDE USING gist prevents overlapping number ranges for the same
-- company/document_type/prefix.
-- ============================================================================
CREATE TABLE document_number_leases (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id     UUID         NOT NULL REFERENCES branches(id),
  device_id     UUID         NOT NULL REFERENCES devices(id),
  document_type VARCHAR(40)  NOT NULL,
  prefix        VARCHAR(20)  NOT NULL,
  range_start   BIGINT       NOT NULL,
  range_end     BIGINT       NOT NULL CHECK (range_end >= range_start),
  next_number   BIGINT       NOT NULL,
  expires_at    TIMESTAMPTZ  NOT NULL,
  status        VARCHAR(20)  NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','exhausted','expired','revoked'))
);
CREATE INDEX idx_doc_leases_company_type_prefix ON document_number_leases(company_id, document_type, prefix);
CREATE INDEX idx_doc_leases_branch              ON document_number_leases(branch_id);
CREATE INDEX idx_doc_leases_device              ON document_number_leases(device_id);
CREATE INDEX idx_doc_leases_expires             ON document_number_leases(expires_at);
CREATE INDEX idx_doc_leases_status              ON document_number_leases(status);

-- EXCLUDE constraint: no two leases for the same company/type/prefix may
-- have overlapping number ranges.
ALTER TABLE document_number_leases
  ADD CONSTRAINT exclude_doc_lease_overlap
  EXCLUDE USING gist (
    company_id     WITH =,
    document_type  WITH =,
    prefix         WITH =,
    int8range(range_start, range_end, '[]') WITH &&
  );

-- ============================================================================
-- idempotency_requests
-- UNIQUE(company_id, idempotency_key) is the natural key — partial unique
-- index allows the application to look up by idempotency_key alone.
-- ============================================================================
CREATE TABLE idempotency_requests (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  user_id         UUID         REFERENCES users(id),
  device_id       UUID         REFERENCES devices(id),
  idempotency_key VARCHAR(160) NOT NULL,
  operation       VARCHAR(100) NOT NULL,
  request_hash    CHAR(64)     NOT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'processing'
                  CHECK (status IN ('processing','succeeded','failed')),
  resource_type   VARCHAR(60),
  resource_id     UUID,
  response_status SMALLINT,
  response_body   JSONB,
  locked_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ  NOT NULL
);
-- Composite unique is the natural key per §5.3
CREATE UNIQUE INDEX idx_idem_req_company_key
  ON idempotency_requests(company_id, idempotency_key);
-- Global index for fast lookup by key alone (cross-tenant reuse detection)
CREATE UNIQUE INDEX idx_idem_req_key_global
  ON idempotency_requests(idempotency_key);

CREATE INDEX idx_idem_req_company   ON idempotency_requests(company_id);
CREATE INDEX idx_idem_req_user      ON idempotency_requests(user_id);
CREATE INDEX idx_idem_req_device    ON idempotency_requests(device_id);
CREATE INDEX idx_idem_req_operation ON idempotency_requests(operation);
CREATE INDEX idx_idem_req_status    ON idempotency_requests(status);
CREATE INDEX idx_idem_req_resource  ON idempotency_requests(resource_id);
CREATE INDEX idx_idem_req_expires   ON idempotency_requests(expires_at);

-- ============================================================================
-- business_events
-- ============================================================================
CREATE TABLE business_events (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  event_type     VARCHAR(80)  NOT NULL,
  source_type    VARCHAR(60)  NOT NULL,
  source_id      UUID         NOT NULL,
  correlation_id UUID         NOT NULL,
  occurred_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(company_id, event_type, source_type, source_id)
);
CREATE INDEX idx_biz_events_company    ON business_events(company_id);
CREATE INDEX idx_biz_events_type       ON business_events(event_type);
CREATE INDEX idx_biz_events_source     ON business_events(source_type, source_id);
CREATE INDEX idx_biz_events_corr       ON business_events(correlation_id);
CREATE INDEX idx_biz_events_occurred   ON business_events(occurred_at);

-- ============================================================================
-- document_exchange_rates (snapshot of rate at document time)
-- ============================================================================
CREATE TABLE document_exchange_rates (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  currency_code CHAR(3)     NOT NULL REFERENCES currencies(code),
  rate_to_base DECIMAL(18,6) NOT NULL CHECK (rate_to_base > 0),
  rate_date    DATE         NOT NULL
);
CREATE INDEX idx_doc_exchange_rates_company  ON document_exchange_rates(company_id);
CREATE INDEX idx_doc_exchange_rates_currency ON document_exchange_rates(currency_code);

-- ============================================================================
-- recovery_epochs (§20.D10)
-- ============================================================================
CREATE TABLE recovery_epochs (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  epoch_number INTEGER      NOT NULL,
  reason       VARCHAR(120) NOT NULL,
  declared_by  UUID         NOT NULL REFERENCES users(id),
  declared_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_recovery_epochs_company_epoch ON recovery_epochs(company_id, epoch_number);

COMMIT;
