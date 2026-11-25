-- The documents a CSV import created: one row per sale, purchase, transfer or
-- opening-stock posting, keyed by the grouping key from the file.
--
-- The import of sale, purchase, transfer and opening-stock files used to
-- validate only. They now create real documents, and this table stops the same
-- file (or a retried commit) from creating the same document twice. It also
-- maps the file's reference_no to the number the system generated.
--
-- Structure only: one new table, no change to existing tables or data.

CREATE TABLE `import_job_entities` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `import_job_id` VARCHAR(191) NOT NULL,
    `job_type` VARCHAR(191) NOT NULL,
    `source_key` VARCHAR(191) NOT NULL,
    `entity_type` VARCHAR(191) NOT NULL,
    `entity_id` VARCHAR(191) NOT NULL,
    `reference_no` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `import_job_entities_company_id_job_type_source_key_key`(`company_id`, `job_type`, `source_key`),
    INDEX `import_job_entities_company_id_idx`(`company_id`),
    INDEX `import_job_entities_import_job_id_idx`(`import_job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `import_job_entities` ADD CONSTRAINT `import_job_entities_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `import_job_entities` ADD CONSTRAINT `import_job_entities_import_job_id_fkey` FOREIGN KEY (`import_job_id`) REFERENCES `import_jobs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant key (same as import_job_errors, 20260831180500_tenant_fks): the job
-- a row points at must belong to the same company.
ALTER TABLE `import_job_entities` ADD INDEX `idx_tenant_fk_import_job_entities_importjob` (`company_id`, `import_job_id`);
ALTER TABLE `import_job_entities` ADD CONSTRAINT `fk_tenant_import_job_entities_importjob` FOREIGN KEY (`company_id`, `import_job_id`) REFERENCES `import_jobs` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
