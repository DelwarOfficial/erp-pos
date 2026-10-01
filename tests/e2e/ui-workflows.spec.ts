import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { ensureSyntheticIssuerTenant } from '../integration/helpers/disposableFixtures';

const db = new PrismaClient({ log: [] });
let fixture: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let token: string;
let warehouse: { id: string; name: string };
let destination: { id: string; name: string };
let product: { id: string; name: string };
let supplier: { id: string; name: string };
let customer: { id: string; name: string };
test.beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? 'invalid:');
  if (process.env.UI_HEALTH_LOCAL_VERIFICATION !== '1' || target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') throw new Error('Only approved disposable database allowed');
  const companyId = randomUUID();
  fixture = await ensureSyntheticIssuerTenant(db, { companyId, label: 'Workflow browser', code: `UI-${randomUUID().slice(0, 8)}` });
  for (const code of ['crm.lead.read', 'crm.lead.create', 'crm.lead.update', 'lead.convert', 'purchase.read', 'purchase.create', 'purchase.receive', 'supplier.read', 'product.read', 'inventory.read', 'transfer.dispatch', 'transfer.receive', 'stock_count.post', 'stock_adjustment.post', 'approval.resolve', 'service.read', 'service.intake', 'service.complete', 'sale.read', 'sale.post', 'customer.read', 'payment.read', 'shift.read', 'sale_return.post', 'sale.refund.branch', 'payment.pay.branch']) {
    const permission = await db.permission.upsert({ where: { code }, create: { code, module: code.split('.')[0], description: code }, update: {} });
    await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: fixture.role.id, permissionId: permission.id } }, create: { roleId: fixture.role.id, permissionId: permission.id }, update: {} });
  }
  warehouse = await db.warehouse.create({ data: { companyId, branchId: fixture.branches[0].id, code: 'UI-SOURCE', name: 'Browser source warehouse' } });
  destination = await db.warehouse.create({ data: { companyId, branchId: fixture.branches[1].id, code: 'UI-DEST', name: 'Browser destination warehouse' } });
  const category = await db.category.create({ data: { companyId, name: 'Browser goods', code: 'UI' } });
  const unit = await db.unit.create({ data: { companyId, name: 'Piece', code: 'pc' } });
  product = await db.product.create({ data: { companyId, name: 'Browser receiving product', code: 'UI-PRODUCT', categoryId: category.id, unitId: unit.id, defaultPrice: 100, referenceCost: 50 } });
  supplier = await db.supplier.create({ data: { companyId, name: 'Browser supplier' } });
  customer = await db.customer.create({ data: { companyId, name: 'Browser customer' } });
  const familyId = randomUUID(); const sessionId = randomUUID();
  await db.refreshToken.create({ data: { companyId, userId: fixture.user.id, familyId, sessionId, mfaVerified: true, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
  token = await new SignJWT({ company_id: companyId, scope: 'multi_branch', is_global: false, branch_ids: fixture.branches.map(branch => branch.id), session_id: sessionId, family_id: familyId, mfa_verified: true })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer('erp-pos').setAudience('erp-pos-clients').setSubject(fixture.user.id)
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
});
test.afterAll(async () => { await db.$disconnect(); });
async function login(page: Page) {
  await page.context().addCookies([{ name: 'erp_access', value: token, url: process.env.E2E_BASE_URL!, httpOnly: true, sameSite: 'Strict' }]);
}
async function pick(page: Page, label: string, name: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
}

test('purchase create → view → partial/full receiving preserves correct IDs, stock and ledger', async ({ page }) => {
  await login(page); await page.goto('/dashboard/purchases');
  await page.getByRole('button', { name: 'New Purchase', exact: true }).click();
  await pick(page, 'Supplier', supplier.name); await pick(page, 'Warehouse', warehouse.name); await pick(page, 'Product 1', product.name);
  await page.getByLabel('Qty Ordered', { exact: true }).fill('4'); await page.getByLabel('Unit Cost (BDT)', { exact: true }).fill('50');
  const created = page.waitForResponse(response => response.url().endsWith('/api/v1/purchases') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create Purchase Order', exact: true }).click();
  const response = await created; expect(response.status()).toBe(201);
  const purchase = await response.json();
  const persisted = await db.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
  expect(persisted.warehouseId).toBe(warehouse.id); expect(persisted.branchId).toBe(fixture.branches[0].id);
  await page.getByRole('row').filter({ hasText: purchase.reference_no }).getByRole('button', { name: 'View purchase' }).click();
  page.on('dialog', dialog => dialog.accept());
  for (const status of ['partially_received', 'received']) {
    await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
    await page.getByLabel(/Receive now/).fill('2');
    const posted = page.waitForResponse(result => result.url().endsWith(`/purchases/${purchase.id}/receivings`) && result.request().method() === 'POST');
    await page.getByRole('button', { name: 'Post receiving', exact: true }).click();
    const receipt = await posted; expect(receipt.status(), await receipt.text()).toBe(201);
    expect((await db.purchase.findUniqueOrThrow({ where: { id: purchase.id } })).orderStatus).toBe(status);
    await expect(page.getByRole('heading', { name: 'Receiving history' })).toBeVisible();
  }
  const stock = await db.warehouseStock.findUniqueOrThrow({ where: { companyId_warehouseId_productId: { companyId: fixture.companyId, warehouseId: warehouse.id, productId: product.id } } });
  expect(stock.qtyOnHand.toString()).toBe('4'); expect(stock.movingAverageCost.toString()).toBe('50');
  expect(await db.purchaseReceiving.count({ where: { purchaseId: purchase.id } })).toBe(2);
  const receipts = await db.purchaseReceiving.findMany({ where: { purchaseId: purchase.id } });
  expect(await db.journalEntry.count({ where: { companyId: fixture.companyId, sourceType: 'purchase_receiving', sourceId: { in: receipts.map(row => row.id) }, status: 'posted' } })).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('transfer create → dispatch → receive updates both warehouses', async ({ page }) => {
  // Independent stock fixture; test must not rely on the preceding purchase test.
  await db.warehouseStock.upsert({ where: { companyId_warehouseId_productId: { companyId: fixture.companyId, warehouseId: warehouse.id, productId: product.id } },
    create: { companyId: fixture.companyId, warehouseId: warehouse.id, productId: product.id, qtyOnHand: 10, movingAverageCost: 50 }, update: { qtyOnHand: 10 } });
  await login(page); await page.goto('/dashboard/inventory/transfers');
  await page.getByRole('button', { name: 'New transfer', exact: true }).click();
  await pick(page, 'Source warehouse', warehouse.name); await pick(page, 'Destination warehouse', destination.name); await pick(page, 'Product 1', product.name);
  await page.getByLabel('Quantity', { exact: true }).fill('2'); page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Create transfer', exact: true }).click();
  await page.getByRole('button', { name: 'Dispatch transfer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Receive transfer', exact: true })).toBeVisible();
  expect((await db.warehouseStock.findUniqueOrThrow({ where: { companyId_warehouseId_productId: { companyId: fixture.companyId, warehouseId: warehouse.id, productId: product.id } } })).qtyInTransitOut.toString()).toBe('2');
  await page.getByRole('button', { name: 'Receive transfer', exact: true }).click();
  await expect(page.getByText('completed', { exact: true }).first()).toBeVisible();
  const source = await db.warehouseStock.findUniqueOrThrow({ where: { companyId_warehouseId_productId: { companyId: fixture.companyId, warehouseId: warehouse.id, productId: product.id } } });
  const target = await db.warehouseStock.findUniqueOrThrow({ where: { companyId_warehouseId_productId: { companyId: fixture.companyId, warehouseId: destination.id, productId: product.id } } });
  expect(source.qtyOnHand.toString()).toBe('8'); expect(source.qtyReserved.toString()).toBe('0'); expect(source.qtyInTransitOut.toString()).toBe('0'); expect(target.qtyOnHand.toString()).toBe('2');
});

test('serialized transfer reserves custody, dispatches, receives and cancels without losing serials', async ({ page }) => {
  const base = await db.product.findUniqueOrThrow({ where: { id: product.id } });
  const serialProduct = await db.product.create({ data: { companyId: fixture.companyId, name: 'Browser serialized transfer product', code: 'UI-SERIAL', categoryId: base.categoryId, unitId: base.unitId, isSerialized: true } });
  await db.warehouseStock.create({ data: { companyId: fixture.companyId, warehouseId: warehouse.id, productId: serialProduct.id, qtyOnHand: 2, movingAverageCost: 50 } });
  const serials = await Promise.all(['UI-TRANSFER-1', 'UI-TRANSFER-2'].map(serialNumber => db.productSerial.create({ data: { companyId: fixture.companyId, productId: serialProduct.id, serialNumber, currentWarehouseId: warehouse.id } })));
  await login(page); await page.goto('/dashboard/inventory/transfers'); page.on('dialog', dialog => dialog.accept());
  for (const [index, serial] of serials.entries()) {
    await page.getByRole('button', { name: 'New transfer', exact: true }).click();
    await pick(page, 'Source warehouse', warehouse.name); await pick(page, 'Destination warehouse', destination.name); await pick(page, 'Product 1', serialProduct.name);
    await page.getByLabel('Quantity', { exact: true }).fill('1'); await page.getByLabel(/Serial numbers 1/).fill(serial.serialNumber);
    await page.getByRole('button', { name: 'Create transfer', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Dispatch transfer', exact: true })).toBeVisible();
    const reserved = await db.productSerial.findUniqueOrThrow({ where: { id: serial.id } }); expect(reserved.status).toBe('reserved'); expect(reserved.currentReservationId).toBeTruthy();
    if (index === 0) {
      await page.getByRole('button', { name: 'Dispatch transfer', exact: true }).click(); await expect(page.getByRole('button', { name: 'Receive transfer', exact: true })).toBeVisible();
      expect((await db.productSerial.findUniqueOrThrow({ where: { id: serial.id } })).status).toBe('in_transit');
      const received = page.waitForResponse(response => /\/transfers\/[^/]+\/receive$/.test(response.url()) && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Receive transfer', exact: true }).click(); expect((await received).status()).toBe(200); await expect(page.getByRole('button', { name: 'Receive transfer', exact: true })).toHaveCount(0);
    } else {
      await page.getByLabel('Cancellation reason').fill('Destination no longer needs item'); await page.getByRole('button', { name: 'Cancel transfer', exact: true }).click(); await expect(page.getByText('cancelled', { exact: true }).first()).toBeVisible();
    }
    const final = await db.productSerial.findUniqueOrThrow({ where: { id: serial.id } }); expect(final.status).toBe('in_stock'); expect(final.currentReservationId).toBeNull(); expect(final.currentWarehouseId).toBe(index === 0 ? destination.id : warehouse.id);
    expect(await db.serialEvent.count({ where: { serialId: serial.id } })).toBe(index === 0 ? 3 : 2);
    await page.getByRole('button', { name: 'Close details', exact: true }).click();
  }
  const missingStock = await page.request.post('/api/v1/transfers', { headers: { Origin: new URL(page.url()).origin, 'Idempotency-Key': randomUUID() }, data: { from_warehouse_id: warehouse.id, to_warehouse_id: destination.id, items: [{ product_id: serialProduct.id, qty_requested: 1, serial_numbers: [serials[0].serialNumber] }] } });
  expect(missingStock.status()).toBe(409);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('stock count snapshot → save → review → recount → post preserves blind counts, freeze and ledger', async ({ page }) => {
  const base = await db.product.findUniqueOrThrow({ where: { id: product.id } });
  const category = await db.category.create({ data: { companyId: fixture.companyId, name: 'Count test category', code: 'UI-COUNT-CAT' } });
  const countedProduct = await db.product.create({ data: { companyId: fixture.companyId, categoryId: category.id, unitId: base.unitId, name: 'Browser counted product', code: 'UI-COUNT-PRODUCT' } });
  await db.warehouseStock.create({ data: { companyId: fixture.companyId, warehouseId: warehouse.id, productId: countedProduct.id, qtyOnHand: 10, movingAverageCost: 50 } });
  const reason = await db.inventoryReasonCode.create({ data: { companyId: fixture.companyId, code: 'UI-COUNT', name: 'Count discrepancy', defaultExpenseAccountId: fixture.expense.id } });
  await login(page); page.on('dialog', dialog => dialog.accept()); await page.goto('/dashboard/inventory/counts');
  await page.getByRole('button', { name: 'New stock count', exact: true }).click(); await pick(page, 'Count warehouse', warehouse.name);
  await page.getByLabel('Scope', { exact: true }).selectOption('category'); await pick(page, 'Count category', category.name);
  const creating = page.waitForResponse(response => response.url().endsWith('/api/v1/stock-counts') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create snapshot', exact: true }).click(); const created = await creating; expect(created.status(), await created.text()).toBe(201); const count = await created.json();
  const snapshot = await db.stockCountItem.findFirstOrThrow({ where: { stockCountId: count.id } }); expect(snapshot.expectedQuantity.toString()).toBe('10');
  const hidden = await page.request.get(`/api/v1/stock-counts/${count.id}`); expect((await hidden.json()).item.items[0].expected_quantity).toBeNull();
  const api = async (path: string, data: unknown) => page.request.post(path, { headers: { Origin: new URL(page.url()).origin, 'Idempotency-Key': randomUUID() }, data });
  expect((await api(`/api/v1/stock-counts/${count.id}/actions`, { action: 'post' })).status()).toBe(409);
  const transfer = await api('/api/v1/transfers', { from_warehouse_id: warehouse.id, to_warehouse_id: destination.id, items: [{ product_id: countedProduct.id, qty_requested: 1 }] }); expect(transfer.status()).toBe(201);
  const transferId = (await transfer.json()).transferId;
  const blocked = await api(`/api/v1/transfers/${transferId}/dispatch`, {}); expect(blocked.status()).toBe(409); expect(await blocked.text()).toContain('blocked by count');
  expect((await api(`/api/v1/transfers/${transferId}/cancel`, { reason: 'Release fixture reservation' })).status()).toBe(200);
  await page.getByRole('button', { name: 'Start counting', exact: true }).click();
  for (const quantity of ['8', '9']) {
    await page.getByLabel(`Counted quantity — ${countedProduct.name}`, { exact: true }).fill(quantity);
    await pick(page, `Reason — ${countedProduct.name}`, reason.name);
    await page.getByLabel(`Count note — ${countedProduct.name}`, { exact: true }).fill('Physical recount confirmed discrepancy');
    await page.getByRole('button', { name: 'Save counts', exact: true }).click(); await expect(page.getByRole('button', { name: 'Review count', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Review count', exact: true }).click(); await expect(page.getByRole('button', { name: 'Post variances', exact: true })).toBeVisible();
    if (quantity === '8') await page.getByRole('button', { name: 'Reopen for recount', exact: true }).click();
  }
  const posting = page.waitForResponse(response => response.url().endsWith(`/stock-counts/${count.id}/actions`) && response.request().postDataJSON()?.action === 'post');
  await page.getByRole('button', { name: 'Post variances', exact: true }).click(); const posted = await posting; expect(posted.status(), await posted.text()).toBe(200);
  expect((await db.stockCount.findUniqueOrThrow({ where: { id: count.id } })).status).toBe('posted');
  expect((await db.warehouseStock.findUniqueOrThrow({ where: { companyId_warehouseId_productId: { companyId: fixture.companyId, warehouseId: warehouse.id, productId: countedProduct.id } } })).qtyOnHand.toString()).toBe('9');
  const journal = await db.journalEntry.findFirstOrThrow({ where: { companyId: fixture.companyId, sourceType: 'stock_count', sourceId: count.id }, include: { lines: true } });
  expect(journal.lines.filter(line => line.debitBase.gt(0)).reduce((sum, line) => sum + line.debitBase.toNumber(), 0)).toBe(50);
  expect((await api(`/api/v1/stock-counts/${count.id}/actions`, { action: 'post' })).status()).toBe(409);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('stock adjustments add, damage, recover and remove serials; approval enforces maker-checker', async ({ page }) => {
  const base = await db.product.findUniqueOrThrow({ where: { id: product.id } });
  const serialProduct = await db.product.create({ data: { companyId: fixture.companyId, categoryId: base.categoryId, unitId: base.unitId, name: 'Adjustment serialized product', code: 'UI-ADJUSTMENT', isSerialized: true } });
  const reason = await db.inventoryReasonCode.create({ data: { companyId: fixture.companyId, code: 'UI-ADJUST', name: 'Approved stock correction', defaultExpenseAccountId: fixture.expense.id } });
  const approvalReason = await db.inventoryReasonCode.create({ data: { companyId: fixture.companyId, code: 'UI-REVIEW', name: 'Independent stock review', defaultExpenseAccountId: fixture.expense.id, requiresApproval: true } });
  await login(page); page.on('dialog', dialog => dialog.accept()); await page.goto('/dashboard/inventory/adjustments');
  for (const step of [
    { type: 'add', qty: '2', serials: 'UI-ADJUST-1\nUI-ADJUST-2', status: 'in_stock', onHand: '2', damaged: '0' },
    { type: 'damage', qty: '1', serials: 'UI-ADJUST-1', status: 'damaged', onHand: '1', damaged: '1' },
    { type: 'reclassify', qty: '1', serials: 'UI-ADJUST-1', status: 'in_stock', onHand: '2', damaged: '0' },
    { type: 'subtract', qty: '1', serials: 'UI-ADJUST-1', status: 'scrapped', onHand: '1', damaged: '0' },
  ]) {
    await page.getByRole('button', { name: 'New adjustment', exact: true }).click(); await pick(page, 'Adjustment warehouse', warehouse.name); await pick(page, 'Adjustment reason', reason.name);
    await page.getByLabel('Adjustment type', { exact: true }).selectOption(step.type); await pick(page, 'Adjustment product 1', serialProduct.name);
    await page.getByLabel('Quantity 1', { exact: true }).fill(step.qty); if (step.type === 'add') await page.getByLabel('Unit cost 1', { exact: true }).fill('25');
    await page.getByLabel('Adjustment serials 1', { exact: true }).fill(step.serials); await page.getByLabel('Explanation', { exact: true }).fill(`Browser verified ${step.type}`);
    const posting = page.waitForResponse(response => response.url().endsWith('/api/v1/stock-adjustments') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Post adjustment', exact: true }).click(); const result = await posting; expect(result.status(), await result.text()).toBe(201); const document = await result.json();
    await expect(page.getByRole('heading', { name: document.referenceNo, exact: true })).toBeVisible();
    const stock = await db.warehouseStock.findUniqueOrThrow({ where: { companyId_warehouseId_productId: { companyId: fixture.companyId, warehouseId: warehouse.id, productId: serialProduct.id } } });
    expect(stock.qtyOnHand.toString()).toBe(step.onHand); expect(stock.qtyDamaged.toString()).toBe(step.damaged);
    expect((await db.productSerial.findUniqueOrThrow({ where: { companyId_serialNumber: { companyId: fixture.companyId, serialNumber: 'UI-ADJUST-1' } } })).status).toBe(step.status);
    expect(await db.journalEntry.count({ where: { companyId: fixture.companyId, sourceType: 'stock_adjustment', sourceId: document.adjustmentId } })).toBe(1);
  }
  await page.getByRole('button', { name: 'New adjustment', exact: true }).click(); await pick(page, 'Adjustment reason', approvalReason.name); await page.getByLabel('Adjustment type', { exact: true }).selectOption('add'); await pick(page, 'Adjustment product 1', product.name);
  await page.getByLabel('Quantity 1', { exact: true }).fill('1'); await page.getByLabel('Unit cost 1', { exact: true }).fill('50'); await page.getByLabel('Explanation', { exact: true }).fill('Independent reviewer required');
  const queued = page.waitForResponse(response => response.url().endsWith('/api/v1/stock-adjustments') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Submit for approval', exact: true }).click(); const queuedResponse = await queued; expect(queuedResponse.status(), await queuedResponse.text()).toBe(201); const pending = await queuedResponse.json();
  const record = await db.stockAdjustment.findUniqueOrThrow({ where: { id: pending.adjustmentId } }); expect(record.status).toBe('pending_approval');
  expect(await db.stockMovement.count({ where: { companyId: fixture.companyId, referenceId: record.id } })).toBe(0);
  const selfApproval = await page.request.post(`/api/v1/approvals/${record.approvalRequestId}/resolve`, { headers: { Origin: new URL(page.url()).origin, 'Idempotency-Key': randomUUID() }, data: { decision: 'approved' } }); expect(selfApproval.status()).toBe(403);
  const checker = await db.user.create({ data: { companyId: fixture.companyId, name: 'Independent checker', email: `${randomUUID()}@example.invalid`, passwordHash: 'not-a-login', accessScope: 'multi_branch', roles: { create: { roleId: fixture.role.id } } } });
  for (const branch of fixture.branches) await db.userBranchAccess.create({ data: { userId: checker.id, branchId: branch.id } });
  const familyId = randomUUID(); const sessionId = randomUUID(); await db.refreshToken.create({ data: { companyId: fixture.companyId, userId: checker.id, familyId, sessionId, mfaVerified: true, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
  const checkerToken = await new SignJWT({ company_id: fixture.companyId, scope: 'multi_branch', is_global: false, branch_ids: fixture.branches.map(branch => branch.id), session_id: sessionId, family_id: familyId, mfa_verified: true }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer('erp-pos').setAudience('erp-pos-clients').setSubject(checker.id).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  await page.context().addCookies([{ name: 'erp_access', value: checkerToken, url: process.env.E2E_BASE_URL!, httpOnly: true, sameSite: 'Strict' }]); await page.reload();
  await page.getByRole('listitem').filter({ hasText: pending.referenceNo }).getByRole('button', { name: 'View adjustment', exact: true }).click();
  await page.getByRole('button', { name: 'Approve adjustment', exact: true }).click(); await expect(page.getByRole('button', { name: 'Post approved adjustment', exact: true })).toBeEnabled();
  const approvedPost = page.waitForResponse(response => response.url().endsWith(`/stock-adjustments/${record.id}`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Post approved adjustment', exact: true }).click(); const approvedResponse = await approvedPost; expect(approvedResponse.status(), await approvedResponse.text()).toBe(200);
  expect((await db.stockAdjustment.findUniqueOrThrow({ where: { id: record.id } })).status).toBe('posted');
  expect(await db.stockMovement.count({ where: { companyId: fixture.companyId, referenceId: record.id } })).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('service intake → diagnosis → approval → repeated parts → invoice → delivery settles WIP and device custody', async ({ page }) => {
  await db.featureFlag.create({ data: { companyId: fixture.companyId, flagKey: 'service_warranty_enabled', enabled: true, updatedBy: fixture.user.id } });
  const wip = await db.chartOfAccount.create({ data: { companyId: fixture.companyId, code: 'UI-WIP', name: 'Repair work in progress', accountClass: 'asset', accountSubtype: 'current_asset', normalBalance: 'D' } });
  await db.accountingPolicy.update({ where: { companyId: fixture.companyId }, data: { repairWipAccountId: wip.id, serviceCogsAccountId: fixture.expense.id } });
  const base = await db.product.findUniqueOrThrow({ where: { id: product.id } });
  const device = await db.product.create({ data: { companyId: fixture.companyId, categoryId: base.categoryId, unitId: base.unitId, name: 'Service device', code: 'UI-DEVICE', isSerialized: true } });
  const part = await db.product.create({ data: { companyId: fixture.companyId, categoryId: base.categoryId, unitId: base.unitId, name: 'Service replacement part', code: 'UI-PART' } });
  const labour = await db.product.create({ data: { companyId: fixture.companyId, categoryId: base.categoryId, unitId: base.unitId, name: 'Complete service labour and parts', code: 'UI-LABOUR', productType: 'service', defaultPrice: 100 } });
  const serial = await db.productSerial.create({ data: { companyId: fixture.companyId, productId: device.id, serialNumber: 'UI-SERVICE-DEVICE', currentWarehouseId: warehouse.id } });
  await db.warehouseStock.createMany({ data: [{ companyId: fixture.companyId, warehouseId: warehouse.id, productId: device.id, qtyOnHand: 1, movingAverageCost: 100 }, { companyId: fixture.companyId, warehouseId: warehouse.id, productId: part.id, qtyOnHand: 10, movingAverageCost: 20 }] });
  await login(page); page.on('dialog', dialog => dialog.accept()); await page.goto('/dashboard/service');
  await page.getByRole('button', { name: 'New Intake', exact: true }).click(); await pick(page, 'Repair warehouse', warehouse.name); await pick(page, 'Service customer', customer.name);
  await page.getByRole('combobox', { name: 'Device serial / IMEI', exact: true }).click(); await page.getByRole('textbox', { name: 'Search device serial / imei', exact: true }).fill('UI-SERVICE'); await page.getByRole('option', { name: serial.serialNumber, exact: true }).click();
  await page.getByLabel('Issue Description *', { exact: true }).fill('Device requires two repair stages'); await page.getByLabel('Estimate (BDT)', { exact: true }).fill('100');
  const intake = page.waitForResponse(response => response.url().endsWith('/api/v1/service-requests') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create Intake', exact: true }).click(); const intakeResponse = await intake; expect(intakeResponse.status(), await intakeResponse.text()).toBe(201); const service = await intakeResponse.json();
  expect((await db.productSerial.findUniqueOrThrow({ where: { id: serial.id } })).status).toBe('repair');
  const action = async (name: string, note: string) => { await page.getByLabel('Action note / diagnosis / approval evidence', { exact: true }).fill(note); const response = page.waitForResponse(result => result.url().endsWith(`/service-requests/${service.serviceRequestId}`) && result.request().method() === 'POST'); await page.getByRole('button', { name, exact: true }).click(); const result = await response; expect(result.status(), await result.text()).toBe(200); await expect(page.getByLabel('Action note / diagnosis / approval evidence', { exact: true })).toHaveValue(''); };
  await action('Save diagnosis', 'Fault isolated and two parts required'); await action('Request customer approval', 'Estimate sent to customer'); await action('Record customer approval', 'Customer approved total 100 by phone'); await action('Start repair', 'Customer authorization verified');
  for (let index = 0; index < 2; index++) {
    await page.getByRole('button', { name: 'Consume parts', exact: true }).click(); await pick(page, 'Service part 1', part.name); await page.getByLabel('Part quantity 1', { exact: true }).fill('1');
    const consuming = page.waitForResponse(response => response.url().endsWith(`/service-requests/${service.serviceRequestId}/parts`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Post parts consumption', exact: true }).click(); const consumed = await consuming; expect(consumed.status(), await consumed.text()).toBe(200); await expect(page.getByRole('button', { name: 'Post parts consumption', exact: true })).toHaveCount(0);
  }
  await action('Mark ready', 'Repair tested successfully');
  const blocked = await page.request.post(`/api/v1/service-requests/${service.serviceRequestId}`, { headers: { Origin: new URL(page.url()).origin, 'Idempotency-Key': randomUUID() }, data: { action: 'transition', status: 'delivered', note: 'Missing invoice must block delivery' } }); expect(blocked.status()).toBe(409);
  const pos = await page.context().newPage(); await pos.goto('/dashboard/pos'); await pos.getByPlaceholder(/Scan barcode or search/).fill(labour.name);
  await pos.getByRole('button', { name: new RegExp(labour.name) }).click(); await pick(pos, 'Customer (optional)', customer.name);
  await pick(pos, 'Warehouse *', warehouse.name); await pick(pos, 'Financial Account *', fixture.cash.name);
  const invoicing = pos.waitForResponse(response => response.url().endsWith('/api/v1/sales') && response.request().method() === 'POST');
  await pos.getByRole('button', { name: /Complete Sale/ }).click(); const invoiceResponse = await invoicing; expect(invoiceResponse.status(), await invoiceResponse.text()).toBe(201); const sale = await invoiceResponse.json(); await pos.close(); await page.goto('/dashboard/service'); await page.getByRole('button', { name: 'View service request', exact: true }).click();
  await pick(page, 'Service invoice', sale.referenceNo); await action('Link service invoice', 'Invoice covers approved service charge'); await action('Deliver device', 'Customer collected repaired device and accessories');
  const completed = await db.serviceRequest.findUniqueOrThrow({ where: { id: service.serviceRequestId }, include: { parts: true } }); expect(completed.status).toBe('delivered'); expect(completed.serviceSaleId).toBe(sale.saleId); expect(completed.parts.map(part => part.lineNo)).toEqual([1, 2]);
  expect((await db.productSerial.findUniqueOrThrow({ where: { id: serial.id } })).status).toBe('in_stock');
  const wipLines = await db.journalLine.aggregate({ where: { companyId: fixture.companyId, chartOfAccountId: wip.id }, _sum: { debitBase: true, creditBase: true } }); expect(wipLines._sum.debitBase?.toString()).toBe('40'); expect(wipLines._sum.creditBase?.toString()).toBe('40');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('POS customer and split payment use authoritative pricing; receipt/invoice enforce permissions', async ({ page, request }) => {
  await db.warehouseStock.upsert({ where: { companyId_warehouseId_productId: { companyId: fixture.companyId, warehouseId: warehouse.id, productId: product.id } },
    create: { companyId: fixture.companyId, warehouseId: warehouse.id, productId: product.id, qtyOnHand: 10, movingAverageCost: 50 }, update: { qtyOnHand: 10 } });
  await login(page); await page.goto('/dashboard/pos');
  await page.getByPlaceholder(/Scan barcode or search/).fill('Browser receiving');
  await page.getByRole('button', { name: new RegExp(product.name) }).click();
  await pick(page, 'Customer (optional)', customer.name);
  await pick(page, 'Warehouse *', warehouse.name);
  await pick(page, 'Financial Account *', fixture.cash.name);
  await page.getByLabel('Applied payment amount', { exact: true }).fill('60');
  await page.getByRole('button', { name: 'Add split payment', exact: true }).click();
  await page.getByLabel('Method', { exact: true }).selectOption('cash');
  await pick(page, 'Account for payment 1', fixture.cash.name);
  await page.getByLabel('Amount', { exact: true }).fill('40');
  const posting = page.waitForResponse(response => response.url().endsWith('/api/v1/sales') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Complete Sale/ }).click();
  const posted = await posting; expect(posted.status(), await posted.text()).toBe(201);
  const sale = await posted.json();
  await expect(page.getByRole('heading', { name: `Sale posted: ${sale.referenceNo}` })).toBeVisible();
  const persisted = await db.sale.findUniqueOrThrow({ where: { id: sale.saleId }, include: { payments: { include: { payment: true } } } });
  expect(persisted.customerId).toBe(customer.id); expect(persisted.grandTotal.toString()).toBe('100');
  expect(persisted.payments.map(row => row.allocatedAmount.toString()).sort()).toEqual(['40', '60']);
  for (const kind of ['invoice', 'receipt']) {
    const document = await page.request.get(`/print/${kind}/${sale.saleId}`);
    expect(document.status()).toBe(200); expect(await document.text()).toContain(sale.referenceNo);
    expect((await request.get(`/print/${kind}/${sale.saleId}`)).status()).toBe(401);
  }
  expect((await page.request.get(`/print/receipt/${sale.saleId}?format=escpos&printer=127.0.0.1`)).status()).toBe(400);
  await page.goto('/dashboard/sales');
  await page.getByRole('row').filter({ hasText: sale.referenceNo }).getByRole('button', { name: 'View sale' }).click();
  await page.getByRole('button', { name: 'Return items', exact: true }).click();
  await page.getByLabel('Return reason', { exact: true }).fill('Browser return verification');
  await page.getByLabel(/Return quantity/).fill('1'); page.on('dialog', dialog => dialog.accept());
  const returning = page.waitForResponse(response => response.url().endsWith('/api/v1/sale-returns') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Post return', exact: true }).click();
  const returned = await returning; expect(returned.status(), await returned.text()).toBe(201);
  const returnData = await returned.json();
  await page.getByRole('button', { name: 'Record refund', exact: true }).click();
  await pick(page, 'Refund account', fixture.cash.name);
  const refunding = page.waitForResponse(response => response.url().endsWith('/api/v1/payments') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Confirm refund', exact: true }).click();
  const refunded = await refunding; expect(refunded.status(), await refunded.text()).toBe(201);
  await expect(page.getByText('refunded', { exact: true })).toBeVisible();
  expect((await db.sale.findUniqueOrThrow({ where: { id: sale.saleId } })).saleStatus).toBe('returned');
  expect((await db.saleReturn.findUniqueOrThrow({ where: { id: returnData.saleReturnId } })).refundStatus).toBe('refunded');
  const replay = await page.request.post('/api/v1/payments', { headers: { Origin: new URL(page.url()).origin, 'Idempotency-Key': refunded.request().headers()['idempotency-key'] }, data: refunded.request().postDataJSON() });
  expect(replay.status()).toBe(201); expect((await replay.json()).id).toBe((await refunded.json()).id);
  const excess = await page.request.post('/api/v1/payments', { headers: { Origin: new URL(page.url()).origin, 'Idempotency-Key': randomUUID() }, data: { ...refunded.request().postDataJSON(), amount: 1 } });
  expect(excess.status()).toBe(409);
  expect(await db.payment.count({ where: { saleReturnId: returnData.saleReturnId } })).toBe(1);
});

test('batch transfer preserves allocation, expiry and destination custody', async ({ page }) => {
  const base = await db.product.findUniqueOrThrow({ where: { id: product.id } });
  const batchProduct = await db.product.create({ data: { companyId: fixture.companyId, name: 'Browser batch transfer product', code: 'UI-BATCH-TRANSFER', categoryId: base.categoryId, unitId: base.unitId, trackBatches: true } });
  await db.warehouseStock.create({ data: { companyId: fixture.companyId, warehouseId: warehouse.id, productId: batchProduct.id, qtyOnHand: 10, movingAverageCost: 25 } });
  const early = await db.productBatch.create({ data: { companyId: fixture.companyId, productId: batchProduct.id, warehouseId: warehouse.id, batchNo: 'UI-EARLY', expiryDate: new Date('2030-01-01'), qtyOnHand: 4, qtyReserved: 1 } });
  const late = await db.productBatch.create({ data: { companyId: fixture.companyId, productId: batchProduct.id, warehouseId: warehouse.id, batchNo: 'UI-LATE', expiryDate: new Date('2031-01-01'), qtyOnHand: 6 } });
  await login(page); await page.goto('/dashboard/inventory/transfers'); page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'New transfer', exact: true }).click();
  await pick(page, 'Source warehouse', warehouse.name); await pick(page, 'Destination warehouse', destination.name); await pick(page, 'Product 1', batchProduct.name);
  await page.getByLabel('Quantity', { exact: true }).fill('5');
  const creating = page.waitForResponse(response => response.url().endsWith('/api/v1/transfers') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create transfer', exact: true }).click(); const created = await creating; expect(created.status(), await created.text()).toBe(201); const transfer = await created.json();
  await page.getByRole('button', { name: 'Dispatch transfer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Receive transfer', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dispatched batches' })).toBeVisible();
  expect((await db.productBatch.findUniqueOrThrow({ where: { id: early.id } })).qtyOnHand.toString()).toBe('1');
  expect((await db.productBatch.findUniqueOrThrow({ where: { id: late.id } })).qtyOnHand.toString()).toBe('4');
  const conflicting = await db.productBatch.create({ data: { companyId: fixture.companyId, productId: batchProduct.id, warehouseId: destination.id, batchNo: early.batchNo, expiryDate: new Date('2032-01-01'), qtyOnHand: 0 } });
  const blocked = page.waitForResponse(response => response.url().endsWith('/receive') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Receive transfer', exact: true }).click(); expect((await blocked).status()).toBe(409);
  expect((await db.warehouseStock.findUniqueOrThrow({ where: { companyId_warehouseId_productId: { companyId: fixture.companyId, warehouseId: warehouse.id, productId: batchProduct.id } } })).qtyInTransitOut.toString()).toBe('5');
  expect(await db.stockMovement.count({ where: { companyId: fixture.companyId, referenceId: transfer.transferId, movementType: 'transfer_receive' } })).toBe(0);
  await db.productBatch.update({ where: { id: conflicting.id }, data: { expiryDate: early.expiryDate } });
  const receiving = page.waitForResponse(response => response.url().endsWith('/receive') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Receive transfer', exact: true }).click(); const received = await receiving; expect(received.status(), await received.text()).toBe(200);
  await expect(page.getByRole('button', { name: 'Receive transfer', exact: true })).toHaveCount(0);
  const destinationBatches = await db.productBatch.findMany({ where: { companyId: fixture.companyId, productId: batchProduct.id, warehouseId: destination.id }, orderBy: { batchNo: 'asc' } });
  expect(destinationBatches.map(batch => [batch.batchNo, batch.qtyOnHand.toString(), batch.expiryDate?.toISOString()])).toEqual([[early.batchNo, '3', early.expiryDate?.toISOString()], [late.batchNo, '2', late.expiryDate?.toISOString()]]);
  expect(await db.stockMovementBatch.count({ where: { companyId: fixture.companyId, stockMovement: { referenceId: transfer.transferId } } })).toBe(4);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('batch adjustment damage and recovery preserve per-batch damaged custody', async ({ page }) => {
  const base = await db.product.findUniqueOrThrow({ where: { id: product.id } });
  const tracked = await db.product.create({ data: { companyId: fixture.companyId, categoryId: base.categoryId, unitId: base.unitId, name: 'Batch damage product', code: 'UI-BATCH-DAMAGE', trackBatches: true } });
  const reason = await db.inventoryReasonCode.create({ data: { companyId: fixture.companyId, code: 'UI-BATCH-REASON', name: 'Batch reconciliation', defaultExpenseAccountId: fixture.expense.id } });
  await login(page); page.on('dialog', dialog => dialog.accept()); await page.goto('/dashboard/inventory/adjustments');
  for (const step of [{ type: 'add', qty: '4', onHand: '4', damaged: '0' }, { type: 'damage', qty: '3', onHand: '1', damaged: '3' }, { type: 'reclassify', qty: '2', onHand: '3', damaged: '1' }]) {
    await page.getByRole('button', { name: 'New adjustment', exact: true }).click(); await pick(page, 'Adjustment warehouse', warehouse.name); await pick(page, 'Adjustment reason', reason.name);
    await page.getByLabel('Adjustment type', { exact: true }).selectOption(step.type); await pick(page, 'Adjustment product 1', tracked.name);
    await page.getByLabel('Quantity 1', { exact: true }).fill(step.qty); if (step.type === 'add') await page.getByLabel('Unit cost 1', { exact: true }).fill('25');
    await page.getByLabel('Batch number 1', { exact: true }).fill('DAMAGED-BATCH-A'); await page.getByLabel('Explanation', { exact: true }).fill(`Batch custody ${step.type}`);
    const posting = page.waitForResponse(response => response.url().endsWith('/api/v1/stock-adjustments') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Post adjustment', exact: true }).click(); const response = await posting; expect(response.status(), await response.text()).toBe(201); const adjustment = await response.json();
    await expect(page.getByRole('heading', { name: adjustment.referenceNo, exact: true })).toBeVisible();
    const batch = await db.productBatch.findFirstOrThrow({ where: { productId: tracked.id, warehouseId: warehouse.id, batchNo: 'DAMAGED-BATCH-A' } });
    expect(batch.qtyOnHand.toString()).toBe(step.onHand);
    const damaged = await db.stockMovementBatch.aggregate({ where: { productBatchId: batch.id, stockMovement: { stockBucket: 'damaged' } }, _sum: { qty: true } });
    expect(damaged._sum.qty?.toString() ?? '0').toBe(step.damaged);
    const stock = await db.warehouseStock.findFirstOrThrow({ where: { productId: tracked.id, warehouseId: warehouse.id } }); expect(stock.qtyOnHand.toString()).toBe(step.onHand); expect(stock.qtyDamaged.toString()).toBe(step.damaged);
  }
  const wrongBatch = await db.productBatch.create({ data: { companyId: fixture.companyId, productId: tracked.id, warehouseId: warehouse.id, batchNo: 'UNDAMAGED-BATCH-B' } });
  const rejected = await page.request.post('/api/v1/stock-adjustments', { headers: { Origin: new URL(page.url()).origin, 'Idempotency-Key': randomUUID() }, data: { branch_id: fixture.branches[0].id, warehouse_id: warehouse.id, adjustment_type: 'reclassify', reason_code_id: reason.id, business_date: new Date().toISOString(), notes: 'Cannot recover another batch', items: [{ product_id: tracked.id, quantity_delta: 1, batch_no: wrongBatch.batchNo }] } });
  expect(rejected.status(), await rejected.text()).toBe(409);
  expect((await db.productBatch.findUniqueOrThrow({ where: { id: wrongBatch.id } })).qtyOnHand.toString()).toBe('0');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('CRM create, edit, follow-up and conversion enforce permissions and tenant references', async ({ page }) => {
  await login(page); page.on('dialog', dialog => dialog.accept()); await page.goto('/dashboard/crm');
  await page.getByRole('button', { name: 'New lead', exact: true }).click();
  await page.getByLabel('Lead name', { exact: true }).fill('Browser follow-up lead'); await page.getByLabel('Phone', { exact: true }).fill('01700009991');
  await pick(page, 'Lead branch', fixture.branches[0].name); await page.getByLabel('Lead notes', { exact: true }).fill('Contact requested a product demonstration.');
  const creating = page.waitForResponse(response => response.url().endsWith('/api/v1/leads') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create lead', exact: true }).click(); const created = await creating; expect(created.status(), await created.text()).toBe(201); const lead = await created.json();
  await expect(page.getByRole('button', { name: 'Edit lead', exact: true })).toBeVisible();
  const qualified = await db.leadStatus.create({ data: { companyId: fixture.companyId, name: 'Qualified', position: 2 } });
  await page.getByRole('button', { name: 'Edit lead', exact: true }).click(); await page.getByLabel('Company name', { exact: true }).fill('Browser business'); await page.getByLabel('Next follow-up', { exact: true }).fill('2030-03-10T10:30');
  await pick(page, 'Lead status', qualified.name); await pick(page, 'Lead assignee', fixture.user.name);
  const saving = page.waitForResponse(response => response.url().endsWith(`/leads/${lead.id}`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save lead', exact: true }).click(); const saved = await saving; expect(saved.status(), await saved.text()).toBe(200);
  await expect(page.getByText('Lead updated: Qualified', { exact: true })).toBeVisible();
  const persisted = await db.lead.findUniqueOrThrow({ where: { id: lead.id } }); expect(persisted.assignedTo).toBe(fixture.user.id); expect(persisted.statusId).toBe(qualified.id); expect(persisted.companyName).toBe('Browser business'); expect(persisted.nextActionAt).not.toBeNull();
  const foreign = await ensureSyntheticIssuerTenant(db, { companyId: randomUUID(), code: `CRM-${randomUUID().slice(0,8)}`, label: 'Foreign CRM' });
  const foreignStatus = await db.leadStatus.create({ data: { companyId: foreign.companyId, name: 'Foreign status', position: 0 } });
  const headers = { Origin: new URL(page.url()).origin, 'Idempotency-Key': randomUUID() };
  const crossTenant = await page.request.post('/api/v1/leads', { headers, data: { name: 'Forbidden status', phone: '01700009992', branch_id: fixture.branches[0].id, status_id: foreignStatus.id } }); expect(crossTenant.status()).toBe(400);
  const permission = await db.permission.findUniqueOrThrow({ where: { code: 'crm.lead.update' } });
  await db.rolePermission.delete({ where: { roleId_permissionId: { roleId: fixture.role.id, permissionId: permission.id } } });
  try {
    const denied = await page.request.post(`/api/v1/leads/${lead.id}`, { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { action: 'update', lead: { name: 'Unauthorized change', phone: '01700009991' } } }); expect(denied.status()).toBe(403);
  } finally { await db.rolePermission.create({ data: { roleId: fixture.role.id, permissionId: permission.id } }); }
  const converting = page.waitForResponse(response => response.url().endsWith(`/leads/${lead.id}`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Convert to customer', exact: true }).click(); const converted = await converting; expect(converted.status(), await converted.text()).toBe(200); const customerResult = await converted.json();
  await expect(page.getByText('Customer: Browser follow-up lead', { exact: true })).toBeVisible();
  expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).convertedCustomerId).toBe(customerResult.customerId);
  expect(await db.customer.count({ where: { companyId: fixture.companyId, phone: '01700009991' } })).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
