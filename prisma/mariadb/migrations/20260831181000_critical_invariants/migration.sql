-- Critical MariaDB business invariants absent from Prisma's schema language.

ALTER TABLE `document_sequences`
  ADD COLUMN `branch_scope` VARCHAR(191) AS (IFNULL(`branch_id`, '')) PERSISTENT,
  ADD CONSTRAINT `document_sequences_next_positive_chk` CHECK (`next_number` > 0),
  ADD CONSTRAINT `document_sequences_padding_chk` CHECK (`padding` BETWEEN 1 AND 12),
  ADD UNIQUE INDEX `uq_document_sequences_scope` (`company_id`, `branch_scope`, `document_type`, `fiscal_year`);

ALTER TABLE `document_number_leases`
  ADD CONSTRAINT `document_leases_range_order_chk` CHECK (`range_end` >= `range_start`),
  ADD CONSTRAINT `document_leases_next_range_chk` CHECK (`next_number` BETWEEN `range_start` AND (`range_end` + 1)),
  ADD UNIQUE INDEX `uq_document_lease_start` (`company_id`, `document_type`, `prefix`, `range_start`),
  ADD UNIQUE INDEX `uq_document_lease_end` (`company_id`, `document_type`, `prefix`, `range_end`);

ALTER TABLE `journal_lines`
  ADD CONSTRAINT `journal_lines_debit_xor_credit_chk`
  CHECK ((`debit_base` > 0 AND `credit_base` = 0) OR (`debit_base` = 0 AND `credit_base` > 0));

ALTER TABLE `supplier_advance_ledger`
  ADD CONSTRAINT `supplier_advance_exactly_one_source_chk`
  CHECK (((`payment_id` IS NOT NULL) + (`purchase_return_id` IS NOT NULL)) = 1);

ALTER TABLE `transfer_items`
  ADD CONSTRAINT `transfer_items_qty_nonnegative_chk`
    CHECK (`qty_requested` >= 0 AND `qty_dispatched` >= 0 AND `qty_received` >= 0),
  ADD CONSTRAINT `transfer_items_qty_dispatched_chk` CHECK (`qty_dispatched` <= `qty_requested`),
  ADD CONSTRAINT `transfer_items_qty_received_chk` CHECK (`qty_received` <= `qty_dispatched`);

ALTER TABLE `stock_budget_leases`
  ADD CONSTRAINT `stock_budget_qty_chk`
  CHECK (`qty_granted` >= 0 AND `qty_consumed` >= 0 AND `qty_consumed` <= `qty_granted`);

ALTER TABLE `risk_assessments`
  ADD CONSTRAINT `risk_assessments_expiry_chk` CHECK (`expires_at` > `assessed_at`);

ALTER TABLE `fiscal_periods`
  ADD CONSTRAINT `fiscal_periods_order_chk` CHECK (`period_end` >= `period_start`);

ALTER TABLE `fixed_assets`
  ADD CONSTRAINT `fixed_assets_useful_life_chk` CHECK (`useful_life_months` > 0),
  ADD CONSTRAINT `fixed_assets_nbv_nonnegative_chk` CHECK (`net_book_value` >= 0),
  ADD CONSTRAINT `fixed_assets_cost_values_chk`
    CHECK (`purchase_cost` >= 0 AND `salvage_value` >= 0 AND `accumulated_depreciation` >= 0);

ALTER TABLE `warehouse_stocks`
  ADD CONSTRAINT `warehouse_stocks_quantities_chk`
    CHECK (`qty_reserved` >= 0 AND `qty_in_transit_out` >= 0 AND `qty_damaged` >= 0),
  ADD CONSTRAINT `warehouse_stocks_cost_chk` CHECK (`moving_average_cost` >= 0);

ALTER TABLE `payment_allocations`
  ADD CONSTRAINT `payment_allocations_amount_chk`
    CHECK (`allocated_amount` > 0 AND `allocated_base_amount` > 0),
  ADD CONSTRAINT `payment_allocations_target_chk`
    CHECK (((`sale_id` IS NOT NULL) + (`purchase_id` IS NOT NULL)) <= 1);

CREATE FUNCTION `format_document_number`(
  `p_prefix` VARCHAR(191),
  `p_number` BIGINT,
  `p_padding` SMALLINT
) RETURNS VARCHAR(255)
DETERMINISTIC
NO SQL
RETURN CONCAT(`p_prefix`, LPAD(CAST(`p_number` AS CHAR), `p_padding`, '0'));

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `warehouse_stock_available_v` AS
SELECT ws.company_id, ws.warehouse_id, ws.product_id, ws.qty_on_hand,
       COALESCE(ws.qty_reserved, 0) AS qty_reserved,
       ws.qty_on_hand - COALESCE(ws.qty_reserved, 0) AS qty_available,
       ws.moving_average_cost,
       ws.qty_on_hand * ws.moving_average_cost AS inventory_value
FROM warehouse_stocks ws;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `sale_balance_v` AS
SELECT s.company_id, s.id AS sale_id, s.customer_id, s.grand_total,
       COALESCE((SELECT SUM(pa.allocated_amount) FROM payment_allocations pa WHERE pa.sale_id = s.id), 0) AS allocated,
       s.grand_total - COALESCE((SELECT SUM(pa.allocated_amount) FROM payment_allocations pa WHERE pa.sale_id = s.id), 0) AS balance_due
FROM sales s
WHERE s.sale_status IN ('completed', 'partially_paid', 'partially_returned');

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `purchase_balance_v` AS
SELECT p.company_id, p.id AS purchase_id, p.supplier_id, p.grand_total,
       COALESCE((SELECT SUM(pa.allocated_amount) FROM payment_allocations pa WHERE pa.purchase_id = p.id), 0) AS allocated,
       p.grand_total - COALESCE((SELECT SUM(pa.allocated_amount) FROM payment_allocations pa WHERE pa.purchase_id = p.id), 0) AS balance_due
FROM purchases p
WHERE p.order_status IN ('received', 'partially_paid');

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `customer_ar_v` AS
SELECT company_id, customer_id, SUM(grand_total) AS total_sales,
       SUM(allocated) AS total_allocated, SUM(balance_due) AS outstanding_ar
FROM sale_balance_v GROUP BY company_id, customer_id;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `supplier_ap_v` AS
SELECT company_id, supplier_id, SUM(grand_total) AS total_purchases,
       SUM(allocated) AS total_allocated, SUM(balance_due) AS outstanding_ap
FROM purchase_balance_v GROUP BY company_id, supplier_id;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `customer_advance_balance_v` AS
SELECT company_id, customer_id, SUM(amount_delta) AS advance_balance
FROM customer_advance_ledger GROUP BY company_id, customer_id;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `supplier_advance_balance_v` AS
SELECT company_id, supplier_id, SUM(amount_delta) AS advance_balance
FROM supplier_advance_ledger GROUP BY company_id, supplier_id;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `gift_card_balance_v` AS
SELECT company_id, gift_card_id, SUM(amount_delta) AS current_balance
FROM gift_card_transactions GROUP BY company_id, gift_card_id;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `reward_point_balance_v` AS
SELECT company_id, customer_id, SUM(points_delta) AS current_points
FROM reward_point_transactions GROUP BY company_id, customer_id;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `cashier_shift_expected_v` AS
SELECT company_id, id AS shift_id, cashier_id, opening_float,
       CAST(0 AS DECIMAL(65, 30)) AS cash_in, CAST(0 AS DECIMAL(65, 30)) AS cash_out,
       opening_float AS expected_cash
FROM cashier_shifts;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `trial_balance_v` AS
SELECT jl.company_id, jl.chart_of_account_id, coa.code AS account_code,
       coa.name AS account_name, coa.account_class, coa.normal_balance,
       SUM(jl.debit_base) AS total_debit, SUM(jl.credit_base) AS total_credit,
       CASE WHEN coa.normal_balance IN ('D', 'debit')
            THEN SUM(jl.debit_base) - SUM(jl.credit_base)
            ELSE SUM(jl.credit_base) - SUM(jl.debit_base) END AS balance
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
JOIN chart_of_accounts coa ON coa.id = jl.chart_of_account_id AND coa.company_id = jl.company_id
WHERE je.status = 'posted'
GROUP BY jl.company_id, jl.chart_of_account_id, coa.code, coa.name, coa.account_class, coa.normal_balance;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `inventory_valuation_v` AS
SELECT company_id, warehouse_id, product_id, qty_on_hand, moving_average_cost,
       qty_on_hand * moving_average_cost AS total_value
FROM warehouse_stocks WHERE qty_on_hand > 0;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `overdue_installments_v` AS
SELECT company_id, id AS installment_id, sale_id, due_date, amount,
       CAST(0 AS DECIMAL(65, 30)) AS paid_amount, TRUE AS is_overdue,
       TIMESTAMPDIFF(DAY, due_date, CURRENT_DATE) AS days_overdue
FROM installments WHERE due_date < CURRENT_DATE;
