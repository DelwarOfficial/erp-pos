-- Cashiers and branch managers can collect customer dues.
--
-- The permission catalogue (src/lib/permissions/catalogue.ts) gave these to
-- the system roles so that "Collect Payment" works at the till:
--
--   cashier:        payment.read, inventory.read, customer.credit.view.branch,
--                   collection.view.branch
--   branch_manager: payment.read, payment.allocate, customer.credit.view.branch
--
-- (payment.allocate is what the collection route accepts for applying a
-- customer's payment to their dues; payment.pay.branch, which also pays money
-- out, is not granted.) The catalogue only shapes roles made at onboarding, and
-- system roles cannot be edited in the app, so companies onboarded earlier
-- still lack them. This brings those roles in line.
--
-- Data only, additive and idempotent: each grant is added only where missing,
-- only to system roles with exactly these names. Custom roles are untouched.
-- Permission rows are created only if a database somehow lacks them, so no
-- grant silently does nothing.

INSERT INTO `permissions` (`id`, `code`, `module`, `description`)
SELECT UUID(), want.`code`, want.`module`, want.`description`
  FROM (
    SELECT 'payment.read' AS `code`, 'payment' AS `module`, 'View payments and accounts' AS `description`
    UNION ALL SELECT 'inventory.read', 'inventory', 'View stock'
    UNION ALL SELECT 'customer.credit.view.branch', 'party', 'View customer credit limit and AR exposure'
    UNION ALL SELECT 'collection.view.branch', 'collection', 'View dues, the collection worklist, customer collection history and SMS history'
    UNION ALL SELECT 'payment.allocate', 'payment', 'Allocate payments to invoices'
  ) want
 WHERE NOT EXISTS (SELECT 1 FROM `permissions` p WHERE p.`code` = want.`code`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id`
  FROM (
    SELECT 'cashier' AS `role_name`, 'payment.read' AS `code`
    UNION ALL SELECT 'cashier', 'inventory.read'
    UNION ALL SELECT 'cashier', 'customer.credit.view.branch'
    UNION ALL SELECT 'cashier', 'collection.view.branch'
    UNION ALL SELECT 'branch_manager', 'payment.read'
    UNION ALL SELECT 'branch_manager', 'payment.allocate'
    UNION ALL SELECT 'branch_manager', 'customer.credit.view.branch'
  ) grantee
  JOIN `roles` r ON r.`name` = grantee.`role_name` AND r.`is_system_role` = true
  JOIN `permissions` p ON p.`code` = grantee.`code`
 WHERE NOT EXISTS (
   SELECT 1 FROM `role_permissions` rp WHERE rp.`role_id` = r.`id` AND rp.`permission_id` = p.`id`
 );
