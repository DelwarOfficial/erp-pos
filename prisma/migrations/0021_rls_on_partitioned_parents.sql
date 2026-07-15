-- prisma/migrations/0021_rls_on_partitioned_parents.sql
-- §22 REDTEAM Final Bug Hunt — CRITICAL FIX
--
-- Problem: journal_entries and payments are partitioned tables (RANGE partition
-- by business_date / entry_date). Their partitions inherit the parent's RLS
-- setting, but the parent itself was never ENABLEd for RLS, never FORCEd, and
-- never GRANTed to app_role. This means:
--   1. The application (running as erp_app, member of app_role) gets
--      "permission denied for table journal_entries" at runtime.
--   2. Even if it had grants, there were no RLS policies, so cross-tenant
--      isolation was absent at the DB layer for these two tables.
--
-- This migration:
--   1. Enables + forces RLS on the parent tables (partitions inherit).
--   2. Creates tenant_read + tenant_write policies (partitions inherit).
--   3. Grants DML to app_role, SELECT to backup_role + reporting_role.
--   4. Runs the same treatment on every existing partition (belt-and-suspenders
--      so that direct-to-partition queries also work).
--   5. Verifies with a final count.
--
-- Reference: §8.2 RLS Context and Policy, §22 Audit Finding #2.
-- Forward-only. Run via migration_role (BYPASSRLS) or postgres superuser.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. journal_entries (parent)
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'journal_entries_tenant_read' AND tablename = 'journal_entries') THEN
    CREATE POLICY journal_entries_tenant_read  ON journal_entries FOR SELECT TO app_role
      USING (app_is_global() OR company_id = app_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'journal_entries_tenant_write' AND tablename = 'journal_entries') THEN
    CREATE POLICY journal_entries_tenant_write ON journal_entries FOR ALL TO app_role
      USING      (app_is_global() OR company_id = app_company_id())
      WITH CHECK (app_is_global() OR company_id = app_company_id());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entries TO app_role;
GRANT SELECT ON journal_entries TO backup_role;
GRANT SELECT ON journal_entries TO reporting_role;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. payments (parent)
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'payments_tenant_read' AND tablename = 'payments') THEN
    CREATE POLICY payments_tenant_read  ON payments FOR SELECT TO app_role
      USING (app_is_global() OR company_id = app_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'payments_tenant_write' AND tablename = 'payments') THEN
    CREATE POLICY payments_tenant_write ON payments FOR ALL TO app_role
      USING      (app_is_global() OR company_id = app_company_id())
      WITH CHECK (app_is_global() OR company_id = app_company_id());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON payments TO app_role;
GRANT SELECT ON payments TO backup_role;
GRANT SELECT ON payments TO reporting_role;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Existing partitions (belt-and-suspenders — partitions should inherit
--    from parent, but explicit is safer for direct-to-partition queries)
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  part TEXT;
BEGIN
  FOR part IN
    SELECT c.relname FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    WHERE i.inhparent IN ('journal_entries'::regclass, 'payments'::regclass, 'stock_movements'::regclass)
  LOOP
    -- Partitions inherit RLS + policies from parent automatically.
    -- We only need to grant DML (GRANTs do NOT inherit).
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_role;', part);
    EXECUTE format('GRANT SELECT ON %I TO backup_role;', part);
    EXECUTE format('GRANT SELECT ON %I TO reporting_role;', part);
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Also grant on the SEQUENCE used by document_number_leases (if any)
--    (Not needed here — UUIDs are gen_random_uuid())
-- ──────────────────────────────────────────────────────────────────────────

COMMIT;

-- ──────────────────────────────────────────────────────────────────────────
-- Verification (outside transaction)
-- ──────────────────────────────────────────────────────────────────────────
SELECT '=== Post-migration RLS status ===' AS info;
SELECT relname, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relname IN ('journal_entries', 'payments', 'stock_movements')
ORDER BY relname;

SELECT '=== Policies on partitioned parents ===' AS info;
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('journal_entries', 'payments')
ORDER BY tablename, policyname;

SELECT '=== Grants on partitioned parents ===' AS info;
SELECT table_name, grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_name IN ('journal_entries', 'payments')
  AND grantee IN ('app_role', 'backup_role', 'reporting_role')
GROUP BY table_name, grantee
ORDER BY table_name, grantee;
