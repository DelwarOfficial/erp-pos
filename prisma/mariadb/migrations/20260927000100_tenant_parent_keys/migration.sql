-- Foreign keys for the three company-owned tables that had none to their company.
--
-- Every other table carrying company_id references companies, and every
-- reference between company-owned tables is paired with a composite
-- (company_id, ...) key (20260831180500_tenant_fks). These three were missed:
--
--   cashier_device_pins      no foreign key at all: a PIN hash could name a
--                            company, user or device that does not exist, or a
--                            user and device of different companies.
--   document_exchange_rates  company_id unchecked.
--   risk_threshold_changes   company_id unchecked (NULL is a global change and
--                            stays allowed). changed_by holds a user id or
--                            'system'/'unknown', so it is not a user reference.
--
-- All three tables are empty in a fresh deployment; on a database that has
-- rows, a row that violates a key makes this migration fail rather than
-- anything being altered.

-- CreateIndex
CREATE INDEX `cashier_device_pins_device_id_idx` ON `cashier_device_pins`(`device_id`);

-- AddForeignKey
ALTER TABLE `cashier_device_pins` ADD CONSTRAINT `cashier_device_pins_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cashier_device_pins` ADD CONSTRAINT `cashier_device_pins_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cashier_device_pins` ADD CONSTRAINT `cashier_device_pins_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_exchange_rates` ADD CONSTRAINT `document_exchange_rates_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `risk_threshold_changes` ADD CONSTRAINT `risk_threshold_changes_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant consistency, as 20260831180500_tenant_fks does for every other pair:
-- the user and the device must belong to the PIN's company.
ALTER TABLE `cashier_device_pins` ADD CONSTRAINT `fk_tenant_cashier_device_pins_user` FOREIGN KEY (`company_id`, `user_id`) REFERENCES `users` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `cashier_device_pins` ADD CONSTRAINT `fk_tenant_cashier_device_pins_device` FOREIGN KEY (`company_id`, `device_id`) REFERENCES `devices` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
