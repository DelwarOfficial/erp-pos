-- Customer receivables and due reminders, Phase 1
-- (docs/master-plan/ERP_Pos_Blueprint_v4.2.md §5.11A, docs/adr/0008-due-reminders.md).
--
-- - sales.due_reminders_enabled: whether this sale's installments are reminded.
-- - reminder_policies: one per company; when and how often reminders go out.
-- - reminder_occurrences: one reminder stage of one installment for one due
--   date. Its unique key is the idempotency identity of an automatic
--   reminder: scheduler reruns and concurrent schedulers insert it once.
-- - outbound_messages (already in the schema, unused until now) becomes the
--   message record: linked to its customer/sale/installment/occurrence, with
--   at most one message per occurrence, and TEXT bodies (a Bangla reminder does
--   not fit VARCHAR(191)).
--
-- Additive only. No existing row changes meaning.

-- AlterTable
ALTER TABLE `sales` ADD COLUMN `due_reminders_enabled` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `outbound_messages` ADD COLUMN `claimed_at` DATETIME(3) NULL,
    ADD COLUMN `created_by` VARCHAR(191) NULL,
    ADD COLUMN `customer_id` VARCHAR(191) NULL,
    ADD COLUMN `delivered_at` DATETIME(3) NULL,
    ADD COLUMN `encoding` VARCHAR(191) NULL,
    ADD COLUMN `failure_category` VARCHAR(191) NULL,
    ADD COLUMN `installment_id` VARCHAR(191) NULL,
    ADD COLUMN `locale` VARCHAR(191) NULL,
    ADD COLUMN `provider_status` VARCHAR(191) NULL,
    ADD COLUMN `reminder_occurrence_id` VARCHAR(191) NULL,
    ADD COLUMN `sale_id` VARCHAR(191) NULL,
    ADD COLUMN `segments` INTEGER NULL,
    ADD COLUMN `sent_at` DATETIME(3) NULL,
    ADD COLUMN `trigger_source` VARCHAR(191) NOT NULL DEFAULT 'manual',
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY `destination_encrypted` TEXT NOT NULL,
    MODIFY `rendered_body` TEXT NOT NULL;

-- CreateTable
CREATE TABLE `reminder_policies` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `stage_offsets` VARCHAR(191) NOT NULL DEFAULT '[-3,-1,0,1,3,7]',
    `send_window_start_minute` INTEGER NOT NULL DEFAULT 540,
    `send_window_end_minute` INTEGER NOT NULL DEFAULT 1200,
    `min_outstanding` DECIMAL(65, 30) NOT NULL DEFAULT 1,
    `max_per_customer_per_day` INTEGER NOT NULL DEFAULT 1,
    `daily_company_limit` INTEGER NOT NULL DEFAULT 500,
    `locale` VARCHAR(191) NOT NULL DEFAULT 'bn',
    `updated_by` VARCHAR(191) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `reminder_policies_company_id_key`(`company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reminder_occurrences` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `installment_id` VARCHAR(191) NOT NULL,
    `sale_id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `stage_offset_days` INTEGER NOT NULL,
    `due_date` DATETIME(3) NOT NULL,
    `scheduled_for` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `skip_reason` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `reminder_occurrences_company_status_scheduled_idx`(`company_id`, `status`, `scheduled_for`),
    INDEX `reminder_occurrences_installment_id_idx`(`installment_id`),
    INDEX `reminder_occurrences_sale_id_idx`(`sale_id`),
    INDEX `reminder_occurrences_customer_id_idx`(`customer_id`),
    UNIQUE INDEX `uq_reminder_occurrence_stage`(`company_id`, `installment_id`, `stage_offset_days`, `due_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `outbound_messages_reminder_occurrence_id_key` ON `outbound_messages`(`reminder_occurrence_id`);

-- CreateIndex
CREATE INDEX `outbound_messages_company_status_next_idx` ON `outbound_messages`(`company_id`, `status`, `next_attempt_at`);

-- CreateIndex
CREATE INDEX `outbound_messages_company_customer_created_idx` ON `outbound_messages`(`company_id`, `customer_id`, `created_at`);

-- CreateIndex
CREATE INDEX `outbound_messages_sale_id_idx` ON `outbound_messages`(`sale_id`);

-- CreateIndex
CREATE INDEX `outbound_messages_installment_id_idx` ON `outbound_messages`(`installment_id`);

-- AddForeignKey
ALTER TABLE `outbound_messages` ADD CONSTRAINT `outbound_messages_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `outbound_messages` ADD CONSTRAINT `outbound_messages_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `outbound_messages` ADD CONSTRAINT `outbound_messages_installment_id_fkey` FOREIGN KEY (`installment_id`) REFERENCES `installments`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `outbound_messages` ADD CONSTRAINT `outbound_messages_reminder_occurrence_id_fkey` FOREIGN KEY (`reminder_occurrence_id`) REFERENCES `reminder_occurrences`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `reminder_policies` ADD CONSTRAINT `reminder_policies_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reminder_occurrences` ADD CONSTRAINT `reminder_occurrences_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reminder_occurrences` ADD CONSTRAINT `reminder_occurrences_installment_id_fkey` FOREIGN KEY (`installment_id`) REFERENCES `installments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reminder_occurrences` ADD CONSTRAINT `reminder_occurrences_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reminder_occurrences` ADD CONSTRAINT `reminder_occurrences_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Tenant consistency (as 20260831180500_tenant_fks does for every pair) ──
ALTER TABLE `reminder_occurrences` ADD UNIQUE INDEX `uq_tenant_reminder_occurrences_id` (`company_id`, `id`);
ALTER TABLE `reminder_occurrences` ADD CONSTRAINT `fk_tenant_reminder_occurrences_installment` FOREIGN KEY (`company_id`, `installment_id`) REFERENCES `installments` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `reminder_occurrences` ADD CONSTRAINT `fk_tenant_reminder_occurrences_sale` FOREIGN KEY (`company_id`, `sale_id`) REFERENCES `sales` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `reminder_occurrences` ADD CONSTRAINT `fk_tenant_reminder_occurrences_customer` FOREIGN KEY (`company_id`, `customer_id`) REFERENCES `customers` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `outbound_messages` ADD CONSTRAINT `fk_tenant_outbound_messages_customer` FOREIGN KEY (`company_id`, `customer_id`) REFERENCES `customers` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `outbound_messages` ADD CONSTRAINT `fk_tenant_outbound_messages_sale` FOREIGN KEY (`company_id`, `sale_id`) REFERENCES `sales` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `outbound_messages` ADD CONSTRAINT `fk_tenant_outbound_messages_installment` FOREIGN KEY (`company_id`, `installment_id`) REFERENCES `installments` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `outbound_messages` ADD CONSTRAINT `fk_tenant_outbound_messages_occurrence` FOREIGN KEY (`company_id`, `reminder_occurrence_id`) REFERENCES `reminder_occurrences` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── Invariants ──
ALTER TABLE `installments` ADD CONSTRAINT `installments_amount_positive_chk` CHECK (`amount` > 0);
ALTER TABLE `installments` ADD CONSTRAINT `installments_number_positive_chk` CHECK (`installment_no` > 0);
ALTER TABLE `installments` ADD CONSTRAINT `installments_status_chk` CHECK (`status` IN ('scheduled', 'cancelled'));
ALTER TABLE `installment_allocations` ADD CONSTRAINT `installment_allocations_amount_positive_chk` CHECK (`allocated_amount` > 0);
ALTER TABLE `reminder_occurrences` ADD CONSTRAINT `reminder_occurrences_status_chk` CHECK (`status` IN ('pending', 'messaged', 'skipped', 'cancelled'));
ALTER TABLE `reminder_policies` ADD CONSTRAINT `reminder_policies_window_chk`
  CHECK (`send_window_start_minute` BETWEEN 0 AND 1439 AND `send_window_end_minute` BETWEEN 1 AND 1440 AND `send_window_start_minute` < `send_window_end_minute`);
ALTER TABLE `reminder_policies` ADD CONSTRAINT `reminder_policies_limits_chk`
  CHECK (`max_per_customer_per_day` >= 1 AND `daily_company_limit` >= 0 AND `min_outstanding` >= 0);
ALTER TABLE `outbound_messages` ADD CONSTRAINT `outbound_messages_status_chk`
  CHECK (`status` IN ('queued', 'sending', 'sent', 'delivered', 'failed', 'unknown', 'skipped', 'cancelled', 'dead_letter'));
ALTER TABLE `outbound_messages` ADD CONSTRAINT `outbound_messages_trigger_chk` CHECK (`trigger_source` IN ('reminder', 'manual', 'bulk'));
-- A reminder message always names the installment it is about.
ALTER TABLE `outbound_messages` ADD CONSTRAINT `outbound_messages_reminder_link_chk`
  CHECK (`reminder_occurrence_id` IS NULL OR (`installment_id` IS NOT NULL AND `trigger_source` = 'reminder'));
