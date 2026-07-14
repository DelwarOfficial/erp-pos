-- prisma/migrations/0003_identity_rbac_devices.sql
-- §5.2 Identity, RBAC, and Devices

BEGIN;

-- ============================================================================
-- users
-- ============================================================================
CREATE TABLE users (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name                  VARCHAR(120) NOT NULL,
  email                 VARCHAR(150) NOT NULL,
  phone                 VARCHAR(30),
  password_hash         VARCHAR(255) NOT NULL,
  primary_branch_id     UUID,  -- FK to branches added below
  access_scope          VARCHAR(20)  NOT NULL DEFAULT 'single_branch'
                        CHECK (access_scope IN ('single_branch','multi_branch','global')),
  is_active             BOOLEAN      NOT NULL DEFAULT true,
  mfa_enabled           BOOLEAN      NOT NULL DEFAULT false,
  mfa_secret_ciphertext BYTEA,
  mfa_secret_key_version SMALLINT,
  failed_login_count    SMALLINT     NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  password_changed_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_login_at         TIMESTAMPTZ,
  last_login_ip         INET,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ
);
-- UNIQUE(company_id, LOWER(email)) — Postgres needs expression index
CREATE UNIQUE INDEX idx_users_company_email_lower
  ON users (company_id, LOWER(email));
CREATE INDEX idx_users_company       ON users(company_id);
CREATE INDEX idx_users_phone         ON users(phone);
CREATE INDEX idx_users_primary_branch ON users(primary_branch_id);
CREATE INDEX idx_users_access_scope  ON users(access_scope);
CREATE INDEX idx_users_is_active     ON users(is_active);
CREATE INDEX idx_users_locked_until  ON users(locked_until);
CREATE INDEX idx_users_deleted_at    ON users(deleted_at);

ALTER TABLE users
  ADD CONSTRAINT fk_users_primary_branch
  FOREIGN KEY (primary_branch_id) REFERENCES branches(id);

-- Now add the deferred FK from exchange_rates.approved_by
ALTER TABLE exchange_rates
  ADD CONSTRAINT fk_exchange_rates_approved_by
  FOREIGN KEY (approved_by) REFERENCES users(id);

-- ============================================================================
-- roles
-- ============================================================================
CREATE TABLE roles (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name          VARCHAR(80)  NOT NULL,
  description   VARCHAR(255),
  is_system_role BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(company_id, name)
);
CREATE INDEX idx_roles_company ON roles(company_id);

-- ============================================================================
-- permissions (global catalogue)
-- ============================================================================
CREATE TABLE permissions (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(120) NOT NULL UNIQUE,  -- resource.action.scope
  module      VARCHAR(60)  NOT NULL,
  description VARCHAR(255) NOT NULL
);
CREATE INDEX idx_permissions_module ON permissions(module);

-- ============================================================================
-- role_permissions
-- ============================================================================
CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX idx_role_permissions_permission ON role_permissions(permission_id);

-- ============================================================================
-- user_roles
-- ============================================================================
CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);

-- ============================================================================
-- user_branch_access
-- ============================================================================
CREATE TABLE user_branch_access (
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, branch_id)
);
CREATE INDEX idx_user_branch_access_branch ON user_branch_access(branch_id);

-- ============================================================================
-- devices
-- ============================================================================
CREATE TABLE devices (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id            UUID         NOT NULL REFERENCES branches(id),
  label                VARCHAR(100) NOT NULL,
  device_public_key    TEXT         NOT NULL,
  registered_by        UUID         NOT NULL REFERENCES users(id),
  status               VARCHAR(20)  NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','active','revoked')),
  app_version          VARCHAR(30),
  last_seen_at         TIMESTAMPTZ,
  last_bootstrap_at    TIMESTAMPTZ,
  last_recovery_epoch  INTEGER      NOT NULL DEFAULT 0,
  schema_version       VARCHAR(30),
  revoked_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(company_id, branch_id, label),
  UNIQUE(company_id, device_public_key)
);
CREATE INDEX idx_devices_company    ON devices(company_id);
CREATE INDEX idx_devices_branch     ON devices(branch_id);
CREATE INDEX idx_devices_status     ON devices(status);
CREATE INDEX idx_devices_last_seen  ON devices(last_seen_at);

-- ============================================================================
-- cashier_device_pins (§20.D06)
-- ============================================================================
CREATE TABLE cashier_device_pins (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id  UUID         NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  pin_hash   VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(user_id, device_id)
);
CREATE INDEX idx_cashier_device_pins_company ON cashier_device_pins(company_id);

-- ============================================================================
-- refresh_tokens
-- ============================================================================
CREATE TABLE refresh_tokens (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash     CHAR(64)     NOT NULL UNIQUE,
  family_id      UUID         NOT NULL,
  device_id      UUID         REFERENCES devices(id),
  expires_at     TIMESTAMPTZ  NOT NULL,
  rotated_from_id UUID        REFERENCES refresh_tokens(id),
  revoked_at     TIMESTAMPTZ,
  revoke_reason  VARCHAR(100),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_company  ON refresh_tokens(company_id);
CREATE INDEX idx_refresh_tokens_user     ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_family   ON refresh_tokens(family_id);
CREATE INDEX idx_refresh_tokens_device   ON refresh_tokens(device_id);
CREATE INDEX idx_refresh_tokens_expires  ON refresh_tokens(expires_at);
CREATE INDEX idx_refresh_tokens_revoked  ON refresh_tokens(revoked_at);

-- ============================================================================
-- security_events
-- ============================================================================
CREATE TABLE security_events (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  user_id     UUID         REFERENCES users(id),
  device_id   UUID         REFERENCES devices(id),
  event_type  VARCHAR(80)  NOT NULL,
  severity    VARCHAR(20)  NOT NULL DEFAULT 'info'
              CHECK (severity IN ('info','warning','high','critical')),
  ip_address  INET,
  user_agent  TEXT,
  metadata    JSONB        NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_security_events_company    ON security_events(company_id);
CREATE INDEX idx_security_events_user       ON security_events(user_id);
CREATE INDEX idx_security_events_device     ON security_events(device_id);
CREATE INDEX idx_security_events_event_type ON security_events(event_type);
CREATE INDEX idx_security_events_severity   ON security_events(severity);
CREATE INDEX idx_security_events_occurred   ON security_events(occurred_at);
CREATE INDEX idx_security_events_metadata   ON security_events USING GIN (metadata);

COMMIT;
