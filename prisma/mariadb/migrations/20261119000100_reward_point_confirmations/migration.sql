-- Customer consent for spending reward points.
--
-- Spending points at the till now needs a one-time code texted to the
-- customer's phone on file (src/domain/loyalty/confirmations.ts). One row per
-- request: short-lived, single-use, bound to company, customer, points and the
-- cart, holding only a keyed hash of the code.
--
-- Forward-only and additive: a new table, nothing else changes. Rolling back
-- the application leaves the table unused; it can be dropped afterwards.

CREATE TABLE `reward_point_confirmations` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `points` INTEGER NOT NULL,
    `intent_hash` CHAR(64) NOT NULL,
    `code_hash` CHAR(64) NOT NULL,
    `phone_masked` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expires_at` DATETIME(3) NOT NULL,
    `verified_at` DATETIME(3) NULL,
    `consumed_at` DATETIME(3) NULL,
    `consumed_sale_id` VARCHAR(191) NULL,
    `requested_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `reward_point_confirmations_consumed_sale_id_key`(`consumed_sale_id`),
    INDEX `reward_point_confirmations_company_id_customer_id_idx`(`company_id`, `customer_id`),
    INDEX `reward_point_confirmations_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
