-- Keys for reward_point_confirmations (created by 20261119000100).
--
-- Like every company-owned table: a foreign key from company_id to companies,
-- plain foreign keys for each reference, and each reference to another
-- company-owned row paired with company_id (fk_tenant_*), so a confirmation
-- can never point at another company's customer, user or sale.
--
-- Forward-only. The table is new and holds only short-lived rows, so adding
-- keys does not scan existing business data.

ALTER TABLE `reward_point_confirmations` ADD INDEX `reward_point_confirmations_customer_id_idx` (`customer_id`);
ALTER TABLE `reward_point_confirmations` ADD INDEX `reward_point_confirmations_requested_by_idx` (`requested_by`);

ALTER TABLE `reward_point_confirmations` ADD CONSTRAINT `reward_point_confirmations_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reward_point_confirmations` ADD CONSTRAINT `reward_point_confirmations_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reward_point_confirmations` ADD CONSTRAINT `reward_point_confirmations_requested_by_fkey` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reward_point_confirmations` ADD CONSTRAINT `reward_point_confirmations_consumed_sale_id_fkey` FOREIGN KEY (`consumed_sale_id`) REFERENCES `sales`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `reward_point_confirmations` ADD CONSTRAINT `fk_tenant_reward_point_confirmations_customer` FOREIGN KEY (`company_id`, `customer_id`) REFERENCES `customers` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `reward_point_confirmations` ADD CONSTRAINT `fk_tenant_reward_point_confirmations_requester` FOREIGN KEY (`company_id`, `requested_by`) REFERENCES `users` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `reward_point_confirmations` ADD CONSTRAINT `fk_tenant_reward_point_confirmations_sale` FOREIGN KEY (`company_id`, `consumed_sale_id`) REFERENCES `sales` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
