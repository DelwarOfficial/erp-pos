-- F-27 / F-28 (docs/audits/2026-09-21-full-bug-hunt.md): a cashier shift's
-- counted cash variance is posted to the general ledger, against a cash
-- over/short expense account named in the accounting policy.
--
-- Additive. For each company that already has an accounting policy, the
-- account 5600 "Cash Over/Short" is created if that code is free, and linked.
-- A company whose code 5600 is already used for something else is left
-- unlinked; closing a shift with a variance then asks for the account to be
-- set in the accounting policy.

-- AlterTable
ALTER TABLE `accounting_policies` ADD COLUMN `cash_over_short_account_id` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `accounting_policies` ADD CONSTRAINT `accounting_policies_cash_over_short_account_id_fkey` FOREIGN KEY (`cash_over_short_account_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Tenant consistency, as 20260831180500_tenant_fks does for every policy account.
ALTER TABLE `accounting_policies` ADD INDEX `idx_tenant_fk_accounting_policies_cashovershort` (`company_id`, `cash_over_short_account_id`);
ALTER TABLE `accounting_policies` ADD CONSTRAINT `fk_tenant_accounting_policies_cashovershort` FOREIGN KEY (`company_id`, `cash_over_short_account_id`) REFERENCES `chart_of_accounts` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Backfill for existing companies.
INSERT INTO `chart_of_accounts` (`id`, `company_id`, `code`, `name`, `account_class`, `account_subtype`, `normal_balance`, `allow_manual_posting`, `is_control_account`, `is_active`)
SELECT UUID(), p.`company_id`, '5600', 'Cash Over/Short', 'expense', 'cash_over_short', 'D', false, false, true
  FROM `accounting_policies` p
 WHERE NOT EXISTS (SELECT 1 FROM `chart_of_accounts` c WHERE c.`company_id` = p.`company_id` AND c.`code` = '5600');

UPDATE `accounting_policies` p
  JOIN `chart_of_accounts` c ON c.`company_id` = p.`company_id` AND c.`code` = '5600' AND c.`account_subtype` = 'cash_over_short'
   SET p.`cash_over_short_account_id` = c.`id`
 WHERE p.`cash_over_short_account_id` IS NULL;
