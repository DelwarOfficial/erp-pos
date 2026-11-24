-- Large refunds (red-team workstream 1) need a manager's approval: once a
-- sale's return credit or cash refunds reach refund_approval_threshold, the
-- user posting it must present an approved "large_refund" request.
--
-- The system roles lacked the permissions this needs:
--   cashier         approval.request + approval.read, so the cashier who
--                   posts the return can ask for approval;
--   branch_manager  approval.read, so the manager who approves
--   accountant      (approval.resolve) can see the pending requests.
-- The catalogue (src/lib/permissions/catalogue.ts) gained the same grants for
-- companies onboarded from now on; this brings existing system roles in line.
--
-- Data only, additive and idempotent. Only system roles with these exact names
-- change; custom roles are untouched. No role gains approval.resolve.

INSERT INTO `permissions` (`id`, `code`, `module`, `description`)
SELECT UUID(), 'approval.read', 'approval', 'View approval requests'
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'approval.read');

INSERT INTO `permissions` (`id`, `code`, `module`, `description`)
SELECT UUID(), 'approval.request', 'approval', 'Request approval for a business operation'
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'approval.request');

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id`
  FROM `roles` r
  JOIN `permissions` p ON p.`code` IN ('approval.request', 'approval.read')
 WHERE r.`name` = 'cashier'
   AND r.`is_system_role` = true
   AND NOT EXISTS (
     SELECT 1 FROM `role_permissions` rp
      WHERE rp.`role_id` = r.`id` AND rp.`permission_id` = p.`id`
   );

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id`
  FROM `roles` r
  JOIN `permissions` p ON p.`code` = 'approval.read'
 WHERE r.`name` IN ('branch_manager', 'accountant')
   AND r.`is_system_role` = true
   AND NOT EXISTS (
     SELECT 1 FROM `role_permissions` rp
      WHERE rp.`role_id` = r.`id` AND rp.`permission_id` = p.`id`
   );
