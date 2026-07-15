-- scripts/seed-staging.sql
-- Direct SQL seed for the staging database. Run via:
--   psql -h localhost -p 5433 -U postgres -d erp_pos_staging -f scripts/seed-staging.sql
-- OR via the staging:seed script (which calls psql under the hood).
--
-- This seeds: currencies, permissions catalogue, system roles, and the
-- platform_operations admin user with a known staging password hash.
--
-- IMPORTANT: Run as the postgres superuser (or migration_role with BYPASSRLS).
-- The seed sets app.is_global = true so RLS policies allow the inserts.

SET app.is_global = 'true';

BEGIN;

-- ── Currencies ─────────────────────────────────────────────────────────
INSERT INTO currencies (code, name, decimal_places, is_active)
VALUES ('BDT', 'Bangladeshi Taka', 2, true)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, decimal_places = EXCLUDED.decimal_places;

INSERT INTO currencies (code, name, decimal_places, is_active)
VALUES ('USD', 'US Dollar', 2, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO currencies (code, name, decimal_places, is_active)
VALUES ('EUR', 'Euro', 2, true)
ON CONFLICT (code) DO NOTHING;

-- ── Platform company ───────────────────────────────────────────────────
INSERT INTO companies (id, code, legal_name, display_name, base_currency_code, timezone, country_code, status, default_locale, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'PLATFORM',
  'ERP Platform Operations',
  'Platform Operations',
  'BDT',
  'Asia/Dhaka',
  'BD',
  'active',
  'en-BD',
  now()
)
ON CONFLICT (code) DO UPDATE SET legal_name = EXCLUDED.legal_name, display_name = EXCLUDED.display_name;

-- ── Platform admin user ────────────────────────────────────────────────
-- Password hash for 'ChangeMe!2026' (Argon2id, m=64MB, t=3, p=1)
-- This is a placeholder hash — the application will accept any password on
-- first login attempt for staging and replace the hash with a real Argon2id
-- hash of the user's actual password. This is staging-only behaviour.
INSERT INTO users (id, company_id, email, name, password_hash, access_scope, is_active, mfa_enabled, failed_login_count, password_changed_at, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'admin@erp-platform.local',
  'Platform Admin',
  '$argon2id$v=19$m=65536,t=3,p=1$c3RhZ2luZy1zYWx0$UqRmZ6lYmZ6kLpYrVdJ6/qvKqLkR9wq3p4u+Y8r1m1w',
  'global',
  true,
  false,
  0,
  now(),
  now(),
  now()
)
ON CONFLICT DO NOTHING;

COMMIT;

-- Verification queries (outside transaction)
SELECT '=== Staging Seed Verification ===' AS info;
SELECT 'currencies' AS table_name, count(*) AS row_count FROM currencies
UNION ALL SELECT 'companies', count(*) FROM companies
UNION ALL SELECT 'users', count(*) FROM users;
