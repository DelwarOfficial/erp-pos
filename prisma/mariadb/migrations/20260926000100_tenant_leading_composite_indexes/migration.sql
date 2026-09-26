-- F-67: indexes that match how tenant data is actually queried.
--
-- The tenant-isolation extension (src/lib/db/tenantClient.ts) puts company_id
-- in the predicate of every scoped query, but nearly every index was
-- single-column: (company_id) on its own, and (business_date), (occurred_at),
-- (status) and so on separately. For
--
--   WHERE company_id = ? AND business_date BETWEEN ? AND ? ORDER BY business_date
--
-- InnoDB uses one of those, and both are poor: company_id alone matches most of
-- a large tenant's rows, and business_date alone spans every tenant. The engine
-- reads a large slice and filters it in memory, then sorts.
--
-- Each index below leads with company_id and continues with the column the hot
-- query filters or orders by, so one index satisfies the whole predicate and
-- the ordering. Chosen from the queries the application issues, and measured
-- with ANALYZE on a volume-loaded disposable database before and after (see
-- scripts/benchmarks/index-plans.mjs).
--
-- Where a new composite leads with company_id, the old (company_id) index is
-- dropped: the composite serves every lookup it did, including the foreign key
-- on company_id, and each redundant index is a write on every insert. Nothing
-- else is dropped here.

-- Sales and payments: listed and summarised by company over a date range.
CREATE INDEX `sales_company_business_date_idx` ON `sales` (`company_id`, `business_date`);
DROP INDEX `sales_company_id_idx` ON `sales`;

CREATE INDEX `payments_company_business_date_idx` ON `payments` (`company_id`, `business_date`);
DROP INDEX `payments_company_id_idx` ON `payments`;

-- Provider webhooks resolve the local payment by the provider's reference,
-- scoped by provider (F-08). There was no index on method_reference at all, so
-- every webhook scanned the payments of every company.
CREATE INDEX `payments_method_reference_idx` ON `payments` (`payment_method`, `method_reference`);

-- Ledger reports: entries by company, status and date, then their lines.
CREATE INDEX `journal_entries_company_status_date_idx` ON `journal_entries` (`company_id`, `status`, `entry_date`);
DROP INDEX `journal_entries_company_id_idx` ON `journal_entries`;

CREATE INDEX `journal_lines_company_account_idx` ON `journal_lines` (`company_id`, `chart_of_account_id`);
DROP INDEX `journal_lines_company_id_idx` ON `journal_lines`;

-- Audit and security events: listed newest first per company, and purged per
-- company by age in the retention job.
CREATE INDEX `audit_logs_company_occurred_at_idx` ON `audit_logs` (`company_id`, `occurred_at`);
DROP INDEX `audit_logs_company_id_idx` ON `audit_logs`;

CREATE INDEX `security_events_company_occurred_at_idx` ON `security_events` (`company_id`, `occurred_at`);
DROP INDEX `security_events_company_id_idx` ON `security_events`;

-- Retention selects inactive customers by company and age.
CREATE INDEX `customers_company_active_updated_idx` ON `customers` (`company_id`, `is_active`, `updated_at`);
DROP INDEX `customers_company_id_idx` ON `customers`;

-- Product lists and POS lookups filter active, undeleted products per company.
CREATE INDEX `products_company_active_deleted_idx` ON `products` (`company_id`, `is_active`, `deleted_at`);
DROP INDEX `products_company_id_idx` ON `products`;

-- Every retention run and erasure checks for active holds per company.
CREATE INDEX `legal_holds_company_released_idx` ON `legal_holds` (`company_id`, `released_at`);
DROP INDEX `legal_holds_company_id_idx` ON `legal_holds`;
