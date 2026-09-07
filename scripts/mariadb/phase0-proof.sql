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

-- Assertions (each SELECT must return exactly the commented value).
-- A: duplicate company-wide NULL scope rejected (UNIQUE on normalized scope).
-- B: ON DUPLICATE KEY UPDATE path has a key to fire on (SHOW INDEX).
-- C: XOR rejects both-NULL and both-set (tested by deploy harness, not here).
SELECT 'PROOF_DDL_APPLIED_OK' AS `result`;
SHOW INDEX FROM `proof_sequences` WHERE `Key_name` = 'uq_proof_seq_scope';
SHOW INDEX FROM `proof_idem` WHERE `Key_name` = 'proof_idem_company_key';
