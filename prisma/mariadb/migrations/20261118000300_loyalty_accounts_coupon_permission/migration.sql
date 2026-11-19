-- Reward points and coupons go live.
--
-- Reward points are a liability from the moment they are earned (the customer
-- can spend them as money) until they are spent or lapse, and an expense to
-- the business. Each company gets:
--   2500 Reward Points Liability  (liability, subtype reward_points_liability)
--   5700 Reward Points Expense    (expense,   subtype reward_expense)
-- created only where that code is free, and the expense account linked as the
-- accounting policy's reward expense account when none is set. A company
-- whose 2500 or 5700 is already used for something else is left alone; the
-- app then asks for an account of that subtype before points are earned.
--
-- coupon.manage lets a role create and switch off coupons. It is granted to
-- every role that can already issue gift cards (the same loyalty duties).
--
-- Data only, additive and idempotent.

INSERT INTO `chart_of_accounts` (`id`, `company_id`, `code`, `name`, `account_class`, `account_subtype`, `normal_balance`, `allow_manual_posting`, `is_control_account`, `is_active`)
SELECT UUID(), p.`company_id`, '2500', 'Reward Points Liability', 'liability', 'reward_points_liability', 'C', false, false, true
  FROM `accounting_policies` p
 WHERE NOT EXISTS (SELECT 1 FROM `chart_of_accounts` c WHERE c.`company_id` = p.`company_id` AND c.`code` = '2500');

INSERT INTO `chart_of_accounts` (`id`, `company_id`, `code`, `name`, `account_class`, `account_subtype`, `normal_balance`, `allow_manual_posting`, `is_control_account`, `is_active`)
SELECT UUID(), p.`company_id`, '5700', 'Reward Points Expense', 'expense', 'reward_expense', 'D', false, false, true
  FROM `accounting_policies` p
 WHERE NOT EXISTS (SELECT 1 FROM `chart_of_accounts` c WHERE c.`company_id` = p.`company_id` AND c.`code` = '5700');

UPDATE `accounting_policies` p
  JOIN `chart_of_accounts` c ON c.`company_id` = p.`company_id` AND c.`code` = '5700' AND c.`account_subtype` = 'reward_expense'
   SET p.`reward_expense_account_id` = c.`id`
 WHERE p.`reward_expense_account_id` IS NULL;

INSERT INTO `permissions` (`id`, `code`, `module`, `description`)
SELECT UUID(), 'coupon.manage', 'loyalty', 'Create and switch off coupons'
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'coupon.manage');

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT DISTINCT rp.`role_id`, c.`id`
  FROM `role_permissions` rp
  JOIN `permissions` g ON g.`id` = rp.`permission_id` AND g.`code` = 'gift_card.issue'
  JOIN `permissions` c ON c.`code` = 'coupon.manage'
 WHERE NOT EXISTS (SELECT 1 FROM `role_permissions` x WHERE x.`role_id` = rp.`role_id` AND x.`permission_id` = c.`id`);
