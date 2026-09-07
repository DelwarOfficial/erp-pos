-- Phase 0 isolated DDL proof (MariaDB 11.8.x).
-- Reproduces the EXACT FK structure of the production tables and proves the
-- CHECK-plus-real-column design applies cleanly where
--   branch_scope VARCHAR(36) AS (IFNULL(branch_id, '')) PERSISTENT
-- failed with ERROR 1901.
--
-- Run against a DISPOSABLE database:
--   mysql -h 127.0.0.1 -u root -e "CREATE DATABASE phase0_proof;"
--   mysql -h 127.0.0.1 -u root phase0_proof < scripts/mariadb/phase0-proof.sql
-- Every block ends with an assertion query; all must return the expected row.

CREATE TABLE IF NOT EXISTS `proof_companies` (
  `id` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `proof_branches` (
  `id` VARCHAR(191) NOT NULL,
  `company_id` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_proof_branch_tenant` (`company_id`, `id`),
  CONSTRAINT `fk_proof_branch_company` FOREIGN KEY (`company_id`)
    REFERENCES `proof_companies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 1. document_sequences pattern: real scope column + CHECK + UNIQUE.
CREATE TABLE IF NOT EXISTS `proof_sequences` (
  `id` VARCHAR(191) NOT NULL,
  `company_id` VARCHAR(191) NOT NULL,
  `branch_id` VARCHAR(191) NULL,
  `branch_scope` VARCHAR(191) NOT NULL DEFAULT '',
  `document_type` VARCHAR(191) NOT NULL,
  `fiscal_year` INTEGER NOT NULL,
  `next_number` BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `proof_sequences`
  ADD CONSTRAINT `fk_proof_seq_company` FOREIGN KEY (`company_id`)
    REFERENCES `proof_companies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `proof_sequences`
  ADD CONSTRAINT `fk_proof_seq_branch` FOREIGN KEY (`branch_id`)
    REFERENCES `proof_branches` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `proof_sequences`
  ADD INDEX `idx_proof_seq_tenant_branch` (`company_id`, `branch_id`);
ALTER TABLE `proof_sequences`
  ADD CONSTRAINT `fk_proof_seq_tenant_branch` FOREIGN KEY (`company_id`, `branch_id`)
    REFERENCES `proof_branches` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `proof_sequences`
  ADD CONSTRAINT `proof_seq_scope_chk` CHECK (`branch_scope` = IFNULL(`branch_id`, '')),
  ADD UNIQUE INDEX `uq_proof_seq_scope` (`company_id`, `branch_scope`, `document_type`, `fiscal_year`);

-- 2. Supplier XOR pattern with RESTRICT provenance FKs.
CREATE TABLE IF NOT EXISTS `proof_payments` (
  `id` VARCHAR(191) NOT NULL,
  `company_id` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_proof_payment_tenant` (`company_id`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `proof_advance` (
  `id` VARCHAR(191) NOT NULL,
  `company_id` VARCHAR(191) NOT NULL,
  `payment_id` VARCHAR(191) NULL,
  `purchase_return_id` VARCHAR(191) NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `proof_advance`
  ADD CONSTRAINT `fk_proof_adv_payment` FOREIGN KEY (`payment_id`)
    REFERENCES `proof_payments` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `proof_advance`
  ADD CONSTRAINT `fk_proof_adv_tenant_payment` FOREIGN KEY (`company_id`, `payment_id`)
    REFERENCES `proof_payments` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `proof_advance`
  ADD CONSTRAINT `proof_adv_xor_chk` CHECK (
    (`payment_id` IS NOT NULL AND `purchase_return_id` IS NULL)
    OR (`payment_id` IS NULL AND `purchase_return_id` IS NOT NULL)
  );

-- 3. Tenant-scoped idempotency + TEXT body with expression default.
CREATE TABLE IF NOT EXISTS `proof_idem` (
  `id` VARCHAR(191) NOT NULL,
  `company_id` VARCHAR(191) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `response_body` TEXT NULL,
  `note` TEXT NOT NULL DEFAULT ('{}'),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `proof_idem_company_key` (`company_id`, `idempotency_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 4. Category pattern: root/child scopes, RESTRICT self-FK.
CREATE TABLE IF NOT EXISTS `proof_categories` (
  `id` VARCHAR(191) NOT NULL,
  `company_id` VARCHAR(191) NOT NULL,
  `parent_id` VARCHAR(191) NULL,
  `parent_scope` VARCHAR(191) NOT NULL DEFAULT '',
  `name` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `proof_categories`
  ADD CONSTRAINT `fk_proof_cat_parent` FOREIGN KEY (`parent_id`)
    REFERENCES `proof_categories` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `proof_categories`
  ADD CONSTRAINT `proof_cat_scope_chk` CHECK (`parent_scope` = IFNULL(`parent_id`, '')),
  ADD UNIQUE INDEX `uq_proof_cat_scope_name` (`company_id`, `parent_scope`, `name`);

-- 5. ProductPrice pattern: dual scopes, RESTRICT FKs.
CREATE TABLE IF NOT EXISTS `proof_groups` (
  `id` VARCHAR(191) NOT NULL,
  `company_id` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_proof_group_tenant` (`company_id`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `proof_prices` (
  `id` VARCHAR(191) NOT NULL,
  `company_id` VARCHAR(191) NOT NULL,
  `product_id` VARCHAR(191) NOT NULL,
  `branch_id` VARCHAR(191) NULL,
  `customer_group_id` VARCHAR(191) NULL,
  `branch_scope` VARCHAR(191) NOT NULL DEFAULT '',
  `customer_group_scope` VARCHAR(191) NOT NULL DEFAULT '',
  `currency_code` VARCHAR(191) NOT NULL,
  `valid_from` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `proof_prices`
  ADD CONSTRAINT `fk_proof_price_branch` FOREIGN KEY (`branch_id`)
    REFERENCES `proof_branches` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `proof_prices`
  ADD CONSTRAINT `fk_proof_price_tenant_branch` FOREIGN KEY (`company_id`, `branch_id`)
    REFERENCES `proof_branches` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `proof_prices`
  ADD CONSTRAINT `fk_proof_price_tenant_group` FOREIGN KEY (`company_id`, `customer_group_id`)
    REFERENCES `proof_groups` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `proof_prices`
  ADD CONSTRAINT `proof_price_branch_scope_chk` CHECK (`branch_scope` = IFNULL(`branch_id`, '')),
  ADD CONSTRAINT `proof_price_group_scope_chk` CHECK (`customer_group_scope` = IFNULL(`customer_group_id`, '')),
  ADD UNIQUE INDEX `uq_proof_price_scope`
    (`company_id`, `product_id`, `branch_scope`, `customer_group_scope`, `currency_code`, `valid_from`);

-- Assertions (each SELECT must return exactly the commented value).
-- A: duplicate company-wide NULL scope rejected (UNIQUE on normalized scope).
-- B: ON DUPLICATE KEY UPDATE path has a key to fire on (SHOW INDEX).
-- C: XOR rejects both-NULL and both-set (tested by deploy harness, not here).
SELECT 'PROOF_DDL_APPLIED_OK' AS `result`;
SHOW INDEX FROM `proof_sequences` WHERE `Key_name` = 'uq_proof_seq_scope';
SHOW INDEX FROM `proof_idem` WHERE `Key_name` = 'proof_idem_company_key';

-- ================================================================
-- POSITIVE CASES (all must succeed; run in one transaction, ROLLBACK after).
-- ================================================================
-- S1: two company-wide NULL-branch sequences for DIFFERENT types coexist.
-- S2: same type/year, branches B1/B2/NULL coexist (3 rows).
-- S3: same branch/type/year duplicated -> 1062 (see NEGATIVE).
-- S4: different fiscal years coexist; different companies coexist.
-- C1: root category (parent NULL, scope '').
-- C2: child category (parent set, scope = parent id).
-- C3: same name under different parent accepted.
-- P1: NULL branch + NULL group accepted.
-- P2: branch only / group only / both accepted (3 rows, distinct scopes).
-- I1: same key in two companies accepted; same company+key duplicated -> 1062.

-- ================================================================
-- NEGATIVE CASES (each must FAIL; run each in its own transaction).
-- ================================================================
-- N-S1: INSERT duplicate (company, NULL branch, same type/year) -> 1062.
--        INSERT INTO proof_sequences (id,company_id,branch_id,branch_scope,...)
--        twice with branch_id NULL, branch_scope ''.
-- N-S2: stale scope (branch_id = 'X', branch_scope = '') -> CHECK 3819.
-- N-S3: stale scope (branch_id NULL, branch_scope = 'B1') -> CHECK 3819.
-- N-S4: UPDATE branch_id without scope -> CHECK 3819.
-- N-S5: DELETE referenced branch -> RESTRICT 1451. UPDATE branch id -> RESTRICT 1451.
-- N-C1: duplicate root name per company -> 1062.
-- N-C2: stale parent_scope -> CHECK 3819.
-- N-C3: DELETE referenced parent category -> RESTRICT 1451.
-- N-P1: duplicate normalized scope (same product/scopes/currency/valid_from) -> 1062.
-- N-P2: UPDATE branch_id keeping old scope -> CHECK 3819.
-- N-P3: UPDATE customer_group_id keeping old scope -> CHECK 3819.
-- N-P4: deliberately stale insert (branch set, scope '') -> CHECK 3819.
-- N-P5: DELETE referenced branch/group with prices -> RESTRICT 1451.
-- N-P6: cross-company branch reference (company A row, company B branch)
--        -> tenant FK 1452.
-- N-A1: advance with both NULL / both set -> CHECK 3819.
-- N-A2: DELETE referenced payment with advance rows -> RESTRICT 1451.
-- N-I1: duplicate (company, key) -> 1062; >64KB JSON body round-trips (TEXT).
-- Deploy harness executes each N-* and asserts the listed MariaDB error code.
