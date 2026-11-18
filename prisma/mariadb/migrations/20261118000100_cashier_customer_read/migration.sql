-- Cashiers can look up customers at the till.
--
-- The system "cashier" role gained customer.read in the permission catalogue
-- (src/lib/permissions/catalogue.ts), so New Sale's customer search works for
-- a cashier. The catalogue only shapes roles made at onboarding; every company
-- onboarded before keeps a cashier role without it, and system roles cannot be
-- edited in the app. This brings those roles in line.
--
-- Data only, additive and idempotent: it adds one permission to roles named
-- "cashier" that are system roles, and nothing else. customer.create is NOT
-- granted; adding customers stays with roles that already have it. Custom
-- roles, including ones a company named "cashier" itself, are untouched.

-- The permission exists wherever the catalogue was seeded; create it only if a
-- database somehow lacks it, so the grant below never silently does nothing.
INSERT INTO `permissions` (`id`, `code`, `module`, `description`)
SELECT UUID(), 'customer.read', 'customer', 'View customers'
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'customer.read');

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id`
  FROM `roles` r
  JOIN `permissions` p ON p.`code` = 'customer.read'
 WHERE r.`name` = 'cashier'
   AND r.`is_system_role` = true
   AND NOT EXISTS (
     SELECT 1 FROM `role_permissions` rp
      WHERE rp.`role_id` = r.`id` AND rp.`permission_id` = p.`id`
   );
