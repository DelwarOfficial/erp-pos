-- CreateTable
CREATE TABLE `currencies` (
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `decimal_places` INTEGER NOT NULL DEFAULT 2,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `companies` (
    `id` VARCHAR(191) NOT NULL,
    `legal_name` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `base_currency_code` VARCHAR(191) NOT NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'Asia/Dhaka',
    `country_code` VARCHAR(191) NOT NULL DEFAULT 'BD',
    `bin` VARCHAR(191) NULL,
    `tin` VARCHAR(191) NULL,
    `vat_registered` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `default_locale` VARCHAR(191) NOT NULL DEFAULT 'bn-BD',
    `date_format` VARCHAR(191) NOT NULL DEFAULT 'dd MMM yyyy',
    `fiscal_year_start_month` INTEGER NOT NULL DEFAULT 7,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `companies_code_key`(`code`),
    UNIQUE INDEX `companies_bin_key`(`bin`),
    UNIQUE INDEX `companies_tin_key`(`tin`),
    INDEX `companies_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `branches` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `bin_override` VARCHAR(191) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `branches_company_id_is_active_idx`(`company_id`, `is_active`),
    UNIQUE INDEX `branches_company_id_code_key`(`company_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `warehouses` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `warehouse_type` VARCHAR(191) NOT NULL DEFAULT 'retail',
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `warehouses_company_id_idx`(`company_id`),
    INDEX `warehouses_branch_id_idx`(`branch_id`),
    INDEX `warehouses_warehouse_type_idx`(`warehouse_type`),
    UNIQUE INDEX `warehouses_company_id_code_key`(`company_id`, `code`),
    UNIQUE INDEX `warehouses_company_id_branch_id_name_key`(`company_id`, `branch_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exchange_rates` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `currency_code` VARCHAR(191) NOT NULL,
    `rate_date` DATETIME(3) NOT NULL,
    `rate_to_base` DECIMAL(65, 30) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `approved_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `exchange_rates_company_id_idx`(`company_id`),
    INDEX `exchange_rates_currency_code_idx`(`currency_code`),
    UNIQUE INDEX `exchange_rates_company_id_currency_code_rate_date_key`(`company_id`, `currency_code`, `rate_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_domains` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `hostname` VARCHAR(191) NOT NULL,
    `domain_type` VARCHAR(191) NOT NULL DEFAULT 'platform_subdomain',
    `verification_token_hash` VARCHAR(191) NULL,
    `verified_at` DATETIME(3) NULL,
    `tls_status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `company_domains_hostname_key`(`hostname`),
    INDEX `company_domains_company_id_idx`(`company_id`),
    INDEX `company_domains_domain_type_idx`(`domain_type`),
    INDEX `company_domains_tls_status_idx`(`tls_status`),
    INDEX `company_domains_is_primary_idx`(`is_primary`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `password_hash` VARCHAR(191) NOT NULL,
    `primary_branch_id` VARCHAR(191) NULL,
    `access_scope` VARCHAR(191) NOT NULL DEFAULT 'single_branch',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `mfa_enabled` BOOLEAN NOT NULL DEFAULT false,
    `mfa_secret_ciphertext` LONGBLOB NULL,
    `failed_login_count` INTEGER NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `password_changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_login_at` DATETIME(3) NULL,
    `last_login_ip` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `users_company_id_idx`(`company_id`),
    INDEX `users_phone_idx`(`phone`),
    INDEX `users_primary_branch_id_idx`(`primary_branch_id`),
    INDEX `users_access_scope_idx`(`access_scope`),
    INDEX `users_is_active_idx`(`is_active`),
    INDEX `users_locked_until_idx`(`locked_until`),
    INDEX `users_deleted_at_idx`(`deleted_at`),
    UNIQUE INDEX `users_company_id_email_key`(`company_id`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `is_system_role` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `roles_company_id_idx`(`company_id`),
    UNIQUE INDEX `roles_company_id_name_key`(`company_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `module` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `permissions_code_key`(`code`),
    INDEX `permissions_module_idx`(`module`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `role_id` VARCHAR(191) NOT NULL,
    `permission_id` VARCHAR(191) NOT NULL,

    INDEX `role_permissions_permission_id_idx`(`permission_id`),
    PRIMARY KEY (`role_id`, `permission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `user_id` VARCHAR(191) NOT NULL,
    `role_id` VARCHAR(191) NOT NULL,

    INDEX `user_roles_role_id_idx`(`role_id`),
    PRIMARY KEY (`user_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_branch_access` (
    `user_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,

    INDEX `user_branch_access_branch_id_idx`(`branch_id`),
    PRIMARY KEY (`user_id`, `branch_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `devices` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `device_public_key` VARCHAR(191) NOT NULL,
    `registered_by` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `app_version` VARCHAR(191) NULL,
    `last_seen_at` DATETIME(3) NULL,
    `last_bootstrap_at` DATETIME(3) NULL,
    `last_recovery_epoch` INTEGER NOT NULL DEFAULT 0,
    `schema_version` VARCHAR(191) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `devices_device_public_key_key`(`device_public_key`),
    INDEX `devices_company_id_idx`(`company_id`),
    INDEX `devices_branch_id_idx`(`branch_id`),
    INDEX `devices_status_idx`(`status`),
    INDEX `devices_last_seen_at_idx`(`last_seen_at`),
    UNIQUE INDEX `devices_company_id_branch_id_label_key`(`company_id`, `branch_id`, `label`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `token_hash` VARCHAR(191) NOT NULL,
    `family_id` VARCHAR(191) NOT NULL,
    `device_id` VARCHAR(191) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `rotated_from_id` VARCHAR(191) NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoke_reason` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_company_id_idx`(`company_id`),
    INDEX `refresh_tokens_user_id_idx`(`user_id`),
    INDEX `refresh_tokens_family_id_idx`(`family_id`),
    INDEX `refresh_tokens_device_id_idx`(`device_id`),
    INDEX `refresh_tokens_expires_at_idx`(`expires_at`),
    INDEX `refresh_tokens_revoked_at_idx`(`revoked_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `security_events` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `device_id` VARCHAR(191) NULL,
    `event_type` VARCHAR(191) NOT NULL,
    `severity` VARCHAR(191) NOT NULL DEFAULT 'info',
    `ip_address` VARCHAR(191) NULL,
    `user_agent` VARCHAR(191) NULL,
    `metadata` VARCHAR(191) NOT NULL DEFAULT '{}',
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `security_events_company_id_idx`(`company_id`),
    INDEX `security_events_user_id_idx`(`user_id`),
    INDEX `security_events_device_id_idx`(`device_id`),
    INDEX `security_events_event_type_idx`(`event_type`),
    INDEX `security_events_severity_idx`(`severity`),
    INDEX `security_events_occurred_at_idx`(`occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cashier_device_pins` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `device_id` VARCHAR(191) NOT NULL,
    `pin_hash` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,

    INDEX `cashier_device_pins_company_id_idx`(`company_id`),
    UNIQUE INDEX `cashier_device_pins_user_id_device_id_key`(`user_id`, `device_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webauthn_credentials` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `credential_id` VARCHAR(191) NOT NULL,
    `public_key` LONGBLOB NOT NULL,
    `counter` INTEGER NOT NULL DEFAULT 0,
    `device_type` VARCHAR(191) NULL,
    `backed_up` BOOLEAN NOT NULL DEFAULT false,
    `transports` VARCHAR(191) NOT NULL DEFAULT '[]',
    `name` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_used_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `webauthn_credentials_credential_id_key`(`credential_id`),
    INDEX `webauthn_credentials_company_id_idx`(`company_id`),
    INDEX `webauthn_credentials_user_id_idx`(`user_id`),
    INDEX `webauthn_credentials_revoked_at_idx`(`revoked_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webauthn_challenges` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `challenge` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `webauthn_challenges_company_id_idx`(`company_id`),
    INDEX `webauthn_challenges_user_id_idx`(`user_id`),
    INDEX `webauthn_challenges_expires_at_idx`(`expires_at`),
    INDEX `webauthn_challenges_consumed_at_idx`(`consumed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_sequences` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NULL,
    `document_type` VARCHAR(191) NOT NULL,
    `fiscal_year` INTEGER NOT NULL,
    `prefix` VARCHAR(191) NOT NULL,
    `next_number` BIGINT NOT NULL DEFAULT 1,
    `padding` INTEGER NOT NULL DEFAULT 6,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `document_sequences_company_id_document_type_fiscal_year_idx`(`company_id`, `document_type`, `fiscal_year`),
    INDEX `document_sequences_company_id_branch_id_document_type_fiscal_idx`(`company_id`, `branch_id`, `document_type`, `fiscal_year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_number_leases` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `device_id` VARCHAR(191) NOT NULL,
    `document_type` VARCHAR(191) NOT NULL,
    `prefix` VARCHAR(191) NOT NULL,
    `range_start` BIGINT NOT NULL,
    `range_end` BIGINT NOT NULL,
    `next_number` BIGINT NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',

    INDEX `document_number_leases_company_id_document_type_prefix_idx`(`company_id`, `document_type`, `prefix`),
    INDEX `document_number_leases_branch_id_idx`(`branch_id`),
    INDEX `document_number_leases_device_id_idx`(`device_id`),
    INDEX `document_number_leases_expires_at_idx`(`expires_at`),
    INDEX `document_number_leases_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idempotency_requests` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `device_id` VARCHAR(191) NULL,
    `idempotency_key` VARCHAR(191) NOT NULL,
    `operation` VARCHAR(191) NOT NULL,
    `request_hash` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'processing',
    `resource_type` VARCHAR(191) NULL,
    `resource_id` VARCHAR(191) NULL,
    `response_status` INTEGER NULL,
    `response_body` VARCHAR(191) NULL,
    `locked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `idempotency_requests_idempotency_key_key`(`idempotency_key`),
    INDEX `idempotency_requests_company_id_idx`(`company_id`),
    INDEX `idempotency_requests_user_id_idx`(`user_id`),
    INDEX `idempotency_requests_device_id_idx`(`device_id`),
    INDEX `idempotency_requests_operation_idx`(`operation`),
    INDEX `idempotency_requests_status_idx`(`status`),
    INDEX `idempotency_requests_resource_id_idx`(`resource_id`),
    INDEX `idempotency_requests_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `business_events` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `event_type` VARCHAR(191) NOT NULL,
    `source_type` VARCHAR(191) NOT NULL,
    `source_id` VARCHAR(191) NOT NULL,
    `correlation_id` VARCHAR(191) NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `business_events_company_id_idx`(`company_id`),
    INDEX `business_events_event_type_idx`(`event_type`),
    INDEX `business_events_source_type_source_id_idx`(`source_type`, `source_id`),
    INDEX `business_events_correlation_id_idx`(`correlation_id`),
    INDEX `business_events_occurred_at_idx`(`occurred_at`),
    UNIQUE INDEX `business_events_company_id_event_type_source_type_source_id_key`(`company_id`, `event_type`, `source_type`, `source_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_exchange_rates` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `currency_code` VARCHAR(191) NOT NULL,
    `rate_to_base` DECIMAL(65, 30) NOT NULL,
    `rate_date` DATETIME(3) NOT NULL,

    INDEX `document_exchange_rates_company_id_idx`(`company_id`),
    INDEX `document_exchange_rates_currency_code_idx`(`currency_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `device_id` VARCHAR(191) NULL,
    `correlation_id` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `entity_type` VARCHAR(191) NOT NULL,
    `entity_id` VARCHAR(191) NOT NULL,
    `before_value` VARCHAR(191) NULL,
    `after_value` VARCHAR(191) NULL,
    `client_ip` VARCHAR(191) NULL,
    `sync_ip` VARCHAR(191) NULL,
    `user_agent` VARCHAR(191) NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_company_id_idx`(`company_id`),
    INDEX `audit_logs_user_id_idx`(`user_id`),
    INDEX `audit_logs_device_id_idx`(`device_id`),
    INDEX `audit_logs_correlation_id_idx`(`correlation_id`),
    INDEX `audit_logs_action_idx`(`action`),
    INDEX `audit_logs_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    INDEX `audit_logs_occurred_at_idx`(`occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_requests` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NULL,
    `request_type` VARCHAR(191) NOT NULL,
    `reference_type` VARCHAR(191) NOT NULL,
    `reference_id` VARCHAR(191) NOT NULL,
    `requested_by` VARCHAR(191) NOT NULL,
    `approved_by` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `reason` VARCHAR(191) NOT NULL,
    `payload` VARCHAR(191) NOT NULL DEFAULT '{}',
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolved_at` DATETIME(3) NULL,
    `waived_by` VARCHAR(191) NULL,
    `waiver_reason` VARCHAR(191) NULL,

    INDEX `approval_requests_company_id_idx`(`company_id`),
    INDEX `approval_requests_branch_id_idx`(`branch_id`),
    INDEX `approval_requests_request_type_idx`(`request_type`),
    INDEX `approval_requests_reference_type_reference_id_idx`(`reference_type`, `reference_id`),
    INDEX `approval_requests_requested_by_idx`(`requested_by`),
    INDEX `approval_requests_approved_by_idx`(`approved_by`),
    INDEX `approval_requests_status_idx`(`status`),
    INDEX `approval_requests_requested_at_idx`(`requested_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `statutory_documents` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `document_type` VARCHAR(191) NOT NULL,
    `document_no` VARCHAR(191) NOT NULL,
    `source_type` VARCHAR(191) NOT NULL,
    `source_id` VARCHAR(191) NOT NULL,
    `issue_date` DATETIME(3) NOT NULL,
    `tax_period_start` DATETIME(3) NULL,
    `tax_period_end` DATETIME(3) NULL,
    `payload_snapshot` VARCHAR(191) NOT NULL DEFAULT '{}',
    `object_key` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `replacement_of_id` VARCHAR(191) NULL,
    `issued_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `statutory_documents_company_id_idx`(`company_id`),
    INDEX `statutory_documents_branch_id_idx`(`branch_id`),
    INDEX `statutory_documents_document_type_idx`(`document_type`),
    INDEX `statutory_documents_source_type_source_id_idx`(`source_type`, `source_id`),
    INDEX `statutory_documents_issue_date_idx`(`issue_date`),
    INDEX `statutory_documents_status_idx`(`status`),
    UNIQUE INDEX `statutory_documents_company_id_document_type_document_no_key`(`company_id`, `document_type`, `document_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tax_return_periods` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `period_start` DATETIME(3) NOT NULL,
    `period_end` DATETIME(3) NOT NULL,
    `return_type` VARCHAR(191) NOT NULL DEFAULT 'VAT_9_1',
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `prepared_document_id` VARCHAR(191) NULL,
    `filed_at` DATETIME(3) NULL,
    `filed_reference` VARCHAR(191) NULL,

    INDEX `tax_return_periods_company_id_idx`(`company_id`),
    INDEX `tax_return_periods_status_idx`(`status`),
    UNIQUE INDEX `tax_return_periods_company_id_return_type_period_start_perio_key`(`company_id`, `return_type`, `period_start`, `period_end`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reconciliation_runs` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `run_type` VARCHAR(191) NOT NULL DEFAULT 'nightly',
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'running',
    `initiated_by` VARCHAR(191) NULL,
    `summary` VARCHAR(191) NOT NULL DEFAULT '{}',

    INDEX `reconciliation_runs_company_id_idx`(`company_id`),
    INDEX `reconciliation_runs_run_type_idx`(`run_type`),
    INDEX `reconciliation_runs_started_at_idx`(`started_at`),
    INDEX `reconciliation_runs_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reconciliation_findings` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `reconciliation_run_id` VARCHAR(191) NOT NULL,
    `check_code` VARCHAR(191) NOT NULL,
    `severity` VARCHAR(191) NOT NULL DEFAULT 'info',
    `branch_id` VARCHAR(191) NULL,
    `reference_type` VARCHAR(191) NULL,
    `reference_id` VARCHAR(191) NULL,
    `expected_value` DECIMAL(65, 30) NULL,
    `actual_value` DECIMAL(65, 30) NULL,
    `variance` DECIMAL(65, 30) NULL,
    `details` VARCHAR(191) NOT NULL DEFAULT '{}',
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `resolved_by` VARCHAR(191) NULL,
    `resolved_at` DATETIME(3) NULL,

    INDEX `reconciliation_findings_company_id_idx`(`company_id`),
    INDEX `reconciliation_findings_reconciliation_run_id_idx`(`reconciliation_run_id`),
    INDEX `reconciliation_findings_check_code_idx`(`check_code`),
    INDEX `reconciliation_findings_severity_idx`(`severity`),
    INDEX `reconciliation_findings_branch_id_idx`(`branch_id`),
    INDEX `reconciliation_findings_reference_id_idx`(`reference_id`),
    INDEX `reconciliation_findings_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recovery_epochs` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `epoch_number` INTEGER NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `declared_by` VARCHAR(191) NOT NULL,
    `declared_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recovery_epochs_company_id_epoch_number_idx`(`company_id`, `epoch_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration_credentials` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `credential_ciphertext` LONGBLOB NOT NULL,
    `key_version` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `last_rotated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NOT NULL,

    INDEX `integration_credentials_company_id_idx`(`company_id`),
    INDEX `integration_credentials_status_idx`(`status`),
    UNIQUE INDEX `integration_credentials_company_id_provider_label_key`(`company_id`, `provider`, `label`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `parent_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `deleted_at` DATETIME(3) NULL,

    INDEX `categories_company_id_idx`(`company_id`),
    INDEX `categories_parent_id_idx`(`parent_id`),
    INDEX `categories_is_active_idx`(`is_active`),
    UNIQUE INDEX `categories_company_id_code_key`(`company_id`, `code`),
    UNIQUE INDEX `categories_company_id_parent_id_name_key`(`company_id`, `parent_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `brands` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `deleted_at` DATETIME(3) NULL,

    INDEX `brands_company_id_idx`(`company_id`),
    UNIQUE INDEX `brands_company_id_name_key`(`company_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `units` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `base_unit_id` VARCHAR(191) NULL,
    `conversion_factor` DECIMAL(65, 30) NOT NULL DEFAULT 1,
    `allow_fractional` BOOLEAN NOT NULL DEFAULT false,

    INDEX `units_company_id_idx`(`company_id`),
    INDEX `units_base_unit_id_idx`(`base_unit_id`),
    UNIQUE INDEX `units_company_id_code_key`(`company_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_groups` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `default_discount_rate` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `credit_limit_default` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `customer_groups_company_id_idx`(`company_id`),
    UNIQUE INDEX `customer_groups_company_id_name_key`(`company_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `category_id` VARCHAR(191) NOT NULL,
    `brand_id` VARCHAR(191) NULL,
    `unit_id` VARCHAR(191) NOT NULL,
    `product_type` VARCHAR(191) NOT NULL DEFAULT 'standard',
    `is_serialized` BOOLEAN NOT NULL DEFAULT false,
    `track_batches` BOOLEAN NOT NULL DEFAULT false,
    `warranty_period_months` INTEGER NULL,
    `reference_cost` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `default_price` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `default_tax_code_id` VARCHAR(191) NULL,
    `alert_quantity` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `short_description` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `is_featured` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `products_company_id_idx`(`company_id`),
    INDEX `products_category_id_idx`(`category_id`),
    INDEX `products_brand_id_idx`(`brand_id`),
    INDEX `products_unit_id_idx`(`unit_id`),
    INDEX `products_product_type_idx`(`product_type`),
    INDEX `products_is_serialized_idx`(`is_serialized`),
    INDEX `products_track_batches_idx`(`track_batches`),
    INDEX `products_is_featured_idx`(`is_featured`),
    INDEX `products_is_active_idx`(`is_active`),
    INDEX `products_deleted_at_idx`(`deleted_at`),
    UNIQUE INDEX `products_company_id_code_key`(`company_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `media_assets` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `object_key` VARCHAR(191) NOT NULL,
    `original_filename` VARCHAR(191) NOT NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `size_bytes` INTEGER NOT NULL DEFAULT 0,
    `sha256` VARCHAR(191) NOT NULL,
    `width_px` INTEGER NULL,
    `height_px` INTEGER NULL,
    `alt_text` VARCHAR(191) NULL,
    `scan_status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `media_assets_company_id_idx`(`company_id`),
    INDEX `media_assets_mime_type_idx`(`mime_type`),
    INDEX `media_assets_sha256_idx`(`sha256`),
    INDEX `media_assets_scan_status_idx`(`scan_status`),
    INDEX `media_assets_deleted_at_idx`(`deleted_at`),
    UNIQUE INDEX `media_assets_company_id_object_key_key`(`company_id`, `object_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `entity_media_links` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `media_asset_id` VARCHAR(191) NOT NULL,
    `entity_type` VARCHAR(191) NOT NULL,
    `entity_id` VARCHAR(191) NOT NULL,
    `media_role` VARCHAR(191) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `entity_media_links_company_id_idx`(`company_id`),
    INDEX `entity_media_links_media_asset_id_idx`(`media_asset_id`),
    INDEX `entity_media_links_entity_type_idx`(`entity_type`),
    INDEX `entity_media_links_entity_id_idx`(`entity_id`),
    INDEX `entity_media_links_media_role_idx`(`media_role`),
    UNIQUE INDEX `entity_media_links_company_id_entity_type_entity_id_media_as_key`(`company_id`, `entity_type`, `entity_id`, `media_asset_id`, `media_role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_barcodes` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `symbology` VARCHAR(191) NOT NULL DEFAULT 'CODE128',
    `unit_id` VARCHAR(191) NULL,
    `package_quantity` DECIMAL(65, 30) NOT NULL DEFAULT 1,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `product_barcodes_company_id_idx`(`company_id`),
    INDEX `product_barcodes_product_id_idx`(`product_id`),
    INDEX `product_barcodes_symbology_idx`(`symbology`),
    INDEX `product_barcodes_unit_id_idx`(`unit_id`),
    INDEX `product_barcodes_is_primary_idx`(`is_primary`),
    UNIQUE INDEX `product_barcodes_company_id_code_key`(`company_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_unit_options` (
    `company_id` VARCHAR(191) NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `unit_id` VARCHAR(191) NOT NULL,
    `conversion_to_stock_unit` DECIMAL(65, 30) NOT NULL DEFAULT 1,
    `can_purchase` BOOLEAN NOT NULL DEFAULT false,
    `can_sell` BOOLEAN NOT NULL DEFAULT false,
    `is_default_purchase` BOOLEAN NOT NULL DEFAULT false,
    `is_default_sale` BOOLEAN NOT NULL DEFAULT false,

    INDEX `product_unit_options_product_id_idx`(`product_id`),
    INDEX `product_unit_options_unit_id_idx`(`unit_id`),
    PRIMARY KEY (`company_id`, `product_id`, `unit_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_combo_items` (
    `company_id` VARCHAR(191) NOT NULL,
    `combo_product_id` VARCHAR(191) NOT NULL,
    `component_product_id` VARCHAR(191) NOT NULL,
    `component_quantity` DECIMAL(65, 30) NOT NULL,
    `component_unit_id` VARCHAR(191) NOT NULL,
    `allow_substitution` BOOLEAN NOT NULL DEFAULT false,

    INDEX `product_combo_items_combo_product_id_idx`(`combo_product_id`),
    INDEX `product_combo_items_component_product_id_idx`(`component_product_id`),
    INDEX `product_combo_items_component_unit_id_idx`(`component_unit_id`),
    PRIMARY KEY (`company_id`, `combo_product_id`, `component_product_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `discount_policies` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `discount_type` VARCHAR(191) NOT NULL,
    `value` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `max_discount_amount` DECIMAL(65, 30) NULL,
    `product_id` VARCHAR(191) NULL,
    `category_id` VARCHAR(191) NULL,
    `customer_group_id` VARCHAR(191) NULL,
    `branch_id` VARCHAR(191) NULL,
    `valid_from` DATETIME(3) NOT NULL,
    `valid_to` DATETIME(3) NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `combinable` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `discount_policies_company_id_idx`(`company_id`),
    INDEX `discount_policies_product_id_idx`(`product_id`),
    INDEX `discount_policies_category_id_idx`(`category_id`),
    INDEX `discount_policies_customer_group_id_idx`(`customer_group_id`),
    INDEX `discount_policies_branch_id_idx`(`branch_id`),
    INDEX `discount_policies_valid_from_idx`(`valid_from`),
    INDEX `discount_policies_valid_to_idx`(`valid_to`),
    INDEX `discount_policies_is_active_idx`(`is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_prices` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NULL,
    `customer_group_id` VARCHAR(191) NULL,
    `currency_code` VARCHAR(191) NOT NULL,
    `price` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `valid_from` DATETIME(3) NOT NULL,
    `valid_to` DATETIME(3) NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,

    INDEX `product_prices_company_id_idx`(`company_id`),
    INDEX `product_prices_product_id_idx`(`product_id`),
    INDEX `product_prices_branch_id_idx`(`branch_id`),
    INDEX `product_prices_customer_group_id_idx`(`customer_group_id`),
    INDEX `product_prices_valid_from_idx`(`valid_from`),
    INDEX `product_prices_valid_to_idx`(`valid_to`),
    UNIQUE INDEX `product_prices_company_id_product_id_branch_id_customer_grou_key`(`company_id`, `product_id`, `branch_id`, `customer_group_id`, `currency_code`, `valid_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tax_codes` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `price_includes_tax` BOOLEAN NOT NULL DEFAULT false,
    `effective_from` DATETIME(3) NOT NULL,
    `effective_to` DATETIME(3) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `tax_codes_company_id_idx`(`company_id`),
    INDEX `tax_codes_effective_from_idx`(`effective_from`),
    INDEX `tax_codes_effective_to_idx`(`effective_to`),
    INDEX `tax_codes_is_active_idx`(`is_active`),
    UNIQUE INDEX `tax_codes_company_id_code_key`(`company_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tax_components` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `component_code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `component_type` VARCHAR(191) NOT NULL DEFAULT 'VAT',
    `rate` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `calculation_order` INTEGER NOT NULL DEFAULT 1,
    `compound_on_previous` BOOLEAN NOT NULL DEFAULT false,
    `input_account_id` VARCHAR(191) NULL,
    `output_account_id` VARCHAR(191) NULL,
    `effective_from` DATETIME(3) NOT NULL,
    `effective_to` DATETIME(3) NULL,

    INDEX `tax_components_company_id_idx`(`company_id`),
    INDEX `tax_components_component_type_idx`(`component_type`),
    UNIQUE INDEX `tax_components_company_id_component_code_key`(`company_id`, `component_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tax_code_components` (
    `tax_code_id` VARCHAR(191) NOT NULL,
    `tax_component_id` VARCHAR(191) NOT NULL,

    INDEX `tax_code_components_tax_component_id_idx`(`tax_component_id`),
    PRIMARY KEY (`tax_code_id`, `tax_component_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `withholding_rules` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `withholding_type` VARCHAR(191) NOT NULL DEFAULT 'TDS',
    `applies_to` VARCHAR(191) NOT NULL DEFAULT 'supplier_payment',
    `rate` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `minimum_base_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `effective_from` DATETIME(3) NOT NULL,
    `effective_to` DATETIME(3) NULL,
    `conditions` VARCHAR(191) NOT NULL DEFAULT '{}',
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `withholding_rules_company_id_idx`(`company_id`),
    INDEX `withholding_rules_withholding_type_idx`(`withholding_type`),
    INDEX `withholding_rules_applies_to_idx`(`applies_to`),
    INDEX `withholding_rules_effective_from_idx`(`effective_from`),
    INDEX `withholding_rules_effective_to_idx`(`effective_to`),
    INDEX `withholding_rules_is_active_idx`(`is_active`),
    UNIQUE INDEX `withholding_rules_company_id_code_key`(`company_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `configuration_definitions` (
    `key` VARCHAR(191) NOT NULL,
    `module` VARCHAR(191) NOT NULL,
    `value_type` VARCHAR(191) NOT NULL,
    `json_schema` VARCHAR(191) NULL,
    `allowed_scopes` VARCHAR(191) NOT NULL DEFAULT 'company,branch',
    `is_secret` BOOLEAN NOT NULL DEFAULT false,
    `default_value` VARCHAR(191) NULL,
    `description` VARCHAR(191) NOT NULL,

    INDEX `configuration_definitions_module_idx`(`module`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `configuration_values` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `definition_key` VARCHAR(191) NOT NULL,
    `scope_type` VARCHAR(191) NOT NULL DEFAULT 'company',
    `scope_id` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL DEFAULT '{}',
    `version` INTEGER NOT NULL DEFAULT 1,
    `updated_by` VARCHAR(191) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `configuration_values_company_id_idx`(`company_id`),
    INDEX `configuration_values_definition_key_idx`(`definition_key`),
    INDEX `configuration_values_scope_type_scope_id_idx`(`scope_type`, `scope_id`),
    UNIQUE INDEX `configuration_values_company_id_definition_key_scope_type_sc_key`(`company_id`, `definition_key`, `scope_type`, `scope_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pos_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `default_warehouse_id` VARCHAR(191) NOT NULL,
    `default_customer_id` VARCHAR(191) NULL,
    `receipt_template_id` VARCHAR(191) NULL,
    `invoice_template_id` VARCHAR(191) NULL,
    `hold_reservation_minutes` INTEGER NOT NULL DEFAULT 15,
    `allow_due_sale` BOOLEAN NOT NULL DEFAULT false,
    `require_customer_for_due` BOOLEAN NOT NULL DEFAULT true,
    `printer_mode` VARCHAR(191) NOT NULL DEFAULT 'browser',
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `pos_profiles_company_id_idx`(`company_id`),
    INDEX `pos_profiles_branch_id_idx`(`branch_id`),
    INDEX `pos_profiles_is_active_idx`(`is_active`),
    UNIQUE INDEX `pos_profiles_company_id_branch_id_name_key`(`company_id`, `branch_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_templates` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `template_type` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `locale` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `template_schema` VARCHAR(191) NOT NULL DEFAULT '{}',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `approved_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `document_templates_company_id_idx`(`company_id`),
    INDEX `document_templates_template_type_idx`(`template_type`),
    INDEX `document_templates_locale_idx`(`locale`),
    INDEX `document_templates_is_active_idx`(`is_active`),
    UNIQUE INDEX `document_templates_company_id_template_type_name_locale_vers_key`(`company_id`, `template_type`, `name`, `locale`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supported_languages` (
    `locale` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `native_name` VARCHAR(191) NOT NULL,
    `text_direction` VARCHAR(191) NOT NULL DEFAULT 'ltr',
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`locale`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_languages` (
    `company_id` VARCHAR(191) NOT NULL,
    `locale` VARCHAR(191) NOT NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `is_enabled` BOOLEAN NOT NULL DEFAULT true,

    INDEX `company_languages_locale_idx`(`locale`),
    PRIMARY KEY (`company_id`, `locale`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `translation_overrides` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `locale` VARCHAR(191) NOT NULL,
    `translation_key` VARCHAR(191) NOT NULL,
    `translated_value` VARCHAR(191) NOT NULL,
    `updated_by` VARCHAR(191) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `translation_overrides_company_id_idx`(`company_id`),
    INDEX `translation_overrides_locale_idx`(`locale`),
    INDEX `translation_overrides_translation_key_idx`(`translation_key`),
    UNIQUE INDEX `translation_overrides_company_id_locale_translation_key_key`(`company_id`, `locale`, `translation_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feature_flags` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `flag_key` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `rollout_rules` VARCHAR(191) NOT NULL DEFAULT '{}',
    `updated_by` VARCHAR(191) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `feature_flags_company_id_idx`(`company_id`),
    INDEX `feature_flags_enabled_idx`(`enabled`),
    UNIQUE INDEX `feature_flags_company_id_flag_key_key`(`company_id`, `flag_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dashboard_preferences` (
    `userId` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `widget_layout` VARCHAR(191) NOT NULL DEFAULT '[]',
    `default_date_range` VARCHAR(191) NOT NULL DEFAULT 'today',
    `default_branch_ids` VARCHAR(191) NOT NULL DEFAULT '[]',
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `dashboard_preferences_company_id_idx`(`company_id`),
    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_targets` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `period_start` DATETIME(3) NOT NULL,
    `period_end` DATETIME(3) NOT NULL,
    `target_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `target_quantity` DECIMAL(65, 30) NULL,
    `created_by` VARCHAR(191) NOT NULL,

    INDEX `sales_targets_company_id_idx`(`company_id`),
    INDEX `sales_targets_branch_id_idx`(`branch_id`),
    INDEX `sales_targets_user_id_idx`(`user_id`),
    INDEX `sales_targets_period_start_idx`(`period_start`),
    INDEX `sales_targets_period_end_idx`(`period_end`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `saved_report_filters` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `report_code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `filter_json` VARCHAR(191) NOT NULL DEFAULT '{}',
    `is_shared` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `saved_report_filters_company_id_idx`(`company_id`),
    INDEX `saved_report_filters_user_id_idx`(`user_id`),
    INDEX `saved_report_filters_report_code_idx`(`report_code`),
    UNIQUE INDEX `saved_report_filters_user_id_report_code_name_key`(`user_id`, `report_code`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_export_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `requested_by` VARCHAR(191) NOT NULL,
    `report_code` VARCHAR(191) NOT NULL,
    `format` VARCHAR(191) NOT NULL DEFAULT 'pdf',
    `filter_json` VARCHAR(191) NOT NULL DEFAULT '{}',
    `data_cutoff_at` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
    `output_media_id` VARCHAR(191) NULL,
    `error_summary` VARCHAR(191) NULL,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `report_export_jobs_company_id_idx`(`company_id`),
    INDEX `report_export_jobs_requested_by_idx`(`requested_by`),
    INDEX `report_export_jobs_report_code_idx`(`report_code`),
    INDEX `report_export_jobs_status_idx`(`status`),
    INDEX `report_export_jobs_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_tickets` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `priority` VARCHAR(191) NOT NULL DEFAULT 'normal',
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `opened_by` VARCHAR(191) NOT NULL,
    `assigned_to` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closed_at` DATETIME(3) NULL,

    INDEX `support_tickets_company_id_idx`(`company_id`),
    INDEX `support_tickets_priority_idx`(`priority`),
    INDEX `support_tickets_status_idx`(`status`),
    INDEX `support_tickets_opened_by_idx`(`opened_by`),
    INDEX `support_tickets_assigned_to_idx`(`assigned_to`),
    INDEX `support_tickets_created_at_idx`(`created_at`),
    UNIQUE INDEX `support_tickets_company_id_reference_no_key`(`company_id`, `reference_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_ticket_messages` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `support_ticket_id` VARCHAR(191) NOT NULL,
    `author_user_id` VARCHAR(191) NOT NULL,
    `body` VARCHAR(191) NOT NULL,
    `is_internal` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `support_ticket_messages_company_id_idx`(`company_id`),
    INDEX `support_ticket_messages_support_ticket_id_idx`(`support_ticket_id`),
    INDEX `support_ticket_messages_author_user_id_idx`(`author_user_id`),
    INDEX `support_ticket_messages_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `communication_templates` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL DEFAULT 'sms',
    `purpose` VARCHAR(191) NOT NULL DEFAULT 'transactional',
    `locale` VARCHAR(191) NOT NULL,
    `subject_template` VARCHAR(191) NULL,
    `body_template` VARCHAR(191) NOT NULL,
    `allowed_tokens` VARCHAR(191) NOT NULL DEFAULT '[]',
    `version` INTEGER NOT NULL DEFAULT 1,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `approved_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `communication_templates_company_id_idx`(`company_id`),
    INDEX `communication_templates_channel_idx`(`channel`),
    INDEX `communication_templates_purpose_idx`(`purpose`),
    INDEX `communication_templates_locale_idx`(`locale`),
    INDEX `communication_templates_is_active_idx`(`is_active`),
    UNIQUE INDEX `communication_templates_company_id_code_key`(`company_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `warehouse_stocks` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `warehouse_id` VARCHAR(191) NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `qty_on_hand` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `qty_reserved` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `qty_in_transit_out` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `qty_damaged` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `moving_average_cost` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `warehouse_stocks_company_id_idx`(`company_id`),
    INDEX `warehouse_stocks_warehouse_id_idx`(`warehouse_id`),
    INDEX `warehouse_stocks_product_id_idx`(`product_id`),
    UNIQUE INDEX `warehouse_stocks_company_id_warehouse_id_product_id_key`(`company_id`, `warehouse_id`, `product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_movements` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `event_line_no` INTEGER NOT NULL,
    `warehouse_id` VARCHAR(191) NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `stock_bucket` VARCHAR(191) NOT NULL DEFAULT 'on_hand',
    `movement_type` VARCHAR(191) NOT NULL,
    `qty_delta` DECIMAL(65, 30) NOT NULL,
    `unit_cost` DECIMAL(65, 30) NOT NULL,
    `total_cost_delta` DECIMAL(65, 30) NOT NULL,
    `reference_type` VARCHAR(191) NOT NULL,
    `reference_id` VARCHAR(191) NOT NULL,
    `source_line_id` VARCHAR(191) NULL,
    `reversal_of_movement_id` VARCHAR(191) NULL,
    `effective_at` DATETIME(3) NOT NULL,
    `posted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NOT NULL,
    `metadata` VARCHAR(191) NOT NULL DEFAULT '{}',

    INDEX `stock_movements_company_id_idx`(`company_id`),
    INDEX `stock_movements_event_id_idx`(`event_id`),
    INDEX `stock_movements_warehouse_id_idx`(`warehouse_id`),
    INDEX `stock_movements_product_id_idx`(`product_id`),
    INDEX `stock_movements_stock_bucket_idx`(`stock_bucket`),
    INDEX `stock_movements_movement_type_idx`(`movement_type`),
    INDEX `stock_movements_reference_type_reference_id_idx`(`reference_type`, `reference_id`),
    INDEX `stock_movements_effective_at_idx`(`effective_at`),
    INDEX `stock_movements_posted_at_idx`(`posted_at`),
    INDEX `stock_movements_reversal_of_movement_id_idx`(`reversal_of_movement_id`),
    UNIQUE INDEX `stock_movements_company_id_event_id_event_line_no_key`(`company_id`, `event_id`, `event_line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_reservations` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `warehouse_id` VARCHAR(191) NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `reservation_type` VARCHAR(191) NOT NULL,
    `reference_id` VARCHAR(191) NOT NULL,
    `qty` DECIMAL(65, 30) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `expires_at` DATETIME(3) NULL,
    `consumed_at` DATETIME(3) NULL,
    `released_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stock_reservations_company_id_idx`(`company_id`),
    INDEX `stock_reservations_warehouse_id_idx`(`warehouse_id`),
    INDEX `stock_reservations_product_id_idx`(`product_id`),
    INDEX `stock_reservations_reservation_type_reference_id_idx`(`reservation_type`, `reference_id`),
    INDEX `stock_reservations_status_idx`(`status`),
    INDEX `stock_reservations_expires_at_idx`(`expires_at`),
    UNIQUE INDEX `stock_reservations_company_id_reservation_type_reference_id__key`(`company_id`, `reservation_type`, `reference_id`, `product_id`, `warehouse_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_batches` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `warehouse_id` VARCHAR(191) NOT NULL,
    `batch_no` VARCHAR(191) NOT NULL,
    `manufactured_at` DATETIME(3) NULL,
    `expiry_date` DATETIME(3) NULL,
    `qty_on_hand` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `qty_reserved` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',

    INDEX `product_batches_company_id_idx`(`company_id`),
    INDEX `product_batches_product_id_idx`(`product_id`),
    INDEX `product_batches_warehouse_id_idx`(`warehouse_id`),
    INDEX `product_batches_expiry_date_idx`(`expiry_date`),
    INDEX `product_batches_status_idx`(`status`),
    UNIQUE INDEX `product_batches_company_id_product_id_warehouse_id_batch_no_key`(`company_id`, `product_id`, `warehouse_id`, `batch_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_movement_batches` (
    `stock_movement_id` VARCHAR(191) NOT NULL,
    `product_batch_id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `qty` DECIMAL(65, 30) NOT NULL,
    `override_reason` VARCHAR(191) NULL,

    INDEX `stock_movement_batches_product_batch_id_idx`(`product_batch_id`),
    PRIMARY KEY (`stock_movement_id`, `product_batch_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_serials` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `serial_number` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'in_stock',
    `current_warehouse_id` VARCHAR(191) NULL,
    `current_reservation_id` VARCHAR(191) NULL,
    `originating_purchase_item_id` VARCHAR(191) NULL,
    `sold_sale_item_id` VARCHAR(191) NULL,
    `warranty_start_date` DATETIME(3) NULL,
    `warranty_expiry_date` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `product_serials_company_id_idx`(`company_id`),
    INDEX `product_serials_product_id_idx`(`product_id`),
    INDEX `product_serials_status_idx`(`status`),
    INDEX `product_serials_current_warehouse_id_idx`(`current_warehouse_id`),
    INDEX `product_serials_current_reservation_id_idx`(`current_reservation_id`),
    INDEX `product_serials_warranty_expiry_date_idx`(`warranty_expiry_date`),
    UNIQUE INDEX `product_serials_company_id_serial_number_key`(`company_id`, `serial_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `serial_events` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `serial_id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `event_line_no` INTEGER NOT NULL,
    `event_type` VARCHAR(191) NOT NULL,
    `from_status` VARCHAR(191) NULL,
    `to_status` VARCHAR(191) NOT NULL,
    `from_warehouse_id` VARCHAR(191) NULL,
    `to_warehouse_id` VARCHAR(191) NULL,
    `stock_movement_id` VARCHAR(191) NULL,
    `reference_type` VARCHAR(191) NOT NULL,
    `reference_id` VARCHAR(191) NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NOT NULL,

    INDEX `serial_events_company_id_idx`(`company_id`),
    INDEX `serial_events_serial_id_idx`(`serial_id`),
    INDEX `serial_events_event_id_idx`(`event_id`),
    INDEX `serial_events_event_type_idx`(`event_type`),
    INDEX `serial_events_reference_type_reference_id_idx`(`reference_type`, `reference_id`),
    INDEX `serial_events_occurred_at_idx`(`occurred_at`),
    UNIQUE INDEX `serial_events_company_id_event_id_event_line_no_key`(`company_id`, `event_id`, `event_line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_reason_codes` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `reason_type` VARCHAR(191) NOT NULL DEFAULT 'adjustment',
    `requires_approval` BOOLEAN NOT NULL DEFAULT false,
    `default_expense_account_id` VARCHAR(191) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `inventory_reason_codes_company_id_idx`(`company_id`),
    INDEX `inventory_reason_codes_reason_type_idx`(`reason_type`),
    UNIQUE INDEX `inventory_reason_codes_company_id_code_key`(`company_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_counts` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `warehouse_id` VARCHAR(191) NOT NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `scope_type` VARCHAR(191) NOT NULL DEFAULT 'all',
    `category_id` VARCHAR(191) NULL,
    `brand_id` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `blind_count` BOOLEAN NOT NULL DEFAULT true,
    `snapshot_at` DATETIME(3) NULL,
    `movement_freeze_policy` VARCHAR(191) NOT NULL DEFAULT 'warn',
    `notes` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `reviewed_by` VARCHAR(191) NULL,
    `posted_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `posted_at` DATETIME(3) NULL,

    INDEX `stock_counts_company_id_idx`(`company_id`),
    INDEX `stock_counts_branch_id_idx`(`branch_id`),
    INDEX `stock_counts_warehouse_id_idx`(`warehouse_id`),
    INDEX `stock_counts_status_idx`(`status`),
    UNIQUE INDEX `stock_counts_company_id_reference_no_key`(`company_id`, `reference_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_count_items` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `stock_count_id` VARCHAR(191) NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `batch_id` VARCHAR(191) NULL,
    `expected_quantity` DECIMAL(65, 30) NOT NULL,
    `counted_quantity` DECIMAL(65, 30) NULL,
    `variance_quantity` DECIMAL(65, 30) NULL,
    `reason_code_id` VARCHAR(191) NULL,
    `count_note` VARCHAR(191) NULL,

    INDEX `stock_count_items_company_id_idx`(`company_id`),
    INDEX `stock_count_items_stock_count_id_idx`(`stock_count_id`),
    INDEX `stock_count_items_product_id_idx`(`product_id`),
    INDEX `stock_count_items_batch_id_idx`(`batch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_count_serials` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `stock_count_item_id` VARCHAR(191) NOT NULL,
    `serial_id` VARCHAR(191) NULL,
    `scanned_serial_number` VARCHAR(191) NOT NULL,
    `expected_present` BOOLEAN NOT NULL DEFAULT true,
    `counted_present` BOOLEAN NOT NULL DEFAULT false,
    `resolution` VARCHAR(191) NOT NULL DEFAULT 'matched',

    INDEX `stock_count_serials_company_id_idx`(`company_id`),
    INDEX `stock_count_serials_stock_count_item_id_idx`(`stock_count_item_id`),
    INDEX `stock_count_serials_serial_id_idx`(`serial_id`),
    INDEX `stock_count_serials_resolution_idx`(`resolution`),
    UNIQUE INDEX `stock_count_serials_stock_count_item_id_scanned_serial_numbe_key`(`stock_count_item_id`, `scanned_serial_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_adjustments` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `warehouse_id` VARCHAR(191) NOT NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `client_txn_id` VARCHAR(191) NOT NULL,
    `adjustment_type` VARCHAR(191) NOT NULL DEFAULT 'adjustment',
    `reason_code_id` VARCHAR(191) NOT NULL,
    `source_stock_count_id` VARCHAR(191) NULL,
    `reversal_of_id` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `business_date` DATETIME(3) NOT NULL,
    `notes` VARCHAR(191) NOT NULL,
    `approval_request_id` VARCHAR(191) NULL,
    `journal_entry_id` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `approved_by` VARCHAR(191) NULL,
    `posted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stock_adjustments_company_id_idx`(`company_id`),
    INDEX `stock_adjustments_branch_id_idx`(`branch_id`),
    INDEX `stock_adjustments_warehouse_id_idx`(`warehouse_id`),
    INDEX `stock_adjustments_adjustment_type_idx`(`adjustment_type`),
    INDEX `stock_adjustments_reason_code_id_idx`(`reason_code_id`),
    INDEX `stock_adjustments_source_stock_count_id_idx`(`source_stock_count_id`),
    INDEX `stock_adjustments_reversal_of_id_idx`(`reversal_of_id`),
    INDEX `stock_adjustments_status_idx`(`status`),
    INDEX `stock_adjustments_business_date_idx`(`business_date`),
    UNIQUE INDEX `stock_adjustments_company_id_reference_no_key`(`company_id`, `reference_no`),
    UNIQUE INDEX `stock_adjustments_company_id_client_txn_id_key`(`company_id`, `client_txn_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_adjustment_items` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `stock_adjustment_id` VARCHAR(191) NOT NULL,
    `line_no` INTEGER NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `batch_id` VARCHAR(191) NULL,
    `quantity_delta` DECIMAL(65, 30) NOT NULL,
    `unit_cost_snapshot` DECIMAL(65, 30) NOT NULL,
    `value_delta` DECIMAL(65, 30) NOT NULL,
    `event_id` VARCHAR(191) NULL,

    INDEX `stock_adjustment_items_company_id_idx`(`company_id`),
    INDEX `stock_adjustment_items_stock_adjustment_id_idx`(`stock_adjustment_id`),
    INDEX `stock_adjustment_items_product_id_idx`(`product_id`),
    INDEX `stock_adjustment_items_batch_id_idx`(`batch_id`),
    INDEX `stock_adjustment_items_event_id_idx`(`event_id`),
    UNIQUE INDEX `stock_adjustment_items_stock_adjustment_id_line_no_key`(`stock_adjustment_id`, `line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_adjustment_item_serials` (
    `stock_adjustment_item_id` VARCHAR(191) NOT NULL,
    `serial_id` VARCHAR(191) NOT NULL,
    `resulting_status` VARCHAR(191) NOT NULL DEFAULT 'in_stock',

    INDEX `stock_adjustment_item_serials_serial_id_idx`(`serial_id`),
    PRIMARY KEY (`stock_adjustment_item_id`, `serial_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customers` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `customer_group_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `tax_identifier` VARCHAR(191) NULL,
    `credit_limit` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `preferred_branch_id` VARCHAR(191) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `customers_company_id_idx`(`company_id`),
    INDEX `customers_customer_group_id_idx`(`customer_group_id`),
    INDEX `customers_phone_idx`(`phone`),
    INDEX `customers_email_idx`(`email`),
    INDEX `customers_preferred_branch_id_idx`(`preferred_branch_id`),
    INDEX `customers_is_active_idx`(`is_active`),
    INDEX `customers_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `suppliers` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `tax_identifier` VARCHAR(191) NULL,
    `currency_code` VARCHAR(191) NOT NULL DEFAULT 'BDT',
    `payment_terms_days` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `suppliers_company_id_idx`(`company_id`),
    INDEX `suppliers_phone_idx`(`phone`),
    INDEX `suppliers_email_idx`(`email`),
    INDEX `suppliers_currency_code_idx`(`currency_code`),
    INDEX `suppliers_is_active_idx`(`is_active`),
    INDEX `suppliers_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchases` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `warehouse_id` VARCHAR(191) NOT NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `supplier_invoice_no` VARCHAR(191) NULL,
    `supplier_id` VARCHAR(191) NOT NULL,
    `order_status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `invoice_status` VARCHAR(191) NOT NULL DEFAULT 'not_invoiced',
    `currency_code` VARCHAR(191) NOT NULL DEFAULT 'BDT',
    `exchange_rate` DECIMAL(65, 30) NOT NULL DEFAULT 1,
    `order_date` DATETIME(3) NOT NULL,
    `expected_date` DATETIME(3) NULL,
    `subtotal` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `discount_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `tax_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `landed_cost_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `grand_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `base_grand_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `notes` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `purchases_company_id_idx`(`company_id`),
    INDEX `purchases_branch_id_idx`(`branch_id`),
    INDEX `purchases_warehouse_id_idx`(`warehouse_id`),
    INDEX `purchases_supplier_id_idx`(`supplier_id`),
    INDEX `purchases_order_status_idx`(`order_status`),
    INDEX `purchases_order_date_idx`(`order_date`),
    UNIQUE INDEX `purchases_company_id_reference_no_key`(`company_id`, `reference_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_items` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `purchase_id` VARCHAR(191) NOT NULL,
    `line_no` INTEGER NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `product_name_snapshot` VARCHAR(191) NOT NULL,
    `product_code_snapshot` VARCHAR(191) NOT NULL,
    `qty_ordered` DECIMAL(65, 30) NOT NULL,
    `qty_received` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `qty_returned` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `unit_cost` DECIMAL(65, 30) NOT NULL,
    `allocated_landed_cost_per_unit` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `discount_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `tax_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `line_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,

    INDEX `purchase_items_company_id_idx`(`company_id`),
    INDEX `purchase_items_purchase_id_idx`(`purchase_id`),
    INDEX `purchase_items_product_id_idx`(`product_id`),
    UNIQUE INDEX `purchase_items_purchase_id_line_no_key`(`purchase_id`, `line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_item_taxes` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `purchase_item_id` VARCHAR(191) NOT NULL,
    `tax_component_id` VARCHAR(191) NOT NULL,
    `component_code_snapshot` VARCHAR(191) NOT NULL,
    `rate_snapshot` DECIMAL(65, 30) NOT NULL,
    `taxable_base` DECIMAL(65, 30) NOT NULL,
    `tax_amount` DECIMAL(65, 30) NOT NULL,
    `recoverable_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,

    INDEX `purchase_item_taxes_company_id_idx`(`company_id`),
    INDEX `purchase_item_taxes_purchase_item_id_idx`(`purchase_item_id`),
    INDEX `purchase_item_taxes_tax_component_id_idx`(`tax_component_id`),
    UNIQUE INDEX `purchase_item_taxes_purchase_item_id_tax_component_id_key`(`purchase_item_id`, `tax_component_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_receivings` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `warehouse_id` VARCHAR(191) NOT NULL,
    `purchase_id` VARCHAR(191) NOT NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `client_txn_id` VARCHAR(191) NOT NULL,
    `receiving_status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `business_date` DATETIME(3) NOT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `supplier_document_no` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `posted_at` DATETIME(3) NULL,
    `received_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `purchase_receivings_company_id_idx`(`company_id`),
    INDEX `purchase_receivings_branch_id_idx`(`branch_id`),
    INDEX `purchase_receivings_warehouse_id_idx`(`warehouse_id`),
    INDEX `purchase_receivings_purchase_id_idx`(`purchase_id`),
    INDEX `purchase_receivings_receiving_status_idx`(`receiving_status`),
    INDEX `purchase_receivings_business_date_idx`(`business_date`),
    UNIQUE INDEX `purchase_receivings_company_id_reference_no_key`(`company_id`, `reference_no`),
    UNIQUE INDEX `purchase_receivings_company_id_client_txn_id_key`(`company_id`, `client_txn_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_receiving_items` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `purchase_receiving_id` VARCHAR(191) NOT NULL,
    `purchase_item_id` VARCHAR(191) NOT NULL,
    `line_no` INTEGER NOT NULL,
    `qty_received_now` DECIMAL(65, 30) NOT NULL,
    `unit_cost_snapshot` DECIMAL(65, 30) NOT NULL,
    `landed_cost_per_unit_snapshot` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `inventory_unit_cost` DECIMAL(65, 30) NOT NULL,
    `batch_no` VARCHAR(191) NULL,
    `manufactured_at` DATETIME(3) NULL,
    `expiry_date` DATETIME(3) NULL,

    INDEX `purchase_receiving_items_company_id_idx`(`company_id`),
    INDEX `purchase_receiving_items_purchase_receiving_id_idx`(`purchase_receiving_id`),
    INDEX `purchase_receiving_items_purchase_item_id_idx`(`purchase_item_id`),
    UNIQUE INDEX `purchase_receiving_items_purchase_receiving_id_line_no_key`(`purchase_receiving_id`, `line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_receiving_item_serials` (
    `purchase_receiving_item_id` VARCHAR(191) NOT NULL,
    `serial_id` VARCHAR(191) NOT NULL,

    INDEX `purchase_receiving_item_serials_serial_id_idx`(`serial_id`),
    PRIMARY KEY (`purchase_receiving_item_id`, `serial_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `landed_cost_documents` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `purchase_id` VARCHAR(191) NOT NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `cost_type` VARCHAR(191) NOT NULL DEFAULT 'freight',
    `supplier_id` VARCHAR(191) NULL,
    `currency_code` VARCHAR(191) NOT NULL DEFAULT 'BDT',
    `exchange_rate` DECIMAL(65, 30) NOT NULL DEFAULT 1,
    `amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `base_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `allocation_method` VARCHAR(191) NOT NULL DEFAULT 'quantity',
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `landed_cost_documents_company_id_idx`(`company_id`),
    INDEX `landed_cost_documents_purchase_id_idx`(`purchase_id`),
    INDEX `landed_cost_documents_cost_type_idx`(`cost_type`),
    INDEX `landed_cost_documents_supplier_id_idx`(`supplier_id`),
    INDEX `landed_cost_documents_status_idx`(`status`),
    UNIQUE INDEX `landed_cost_documents_company_id_reference_no_key`(`company_id`, `reference_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `landed_cost_allocations` (
    `landed_cost_document_id` VARCHAR(191) NOT NULL,
    `purchase_item_id` VARCHAR(191) NOT NULL,
    `allocated_base_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,

    INDEX `landed_cost_allocations_purchase_item_id_idx`(`purchase_item_id`),
    PRIMARY KEY (`landed_cost_document_id`, `purchase_item_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_returns` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `warehouse_id` VARCHAR(191) NOT NULL,
    `purchase_id` VARCHAR(191) NOT NULL,
    `supplier_id` VARCHAR(191) NOT NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `client_txn_id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `business_date` DATETIME(3) NOT NULL,
    `supplier_credit_no` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NOT NULL,
    `subtotal_credit` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `tax_credit` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `total_credit` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `base_total_credit` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `refund_status` VARCHAR(191) NOT NULL DEFAULT 'not_required',
    `approved_by` VARCHAR(191) NULL,
    `posted_at` DATETIME(3) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `purchase_returns_company_id_idx`(`company_id`),
    INDEX `purchase_returns_branch_id_idx`(`branch_id`),
    INDEX `purchase_returns_warehouse_id_idx`(`warehouse_id`),
    INDEX `purchase_returns_purchase_id_idx`(`purchase_id`),
    INDEX `purchase_returns_supplier_id_idx`(`supplier_id`),
    INDEX `purchase_returns_status_idx`(`status`),
    INDEX `purchase_returns_business_date_idx`(`business_date`),
    UNIQUE INDEX `purchase_returns_company_id_reference_no_key`(`company_id`, `reference_no`),
    UNIQUE INDEX `purchase_returns_company_id_client_txn_id_key`(`company_id`, `client_txn_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_return_items` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `purchase_return_id` VARCHAR(191) NOT NULL,
    `purchase_item_id` VARCHAR(191) NOT NULL,
    `qty_returned` DECIMAL(65, 30) NOT NULL,
    `supplier_unit_credit` DECIMAL(65, 30) NOT NULL,
    `inventory_unit_cost` DECIMAL(65, 30) NOT NULL,
    `tax_credit` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `line_credit` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `variance_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,

    INDEX `purchase_return_items_company_id_idx`(`company_id`),
    INDEX `purchase_return_items_purchase_return_id_idx`(`purchase_return_id`),
    INDEX `purchase_return_items_purchase_item_id_idx`(`purchase_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_return_item_serials` (
    `purchase_return_item_id` VARCHAR(191) NOT NULL,
    `serial_id` VARCHAR(191) NOT NULL,

    INDEX `purchase_return_item_serials_serial_id_idx`(`serial_id`),
    PRIMARY KEY (`purchase_return_item_id`, `serial_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transfers` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `client_txn_id` VARCHAR(191) NOT NULL,
    `from_warehouse_id` VARCHAR(191) NOT NULL,
    `to_warehouse_id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `requested_by` VARCHAR(191) NOT NULL,
    `approved_by` VARCHAR(191) NULL,
    `dispatched_by` VARCHAR(191) NULL,
    `received_by` VARCHAR(191) NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dispatched_at` DATETIME(3) NULL,
    `received_at` DATETIME(3) NULL,
    `cancellation_reason` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,

    INDEX `transfers_company_id_idx`(`company_id`),
    INDEX `transfers_from_warehouse_id_idx`(`from_warehouse_id`),
    INDEX `transfers_to_warehouse_id_idx`(`to_warehouse_id`),
    INDEX `transfers_status_idx`(`status`),
    INDEX `transfers_dispatched_at_idx`(`dispatched_at`),
    INDEX `transfers_received_at_idx`(`received_at`),
    UNIQUE INDEX `transfers_company_id_reference_no_key`(`company_id`, `reference_no`),
    UNIQUE INDEX `transfers_company_id_client_txn_id_key`(`company_id`, `client_txn_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transfer_items` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `transfer_id` VARCHAR(191) NOT NULL,
    `line_no` INTEGER NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `qty_requested` DECIMAL(65, 30) NOT NULL,
    `qty_dispatched` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `qty_received` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `unit_cost_snapshot` DECIMAL(65, 30) NULL,
    `reservation_id` VARCHAR(191) NULL,

    INDEX `transfer_items_company_id_idx`(`company_id`),
    INDEX `transfer_items_transfer_id_idx`(`transfer_id`),
    INDEX `transfer_items_product_id_idx`(`product_id`),
    INDEX `transfer_items_reservation_id_idx`(`reservation_id`),
    UNIQUE INDEX `transfer_items_transfer_id_line_no_key`(`transfer_id`, `line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transfer_item_serials` (
    `transfer_item_id` VARCHAR(191) NOT NULL,
    `serial_id` VARCHAR(191) NOT NULL,

    INDEX `transfer_item_serials_serial_id_idx`(`serial_id`),
    PRIMARY KEY (`transfer_item_id`, `serial_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quotations` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `client_txn_id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NULL,
    `customer_name_snapshot` VARCHAR(191) NULL,
    `currency_code` VARCHAR(191) NOT NULL DEFAULT 'BDT',
    `exchange_rate` DECIMAL(65, 30) NOT NULL DEFAULT 1,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `valid_until` DATETIME(3) NULL,
    `business_date` DATETIME(3) NOT NULL,
    `subtotal` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `discount_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `tax_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `grand_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `notes` VARCHAR(191) NULL,
    `converted_sale_id` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `quotations_company_id_idx`(`company_id`),
    INDEX `quotations_branch_id_idx`(`branch_id`),
    INDEX `quotations_customer_id_idx`(`customer_id`),
    INDEX `quotations_status_idx`(`status`),
    INDEX `quotations_business_date_idx`(`business_date`),
    INDEX `quotations_valid_until_idx`(`valid_until`),
    UNIQUE INDEX `quotations_company_id_reference_no_key`(`company_id`, `reference_no`),
    UNIQUE INDEX `quotations_company_id_client_txn_id_key`(`company_id`, `client_txn_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quotation_items` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `quotation_id` VARCHAR(191) NOT NULL,
    `line_no` INTEGER NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `product_name_snapshot` VARCHAR(191) NOT NULL,
    `product_code_snapshot` VARCHAR(191) NOT NULL,
    `qty` DECIMAL(65, 30) NOT NULL,
    `unit_price` DECIMAL(65, 30) NOT NULL,
    `discount_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `tax_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `line_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,

    INDEX `quotation_items_company_id_idx`(`company_id`),
    INDEX `quotation_items_quotation_id_idx`(`quotation_id`),
    INDEX `quotation_items_product_id_idx`(`product_id`),
    UNIQUE INDEX `quotation_items_quotation_id_line_no_key`(`quotation_id`, `line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `warehouse_id` VARCHAR(191) NOT NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `client_txn_id` VARCHAR(191) NOT NULL,
    `quotation_id` VARCHAR(191) NULL,
    `customer_id` VARCHAR(191) NULL,
    `customer_name_snapshot` VARCHAR(191) NULL,
    `customer_phone_snapshot` VARCHAR(191) NULL,
    `biller_id` VARCHAR(191) NOT NULL,
    `cashier_shift_id` VARCHAR(191) NULL,
    `sale_status` VARCHAR(191) NOT NULL DEFAULT 'completed',
    `currency_code` VARCHAR(191) NOT NULL DEFAULT 'BDT',
    `exchange_rate` DECIMAL(65, 30) NOT NULL DEFAULT 1,
    `subtotal` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `discount_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `tax_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `shipping_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `grand_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `base_grand_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `sale_note` VARCHAR(191) NULL,
    `business_date` DATETIME(3) NOT NULL,
    `offline_created_at` DATETIME(3) NULL,
    `posted_at` DATETIME(3) NULL,
    `voided_at` DATETIME(3) NULL,
    `voided_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sales_quotation_id_key`(`quotation_id`),
    INDEX `sales_company_id_idx`(`company_id`),
    INDEX `sales_branch_id_idx`(`branch_id`),
    INDEX `sales_warehouse_id_idx`(`warehouse_id`),
    INDEX `sales_customer_id_idx`(`customer_id`),
    INDEX `sales_biller_id_idx`(`biller_id`),
    INDEX `sales_cashier_shift_id_idx`(`cashier_shift_id`),
    INDEX `sales_sale_status_idx`(`sale_status`),
    INDEX `sales_business_date_idx`(`business_date`),
    INDEX `sales_posted_at_idx`(`posted_at`),
    UNIQUE INDEX `sales_company_id_reference_no_key`(`company_id`, `reference_no`),
    UNIQUE INDEX `sales_company_id_client_txn_id_key`(`company_id`, `client_txn_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_items` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `sale_id` VARCHAR(191) NOT NULL,
    `line_no` INTEGER NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `product_name_snapshot` VARCHAR(191) NOT NULL,
    `product_code_snapshot` VARCHAR(191) NOT NULL,
    `unit_code_snapshot` VARCHAR(191) NOT NULL,
    `qty` DECIMAL(65, 30) NOT NULL,
    `unit_cost_snapshot` DECIMAL(65, 30) NOT NULL,
    `unit_price_snapshot` DECIMAL(65, 30) NOT NULL,
    `gross_amount` DECIMAL(65, 30) NOT NULL,
    `discount_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `taxable_amount` DECIMAL(65, 30) NOT NULL,
    `tax_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `line_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `warranty_months_snapshot` INTEGER NULL,
    `inventory_issue_source` VARCHAR(191) NOT NULL DEFAULT 'sale',

    INDEX `sale_items_company_id_idx`(`company_id`),
    INDEX `sale_items_sale_id_idx`(`sale_id`),
    INDEX `sale_items_product_id_idx`(`product_id`),
    INDEX `sale_items_inventory_issue_source_idx`(`inventory_issue_source`),
    UNIQUE INDEX `sale_items_sale_id_line_no_key`(`sale_id`, `line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_item_serials` (
    `sale_item_id` VARCHAR(191) NOT NULL,
    `serial_id` VARCHAR(191) NOT NULL,

    INDEX `sale_item_serials_serial_id_idx`(`serial_id`),
    PRIMARY KEY (`sale_item_id`, `serial_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_item_taxes` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `sale_item_id` VARCHAR(191) NOT NULL,
    `tax_component_id` VARCHAR(191) NOT NULL,
    `component_code_snapshot` VARCHAR(191) NOT NULL,
    `rate_snapshot` DECIMAL(65, 30) NOT NULL,
    `taxable_base` DECIMAL(65, 30) NOT NULL,
    `tax_amount` DECIMAL(65, 30) NOT NULL,

    INDEX `sale_item_taxes_company_id_idx`(`company_id`),
    INDEX `sale_item_taxes_sale_item_id_idx`(`sale_item_id`),
    INDEX `sale_item_taxes_tax_component_id_idx`(`tax_component_id`),
    UNIQUE INDEX `sale_item_taxes_sale_item_id_tax_component_id_key`(`sale_item_id`, `tax_component_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_returns` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `warehouse_id` VARCHAR(191) NOT NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `client_txn_id` VARCHAR(191) NOT NULL,
    `sale_id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `business_date` DATETIME(3) NOT NULL,
    `disposition` VARCHAR(191) NOT NULL DEFAULT 'restock',
    `reason` VARCHAR(191) NOT NULL,
    `subtotal_credit` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `tax_credit` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `total_credit` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `base_total_credit` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `refund_status` VARCHAR(191) NOT NULL DEFAULT 'not_required',
    `approved_by` VARCHAR(191) NULL,
    `posted_at` DATETIME(3) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sale_returns_company_id_idx`(`company_id`),
    INDEX `sale_returns_sale_id_idx`(`sale_id`),
    INDEX `sale_returns_status_idx`(`status`),
    INDEX `sale_returns_business_date_idx`(`business_date`),
    UNIQUE INDEX `sale_returns_company_id_reference_no_key`(`company_id`, `reference_no`),
    UNIQUE INDEX `sale_returns_company_id_client_txn_id_key`(`company_id`, `client_txn_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_return_items` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `sale_return_id` VARCHAR(191) NOT NULL,
    `sale_item_id` VARCHAR(191) NOT NULL,
    `qty_returned` DECIMAL(65, 30) NOT NULL,
    `unit_price_credit` DECIMAL(65, 30) NOT NULL,
    `unit_cost_snapshot` DECIMAL(65, 30) NOT NULL,
    `discount_credit` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `tax_credit` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `line_credit` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `condition` VARCHAR(191) NOT NULL DEFAULT 'resalable',

    INDEX `sale_return_items_company_id_idx`(`company_id`),
    INDEX `sale_return_items_sale_return_id_idx`(`sale_return_id`),
    INDEX `sale_return_items_sale_item_id_idx`(`sale_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_return_item_serials` (
    `sale_return_item_id` VARCHAR(191) NOT NULL,
    `serial_id` VARCHAR(191) NOT NULL,

    INDEX `sale_return_item_serials_serial_id_idx`(`serial_id`),
    PRIMARY KEY (`sale_return_item_id`, `serial_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cashier_shifts` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `warehouse_id` VARCHAR(191) NOT NULL,
    `cashier_id` VARCHAR(191) NOT NULL,
    `cash_account_id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `opened_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closed_at` DATETIME(3) NULL,
    `opening_float` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `expected_closing_cash` DECIMAL(65, 30) NULL,
    `counted_closing_cash` DECIMAL(65, 30) NULL,
    `variance` DECIMAL(65, 30) NULL,
    `variance_reason` VARCHAR(191) NULL,
    `approved_by` VARCHAR(191) NULL,
    `approved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `cashier_shifts_company_id_idx`(`company_id`),
    INDEX `cashier_shifts_branch_id_idx`(`branch_id`),
    INDEX `cashier_shifts_cashier_id_idx`(`cashier_id`),
    INDEX `cashier_shifts_cash_account_id_idx`(`cash_account_id`),
    INDEX `cashier_shifts_status_idx`(`status`),
    INDEX `cashier_shifts_opened_at_idx`(`opened_at`),
    INDEX `cashier_shifts_closed_at_idx`(`closed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_drawer_counts` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `cashier_shift_id` VARCHAR(191) NOT NULL,
    `count_type` VARCHAR(191) NOT NULL DEFAULT 'opening',
    `counted_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `denomination_detail` VARCHAR(191) NOT NULL DEFAULT '{}',
    `counted_by` VARCHAR(191) NOT NULL,
    `counted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `cash_drawer_counts_company_id_idx`(`company_id`),
    INDEX `cash_drawer_counts_cashier_shift_id_idx`(`cashier_shift_id`),
    INDEX `cash_drawer_counts_count_type_idx`(`count_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `client_txn_id` VARCHAR(191) NOT NULL,
    `payment_type` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(191) NOT NULL DEFAULT 'incoming',
    `customer_id` VARCHAR(191) NULL,
    `supplier_id` VARCHAR(191) NULL,
    `sale_return_id` VARCHAR(191) NULL,
    `financial_account_id` VARCHAR(191) NOT NULL,
    `cashier_shift_id` VARCHAR(191) NULL,
    `currency_code` VARCHAR(191) NOT NULL DEFAULT 'BDT',
    `exchange_rate` DECIMAL(65, 30) NOT NULL DEFAULT 1,
    `amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `base_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `payment_method` VARCHAR(191) NOT NULL DEFAULT 'cash',
    `method_reference` VARCHAR(191) NULL,
    `cheque_status` VARCHAR(191) NOT NULL DEFAULT 'not_applicable',
    `payment_status` VARCHAR(191) NOT NULL DEFAULT 'posted',
    `business_date` DATETIME(3) NOT NULL,
    `received_or_paid_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reversed_payment_id` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `posted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payments_company_id_idx`(`company_id`),
    INDEX `payments_branch_id_idx`(`branch_id`),
    INDEX `payments_customer_id_idx`(`customer_id`),
    INDEX `payments_supplier_id_idx`(`supplier_id`),
    INDEX `payments_sale_return_id_idx`(`sale_return_id`),
    INDEX `payments_cashier_shift_id_idx`(`cashier_shift_id`),
    INDEX `payments_payment_type_idx`(`payment_type`),
    INDEX `payments_direction_idx`(`direction`),
    INDEX `payments_payment_method_idx`(`payment_method`),
    INDEX `payments_cheque_status_idx`(`cheque_status`),
    INDEX `payments_payment_status_idx`(`payment_status`),
    INDEX `payments_business_date_idx`(`business_date`),
    UNIQUE INDEX `payments_company_id_reference_no_key`(`company_id`, `reference_no`),
    UNIQUE INDEX `payments_company_id_client_txn_id_key`(`company_id`, `client_txn_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_allocations` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `payment_id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `event_line_no` INTEGER NOT NULL,
    `sale_id` VARCHAR(191) NULL,
    `purchase_id` VARCHAR(191) NULL,
    `allocation_source` VARCHAR(191) NOT NULL DEFAULT 'direct',
    `allocated_amount` DECIMAL(65, 30) NOT NULL,
    `allocated_base_amount` DECIMAL(65, 30) NOT NULL,
    `allocated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NOT NULL,

    INDEX `payment_allocations_company_id_idx`(`company_id`),
    INDEX `payment_allocations_payment_id_idx`(`payment_id`),
    INDEX `payment_allocations_event_id_idx`(`event_id`),
    INDEX `payment_allocations_sale_id_idx`(`sale_id`),
    INDEX `payment_allocations_purchase_id_idx`(`purchase_id`),
    INDEX `payment_allocations_allocation_source_idx`(`allocation_source`),
    UNIQUE INDEX `payment_allocations_company_id_event_id_event_line_no_key`(`company_id`, `event_id`, `event_line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `return_refund_allocations` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `payment_id` VARCHAR(191) NOT NULL,
    `sale_return_id` VARCHAR(191) NULL,
    `purchase_return_id` VARCHAR(191) NULL,
    `allocated_amount` DECIMAL(65, 30) NOT NULL,
    `allocated_base_amount` DECIMAL(65, 30) NOT NULL,

    INDEX `return_refund_allocations_company_id_idx`(`company_id`),
    INDEX `return_refund_allocations_payment_id_idx`(`payment_id`),
    INDEX `return_refund_allocations_sale_return_id_idx`(`sale_return_id`),
    INDEX `return_refund_allocations_purchase_return_id_idx`(`purchase_return_id`),
    UNIQUE INDEX `return_refund_allocations_payment_id_key`(`payment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `installments` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `sale_id` VARCHAR(191) NOT NULL,
    `installment_no` INTEGER NOT NULL,
    `due_date` DATETIME(3) NOT NULL,
    `amount` DECIMAL(65, 30) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'scheduled',

    INDEX `installments_company_id_idx`(`company_id`),
    INDEX `installments_sale_id_idx`(`sale_id`),
    INDEX `installments_due_date_idx`(`due_date`),
    INDEX `installments_status_idx`(`status`),
    UNIQUE INDEX `installments_sale_id_installment_no_key`(`sale_id`, `installment_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `installment_allocations` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `installment_id` VARCHAR(191) NOT NULL,
    `payment_allocation_id` VARCHAR(191) NOT NULL,
    `allocated_amount` DECIMAL(65, 30) NOT NULL,
    `allocated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `installment_allocations_payment_allocation_id_key`(`payment_allocation_id`),
    INDEX `installment_allocations_company_id_idx`(`company_id`),
    INDEX `installment_allocations_installment_id_idx`(`installment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chart_of_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `account_class` VARCHAR(191) NOT NULL DEFAULT 'asset',
    `account_subtype` VARCHAR(191) NOT NULL,
    `parent_id` VARCHAR(191) NULL,
    `normal_balance` VARCHAR(191) NOT NULL DEFAULT 'D',
    `allow_manual_posting` BOOLEAN NOT NULL DEFAULT false,
    `is_control_account` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `chart_of_accounts_company_id_idx`(`company_id`),
    INDEX `chart_of_accounts_account_class_idx`(`account_class`),
    INDEX `chart_of_accounts_account_subtype_idx`(`account_subtype`),
    INDEX `chart_of_accounts_parent_id_idx`(`parent_id`),
    INDEX `chart_of_accounts_is_control_account_idx`(`is_control_account`),
    UNIQUE INDEX `chart_of_accounts_company_id_code_key`(`company_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `financial_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NULL,
    `chart_of_account_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `account_type` VARCHAR(191) NOT NULL DEFAULT 'cash',
    `currency_code` VARCHAR(191) NOT NULL DEFAULT 'BDT',
    `account_number_masked` VARCHAR(191) NULL,
    `account_number_encrypted` LONGBLOB NULL,
    `account_number_key_version` INTEGER NOT NULL DEFAULT 1,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `financial_accounts_company_id_idx`(`company_id`),
    INDEX `financial_accounts_branch_id_idx`(`branch_id`),
    INDEX `financial_accounts_account_type_idx`(`account_type`),
    UNIQUE INDEX `financial_accounts_company_id_chart_of_account_id_key`(`company_id`, `chart_of_account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fiscal_periods` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `period_name` VARCHAR(191) NOT NULL,
    `period_start` DATETIME(3) NOT NULL,
    `period_end` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `locked_by` VARCHAR(191) NULL,
    `locked_at` DATETIME(3) NULL,

    INDEX `fiscal_periods_company_id_idx`(`company_id`),
    INDEX `fiscal_periods_status_idx`(`status`),
    INDEX `fiscal_periods_period_start_idx`(`period_start`),
    INDEX `fiscal_periods_period_end_idx`(`period_end`),
    UNIQUE INDEX `fiscal_periods_company_id_period_name_key`(`company_id`, `period_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journal_entries` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `entry_no` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `posting_kind` VARCHAR(191) NOT NULL,
    `entry_date` DATETIME(3) NOT NULL,
    `posting_date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `source_type` VARCHAR(191) NOT NULL,
    `source_id` VARCHAR(191) NOT NULL,
    `currency_code` VARCHAR(191) NOT NULL DEFAULT 'BDT',
    `exchange_rate` DECIMAL(65, 30) NOT NULL DEFAULT 1,
    `description` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'posted',
    `reversal_of_entry_id` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `posted_by` VARCHAR(191) NULL,
    `posted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `journal_entries_company_id_idx`(`company_id`),
    INDEX `journal_entries_entry_date_idx`(`entry_date`),
    INDEX `journal_entries_posting_date_idx`(`posting_date`),
    INDEX `journal_entries_source_type_source_id_idx`(`source_type`, `source_id`),
    INDEX `journal_entries_status_idx`(`status`),
    INDEX `journal_entries_posted_at_idx`(`posted_at`),
    UNIQUE INDEX `journal_entries_company_id_entry_no_key`(`company_id`, `entry_no`),
    UNIQUE INDEX `journal_entries_company_id_event_id_posting_kind_key`(`company_id`, `event_id`, `posting_kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journal_lines` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `journal_entry_id` VARCHAR(191) NOT NULL,
    `line_no` INTEGER NOT NULL,
    `branch_id` VARCHAR(191) NULL,
    `chart_of_account_id` VARCHAR(191) NOT NULL,
    `financial_account_id` VARCHAR(191) NULL,
    `customer_id` VARCHAR(191) NULL,
    `supplier_id` VARCHAR(191) NULL,
    `product_id` VARCHAR(191) NULL,
    `debit_base` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `credit_base` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `amount_currency` DECIMAL(65, 30) NULL,
    `currency_code` VARCHAR(191) NULL,
    `memo` VARCHAR(191) NULL,

    INDEX `journal_lines_company_id_idx`(`company_id`),
    INDEX `journal_lines_journal_entry_id_idx`(`journal_entry_id`),
    INDEX `journal_lines_branch_id_idx`(`branch_id`),
    INDEX `journal_lines_chart_of_account_id_idx`(`chart_of_account_id`),
    INDEX `journal_lines_financial_account_id_idx`(`financial_account_id`),
    INDEX `journal_lines_customer_id_idx`(`customer_id`),
    INDEX `journal_lines_supplier_id_idx`(`supplier_id`),
    INDEX `journal_lines_product_id_idx`(`product_id`),
    UNIQUE INDEX `journal_lines_journal_entry_id_line_no_key`(`journal_entry_id`, `line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `accounting_policies` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `inventory_account_id` VARCHAR(191) NOT NULL,
    `cogs_account_id` VARCHAR(191) NOT NULL,
    `sales_revenue_account_id` VARCHAR(191) NOT NULL,
    `ar_account_id` VARCHAR(191) NOT NULL,
    `ap_account_id` VARCHAR(191) NOT NULL,
    `customer_advance_account_id` VARCHAR(191) NOT NULL,
    `supplier_advance_account_id` VARCHAR(191) NOT NULL,
    `purchase_variance_account_id` VARCHAR(191) NOT NULL,
    `gift_card_liability_account_id` VARCHAR(191) NOT NULL,
    `reward_expense_account_id` VARCHAR(191) NULL,
    `branch_clearing_account_id` VARCHAR(191) NULL,
    `inventory_damage_account_id` VARCHAR(191) NULL,
    `inventory_write_off_account_id` VARCHAR(191) NULL,
    `exchange_gain_loss_account_id` VARCHAR(191) NULL,
    `courier_clearing_account_id` VARCHAR(191) NULL,
    `service_cogs_account_id` VARCHAR(191) NULL,
    `repair_wip_account_id` VARCHAR(191) NULL,
    `cheque_clearing_account_id` VARCHAR(191) NULL,
    `rounding_account_id` VARCHAR(191) NULL,
    `grni_account_id` VARCHAR(191) NULL,
    `opening_balance_equity_account_id` VARCHAR(191) NULL,
    `impairment_allowance_account_id` VARCHAR(191) NULL,
    `cheque_bounce_fee_account_id` VARCHAR(191) NULL,

    UNIQUE INDEX `accounting_policies_company_id_key`(`company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expense_categories` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `expense_account_id` VARCHAR(191) NOT NULL,
    `requires_approval` BOOLEAN NOT NULL DEFAULT true,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `expense_categories_company_id_idx`(`company_id`),
    UNIQUE INDEX `expense_categories_company_id_name_key`(`company_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expenses` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `client_txn_id` VARCHAR(191) NOT NULL,
    `supplier_id` VARCHAR(191) NULL,
    `payee_name` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `expense_date` DATETIME(3) NOT NULL,
    `currency_code` VARCHAR(191) NOT NULL DEFAULT 'BDT',
    `exchange_rate` DECIMAL(65, 30) NOT NULL DEFAULT 1,
    `subtotal` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `tax_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `grand_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `base_grand_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `description` VARCHAR(191) NOT NULL,
    `requested_by` VARCHAR(191) NOT NULL,
    `approved_by` VARCHAR(191) NULL,
    `approval_request_id` VARCHAR(191) NULL,
    `journal_entry_id` VARCHAR(191) NULL,
    `posted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `expenses_company_id_idx`(`company_id`),
    INDEX `expenses_branch_id_idx`(`branch_id`),
    INDEX `expenses_supplier_id_idx`(`supplier_id`),
    INDEX `expenses_status_idx`(`status`),
    INDEX `expenses_expense_date_idx`(`expense_date`),
    UNIQUE INDEX `expenses_company_id_reference_no_key`(`company_id`, `reference_no`),
    UNIQUE INDEX `expenses_company_id_client_txn_id_key`(`company_id`, `client_txn_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expense_items` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `expense_id` VARCHAR(191) NOT NULL,
    `line_no` INTEGER NOT NULL,
    `expense_category_id` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `tax_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `base_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,

    INDEX `expense_items_company_id_idx`(`company_id`),
    INDEX `expense_items_expense_id_idx`(`expense_id`),
    INDEX `expense_items_expense_category_id_idx`(`expense_category_id`),
    UNIQUE INDEX `expense_items_expense_id_line_no_key`(`expense_id`, `line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `delivery_orders` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `sale_id` VARCHAR(191) NOT NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `recipient_name` VARCHAR(191) NOT NULL,
    `recipient_phone` VARCHAR(191) NOT NULL,
    `address_snapshot` VARCHAR(191) NOT NULL,
    `district` VARCHAR(191) NULL,
    `area` VARCHAR(191) NULL,
    `delivery_method` VARCHAR(191) NOT NULL DEFAULT 'internal',
    `courier_code` VARCHAR(191) NULL,
    `cod_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `delivery_fee` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `expected_delivery_date` DATETIME(3) NULL,
    `delivered_at` DATETIME(3) NULL,
    `received_by_name` VARCHAR(191) NULL,
    `assigned_user_id` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `delivery_orders_company_id_idx`(`company_id`),
    INDEX `delivery_orders_sale_id_idx`(`sale_id`),
    INDEX `delivery_orders_status_idx`(`status`),
    INDEX `delivery_orders_delivery_method_idx`(`delivery_method`),
    INDEX `delivery_orders_courier_code_idx`(`courier_code`),
    INDEX `delivery_orders_recipient_phone_idx`(`recipient_phone`),
    INDEX `delivery_orders_created_at_idx`(`created_at`),
    UNIQUE INDEX `delivery_orders_company_id_reference_no_key`(`company_id`, `reference_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `delivery_items` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `delivery_order_id` VARCHAR(191) NOT NULL,
    `sale_item_id` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(65, 30) NOT NULL,

    INDEX `delivery_items_company_id_idx`(`company_id`),
    INDEX `delivery_items_delivery_order_id_idx`(`delivery_order_id`),
    INDEX `delivery_items_sale_item_id_idx`(`sale_item_id`),
    UNIQUE INDEX `delivery_items_delivery_order_id_sale_item_id_key`(`delivery_order_id`, `sale_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `delivery_events` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `delivery_order_id` VARCHAR(191) NOT NULL,
    `from_status` VARCHAR(191) NULL,
    `to_status` VARCHAR(191) NOT NULL,
    `event_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `provider_status` VARCHAR(191) NULL,
    `location_text` VARCHAR(191) NULL,
    `note` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NULL,

    INDEX `delivery_events_company_id_idx`(`company_id`),
    INDEX `delivery_events_delivery_order_id_idx`(`delivery_order_id`),
    INDEX `delivery_events_to_status_idx`(`to_status`),
    INDEX `delivery_events_event_at_idx`(`event_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `courier_shipments` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `delivery_order_id` VARCHAR(191) NOT NULL,
    `integration_credential_id` VARCHAR(191) NOT NULL,
    `provider_shipment_id` VARCHAR(191) NULL,
    `tracking_code` VARCHAR(191) NULL,
    `booking_status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `label_media_id` VARCHAR(191) NULL,
    `quoted_charge` DECIMAL(65, 30) NULL,
    `final_charge` DECIMAL(65, 30) NULL,
    `last_provider_status` VARCHAR(191) NULL,
    `last_synced_at` DATETIME(3) NULL,
    `sanitized_provider_data` VARCHAR(191) NOT NULL DEFAULT '{}',

    UNIQUE INDEX `courier_shipments_delivery_order_id_key`(`delivery_order_id`),
    INDEX `courier_shipments_company_id_idx`(`company_id`),
    INDEX `courier_shipments_booking_status_idx`(`booking_status`),
    INDEX `courier_shipments_tracking_code_idx`(`tracking_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `courier_cod_settlements` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `courier_code` VARCHAR(191) NOT NULL,
    `settlement_date` DATETIME(3) NOT NULL,
    `gross_cod_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `fee_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `adjustment_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `net_received_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `financial_account_id` VARCHAR(191) NOT NULL,
    `journal_entry_id` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `posted_at` DATETIME(3) NULL,

    INDEX `courier_cod_settlements_company_id_idx`(`company_id`),
    INDEX `courier_cod_settlements_courier_code_idx`(`courier_code`),
    INDEX `courier_cod_settlements_status_idx`(`status`),
    INDEX `courier_cod_settlements_settlement_date_idx`(`settlement_date`),
    UNIQUE INDEX `courier_cod_settlements_company_id_reference_no_key`(`company_id`, `reference_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `courier_cod_settlement_items` (
    `settlement_id` VARCHAR(191) NOT NULL,
    `delivery_order_id` VARCHAR(191) NOT NULL,
    `cod_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `fee_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `adjustment_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,

    UNIQUE INDEX `courier_cod_settlement_items_delivery_order_id_key`(`delivery_order_id`),
    PRIMARY KEY (`settlement_id`, `delivery_order_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_requests` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `repair_warehouse_id` VARCHAR(191) NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NULL,
    `sale_id` VARCHAR(191) NULL,
    `service_sale_id` VARCHAR(191) NULL,
    `serial_id` VARCHAR(191) NULL,
    `service_type` VARCHAR(191) NOT NULL DEFAULT 'paid_repair',
    `status` VARCHAR(191) NOT NULL DEFAULT 'received',
    `issue_description` VARCHAR(191) NOT NULL,
    `intake_condition` VARCHAR(191) NULL,
    `accessories_received` VARCHAR(191) NULL,
    `estimated_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `approved_amount` DECIMAL(65, 30) NULL,
    `deposit_required_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `promised_date` DATETIME(3) NULL,
    `warranty_eligible_snapshot` BOOLEAN NULL,
    `warranty_expiry_snapshot` DATETIME(3) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `delivered_at` DATETIME(3) NULL,

    UNIQUE INDEX `service_requests_service_sale_id_key`(`service_sale_id`),
    INDEX `service_requests_company_id_idx`(`company_id`),
    INDEX `service_requests_branch_id_idx`(`branch_id`),
    INDEX `service_requests_customer_id_idx`(`customer_id`),
    INDEX `service_requests_sale_id_idx`(`sale_id`),
    INDEX `service_requests_serial_id_idx`(`serial_id`),
    INDEX `service_requests_service_type_idx`(`service_type`),
    INDEX `service_requests_status_idx`(`status`),
    INDEX `service_requests_received_at_idx`(`received_at`),
    UNIQUE INDEX `service_requests_company_id_reference_no_key`(`company_id`, `reference_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_request_parts` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `service_request_id` VARCHAR(191) NOT NULL,
    `line_no` INTEGER NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(65, 30) NOT NULL,
    `unit_cost_snapshot` DECIMAL(65, 30) NOT NULL,
    `unit_price` DECIMAL(65, 30) NOT NULL,
    `warranty_covered` BOOLEAN NOT NULL DEFAULT false,
    `consumed_event_id` VARCHAR(191) NULL,

    INDEX `service_request_parts_company_id_idx`(`company_id`),
    INDEX `service_request_parts_service_request_id_idx`(`service_request_id`),
    INDEX `service_request_parts_product_id_idx`(`product_id`),
    UNIQUE INDEX `service_request_parts_service_request_id_line_no_key`(`service_request_id`, `line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_events` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `service_request_id` VARCHAR(191) NOT NULL,
    `event_type` VARCHAR(191) NOT NULL,
    `event_data` VARCHAR(191) NOT NULL DEFAULT '{}',
    `created_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `service_events_company_id_idx`(`company_id`),
    INDEX `service_events_service_request_id_idx`(`service_request_id`),
    INDEX `service_events_event_type_idx`(`event_type`),
    INDEX `service_events_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `warranty_claims` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `service_request_id` VARCHAR(191) NOT NULL,
    `claim_type` VARCHAR(191) NOT NULL DEFAULT 'repair',
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `eligibility_reason` VARCHAR(191) NOT NULL,
    `replacement_serial_id` VARCHAR(191) NULL,
    `supplier_reference` VARCHAR(191) NULL,
    `approval_request_id` VARCHAR(191) NULL,
    `approved_by` VARCHAR(191) NULL,
    `approved_at` DATETIME(3) NULL,
    `fulfilled_at` DATETIME(3) NULL,

    UNIQUE INDEX `warranty_claims_service_request_id_key`(`service_request_id`),
    UNIQUE INDEX `warranty_claims_replacement_serial_id_key`(`replacement_serial_id`),
    INDEX `warranty_claims_company_id_idx`(`company_id`),
    INDEX `warranty_claims_claim_type_idx`(`claim_type`),
    INDEX `warranty_claims_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_subjects` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `lead_subjects_company_id_name_key`(`company_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_sources` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `lead_sources_company_id_name_key`(`company_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_statuses` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `is_won` BOOLEAN NOT NULL DEFAULT false,
    `is_lost` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `lead_statuses_company_id_name_key`(`company_id`, `name`),
    UNIQUE INDEX `lead_statuses_company_id_position_key`(`company_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leads` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NULL,
    `subject_id` VARCHAR(191) NULL,
    `source_id` VARCHAR(191) NULL,
    `status_id` VARCHAR(191) NOT NULL,
    `assigned_to` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `company_name` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `estimated_value` DECIMAL(65, 30) NULL,
    `next_action_at` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,
    `converted_customer_id` VARCHAR(191) NULL,
    `converted_quotation_id` VARCHAR(191) NULL,
    `lost_reason` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `leads_converted_customer_id_key`(`converted_customer_id`),
    INDEX `leads_company_id_idx`(`company_id`),
    INDEX `leads_status_id_idx`(`status_id`),
    INDEX `leads_assigned_to_idx`(`assigned_to`),
    INDEX `leads_next_action_at_idx`(`next_action_at`),
    INDEX `leads_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_activities` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `lead_id` VARCHAR(191) NOT NULL,
    `activity_type` VARCHAR(191) NOT NULL,
    `summary` VARCHAR(191) NOT NULL,
    `details` VARCHAR(191) NULL,
    `scheduled_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lead_activities_company_id_idx`(`company_id`),
    INDEX `lead_activities_lead_id_idx`(`lead_id`),
    INDEX `lead_activities_activity_type_idx`(`activity_type`),
    INDEX `lead_activities_scheduled_at_idx`(`scheduled_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gift_cards` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `pin_hash` VARCHAR(191) NULL,
    `face_value` DECIMAL(65, 30) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `issued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NULL,
    `issued_by` VARCHAR(191) NOT NULL,
    `issued_sale_id` VARCHAR(191) NULL,

    UNIQUE INDEX `gift_cards_code_key`(`code`),
    INDEX `gift_cards_company_id_idx`(`company_id`),
    INDEX `gift_cards_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departments` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `manager_employee_id` VARCHAR(191) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `departments_company_id_name_key`(`company_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `designations` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `designations_company_id_name_key`(`company_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employees` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `employee_no` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `department_id` VARCHAR(191) NULL,
    `designation_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `join_date` DATETIME(3) NOT NULL,
    `employment_status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `base_salary` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `payroll_expense_account_id` VARCHAR(191) NOT NULL,
    `payroll_payable_account_id` VARCHAR(191) NOT NULL,
    `bank_account_no` VARCHAR(191) NULL,
    `bank_code` VARCHAR(191) NULL,
    `bank_branch_code` VARCHAR(191) NULL,
    `terminated_at` DATETIME(3) NULL,

    UNIQUE INDEX `employees_user_id_key`(`user_id`),
    INDEX `employees_company_id_idx`(`company_id`),
    INDEX `employees_branch_id_idx`(`branch_id`),
    INDEX `employees_employment_status_idx`(`employment_status`),
    UNIQUE INDEX `employees_company_id_employee_no_key`(`company_id`, `employee_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_runs` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `period_start` DATETIME(3) NOT NULL,
    `period_end` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `gross_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `deduction_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `net_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `approved_by` VARCHAR(191) NULL,
    `posted_at` DATETIME(3) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payroll_runs_company_id_idx`(`company_id`),
    INDEX `payroll_runs_status_idx`(`status`),
    UNIQUE INDEX `payroll_runs_company_id_reference_no_key`(`company_id`, `reference_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `notification_type` VARCHAR(191) NOT NULL,
    `severity` VARCHAR(191) NOT NULL DEFAULT 'info',
    `title` VARCHAR(191) NOT NULL,
    `body` VARCHAR(191) NOT NULL,
    `action_url` VARCHAR(191) NULL,
    `entity_type` VARCHAR(191) NULL,
    `entity_id` VARCHAR(191) NULL,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_company_id_idx`(`company_id`),
    INDEX `notifications_severity_idx`(`severity`),
    INDEX `notifications_created_at_idx`(`created_at`),
    INDEX `notifications_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbox_events` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `business_event_id` VARCHAR(191) NOT NULL,
    `event_name` VARCHAR(191) NOT NULL,
    `aggregate_type` VARCHAR(191) NOT NULL,
    `aggregate_id` VARCHAR(191) NOT NULL,
    `payload` VARCHAR(191) NOT NULL DEFAULT '{}',
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `published_at` DATETIME(3) NULL,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL DEFAULT 10,
    `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `dead_lettered_at` DATETIME(3) NULL,
    `dead_letter_reason` VARCHAR(191) NULL,
    `last_error` VARCHAR(191) NULL,

    INDEX `outbox_events_company_id_idx`(`company_id`),
    INDEX `outbox_events_status_idx`(`status`),
    INDEX `outbox_events_next_attempt_at_idx`(`next_attempt_at`),
    INDEX `outbox_events_published_at_idx`(`published_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_endpoints` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `secret_ciphertext` LONGBLOB NOT NULL,
    `subscribedEvents` VARCHAR(191) NOT NULL DEFAULT '[]',
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `webhook_endpoints_company_id_idx`(`company_id`),
    INDEX `webhook_endpoints_status_idx`(`status`),
    UNIQUE INDEX `webhook_endpoints_company_id_url_key`(`company_id`, `url`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_deliveries` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `webhook_endpoint_id` VARCHAR(191) NOT NULL,
    `outbox_event_id` VARCHAR(191) NOT NULL,
    `deliveryId` VARCHAR(191) NOT NULL,
    `signature` VARCHAR(191) NOT NULL,
    `timestamp_header` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_attempted_at` DATETIME(3) NULL,
    `response_status` INTEGER NULL,
    `response_body_excerpt` VARCHAR(191) NULL,
    `last_error` VARCHAR(191) NULL,

    UNIQUE INDEX `webhook_deliveries_deliveryId_key`(`deliveryId`),
    INDEX `webhook_deliveries_company_id_idx`(`company_id`),
    INDEX `webhook_deliveries_status_idx`(`status`),
    INDEX `webhook_deliveries_next_attempt_at_idx`(`next_attempt_at`),
    UNIQUE INDEX `webhook_deliveries_webhook_endpoint_id_outbox_event_id_key`(`webhook_endpoint_id`, `outbox_event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `job_type` VARCHAR(191) NOT NULL,
    `file_name` VARCHAR(191) NOT NULL,
    `object_key` VARCHAR(191) NULL,
    `file_sha256` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'uploaded',
    `total_rows` INTEGER NOT NULL DEFAULT 0,
    `valid_rows` INTEGER NOT NULL DEFAULT 0,
    `invalid_rows` INTEGER NOT NULL DEFAULT 0,
    `committed_rows` INTEGER NULL,
    `result_object_key` VARCHAR(191) NULL,
    `dry_run` BOOLEAN NOT NULL DEFAULT true,
    `duplicate_strategy` VARCHAR(191) NULL,
    `control_totals` VARCHAR(191) NULL,
    `error_summary` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,

    INDEX `import_jobs_company_id_idx`(`company_id`),
    INDEX `import_jobs_status_idx`(`status`),
    INDEX `import_jobs_file_sha256_idx`(`file_sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_job_errors` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `import_job_id` VARCHAR(191) NOT NULL,
    `row_number` INTEGER NOT NULL,
    `column_name` VARCHAR(191) NULL,
    `error_code` VARCHAR(191) NULL,
    `error_value` VARCHAR(191) NULL,
    `error_message` VARCHAR(191) NOT NULL,
    `raw_row` VARCHAR(191) NULL,

    INDEX `import_job_errors_company_id_idx`(`company_id`),
    INDEX `import_job_errors_import_job_id_idx`(`import_job_id`),
    INDEX `import_job_errors_row_number_idx`(`row_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `offline_commands` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `device_id` VARCHAR(191) NOT NULL,
    `command_type` VARCHAR(191) NOT NULL,
    `sequence_number` INTEGER NOT NULL,
    `payload` VARCHAR(191) NOT NULL DEFAULT '{}',
    `payload_hash` VARCHAR(191) NOT NULL,
    `idempotency_key` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `conflict_reason` VARCHAR(191) NULL,
    `synced_at` DATETIME(3) NULL,
    `sync_batch_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `offline_commands_company_id_idx`(`company_id`),
    INDEX `offline_commands_device_id_idx`(`device_id`),
    INDEX `offline_commands_status_idx`(`status`),
    INDEX `offline_commands_sync_batch_id_idx`(`sync_batch_id`),
    UNIQUE INDEX `offline_commands_device_id_sequence_number_key`(`device_id`, `sequence_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `offline_sync_batches` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `device_id` VARCHAR(191) NOT NULL,
    `batch_number` INTEGER NOT NULL,
    `command_count` INTEGER NOT NULL,
    `synced_count` INTEGER NOT NULL DEFAULT 0,
    `conflict_count` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'processing',
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,

    INDEX `offline_sync_batches_company_id_idx`(`company_id`),
    INDEX `offline_sync_batches_device_id_idx`(`device_id`),
    INDEX `offline_sync_batches_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_transfers` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `reference_no` VARCHAR(191) NOT NULL,
    `client_txn_id` VARCHAR(191) NOT NULL,
    `from_financial_account_id` VARCHAR(191) NOT NULL,
    `to_financial_account_id` VARCHAR(191) NOT NULL,
    `from_currency_code` VARCHAR(191) NOT NULL,
    `to_currency_code` VARCHAR(191) NOT NULL,
    `from_amount` DECIMAL(65, 30) NOT NULL,
    `to_amount` DECIMAL(65, 30) NOT NULL,
    `exchange_rate` DECIMAL(65, 30) NOT NULL DEFAULT 1,
    `transfer_fee` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `business_date` DATETIME(3) NOT NULL,
    `journal_entry_id` VARCHAR(191) NULL,
    `approval_request_id` VARCHAR(191) NULL,
    `reversal_of_id` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `approved_by` VARCHAR(191) NULL,
    `posted_at` DATETIME(3) NULL,

    INDEX `account_transfers_company_id_idx`(`company_id`),
    INDEX `account_transfers_status_idx`(`status`),
    INDEX `account_transfers_business_date_idx`(`business_date`),
    UNIQUE INDEX `account_transfers_company_id_reference_no_key`(`company_id`, `reference_no`),
    UNIQUE INDEX `account_transfers_company_id_client_txn_id_key`(`company_id`, `client_txn_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_advance_ledger` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `payment_id` VARCHAR(191) NULL,
    `sale_return_id` VARCHAR(191) NULL,
    `purchase_return_id` VARCHAR(191) NULL,
    `payment_allocation_id` VARCHAR(191) NULL,
    `entry_type` VARCHAR(191) NOT NULL,
    `amount_delta` DECIMAL(65, 30) NOT NULL,
    `base_amount_delta` DECIMAL(65, 30) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `event_line_no` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `customer_advance_ledger_payment_allocation_id_key`(`payment_allocation_id`),
    INDEX `customer_advance_ledger_company_id_idx`(`company_id`),
    INDEX `customer_advance_ledger_customer_id_idx`(`customer_id`),
    INDEX `customer_advance_ledger_payment_id_idx`(`payment_id`),
    INDEX `customer_advance_ledger_sale_return_id_idx`(`sale_return_id`),
    INDEX `customer_advance_ledger_entry_type_idx`(`entry_type`),
    UNIQUE INDEX `customer_advance_ledger_company_id_event_id_event_line_no_key`(`company_id`, `event_id`, `event_line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supplier_advance_ledger` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `supplier_id` VARCHAR(191) NOT NULL,
    `payment_id` VARCHAR(191) NULL,
    `purchase_return_id` VARCHAR(191) NULL,
    `payment_allocation_id` VARCHAR(191) NULL,
    `entry_type` VARCHAR(191) NOT NULL,
    `amount_delta` DECIMAL(65, 30) NOT NULL,
    `base_amount_delta` DECIMAL(65, 30) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `event_line_no` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `supplier_advance_ledger_payment_allocation_id_key`(`payment_allocation_id`),
    INDEX `supplier_advance_ledger_company_id_idx`(`company_id`),
    INDEX `supplier_advance_ledger_supplier_id_idx`(`supplier_id`),
    INDEX `supplier_advance_ledger_payment_id_idx`(`payment_id`),
    INDEX `supplier_advance_ledger_entry_type_idx`(`entry_type`),
    UNIQUE INDEX `supplier_advance_ledger_company_id_event_id_event_line_no_key`(`company_id`, `event_id`, `event_line_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `withholding_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `payment_id` VARCHAR(191) NOT NULL,
    `withholding_rule_id` VARCHAR(191) NOT NULL,
    `supplier_id` VARCHAR(191) NULL,
    `customer_id` VARCHAR(191) NULL,
    `taxable_base` DECIMAL(65, 30) NOT NULL,
    `rate_snapshot` DECIMAL(65, 30) NOT NULL,
    `withheld_amount` DECIMAL(65, 30) NOT NULL,
    `certificate_no` VARCHAR(191) NULL,
    `remittance_status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `remitted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `withholding_transactions_company_id_idx`(`company_id`),
    INDEX `withholding_transactions_payment_id_idx`(`payment_id`),
    INDEX `withholding_transactions_withholding_rule_id_idx`(`withholding_rule_id`),
    INDEX `withholding_transactions_remittance_status_idx`(`remittance_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expense_item_taxes` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `expense_item_id` VARCHAR(191) NOT NULL,
    `tax_component_id` VARCHAR(191) NOT NULL,
    `component_code_snapshot` VARCHAR(191) NOT NULL,
    `rate_snapshot` DECIMAL(65, 30) NOT NULL,
    `taxable_base` DECIMAL(65, 30) NOT NULL,
    `tax_amount` DECIMAL(65, 30) NOT NULL,
    `recoverable_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,

    INDEX `expense_item_taxes_company_id_idx`(`company_id`),
    INDEX `expense_item_taxes_expense_item_id_idx`(`expense_item_id`),
    UNIQUE INDEX `expense_item_taxes_expense_item_id_tax_component_id_key`(`expense_item_id`, `tax_component_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expense_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `expense_id` VARCHAR(191) NOT NULL,
    `object_key` VARCHAR(191) NOT NULL,
    `file_name` VARCHAR(191) NOT NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `sha256` VARCHAR(191) NOT NULL,
    `uploaded_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `expense_attachments_company_id_idx`(`company_id`),
    INDEX `expense_attachments_expense_id_idx`(`expense_id`),
    INDEX `expense_attachments_sha256_idx`(`sha256`),
    UNIQUE INDEX `expense_attachments_company_id_object_key_key`(`company_id`, `object_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gift_card_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `gift_card_id` VARCHAR(191) NOT NULL,
    `entry_type` VARCHAR(191) NOT NULL,
    `amount_delta` DECIMAL(65, 30) NOT NULL,
    `sale_id` VARCHAR(191) NULL,
    `sale_return_id` VARCHAR(191) NULL,
    `event_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NOT NULL,

    INDEX `gift_card_transactions_company_id_idx`(`company_id`),
    INDEX `gift_card_transactions_gift_card_id_idx`(`gift_card_id`),
    INDEX `gift_card_transactions_entry_type_idx`(`entry_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupons` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `discount_type` VARCHAR(191) NOT NULL DEFAULT 'percentage',
    `value` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `max_discount_amount` DECIMAL(65, 30) NULL,
    `min_order_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `valid_from` DATETIME(3) NOT NULL,
    `valid_to` DATETIME(3) NULL,
    `usage_limit` INTEGER NULL,
    `usage_count` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `coupons_company_id_idx`(`company_id`),
    INDEX `coupons_is_active_idx`(`is_active`),
    UNIQUE INDEX `coupons_company_id_code_key`(`company_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupon_redemptions` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `coupon_id` VARCHAR(191) NOT NULL,
    `sale_id` VARCHAR(191) NOT NULL,
    `discount_amount` DECIMAL(65, 30) NOT NULL,
    `redeemed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `coupon_redemptions_company_id_idx`(`company_id`),
    INDEX `coupon_redemptions_coupon_id_idx`(`coupon_id`),
    INDEX `coupon_redemptions_sale_id_idx`(`sale_id`),
    UNIQUE INDEX `coupon_redemptions_coupon_id_sale_id_key`(`coupon_id`, `sale_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reward_point_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `entry_type` VARCHAR(191) NOT NULL,
    `points_delta` INTEGER NOT NULL,
    `sale_id` VARCHAR(191) NULL,
    `event_id` VARCHAR(191) NULL,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `reward_point_transactions_company_id_idx`(`company_id`),
    INDEX `reward_point_transactions_customer_id_idx`(`customer_id`),
    INDEX `reward_point_transactions_entry_type_idx`(`entry_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reward_point_consumptions` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `earn_transaction_id` VARCHAR(191) NOT NULL,
    `consume_transaction_id` VARCHAR(191) NOT NULL,
    `points_consumed` INTEGER NOT NULL,

    INDEX `reward_point_consumptions_company_id_idx`(`company_id`),
    INDEX `reward_point_consumptions_customer_id_idx`(`customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `holidays` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `start_date` DATETIME(3) NOT NULL,
    `end_date` DATETIME(3) NOT NULL,
    `is_paid` BOOLEAN NOT NULL DEFAULT true,
    `notes` VARCHAR(191) NULL,

    INDEX `holidays_company_id_idx`(`company_id`),
    INDEX `holidays_branch_id_idx`(`branch_id`),
    INDEX `holidays_start_date_idx`(`start_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_types` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `annual_allowance_days` DECIMAL(65, 30) NULL,
    `is_paid` BOOLEAN NOT NULL DEFAULT true,
    `requires_attachment` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `leave_types_company_id_name_key`(`company_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_requests` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `leave_type_id` VARCHAR(191) NOT NULL,
    `start_date` DATETIME(3) NOT NULL,
    `end_date` DATETIME(3) NOT NULL,
    `requested_days` DECIMAL(65, 30) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `reason` VARCHAR(191) NOT NULL,
    `approval_request_id` VARCHAR(191) NULL,
    `approved_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `leave_requests_company_id_idx`(`company_id`),
    INDEX `leave_requests_employee_id_idx`(`employee_id`),
    INDEX `leave_requests_status_idx`(`status`),
    INDEX `leave_requests_start_date_idx`(`start_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_components` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `component_type` VARCHAR(191) NOT NULL DEFAULT 'earning',
    `calculation_type` VARCHAR(191) NOT NULL DEFAULT 'fixed',
    `default_value` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `account_id` VARCHAR(191) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `payroll_components_company_id_idx`(`company_id`),
    INDEX `payroll_components_component_type_idx`(`component_type`),
    UNIQUE INDEX `payroll_components_company_id_code_key`(`company_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_item_components` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `payroll_item_id` VARCHAR(191) NOT NULL,
    `payroll_component_id` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `calculation_basis` VARCHAR(191) NOT NULL DEFAULT '{}',

    INDEX `payroll_item_components_company_id_idx`(`company_id`),
    INDEX `payroll_item_components_payroll_item_id_idx`(`payroll_item_id`),
    UNIQUE INDEX `payroll_item_components_payroll_item_id_payroll_component_id_key`(`payroll_item_id`, `payroll_component_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_records` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `work_date` DATETIME(3) NOT NULL,
    `check_in_at` DATETIME(3) NULL,
    `check_out_at` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'present',
    `approved_by` VARCHAR(191) NULL,

    INDEX `attendance_records_company_id_idx`(`company_id`),
    INDEX `attendance_records_employee_id_idx`(`employee_id`),
    INDEX `attendance_records_status_idx`(`status`),
    UNIQUE INDEX `attendance_records_employee_id_work_date_key`(`employee_id`, `work_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_items` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `payroll_run_id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `base_salary` DECIMAL(65, 30) NOT NULL,
    `allowance_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `overtime_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `deduction_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `withholding_total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `net_pay` DECIMAL(65, 30) NOT NULL,
    `calculation_detail` VARCHAR(191) NOT NULL DEFAULT '{}',

    INDEX `payroll_items_company_id_idx`(`company_id`),
    INDEX `payroll_items_payroll_run_id_idx`(`payroll_run_id`),
    INDEX `payroll_items_employee_id_idx`(`employee_id`),
    UNIQUE INDEX `payroll_items_payroll_run_id_employee_id_key`(`payroll_run_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `communication_consents` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NULL,
    `supplier_id` VARCHAR(191) NULL,
    `channel` VARCHAR(191) NOT NULL DEFAULT 'sms',
    `purpose` VARCHAR(191) NOT NULL DEFAULT 'transactional',
    `consent_status` VARCHAR(191) NOT NULL DEFAULT 'not_required',
    `source` VARCHAR(191) NOT NULL,
    `captured_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `captured_by` VARCHAR(191) NULL,

    INDEX `communication_consents_company_id_idx`(`company_id`),
    INDEX `communication_consents_customer_id_idx`(`customer_id`),
    INDEX `communication_consents_supplier_id_idx`(`supplier_id`),
    INDEX `communication_consents_consent_status_idx`(`consent_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `communication_campaigns` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL DEFAULT 'sms',
    `template_id` VARCHAR(191) NOT NULL,
    `audience_definition` VARCHAR(191) NOT NULL DEFAULT '{}',
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `scheduled_at` DATETIME(3) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `approved_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `communication_campaigns_company_id_idx`(`company_id`),
    INDEX `communication_campaigns_status_idx`(`status`),
    INDEX `communication_campaigns_scheduled_at_idx`(`scheduled_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `communication_campaign_recipients` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `campaign_id` VARCHAR(191) NOT NULL,
    `recipient_type` VARCHAR(191) NOT NULL DEFAULT 'customer',
    `customer_id` VARCHAR(191) NULL,
    `supplier_id` VARCHAR(191) NULL,
    `destination` VARCHAR(191) NOT NULL,
    `consent_snapshot` VARCHAR(191) NOT NULL DEFAULT 'not_required',
    `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
    `skip_reason` VARCHAR(191) NULL,

    INDEX `communication_campaign_recipients_company_id_idx`(`company_id`),
    INDEX `communication_campaign_recipients_campaign_id_idx`(`campaign_id`),
    INDEX `communication_campaign_recipients_status_idx`(`status`),
    UNIQUE INDEX `communication_campaign_recipients_campaign_id_destination_key`(`campaign_id`, `destination`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbound_messages` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `template_id` VARCHAR(191) NULL,
    `campaign_recipient_id` VARCHAR(191) NULL,
    `channel` VARCHAR(191) NOT NULL DEFAULT 'sms',
    `purpose` VARCHAR(191) NOT NULL DEFAULT 'transactional',
    `destination_hash` VARCHAR(191) NOT NULL,
    `destination_encrypted` VARCHAR(191) NOT NULL,
    `encryption_key_version` VARCHAR(191) NOT NULL DEFAULT '1',
    `rendered_subject` VARCHAR(191) NULL,
    `rendered_body` VARCHAR(191) NOT NULL,
    `provider_code` VARCHAR(191) NULL,
    `provider_message_id` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NULL,
    `last_error_code` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `outbound_messages_company_id_idx`(`company_id`),
    INDEX `outbound_messages_template_id_idx`(`template_id`),
    INDEX `outbound_messages_status_idx`(`status`),
    INDEX `outbound_messages_provider_message_id_idx`(`provider_message_id`),
    INDEX `outbound_messages_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_notifications` (
    `notification_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `read_at` DATETIME(3) NULL,
    `dismissed_at` DATETIME(3) NULL,

    INDEX `user_notifications_user_id_idx`(`user_id`),
    INDEX `user_notifications_read_at_idx`(`read_at`),
    PRIMARY KEY (`notification_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `print_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `print_type` VARCHAR(191) NOT NULL,
    `entity_type` VARCHAR(191) NOT NULL,
    `entity_id` VARCHAR(191) NOT NULL,
    `locale` VARCHAR(191) NOT NULL DEFAULT 'bn-BD',
    `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
    `printer_mode` VARCHAR(191) NOT NULL DEFAULT 'browser',
    `output_media_id` VARCHAR(191) NULL,
    `error_summary` VARCHAR(191) NULL,
    `requested_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,

    INDEX `print_jobs_company_id_idx`(`company_id`),
    INDEX `print_jobs_status_idx`(`status`),
    INDEX `print_jobs_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_budget_leases` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `branch_id` VARCHAR(191) NOT NULL,
    `device_id` VARCHAR(191) NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `warehouse_id` VARCHAR(191) NOT NULL,
    `qty_granted` DECIMAL(65, 30) NOT NULL,
    `qty_consumed` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `expires_at` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stock_budget_leases_company_id_idx`(`company_id`),
    INDEX `stock_budget_leases_device_id_idx`(`device_id`),
    INDEX `stock_budget_leases_product_id_idx`(`product_id`),
    INDEX `stock_budget_leases_status_idx`(`status`),
    INDEX `stock_budget_leases_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `risk_assessments` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `provider_code` VARCHAR(191) NOT NULL,
    `subject_type` VARCHAR(191) NOT NULL,
    `subject_id` VARCHAR(191) NOT NULL,
    `request_event_id` VARCHAR(191) NOT NULL,
    `score` DECIMAL(65, 30) NULL,
    `decision` VARCHAR(191) NOT NULL DEFAULT 'allow',
    `reasonCodes` VARCHAR(191) NOT NULL DEFAULT '[]',
    `provider_reference` VARCHAR(191) NULL,
    `sanitized_response` VARCHAR(191) NOT NULL DEFAULT '{}',
    `assessed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `risk_assessments_company_id_idx`(`company_id`),
    INDEX `risk_assessments_subject_type_subject_id_idx`(`subject_type`, `subject_id`),
    INDEX `risk_assessments_decision_idx`(`decision`),
    INDEX `risk_assessments_expires_at_idx`(`expires_at`),
    UNIQUE INDEX `risk_assessments_company_id_request_event_id_provider_code_key`(`company_id`, `request_event_id`, `provider_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_subject_requests` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `request_type` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NULL,
    `supplier_id` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `details` VARCHAR(191) NULL,
    `resolved_by` VARCHAR(191) NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `data_subject_requests_company_id_idx`(`company_id`),
    INDEX `data_subject_requests_request_type_idx`(`request_type`),
    INDEX `data_subject_requests_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `legal_holds` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `entity_type` VARCHAR(191) NOT NULL,
    `entity_id` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `declared_by` VARCHAR(191) NOT NULL,
    `declared_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `released_at` DATETIME(3) NULL,

    INDEX `legal_holds_company_id_idx`(`company_id`),
    INDEX `legal_holds_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    INDEX `legal_holds_released_at_idx`(`released_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `risk_assessment_outcomes` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `risk_assessment_id` VARCHAR(191) NOT NULL,
    `outcome_type` VARCHAR(191) NOT NULL,
    `outcome_notes` VARCHAR(191) NULL,
    `outcome_amount` DECIMAL(65, 30) NULL,
    `recorded_by` VARCHAR(191) NULL,
    `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `risk_assessment_outcomes_company_id_idx`(`company_id`),
    INDEX `risk_assessment_outcomes_risk_assessment_id_idx`(`risk_assessment_id`),
    INDEX `risk_assessment_outcomes_outcome_type_idx`(`outcome_type`),
    INDEX `risk_assessment_outcomes_recorded_at_idx`(`recorded_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `risk_threshold_changes` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NULL,
    `threshold_key` VARCHAR(191) NOT NULL,
    `old_value` VARCHAR(191) NULL,
    `new_value` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `changed_by` VARCHAR(191) NOT NULL,
    `changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `risk_threshold_changes_company_id_idx`(`company_id`),
    INDEX `risk_threshold_changes_threshold_key_idx`(`threshold_key`),
    INDEX `risk_threshold_changes_changed_at_idx`(`changed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `currency_revaluations` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `revaluation_date` DATETIME(3) NOT NULL,
    `journal_entry_id` VARCHAR(191) NULL,
    `reversal_journal_entry_id` VARCHAR(191) NULL,
    `reversal_of_id` VARCHAR(191) NULL,
    `total_unrealized_gain` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `total_unrealized_loss` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `period_end_rate` DECIMAL(65, 30) NOT NULL,
    `currency_code` VARCHAR(191) NOT NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reversed_at` DATETIME(3) NULL,

    INDEX `currency_revaluations_company_id_idx`(`company_id`),
    INDEX `currency_revaluations_revaluation_date_idx`(`revaluation_date`),
    INDEX `currency_revaluations_currency_code_idx`(`currency_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fixed_assets` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `asset_code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `category_id` VARCHAR(191) NULL,
    `branch_id` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `serial_number` VARCHAR(191) NULL,
    `purchase_date` DATETIME(3) NOT NULL,
    `purchase_cost` DECIMAL(65, 30) NOT NULL,
    `salvage_value` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `useful_life_months` INTEGER NOT NULL,
    `depreciation_method` VARCHAR(191) NOT NULL DEFAULT 'straight_line',
    `depreciation_rate` DECIMAL(65, 30) NULL DEFAULT 0,
    `accumulated_depreciation` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `net_book_value` DECIMAL(65, 30) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `asset_account_id` VARCHAR(191) NOT NULL,
    `accum_dep_account_id` VARCHAR(191) NOT NULL,
    `dep_expense_account_id` VARCHAR(191) NOT NULL,
    `gain_loss_account_id` VARCHAR(191) NULL,
    `disposed_at` DATETIME(3) NULL,
    `disposal_amount` DECIMAL(65, 30) NULL,
    `disposal_method` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `fixed_assets_company_id_idx`(`company_id`),
    INDEX `fixed_assets_status_idx`(`status`),
    UNIQUE INDEX `fixed_assets_company_id_asset_code_key`(`company_id`, `asset_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fixed_asset_categories` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `default_life_months` INTEGER NOT NULL,
    `default_method` VARCHAR(191) NOT NULL DEFAULT 'straight_line',
    `asset_account_id` VARCHAR(191) NOT NULL,
    `accum_dep_account_id` VARCHAR(191) NOT NULL,
    `dep_expense_account_id` VARCHAR(191) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `fixed_asset_categories_company_id_idx`(`company_id`),
    UNIQUE INDEX `fixed_asset_categories_company_id_code_key`(`company_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fixed_asset_depreciation` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `fixed_asset_id` VARCHAR(191) NOT NULL,
    `period_start` DATETIME(3) NOT NULL,
    `period_end` DATETIME(3) NOT NULL,
    `depreciation_amount` DECIMAL(65, 30) NOT NULL,
    `accumulated_after` DECIMAL(65, 30) NOT NULL,
    `net_book_value_after` DECIMAL(65, 30) NOT NULL,
    `journal_entry_id` VARCHAR(191) NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `posted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `posted_by` VARCHAR(191) NOT NULL,

    INDEX `fixed_asset_depreciation_company_id_idx`(`company_id`),
    INDEX `fixed_asset_depreciation_fixed_asset_id_idx`(`fixed_asset_id`),
    INDEX `fixed_asset_depreciation_period_end_idx`(`period_end`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_reconciliations` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `financial_account_id` VARCHAR(191) NOT NULL,
    `statement_date` DATETIME(3) NOT NULL,
    `statement_opening_balance` DECIMAL(65, 30) NOT NULL,
    `statement_closing_balance` DECIMAL(65, 30) NOT NULL,
    `system_opening_balance` DECIMAL(65, 30) NOT NULL,
    `system_closing_balance` DECIMAL(65, 30) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `matched_transactions` INTEGER NOT NULL DEFAULT 0,
    `unmatched_system` INTEGER NOT NULL DEFAULT 0,
    `unmatched_statement` INTEGER NOT NULL DEFAULT 0,
    `variance` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `journal_entry_id` VARCHAR(191) NULL,
    `reconciled_by` VARCHAR(191) NULL,
    `reconciled_at` DATETIME(3) NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bank_reconciliations_company_id_idx`(`company_id`),
    INDEX `bank_reconciliations_financial_account_id_idx`(`financial_account_id`),
    INDEX `bank_reconciliations_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_reconciliation_lines` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `reconciliation_id` VARCHAR(191) NOT NULL,
    `line_type` VARCHAR(191) NOT NULL,
    `transaction_date` DATETIME(3) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(65, 30) NOT NULL,
    `reference_no` VARCHAR(191) NULL,
    `payment_id` VARCHAR(191) NULL,
    `matched_line_id` VARCHAR(191) NULL,
    `match_status` VARCHAR(191) NOT NULL DEFAULT 'unmatched',
    `match_method` VARCHAR(191) NULL,
    `matched_by` VARCHAR(191) NULL,
    `matched_at` DATETIME(3) NULL,

    INDEX `bank_reconciliation_lines_company_id_idx`(`company_id`),
    INDEX `bank_reconciliation_lines_reconciliation_id_idx`(`reconciliation_id`),
    INDEX `bank_reconciliation_lines_match_status_idx`(`match_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `companies` ADD CONSTRAINT `companies_base_currency_code_fkey` FOREIGN KEY (`base_currency_code`) REFERENCES `currencies`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `branches` ADD CONSTRAINT `branches_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warehouses` ADD CONSTRAINT `warehouses_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warehouses` ADD CONSTRAINT `warehouses_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exchange_rates` ADD CONSTRAINT `exchange_rates_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exchange_rates` ADD CONSTRAINT `exchange_rates_currency_code_fkey` FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exchange_rates` ADD CONSTRAINT `exchange_rates_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_domains` ADD CONSTRAINT `company_domains_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_primary_branch_id_fkey` FOREIGN KEY (`primary_branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `roles` ADD CONSTRAINT `roles_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_branch_access` ADD CONSTRAINT `user_branch_access_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_branch_access` ADD CONSTRAINT `user_branch_access_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devices` ADD CONSTRAINT `devices_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devices` ADD CONSTRAINT `devices_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devices` ADD CONSTRAINT `devices_registered_by_fkey` FOREIGN KEY (`registered_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_rotated_from_id_fkey` FOREIGN KEY (`rotated_from_id`) REFERENCES `refresh_tokens`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `security_events` ADD CONSTRAINT `security_events_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `security_events` ADD CONSTRAINT `security_events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `security_events` ADD CONSTRAINT `security_events_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webauthn_credentials` ADD CONSTRAINT `webauthn_credentials_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webauthn_credentials` ADD CONSTRAINT `webauthn_credentials_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webauthn_challenges` ADD CONSTRAINT `webauthn_challenges_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webauthn_challenges` ADD CONSTRAINT `webauthn_challenges_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_sequences` ADD CONSTRAINT `document_sequences_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_sequences` ADD CONSTRAINT `document_sequences_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_number_leases` ADD CONSTRAINT `document_number_leases_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_number_leases` ADD CONSTRAINT `document_number_leases_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_number_leases` ADD CONSTRAINT `document_number_leases_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `idempotency_requests` ADD CONSTRAINT `idempotency_requests_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `business_events` ADD CONSTRAINT `business_events_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_exchange_rates` ADD CONSTRAINT `document_exchange_rates_currency_code_fkey` FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_requests` ADD CONSTRAINT `approval_requests_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_requests` ADD CONSTRAINT `approval_requests_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_requests` ADD CONSTRAINT `approval_requests_requested_by_fkey` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_requests` ADD CONSTRAINT `approval_requests_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_requests` ADD CONSTRAINT `approval_requests_waived_by_fkey` FOREIGN KEY (`waived_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `statutory_documents` ADD CONSTRAINT `statutory_documents_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `statutory_documents` ADD CONSTRAINT `statutory_documents_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `statutory_documents` ADD CONSTRAINT `statutory_documents_issued_by_fkey` FOREIGN KEY (`issued_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `statutory_documents` ADD CONSTRAINT `statutory_documents_replacement_of_id_fkey` FOREIGN KEY (`replacement_of_id`) REFERENCES `statutory_documents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tax_return_periods` ADD CONSTRAINT `tax_return_periods_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tax_return_periods` ADD CONSTRAINT `tax_return_periods_prepared_document_id_fkey` FOREIGN KEY (`prepared_document_id`) REFERENCES `statutory_documents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reconciliation_runs` ADD CONSTRAINT `reconciliation_runs_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reconciliation_runs` ADD CONSTRAINT `reconciliation_runs_initiated_by_fkey` FOREIGN KEY (`initiated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reconciliation_findings` ADD CONSTRAINT `reconciliation_findings_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reconciliation_findings` ADD CONSTRAINT `reconciliation_findings_reconciliation_run_id_fkey` FOREIGN KEY (`reconciliation_run_id`) REFERENCES `reconciliation_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reconciliation_findings` ADD CONSTRAINT `reconciliation_findings_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reconciliation_findings` ADD CONSTRAINT `reconciliation_findings_resolved_by_fkey` FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recovery_epochs` ADD CONSTRAINT `recovery_epochs_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_credentials` ADD CONSTRAINT `integration_credentials_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_credentials` ADD CONSTRAINT `integration_credentials_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `brands` ADD CONSTRAINT `brands_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `units` ADD CONSTRAINT `units_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `units` ADD CONSTRAINT `units_base_unit_id_fkey` FOREIGN KEY (`base_unit_id`) REFERENCES `units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_groups` ADD CONSTRAINT `customer_groups_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_unit_id_fkey` FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_default_tax_code_id_fkey` FOREIGN KEY (`default_tax_code_id`) REFERENCES `tax_codes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `entity_media_links` ADD CONSTRAINT `entity_media_links_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `entity_media_links` ADD CONSTRAINT `entity_media_links_media_asset_id_fkey` FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_barcodes` ADD CONSTRAINT `product_barcodes_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_barcodes` ADD CONSTRAINT `product_barcodes_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_barcodes` ADD CONSTRAINT `product_barcodes_unit_id_fkey` FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_unit_options` ADD CONSTRAINT `product_unit_options_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_unit_options` ADD CONSTRAINT `product_unit_options_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_unit_options` ADD CONSTRAINT `product_unit_options_unit_id_fkey` FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_combo_items` ADD CONSTRAINT `product_combo_items_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_combo_items` ADD CONSTRAINT `product_combo_items_combo_product_id_fkey` FOREIGN KEY (`combo_product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_combo_items` ADD CONSTRAINT `product_combo_items_component_product_id_fkey` FOREIGN KEY (`component_product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_combo_items` ADD CONSTRAINT `product_combo_items_component_unit_id_fkey` FOREIGN KEY (`component_unit_id`) REFERENCES `units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `discount_policies` ADD CONSTRAINT `discount_policies_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `discount_policies` ADD CONSTRAINT `discount_policies_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `discount_policies` ADD CONSTRAINT `discount_policies_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `discount_policies` ADD CONSTRAINT `discount_policies_customer_group_id_fkey` FOREIGN KEY (`customer_group_id`) REFERENCES `customer_groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `discount_policies` ADD CONSTRAINT `discount_policies_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_prices` ADD CONSTRAINT `product_prices_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_prices` ADD CONSTRAINT `product_prices_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_prices` ADD CONSTRAINT `product_prices_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_prices` ADD CONSTRAINT `product_prices_customer_group_id_fkey` FOREIGN KEY (`customer_group_id`) REFERENCES `customer_groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_prices` ADD CONSTRAINT `product_prices_currency_code_fkey` FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tax_codes` ADD CONSTRAINT `tax_codes_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tax_components` ADD CONSTRAINT `tax_components_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tax_components` ADD CONSTRAINT `tax_components_input_account_id_fkey` FOREIGN KEY (`input_account_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tax_components` ADD CONSTRAINT `tax_components_output_account_id_fkey` FOREIGN KEY (`output_account_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tax_code_components` ADD CONSTRAINT `tax_code_components_tax_code_id_fkey` FOREIGN KEY (`tax_code_id`) REFERENCES `tax_codes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tax_code_components` ADD CONSTRAINT `tax_code_components_tax_component_id_fkey` FOREIGN KEY (`tax_component_id`) REFERENCES `tax_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `withholding_rules` ADD CONSTRAINT `withholding_rules_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `configuration_values` ADD CONSTRAINT `configuration_values_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `configuration_values` ADD CONSTRAINT `configuration_values_definition_key_fkey` FOREIGN KEY (`definition_key`) REFERENCES `configuration_definitions`(`key`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `configuration_values` ADD CONSTRAINT `configuration_values_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pos_profiles` ADD CONSTRAINT `pos_profiles_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pos_profiles` ADD CONSTRAINT `pos_profiles_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pos_profiles` ADD CONSTRAINT `pos_profiles_default_warehouse_id_fkey` FOREIGN KEY (`default_warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pos_profiles` ADD CONSTRAINT `pos_profiles_receipt_template_id_fkey` FOREIGN KEY (`receipt_template_id`) REFERENCES `document_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pos_profiles` ADD CONSTRAINT `pos_profiles_invoice_template_id_fkey` FOREIGN KEY (`invoice_template_id`) REFERENCES `document_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_templates` ADD CONSTRAINT `document_templates_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_templates` ADD CONSTRAINT `document_templates_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_languages` ADD CONSTRAINT `company_languages_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_languages` ADD CONSTRAINT `company_languages_locale_fkey` FOREIGN KEY (`locale`) REFERENCES `supported_languages`(`locale`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `translation_overrides` ADD CONSTRAINT `translation_overrides_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `translation_overrides` ADD CONSTRAINT `translation_overrides_locale_fkey` FOREIGN KEY (`locale`) REFERENCES `supported_languages`(`locale`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `translation_overrides` ADD CONSTRAINT `translation_overrides_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `feature_flags` ADD CONSTRAINT `feature_flags_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `feature_flags` ADD CONSTRAINT `feature_flags_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dashboard_preferences` ADD CONSTRAINT `dashboard_preferences_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dashboard_preferences` ADD CONSTRAINT `dashboard_preferences_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_targets` ADD CONSTRAINT `sales_targets_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_targets` ADD CONSTRAINT `sales_targets_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_targets` ADD CONSTRAINT `sales_targets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_targets` ADD CONSTRAINT `sales_targets_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `saved_report_filters` ADD CONSTRAINT `saved_report_filters_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `saved_report_filters` ADD CONSTRAINT `saved_report_filters_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_export_jobs` ADD CONSTRAINT `report_export_jobs_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_export_jobs` ADD CONSTRAINT `report_export_jobs_requested_by_fkey` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_export_jobs` ADD CONSTRAINT `report_export_jobs_output_media_id_fkey` FOREIGN KEY (`output_media_id`) REFERENCES `media_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_opened_by_fkey` FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_assigned_to_fkey` FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_ticket_messages` ADD CONSTRAINT `support_ticket_messages_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_ticket_messages` ADD CONSTRAINT `support_ticket_messages_support_ticket_id_fkey` FOREIGN KEY (`support_ticket_id`) REFERENCES `support_tickets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_ticket_messages` ADD CONSTRAINT `support_ticket_messages_author_user_id_fkey` FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_templates` ADD CONSTRAINT `communication_templates_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_templates` ADD CONSTRAINT `communication_templates_locale_fkey` FOREIGN KEY (`locale`) REFERENCES `supported_languages`(`locale`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_templates` ADD CONSTRAINT `communication_templates_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warehouse_stocks` ADD CONSTRAINT `warehouse_stocks_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warehouse_stocks` ADD CONSTRAINT `warehouse_stocks_warehouse_id_fkey` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warehouse_stocks` ADD CONSTRAINT `warehouse_stocks_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `business_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_warehouse_id_fkey` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_reversal_of_movement_id_fkey` FOREIGN KEY (`reversal_of_movement_id`) REFERENCES `stock_movements`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_reservations` ADD CONSTRAINT `stock_reservations_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_reservations` ADD CONSTRAINT `stock_reservations_warehouse_id_fkey` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_reservations` ADD CONSTRAINT `stock_reservations_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_batches` ADD CONSTRAINT `product_batches_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_batches` ADD CONSTRAINT `product_batches_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_batches` ADD CONSTRAINT `product_batches_warehouse_id_fkey` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movement_batches` ADD CONSTRAINT `stock_movement_batches_stock_movement_id_fkey` FOREIGN KEY (`stock_movement_id`) REFERENCES `stock_movements`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movement_batches` ADD CONSTRAINT `stock_movement_batches_product_batch_id_fkey` FOREIGN KEY (`product_batch_id`) REFERENCES `product_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movement_batches` ADD CONSTRAINT `stock_movement_batches_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_serials` ADD CONSTRAINT `product_serials_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_serials` ADD CONSTRAINT `product_serials_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_serials` ADD CONSTRAINT `product_serials_current_warehouse_id_fkey` FOREIGN KEY (`current_warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_serials` ADD CONSTRAINT `product_serials_current_reservation_id_fkey` FOREIGN KEY (`current_reservation_id`) REFERENCES `stock_reservations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_serials` ADD CONSTRAINT `product_serials_originating_purchase_item_id_fkey` FOREIGN KEY (`originating_purchase_item_id`) REFERENCES `purchase_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `serial_events` ADD CONSTRAINT `serial_events_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `serial_events` ADD CONSTRAINT `serial_events_serial_id_fkey` FOREIGN KEY (`serial_id`) REFERENCES `product_serials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `serial_events` ADD CONSTRAINT `serial_events_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `business_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `serial_events` ADD CONSTRAINT `serial_events_stock_movement_id_fkey` FOREIGN KEY (`stock_movement_id`) REFERENCES `stock_movements`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `serial_events` ADD CONSTRAINT `serial_events_from_warehouse_id_fkey` FOREIGN KEY (`from_warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `serial_events` ADD CONSTRAINT `serial_events_to_warehouse_id_fkey` FOREIGN KEY (`to_warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_reason_codes` ADD CONSTRAINT `inventory_reason_codes_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_counts` ADD CONSTRAINT `stock_counts_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_counts` ADD CONSTRAINT `stock_counts_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_counts` ADD CONSTRAINT `stock_counts_warehouse_id_fkey` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_counts` ADD CONSTRAINT `stock_counts_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_counts` ADD CONSTRAINT `stock_counts_brand_id_fkey` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_items` ADD CONSTRAINT `stock_count_items_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_items` ADD CONSTRAINT `stock_count_items_stock_count_id_fkey` FOREIGN KEY (`stock_count_id`) REFERENCES `stock_counts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_items` ADD CONSTRAINT `stock_count_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_items` ADD CONSTRAINT `stock_count_items_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `product_batches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_items` ADD CONSTRAINT `stock_count_items_reason_code_id_fkey` FOREIGN KEY (`reason_code_id`) REFERENCES `inventory_reason_codes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_serials` ADD CONSTRAINT `stock_count_serials_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_serials` ADD CONSTRAINT `stock_count_serials_stock_count_item_id_fkey` FOREIGN KEY (`stock_count_item_id`) REFERENCES `stock_count_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_serials` ADD CONSTRAINT `stock_count_serials_serial_id_fkey` FOREIGN KEY (`serial_id`) REFERENCES `product_serials`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_adjustments` ADD CONSTRAINT `stock_adjustments_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_adjustments` ADD CONSTRAINT `stock_adjustments_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_adjustments` ADD CONSTRAINT `stock_adjustments_warehouse_id_fkey` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_adjustments` ADD CONSTRAINT `stock_adjustments_reason_code_id_fkey` FOREIGN KEY (`reason_code_id`) REFERENCES `inventory_reason_codes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_adjustments` ADD CONSTRAINT `stock_adjustments_source_stock_count_id_fkey` FOREIGN KEY (`source_stock_count_id`) REFERENCES `stock_counts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_adjustments` ADD CONSTRAINT `stock_adjustments_reversal_of_id_fkey` FOREIGN KEY (`reversal_of_id`) REFERENCES `stock_adjustments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_adjustment_items` ADD CONSTRAINT `stock_adjustment_items_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_adjustment_items` ADD CONSTRAINT `stock_adjustment_items_stock_adjustment_id_fkey` FOREIGN KEY (`stock_adjustment_id`) REFERENCES `stock_adjustments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_adjustment_items` ADD CONSTRAINT `stock_adjustment_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_adjustment_items` ADD CONSTRAINT `stock_adjustment_items_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `product_batches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_adjustment_items` ADD CONSTRAINT `stock_adjustment_items_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `business_events`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_adjustment_item_serials` ADD CONSTRAINT `stock_adjustment_item_serials_stock_adjustment_item_id_fkey` FOREIGN KEY (`stock_adjustment_item_id`) REFERENCES `stock_adjustment_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_adjustment_item_serials` ADD CONSTRAINT `stock_adjustment_item_serials_serial_id_fkey` FOREIGN KEY (`serial_id`) REFERENCES `product_serials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customers` ADD CONSTRAINT `customers_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customers` ADD CONSTRAINT `customers_customer_group_id_fkey` FOREIGN KEY (`customer_group_id`) REFERENCES `customer_groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customers` ADD CONSTRAINT `customers_preferred_branch_id_fkey` FOREIGN KEY (`preferred_branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_currency_code_fkey` FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_warehouse_id_fkey` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_currency_code_fkey` FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_items` ADD CONSTRAINT `purchase_items_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_items` ADD CONSTRAINT `purchase_items_purchase_id_fkey` FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_items` ADD CONSTRAINT `purchase_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_item_taxes` ADD CONSTRAINT `purchase_item_taxes_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_item_taxes` ADD CONSTRAINT `purchase_item_taxes_purchase_item_id_fkey` FOREIGN KEY (`purchase_item_id`) REFERENCES `purchase_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_item_taxes` ADD CONSTRAINT `purchase_item_taxes_tax_component_id_fkey` FOREIGN KEY (`tax_component_id`) REFERENCES `tax_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receivings` ADD CONSTRAINT `purchase_receivings_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receivings` ADD CONSTRAINT `purchase_receivings_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receivings` ADD CONSTRAINT `purchase_receivings_warehouse_id_fkey` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receivings` ADD CONSTRAINT `purchase_receivings_purchase_id_fkey` FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receiving_items` ADD CONSTRAINT `purchase_receiving_items_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receiving_items` ADD CONSTRAINT `purchase_receiving_items_purchase_receiving_id_fkey` FOREIGN KEY (`purchase_receiving_id`) REFERENCES `purchase_receivings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receiving_items` ADD CONSTRAINT `purchase_receiving_items_purchase_item_id_fkey` FOREIGN KEY (`purchase_item_id`) REFERENCES `purchase_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receiving_item_serials` ADD CONSTRAINT `purchase_receiving_item_serials_purchase_receiving_item_id_fkey` FOREIGN KEY (`purchase_receiving_item_id`) REFERENCES `purchase_receiving_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receiving_item_serials` ADD CONSTRAINT `purchase_receiving_item_serials_serial_id_fkey` FOREIGN KEY (`serial_id`) REFERENCES `product_serials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `landed_cost_documents` ADD CONSTRAINT `landed_cost_documents_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `landed_cost_documents` ADD CONSTRAINT `landed_cost_documents_purchase_id_fkey` FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `landed_cost_documents` ADD CONSTRAINT `landed_cost_documents_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `landed_cost_documents` ADD CONSTRAINT `landed_cost_documents_currency_code_fkey` FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `landed_cost_allocations` ADD CONSTRAINT `landed_cost_allocations_landed_cost_document_id_fkey` FOREIGN KEY (`landed_cost_document_id`) REFERENCES `landed_cost_documents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `landed_cost_allocations` ADD CONSTRAINT `landed_cost_allocations_purchase_item_id_fkey` FOREIGN KEY (`purchase_item_id`) REFERENCES `purchase_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_returns` ADD CONSTRAINT `purchase_returns_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_returns` ADD CONSTRAINT `purchase_returns_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_returns` ADD CONSTRAINT `purchase_returns_warehouse_id_fkey` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_returns` ADD CONSTRAINT `purchase_returns_purchase_id_fkey` FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_returns` ADD CONSTRAINT `purchase_returns_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_return_items` ADD CONSTRAINT `purchase_return_items_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_return_items` ADD CONSTRAINT `purchase_return_items_purchase_return_id_fkey` FOREIGN KEY (`purchase_return_id`) REFERENCES `purchase_returns`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_return_items` ADD CONSTRAINT `purchase_return_items_purchase_item_id_fkey` FOREIGN KEY (`purchase_item_id`) REFERENCES `purchase_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_return_item_serials` ADD CONSTRAINT `purchase_return_item_serials_purchase_return_item_id_fkey` FOREIGN KEY (`purchase_return_item_id`) REFERENCES `purchase_return_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_return_item_serials` ADD CONSTRAINT `purchase_return_item_serials_serial_id_fkey` FOREIGN KEY (`serial_id`) REFERENCES `product_serials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_from_warehouse_id_fkey` FOREIGN KEY (`from_warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_to_warehouse_id_fkey` FOREIGN KEY (`to_warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfer_items` ADD CONSTRAINT `transfer_items_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfer_items` ADD CONSTRAINT `transfer_items_transfer_id_fkey` FOREIGN KEY (`transfer_id`) REFERENCES `transfers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfer_items` ADD CONSTRAINT `transfer_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfer_items` ADD CONSTRAINT `transfer_items_reservation_id_fkey` FOREIGN KEY (`reservation_id`) REFERENCES `stock_reservations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfer_item_serials` ADD CONSTRAINT `transfer_item_serials_transfer_item_id_fkey` FOREIGN KEY (`transfer_item_id`) REFERENCES `transfer_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfer_item_serials` ADD CONSTRAINT `transfer_item_serials_serial_id_fkey` FOREIGN KEY (`serial_id`) REFERENCES `product_serials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_currency_code_fkey` FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotation_items` ADD CONSTRAINT `quotation_items_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotation_items` ADD CONSTRAINT `quotation_items_quotation_id_fkey` FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotation_items` ADD CONSTRAINT `quotation_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_warehouse_id_fkey` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_currency_code_fkey` FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_biller_id_fkey` FOREIGN KEY (`biller_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_cashier_shift_id_fkey` FOREIGN KEY (`cashier_shift_id`) REFERENCES `cashier_shifts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_voided_by_fkey` FOREIGN KEY (`voided_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_quotation_id_fkey` FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_items` ADD CONSTRAINT `sale_items_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_items` ADD CONSTRAINT `sale_items_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_items` ADD CONSTRAINT `sale_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_item_serials` ADD CONSTRAINT `sale_item_serials_sale_item_id_fkey` FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_item_serials` ADD CONSTRAINT `sale_item_serials_serial_id_fkey` FOREIGN KEY (`serial_id`) REFERENCES `product_serials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_item_taxes` ADD CONSTRAINT `sale_item_taxes_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_item_taxes` ADD CONSTRAINT `sale_item_taxes_sale_item_id_fkey` FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_item_taxes` ADD CONSTRAINT `sale_item_taxes_tax_component_id_fkey` FOREIGN KEY (`tax_component_id`) REFERENCES `tax_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_returns` ADD CONSTRAINT `sale_returns_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_returns` ADD CONSTRAINT `sale_returns_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_returns` ADD CONSTRAINT `sale_returns_warehouse_id_fkey` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_returns` ADD CONSTRAINT `sale_returns_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_returns` ADD CONSTRAINT `sale_returns_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_returns` ADD CONSTRAINT `sale_returns_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return_items` ADD CONSTRAINT `sale_return_items_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return_items` ADD CONSTRAINT `sale_return_items_sale_return_id_fkey` FOREIGN KEY (`sale_return_id`) REFERENCES `sale_returns`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return_items` ADD CONSTRAINT `sale_return_items_sale_item_id_fkey` FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return_item_serials` ADD CONSTRAINT `sale_return_item_serials_sale_return_item_id_fkey` FOREIGN KEY (`sale_return_item_id`) REFERENCES `sale_return_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return_item_serials` ADD CONSTRAINT `sale_return_item_serials_serial_id_fkey` FOREIGN KEY (`serial_id`) REFERENCES `product_serials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cashier_shifts` ADD CONSTRAINT `cashier_shifts_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cashier_shifts` ADD CONSTRAINT `cashier_shifts_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cashier_shifts` ADD CONSTRAINT `cashier_shifts_warehouse_id_fkey` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cashier_shifts` ADD CONSTRAINT `cashier_shifts_cashier_id_fkey` FOREIGN KEY (`cashier_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cashier_shifts` ADD CONSTRAINT `cashier_shifts_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cashier_shifts` ADD CONSTRAINT `cashier_shifts_cash_account_id_fkey` FOREIGN KEY (`cash_account_id`) REFERENCES `financial_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_drawer_counts` ADD CONSTRAINT `cash_drawer_counts_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_drawer_counts` ADD CONSTRAINT `cash_drawer_counts_cashier_shift_id_fkey` FOREIGN KEY (`cashier_shift_id`) REFERENCES `cashier_shifts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_drawer_counts` ADD CONSTRAINT `cash_drawer_counts_counted_by_fkey` FOREIGN KEY (`counted_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_sale_return_id_fkey` FOREIGN KEY (`sale_return_id`) REFERENCES `sale_returns`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_cashier_shift_id_fkey` FOREIGN KEY (`cashier_shift_id`) REFERENCES `cashier_shifts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_financial_account_id_fkey` FOREIGN KEY (`financial_account_id`) REFERENCES `financial_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_currency_code_fkey` FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_reversed_payment_id_fkey` FOREIGN KEY (`reversed_payment_id`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `business_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_purchase_id_fkey` FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_refund_allocations` ADD CONSTRAINT `return_refund_allocations_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_refund_allocations` ADD CONSTRAINT `return_refund_allocations_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_refund_allocations` ADD CONSTRAINT `return_refund_allocations_sale_return_id_fkey` FOREIGN KEY (`sale_return_id`) REFERENCES `sale_returns`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `installments` ADD CONSTRAINT `installments_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `installments` ADD CONSTRAINT `installments_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `installment_allocations` ADD CONSTRAINT `installment_allocations_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `installment_allocations` ADD CONSTRAINT `installment_allocations_installment_id_fkey` FOREIGN KEY (`installment_id`) REFERENCES `installments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `installment_allocations` ADD CONSTRAINT `installment_allocations_payment_allocation_id_fkey` FOREIGN KEY (`payment_allocation_id`) REFERENCES `payment_allocations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chart_of_accounts` ADD CONSTRAINT `chart_of_accounts_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chart_of_accounts` ADD CONSTRAINT `chart_of_accounts_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `financial_accounts` ADD CONSTRAINT `financial_accounts_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `financial_accounts` ADD CONSTRAINT `financial_accounts_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `financial_accounts` ADD CONSTRAINT `financial_accounts_chart_of_account_id_fkey` FOREIGN KEY (`chart_of_account_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `financial_accounts` ADD CONSTRAINT `financial_accounts_currency_code_fkey` FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fiscal_periods` ADD CONSTRAINT `fiscal_periods_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fiscal_periods` ADD CONSTRAINT `fiscal_periods_locked_by_fkey` FOREIGN KEY (`locked_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `business_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_currency_code_fkey` FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_reversal_of_entry_id_fkey` FOREIGN KEY (`reversal_of_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_posted_by_fkey` FOREIGN KEY (`posted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_journal_entry_id_fkey` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_chart_of_account_id_fkey` FOREIGN KEY (`chart_of_account_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_financial_account_id_fkey` FOREIGN KEY (`financial_account_id`) REFERENCES `financial_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_currency_code_fkey` FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_policies` ADD CONSTRAINT `accounting_policies_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_policies` ADD CONSTRAINT `accounting_policies_inventory_account_id_fkey` FOREIGN KEY (`inventory_account_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_policies` ADD CONSTRAINT `accounting_policies_cogs_account_id_fkey` FOREIGN KEY (`cogs_account_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_policies` ADD CONSTRAINT `accounting_policies_sales_revenue_account_id_fkey` FOREIGN KEY (`sales_revenue_account_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_policies` ADD CONSTRAINT `accounting_policies_ar_account_id_fkey` FOREIGN KEY (`ar_account_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_policies` ADD CONSTRAINT `accounting_policies_ap_account_id_fkey` FOREIGN KEY (`ap_account_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_policies` ADD CONSTRAINT `accounting_policies_customer_advance_account_id_fkey` FOREIGN KEY (`customer_advance_account_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_policies` ADD CONSTRAINT `accounting_policies_supplier_advance_account_id_fkey` FOREIGN KEY (`supplier_advance_account_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_policies` ADD CONSTRAINT `accounting_policies_purchase_variance_account_id_fkey` FOREIGN KEY (`purchase_variance_account_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_policies` ADD CONSTRAINT `accounting_policies_gift_card_liability_account_id_fkey` FOREIGN KEY (`gift_card_liability_account_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expense_categories` ADD CONSTRAINT `expense_categories_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expense_categories` ADD CONSTRAINT `expense_categories_expense_account_id_fkey` FOREIGN KEY (`expense_account_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_currency_code_fkey` FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_requested_by_fkey` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_journal_entry_id_fkey` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expense_items` ADD CONSTRAINT `expense_items_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expense_items` ADD CONSTRAINT `expense_items_expense_id_fkey` FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expense_items` ADD CONSTRAINT `expense_items_expense_category_id_fkey` FOREIGN KEY (`expense_category_id`) REFERENCES `expense_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_orders` ADD CONSTRAINT `delivery_orders_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_orders` ADD CONSTRAINT `delivery_orders_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_orders` ADD CONSTRAINT `delivery_orders_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_orders` ADD CONSTRAINT `delivery_orders_assigned_user_id_fkey` FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_orders` ADD CONSTRAINT `delivery_orders_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_items` ADD CONSTRAINT `delivery_items_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_items` ADD CONSTRAINT `delivery_items_delivery_order_id_fkey` FOREIGN KEY (`delivery_order_id`) REFERENCES `delivery_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_items` ADD CONSTRAINT `delivery_items_sale_item_id_fkey` FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_events` ADD CONSTRAINT `delivery_events_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_events` ADD CONSTRAINT `delivery_events_delivery_order_id_fkey` FOREIGN KEY (`delivery_order_id`) REFERENCES `delivery_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_events` ADD CONSTRAINT `delivery_events_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courier_shipments` ADD CONSTRAINT `courier_shipments_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courier_shipments` ADD CONSTRAINT `courier_shipments_delivery_order_id_fkey` FOREIGN KEY (`delivery_order_id`) REFERENCES `delivery_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courier_cod_settlements` ADD CONSTRAINT `courier_cod_settlements_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courier_cod_settlements` ADD CONSTRAINT `courier_cod_settlements_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courier_cod_settlements` ADD CONSTRAINT `courier_cod_settlements_financial_account_id_fkey` FOREIGN KEY (`financial_account_id`) REFERENCES `financial_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courier_cod_settlements` ADD CONSTRAINT `courier_cod_settlements_journal_entry_id_fkey` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courier_cod_settlements` ADD CONSTRAINT `courier_cod_settlements_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courier_cod_settlement_items` ADD CONSTRAINT `courier_cod_settlement_items_settlement_id_fkey` FOREIGN KEY (`settlement_id`) REFERENCES `courier_cod_settlements`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courier_cod_settlement_items` ADD CONSTRAINT `courier_cod_settlement_items_delivery_order_id_fkey` FOREIGN KEY (`delivery_order_id`) REFERENCES `delivery_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_repair_warehouse_id_fkey` FOREIGN KEY (`repair_warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_service_sale_id_fkey` FOREIGN KEY (`service_sale_id`) REFERENCES `sales`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_serial_id_fkey` FOREIGN KEY (`serial_id`) REFERENCES `product_serials`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_request_parts` ADD CONSTRAINT `service_request_parts_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_request_parts` ADD CONSTRAINT `service_request_parts_service_request_id_fkey` FOREIGN KEY (`service_request_id`) REFERENCES `service_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_request_parts` ADD CONSTRAINT `service_request_parts_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_request_parts` ADD CONSTRAINT `service_request_parts_consumed_event_id_fkey` FOREIGN KEY (`consumed_event_id`) REFERENCES `business_events`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_events` ADD CONSTRAINT `service_events_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_events` ADD CONSTRAINT `service_events_service_request_id_fkey` FOREIGN KEY (`service_request_id`) REFERENCES `service_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_events` ADD CONSTRAINT `service_events_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warranty_claims` ADD CONSTRAINT `warranty_claims_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warranty_claims` ADD CONSTRAINT `warranty_claims_service_request_id_fkey` FOREIGN KEY (`service_request_id`) REFERENCES `service_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warranty_claims` ADD CONSTRAINT `warranty_claims_replacement_serial_id_fkey` FOREIGN KEY (`replacement_serial_id`) REFERENCES `product_serials`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warranty_claims` ADD CONSTRAINT `warranty_claims_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_subjects` ADD CONSTRAINT `lead_subjects_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_sources` ADD CONSTRAINT `lead_sources_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_statuses` ADD CONSTRAINT `lead_statuses_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `lead_subjects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_source_id_fkey` FOREIGN KEY (`source_id`) REFERENCES `lead_sources`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_status_id_fkey` FOREIGN KEY (`status_id`) REFERENCES `lead_statuses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_assigned_to_fkey` FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_converted_customer_id_fkey` FOREIGN KEY (`converted_customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_activities` ADD CONSTRAINT `lead_activities_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_activities` ADD CONSTRAINT `lead_activities_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_activities` ADD CONSTRAINT `lead_activities_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_cards` ADD CONSTRAINT `gift_cards_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_cards` ADD CONSTRAINT `gift_cards_issued_by_fkey` FOREIGN KEY (`issued_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `designations` ADD CONSTRAINT `designations_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_designation_id_fkey` FOREIGN KEY (`designation_id`) REFERENCES `designations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `outbox_events` ADD CONSTRAINT `outbox_events_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `outbox_events` ADD CONSTRAINT `outbox_events_business_event_id_fkey` FOREIGN KEY (`business_event_id`) REFERENCES `business_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_endpoints` ADD CONSTRAINT `webhook_endpoints_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_deliveries` ADD CONSTRAINT `webhook_deliveries_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_deliveries` ADD CONSTRAINT `webhook_deliveries_webhook_endpoint_id_fkey` FOREIGN KEY (`webhook_endpoint_id`) REFERENCES `webhook_endpoints`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_deliveries` ADD CONSTRAINT `webhook_deliveries_outbox_event_id_fkey` FOREIGN KEY (`outbox_event_id`) REFERENCES `outbox_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_jobs` ADD CONSTRAINT `import_jobs_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_job_errors` ADD CONSTRAINT `import_job_errors_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_job_errors` ADD CONSTRAINT `import_job_errors_import_job_id_fkey` FOREIGN KEY (`import_job_id`) REFERENCES `import_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `offline_commands` ADD CONSTRAINT `offline_commands_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `offline_sync_batches` ADD CONSTRAINT `offline_sync_batches_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_transfers` ADD CONSTRAINT `account_transfers_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_transfers` ADD CONSTRAINT `account_transfers_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_transfers` ADD CONSTRAINT `account_transfers_from_financial_account_id_fkey` FOREIGN KEY (`from_financial_account_id`) REFERENCES `financial_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_transfers` ADD CONSTRAINT `account_transfers_to_financial_account_id_fkey` FOREIGN KEY (`to_financial_account_id`) REFERENCES `financial_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_transfers` ADD CONSTRAINT `account_transfers_from_currency_code_fkey` FOREIGN KEY (`from_currency_code`) REFERENCES `currencies`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_transfers` ADD CONSTRAINT `account_transfers_to_currency_code_fkey` FOREIGN KEY (`to_currency_code`) REFERENCES `currencies`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_transfers` ADD CONSTRAINT `account_transfers_journal_entry_id_fkey` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_transfers` ADD CONSTRAINT `account_transfers_reversal_of_id_fkey` FOREIGN KEY (`reversal_of_id`) REFERENCES `account_transfers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_transfers` ADD CONSTRAINT `account_transfers_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_transfers` ADD CONSTRAINT `account_transfers_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_advance_ledger` ADD CONSTRAINT `customer_advance_ledger_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_advance_ledger` ADD CONSTRAINT `customer_advance_ledger_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_advance_ledger` ADD CONSTRAINT `customer_advance_ledger_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_advance_ledger` ADD CONSTRAINT `customer_advance_ledger_sale_return_id_fkey` FOREIGN KEY (`sale_return_id`) REFERENCES `sale_returns`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_advance_ledger` ADD CONSTRAINT `customer_advance_ledger_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `business_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_advance_ledger` ADD CONSTRAINT `customer_advance_ledger_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_advance_ledger` ADD CONSTRAINT `supplier_advance_ledger_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_advance_ledger` ADD CONSTRAINT `supplier_advance_ledger_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_advance_ledger` ADD CONSTRAINT `supplier_advance_ledger_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_advance_ledger` ADD CONSTRAINT `supplier_advance_ledger_purchase_return_id_fkey` FOREIGN KEY (`purchase_return_id`) REFERENCES `purchase_returns`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_advance_ledger` ADD CONSTRAINT `supplier_advance_ledger_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `business_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_advance_ledger` ADD CONSTRAINT `supplier_advance_ledger_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `withholding_transactions` ADD CONSTRAINT `withholding_transactions_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `withholding_transactions` ADD CONSTRAINT `withholding_transactions_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `withholding_transactions` ADD CONSTRAINT `withholding_transactions_withholding_rule_id_fkey` FOREIGN KEY (`withholding_rule_id`) REFERENCES `withholding_rules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `withholding_transactions` ADD CONSTRAINT `withholding_transactions_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `withholding_transactions` ADD CONSTRAINT `withholding_transactions_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expense_item_taxes` ADD CONSTRAINT `expense_item_taxes_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expense_item_taxes` ADD CONSTRAINT `expense_item_taxes_expense_item_id_fkey` FOREIGN KEY (`expense_item_id`) REFERENCES `expense_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expense_item_taxes` ADD CONSTRAINT `expense_item_taxes_tax_component_id_fkey` FOREIGN KEY (`tax_component_id`) REFERENCES `tax_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expense_attachments` ADD CONSTRAINT `expense_attachments_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expense_attachments` ADD CONSTRAINT `expense_attachments_expense_id_fkey` FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expense_attachments` ADD CONSTRAINT `expense_attachments_uploaded_by_fkey` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_card_transactions` ADD CONSTRAINT `gift_card_transactions_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_card_transactions` ADD CONSTRAINT `gift_card_transactions_gift_card_id_fkey` FOREIGN KEY (`gift_card_id`) REFERENCES `gift_cards`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupons` ADD CONSTRAINT `coupons_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_redemptions` ADD CONSTRAINT `coupon_redemptions_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_redemptions` ADD CONSTRAINT `coupon_redemptions_coupon_id_fkey` FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_redemptions` ADD CONSTRAINT `coupon_redemptions_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reward_point_transactions` ADD CONSTRAINT `reward_point_transactions_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reward_point_transactions` ADD CONSTRAINT `reward_point_transactions_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reward_point_transactions` ADD CONSTRAINT `reward_point_transactions_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reward_point_consumptions` ADD CONSTRAINT `reward_point_consumptions_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reward_point_consumptions` ADD CONSTRAINT `reward_point_consumptions_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reward_point_consumptions` ADD CONSTRAINT `reward_point_consumptions_earn_transaction_id_fkey` FOREIGN KEY (`earn_transaction_id`) REFERENCES `reward_point_transactions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reward_point_consumptions` ADD CONSTRAINT `reward_point_consumptions_consume_transaction_id_fkey` FOREIGN KEY (`consume_transaction_id`) REFERENCES `reward_point_transactions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `holidays` ADD CONSTRAINT `holidays_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `holidays` ADD CONSTRAINT `holidays_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_types` ADD CONSTRAINT `leave_types_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_leave_type_id_fkey` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_components` ADD CONSTRAINT `payroll_components_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_components` ADD CONSTRAINT `payroll_components_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_item_components` ADD CONSTRAINT `payroll_item_components_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_item_components` ADD CONSTRAINT `payroll_item_components_payroll_component_id_fkey` FOREIGN KEY (`payroll_component_id`) REFERENCES `payroll_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_item_components` ADD CONSTRAINT `payroll_item_components_payroll_item_id_fkey` FOREIGN KEY (`payroll_item_id`) REFERENCES `payroll_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_items` ADD CONSTRAINT `payroll_items_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_items` ADD CONSTRAINT `payroll_items_payroll_run_id_fkey` FOREIGN KEY (`payroll_run_id`) REFERENCES `payroll_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_items` ADD CONSTRAINT `payroll_items_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_consents` ADD CONSTRAINT `communication_consents_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_consents` ADD CONSTRAINT `communication_consents_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_consents` ADD CONSTRAINT `communication_consents_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_campaigns` ADD CONSTRAINT `communication_campaigns_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_campaigns` ADD CONSTRAINT `communication_campaigns_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `communication_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_campaigns` ADD CONSTRAINT `communication_campaigns_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_campaigns` ADD CONSTRAINT `communication_campaigns_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_campaign_recipients` ADD CONSTRAINT `communication_campaign_recipients_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_campaign_recipients` ADD CONSTRAINT `communication_campaign_recipients_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES `communication_campaigns`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_campaign_recipients` ADD CONSTRAINT `communication_campaign_recipients_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `outbound_messages` ADD CONSTRAINT `outbound_messages_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `outbound_messages` ADD CONSTRAINT `outbound_messages_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `communication_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_notifications` ADD CONSTRAINT `user_notifications_notification_id_fkey` FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_notifications` ADD CONSTRAINT `user_notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `print_jobs` ADD CONSTRAINT `print_jobs_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `print_jobs` ADD CONSTRAINT `print_jobs_requested_by_fkey` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_budget_leases` ADD CONSTRAINT `stock_budget_leases_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_budget_leases` ADD CONSTRAINT `stock_budget_leases_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_budget_leases` ADD CONSTRAINT `stock_budget_leases_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_budget_leases` ADD CONSTRAINT `stock_budget_leases_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_budget_leases` ADD CONSTRAINT `stock_budget_leases_warehouse_id_fkey` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `risk_assessments` ADD CONSTRAINT `risk_assessments_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `risk_assessments` ADD CONSTRAINT `risk_assessments_request_event_id_fkey` FOREIGN KEY (`request_event_id`) REFERENCES `business_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `data_subject_requests` ADD CONSTRAINT `data_subject_requests_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `data_subject_requests` ADD CONSTRAINT `data_subject_requests_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `legal_holds` ADD CONSTRAINT `legal_holds_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `legal_holds` ADD CONSTRAINT `legal_holds_declared_by_fkey` FOREIGN KEY (`declared_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `risk_assessment_outcomes` ADD CONSTRAINT `risk_assessment_outcomes_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `risk_assessment_outcomes` ADD CONSTRAINT `risk_assessment_outcomes_risk_assessment_id_fkey` FOREIGN KEY (`risk_assessment_id`) REFERENCES `risk_assessments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `currency_revaluations` ADD CONSTRAINT `currency_revaluations_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fixed_assets` ADD CONSTRAINT `fixed_assets_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fixed_assets` ADD CONSTRAINT `fixed_assets_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `fixed_asset_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fixed_assets` ADD CONSTRAINT `fixed_assets_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fixed_asset_categories` ADD CONSTRAINT `fixed_asset_categories_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fixed_asset_depreciation` ADD CONSTRAINT `fixed_asset_depreciation_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fixed_asset_depreciation` ADD CONSTRAINT `fixed_asset_depreciation_fixed_asset_id_fkey` FOREIGN KEY (`fixed_asset_id`) REFERENCES `fixed_assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_reconciliations` ADD CONSTRAINT `bank_reconciliations_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_reconciliations` ADD CONSTRAINT `bank_reconciliations_financial_account_id_fkey` FOREIGN KEY (`financial_account_id`) REFERENCES `financial_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_reconciliation_lines` ADD CONSTRAINT `bank_reconciliation_lines_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_reconciliation_lines` ADD CONSTRAINT `bank_reconciliation_lines_reconciliation_id_fkey` FOREIGN KEY (`reconciliation_id`) REFERENCES `bank_reconciliations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
