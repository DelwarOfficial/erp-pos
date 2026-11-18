# M8 — UAT Scenarios

Per §17.5 — full end-to-end user acceptance test scenarios.

## Scenario 1: Cashier Flow
1. Open cashier shift (POST /api/v1/cashier-shifts/open)
2. Post a cash sale (POST /api/v1/sales — cash payment)
3. Post a split-tender sale (cash + card)
4. Recall a held sale (TODO: hold/recall API)
5. Post a return with restock (POST /api/v1/sale-returns — condition=resalable)
6. Close cashier shift with variance (POST /api/v1/cashier-shifts/{id}/close — counted ≠ expected)
7. Verify: stock reduced, journals posted (revenue + COGS), payment recorded, shift variance logged

## Scenario 2: Inventory Flow
1. Create a purchase order (POST /api/v1/purchases)
2. Receive partial quantity (POST /api/v1/purchases/{id}/receivings)
3. Receive remaining quantity with serials (IMEI capture)
4. Post stock count (TODO: stock-count API)
5. Post stock adjustment for damage (POST /api/v1/stock-adjustments — type=damage)
6. Transfer stock between warehouses (POST /api/v1/transfers → dispatch → receive)
7. Post landed cost (POST /api/v1/landed-costs)
8. Verify: moving-average cost recalculated, IMEI unique, negative-stock blocked, transfer lifecycle complete

## Scenario 3: Accountant Flow
1. Post opening balances (POST /api/v1/inventory/opening-stock)
2. Post a manual journal entry (POST /api/v1/journal-entries — balanced Dr/Cr)
3. Post an expense (POST /api/v1/expenses)
4. View trial balance (GET /api/v1/reports/trial-balance)
5. Lock a fiscal period (POST /api/v1/fiscal-periods — status=locked)
6. Attempt to post to locked period — should fail with FISCAL_PERIOD_LOCKED
7. Verify: double-entry balanced, reversal negates, trial balance totals match

## Scenario 4: Service Flow
1. Create service request (POST /api/v1/service-requests — type=warranty)
2. Consume parts (POST /api/v1/service-requests/{id}/parts)
3. Create warranty claim (POST /api/v1/warranty-claims — type=replace)
4. Verify: serial moved to 'repair' status, parts reduced stock, journal Dr Repair WIP / Cr Inventory

## Scenario 5: Manager Flow
1. View dashboard (GET /api/v1/me — permissions)
2. View security events (GET /api/v1/security-events)
3. View audit log (GET /api/v1/audit-logs)
4. Toggle feature flag (PATCH /api/v1/feature-flags/{key})
5. View trial balance (GET /api/v1/reports/trial-balance)
6. Verify: correct scope enforced, all actions audited

## Scenario 6: Offline Flow
1. Bootstrap device (POST /api/v1/offline/bootstrap — signed snapshot)
2. Upload offline commands (POST /api/v1/offline/sync — cash_sale commands)
3. Verify: duplicate detection, conflict handling, no duplicate sales
4. Verify: serialized/credit/gift-card operations rejected offline (blacklist)

## Scenario 7: Delivery Flow
1. Create delivery order from posted sale (POST /api/v1/deliveries)
2. Transition through statuses (POST /api/v1/deliveries/{id}/transition)
3. Post COD settlement (POST /api/v1/courier-settlements)
4. Verify: COD clearing journal (Dr Cash, Dr Fee, Cr COD Receivable), delivery state machine

## Pass Criteria
- All scenarios complete without unhandled errors
- All journals balance (Dr total = Cr total)
- All stock movements reconcile to warehouse_stocks
- All actions audited in audit_logs
- No cross-tenant data leakage
