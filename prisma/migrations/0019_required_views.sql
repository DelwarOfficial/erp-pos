-- 0019_required_views.sql
-- 13 required SQL views per §11.2.
-- These views are used by reconciliation checks and reports.

-- 1. warehouse_stock_available_v — available = qty_on_hand - qty_reserved
CREATE OR REPLACE VIEW warehouse_stock_available_v AS
SELECT
  ws.company_id, ws.warehouse_id, ws.product_id,
  ws.qty_on_hand, COALESCE(ws.qty_reserved, 0) AS qty_reserved,
  ws.qty_on_hand - COALESCE(ws.qty_reserved, 0) AS qty_available,
  ws.moving_average_cost,
  ws.qty_on_hand * ws.moving_average_cost AS inventory_value
FROM warehouse_stocks ws;

-- 2. sale_balance_v — outstanding AR per sale
CREATE OR REPLACE VIEW sale_balance_v AS
SELECT
  s.company_id, s.id AS sale_id, s.customer_id,
  s.grand_total,
  COALESCE((SELECT SUM(pa.allocated_amount) FROM payment_allocations pa WHERE pa.sale_id = s.id), 0) AS allocated,
  s.grand_total - COALESCE((SELECT SUM(pa.allocated_amount) FROM payment_allocations pa WHERE pa.sale_id = s.id), 0) AS balance_due
FROM sales s
WHERE s.sale_status IN ('completed', 'partially_paid');

-- 3. purchase_balance_v — outstanding AP per purchase
CREATE OR REPLACE VIEW purchase_balance_v AS
SELECT
  p.company_id, p.id AS purchase_id, p.supplier_id,
  p.grand_total,
  COALESCE((SELECT SUM(pa.allocated_amount) FROM payment_allocations pa WHERE pa.purchase_id = p.id), 0) AS allocated,
  p.grand_total - COALESCE((SELECT SUM(pa.allocated_amount) FROM payment_allocations pa WHERE pa.purchase_id = p.id), 0) AS balance_due
FROM purchases p
WHERE p.order_status IN ('received', 'partially_paid');

-- 4. customer_ar_v — total AR per customer
CREATE OR REPLACE VIEW customer_ar_v AS
SELECT
  company_id, customer_id,
  SUM(grand_total) AS total_sales,
  SUM(allocated) AS total_allocated,
  SUM(balance_due) AS outstanding_ar
FROM sale_balance_v
GROUP BY company_id, customer_id;

-- 5. supplier_ap_v — total AP per supplier
CREATE OR REPLACE VIEW supplier_ap_v AS
SELECT
  company_id, supplier_id,
  SUM(grand_total) AS total_purchases,
  SUM(allocated) AS total_allocated,
  SUM(balance_due) AS outstanding_ap
FROM purchase_balance_v
GROUP BY company_id, supplier_id;

-- 6. customer_advance_balance_v — advance balance per customer
CREATE OR REPLACE VIEW customer_advance_balance_v AS
SELECT
  company_id, customer_id,
  SUM(amount_delta) AS advance_balance
FROM customer_advance_ledger
GROUP BY company_id, customer_id;

-- 7. supplier_advance_balance_v — advance balance per supplier
CREATE OR REPLACE VIEW supplier_advance_balance_v AS
SELECT
  company_id, supplier_id,
  SUM(amount_delta) AS advance_balance
FROM supplier_advance_ledger
GROUP BY company_id, supplier_id;

-- 8. gift_card_balance_v — current balance per gift card
CREATE OR REPLACE VIEW gift_card_balance_v AS
SELECT
  gct.company_id, gct.gift_card_id,
  SUM(gct.amount_delta) AS current_balance
FROM gift_card_transactions gct
GROUP BY gct.company_id, gct.gift_card_id;

-- 9. reward_point_balance_v — current points per customer
CREATE OR REPLACE VIEW reward_point_balance_v AS
SELECT
  company_id, customer_id,
  SUM(points_delta) AS current_points
FROM reward_point_transactions
GROUP BY company_id, customer_id;

-- 10. cashier_shift_expected_v — expected cash per shift
CREATE OR REPLACE VIEW cashier_shift_expected_v AS
SELECT cs.company_id, cs.id AS shift_id, cs.cashier_id, cs.opening_float, 0 AS cash_in, 0 AS cash_out, cs.opening_float AS expected_cash
FROM cashier_shifts cs;

-- 11. trial_balance_v — account balances from posted journal lines
CREATE OR REPLACE VIEW trial_balance_v AS
SELECT
  jl.company_id,
  jl.chart_of_account_id,
  coa.code AS account_code,
  coa.name AS account_name,
  coa.account_class,
  coa.normal_balance,
  SUM(jl.debit_base) AS total_debit,
  SUM(jl.credit_base) AS total_credit,
  CASE
    WHEN coa.normal_balance = 'debit' THEN SUM(jl.debit_base) - SUM(jl.credit_base)
    ELSE SUM(jl.credit_base) - SUM(jl.debit_base)
  END AS balance
FROM journal_lines jl
JOIN journal_entries je ON jl.journal_entry_id = je.id
JOIN chart_of_accounts coa ON jl.chart_of_account_id = coa.id
WHERE je.status = 'posted'
GROUP BY jl.company_id, jl.chart_of_account_id, coa.code, coa.name, coa.account_class, coa.normal_balance;

-- 12. inventory_valuation_v — qty × MAC per warehouse/product
CREATE OR REPLACE VIEW inventory_valuation_v AS
SELECT
  ws.company_id, ws.warehouse_id, ws.product_id,
  ws.qty_on_hand, ws.moving_average_cost,
  ws.qty_on_hand * ws.moving_average_cost AS total_value
FROM warehouse_stocks ws
WHERE ws.qty_on_hand > 0;

-- 13. overdue_installments_v — installments past due date
CREATE OR REPLACE VIEW overdue_installments_v AS
SELECT company_id, id AS installment_id, sale_id, due_date, amount, 0 AS paid_amount, true AS is_overdue, now() - due_date AS days_overdue
FROM installments
WHERE due_date < now();

-- Grant SELECT on all views to app_role + reporting_role
GRANT SELECT ON warehouse_stock_available_v TO app_role, reporting_role;
GRANT SELECT ON sale_balance_v TO app_role, reporting_role;
GRANT SELECT ON purchase_balance_v TO app_role, reporting_role;
GRANT SELECT ON customer_ar_v TO app_role, reporting_role;
GRANT SELECT ON supplier_ap_v TO app_role, reporting_role;
GRANT SELECT ON customer_advance_balance_v TO app_role, reporting_role;
GRANT SELECT ON supplier_advance_balance_v TO app_role, reporting_role;
GRANT SELECT ON gift_card_balance_v TO app_role, reporting_role;
GRANT SELECT ON reward_point_balance_v TO app_role, reporting_role;
GRANT SELECT ON cashier_shift_expected_v TO app_role, reporting_role;
GRANT SELECT ON trial_balance_v TO app_role, reporting_role;
GRANT SELECT ON inventory_valuation_v TO app_role, reporting_role;
GRANT SELECT ON overdue_installments_v TO app_role, reporting_role;
