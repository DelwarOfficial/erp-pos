-- Customer receivables, Phase 3: promises to pay, collection follow-ups and
-- due-date changes (docs/master-plan/ERP_Pos_Blueprint_v4.2.md §5.11A).
--
-- - collection_promises: what a customer promised to pay on a sale, and by
--   when. It never rewrites the installment's contractual due date (the
--   original is copied into original_due_date). Kept / broken is derived from
--   posted collections, so a reversed payment turns a kept promise back.
-- - collection_follow_ups: collection tasks (call, visit, escalate...).
-- - installment_due_date_changes: append-only history of every change to an
--   installment's contractual due date.
--
-- Additive only.
-- CreateTable
CREATE TABLE `collection_promises` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `sale_id` VARCHAR(191) NOT NULL,
    `installment_id` VARCHAR(191) NULL,
    `original_due_date` DATETIME(3) NULL,
    `promised_date` DATETIME(3) NOT NULL,
    `deadline_at` DATETIME(3) NOT NULL,
    `promised_amount` DECIMAL(65, 30) NOT NULL,
    `note` TEXT NULL,
    `recorded_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `cancelled_at` DATETIME(3) NULL,
    `cancelled_by` VARCHAR(191) NULL,
    `cancel_reason` VARCHAR(191) NULL,

    INDEX `collection_promises_company_deadline_idx`(`company_id`, `deadline_at`),
    INDEX `collection_promises_customer_id_idx`(`customer_id`),
    INDEX `collection_promises_sale_id_idx`(`sale_id`),
    INDEX `collection_promises_installment_id_idx`(`installment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `collection_follow_ups` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `sale_id` VARCHAR(191) NULL,
    `installment_id` VARCHAR(191) NULL,
    `promise_id` VARCHAR(191) NULL,
    `follow_up_type` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `assigned_to` VARCHAR(191) NULL,
    `due_at` DATETIME(3) NOT NULL,
    `note` TEXT NULL,
    `outcome_note` TEXT NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closed_at` DATETIME(3) NULL,
    `closed_by` VARCHAR(191) NULL,

    INDEX `collection_follow_ups_company_status_due_idx`(`company_id`, `status`, `due_at`),
    INDEX `collection_follow_ups_customer_id_idx`(`customer_id`),
    INDEX `collection_follow_ups_sale_id_idx`(`sale_id`),
    INDEX `collection_follow_ups_installment_id_idx`(`installment_id`),
    INDEX `collection_follow_ups_promise_id_idx`(`promise_id`),
    INDEX `collection_follow_ups_assigned_to_idx`(`assigned_to`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `installment_due_date_changes` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `installment_id` VARCHAR(191) NOT NULL,
    `sale_id` VARCHAR(191) NOT NULL,
    `old_due_date` DATETIME(3) NOT NULL,
    `new_due_date` DATETIME(3) NOT NULL,
    `reason` TEXT NOT NULL,
    `changed_by` VARCHAR(191) NOT NULL,
    `changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `installment_due_date_changes_company_id_idx`(`company_id`),
    INDEX `installment_due_date_changes_installment_id_idx`(`installment_id`),
    INDEX `installment_due_date_changes_sale_id_idx`(`sale_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `collection_promises` ADD CONSTRAINT `collection_promises_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `collection_promises` ADD CONSTRAINT `collection_promises_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `collection_promises` ADD CONSTRAINT `collection_promises_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `collection_promises` ADD CONSTRAINT `collection_promises_installment_id_fkey` FOREIGN KEY (`installment_id`) REFERENCES `installments`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `collection_promises` ADD CONSTRAINT `collection_promises_recorded_by_fkey` FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `collection_promises` ADD CONSTRAINT `collection_promises_cancelled_by_fkey` FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `collection_follow_ups_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `collection_follow_ups_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `collection_follow_ups_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `collection_follow_ups_installment_id_fkey` FOREIGN KEY (`installment_id`) REFERENCES `installments`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `collection_follow_ups_promise_id_fkey` FOREIGN KEY (`promise_id`) REFERENCES `collection_promises`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `collection_follow_ups_assigned_to_fkey` FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `collection_follow_ups_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `collection_follow_ups_closed_by_fkey` FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `installment_due_date_changes` ADD CONSTRAINT `installment_due_date_changes_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `installment_due_date_changes` ADD CONSTRAINT `installment_due_date_changes_installment_id_fkey` FOREIGN KEY (`installment_id`) REFERENCES `installments`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `installment_due_date_changes` ADD CONSTRAINT `installment_due_date_changes_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `installment_due_date_changes` ADD CONSTRAINT `installment_due_date_changes_changed_by_fkey` FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ── Tenant consistency (as 20260831180500_tenant_fks does for every pair) ──
ALTER TABLE `collection_promises` ADD UNIQUE INDEX `uq_tenant_collection_promises_id` (`company_id`, `id`);
ALTER TABLE `collection_promises` ADD CONSTRAINT `fk_tenant_collection_promises_customer` FOREIGN KEY (`company_id`, `customer_id`) REFERENCES `customers` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `collection_promises` ADD CONSTRAINT `fk_tenant_collection_promises_sale` FOREIGN KEY (`company_id`, `sale_id`) REFERENCES `sales` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `collection_promises` ADD CONSTRAINT `fk_tenant_collection_promises_installment` FOREIGN KEY (`company_id`, `installment_id`) REFERENCES `installments` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `collection_promises` ADD CONSTRAINT `fk_tenant_collection_promises_recorder` FOREIGN KEY (`company_id`, `recorded_by`) REFERENCES `users` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `collection_promises` ADD CONSTRAINT `fk_tenant_collection_promises_canceller` FOREIGN KEY (`company_id`, `cancelled_by`) REFERENCES `users` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `collection_follow_ups` ADD UNIQUE INDEX `uq_tenant_collection_follow_ups_id` (`company_id`, `id`);
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `fk_tenant_collection_follow_ups_customer` FOREIGN KEY (`company_id`, `customer_id`) REFERENCES `customers` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `fk_tenant_collection_follow_ups_sale` FOREIGN KEY (`company_id`, `sale_id`) REFERENCES `sales` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `fk_tenant_collection_follow_ups_installment` FOREIGN KEY (`company_id`, `installment_id`) REFERENCES `installments` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `fk_tenant_collection_follow_ups_promise` FOREIGN KEY (`company_id`, `promise_id`) REFERENCES `collection_promises` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `fk_tenant_collection_follow_ups_assignee` FOREIGN KEY (`company_id`, `assigned_to`) REFERENCES `users` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `fk_tenant_collection_follow_ups_creator` FOREIGN KEY (`company_id`, `created_by`) REFERENCES `users` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `fk_tenant_collection_follow_ups_closer` FOREIGN KEY (`company_id`, `closed_by`) REFERENCES `users` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `installment_due_date_changes` ADD CONSTRAINT `fk_tenant_installment_due_date_changes_installment` FOREIGN KEY (`company_id`, `installment_id`) REFERENCES `installments` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `installment_due_date_changes` ADD CONSTRAINT `fk_tenant_installment_due_date_changes_sale` FOREIGN KEY (`company_id`, `sale_id`) REFERENCES `sales` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `installment_due_date_changes` ADD CONSTRAINT `fk_tenant_installment_due_date_changes_changer` FOREIGN KEY (`company_id`, `changed_by`) REFERENCES `users` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── Invariants ──
ALTER TABLE `collection_promises` ADD CONSTRAINT `collection_promises_amount_positive_chk` CHECK (`promised_amount` > 0);
ALTER TABLE `collection_promises` ADD CONSTRAINT `collection_promises_cancel_chk`
  CHECK ((`cancelled_at` IS NULL AND `cancelled_by` IS NULL) OR (`cancelled_at` IS NOT NULL AND `cancelled_by` IS NOT NULL));
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `collection_follow_ups_type_chk`
  CHECK (`follow_up_type` IN ('call', 'visit', 'send_reminder', 'call_later', 'payment_promised', 'escalate', 'other'));
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `collection_follow_ups_status_chk` CHECK (`status` IN ('open', 'done', 'cancelled'));
ALTER TABLE `collection_follow_ups` ADD CONSTRAINT `collection_follow_ups_closed_chk`
  CHECK ((`status` = 'open' AND `closed_at` IS NULL) OR (`status` <> 'open' AND `closed_at` IS NOT NULL AND `closed_by` IS NOT NULL));
ALTER TABLE `installment_due_date_changes` ADD CONSTRAINT `installment_due_date_changes_differs_chk` CHECK (`old_due_date` <> `new_due_date`);

-- Due-date history is evidence: never edited or removed.
CREATE TRIGGER `trg_installment_due_date_changes_immutable_upd` BEFORE UPDATE ON `installment_due_date_changes`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_installment_due_date_changes_immutable_del` BEFORE DELETE ON `installment_due_date_changes`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;
