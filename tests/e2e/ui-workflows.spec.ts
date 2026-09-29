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
test.beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? 'invalid:');
  if (process.env.UI_HEALTH_LOCAL_VERIFICATION !== '1' || target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') throw new Error('Only approved disposable database allowed');
  const companyId = randomUUID();
  fixture = await ensureSyntheticIssuerTenant(db, { companyId, label: 'Workflow browser', code: `UI-${randomUUID().slice(0, 8)}` });
  for (const code of ['purchase.read', 'purchase.create', 'purchase.receive', 'supplier.read', 'product.read', 'inventory.read', 'transfer.dispatch', 'transfer.receive', 'sale.read']) {
    const permission = await db.permission.upsert({ where: { code }, create: { code, module: code.split('.')[0], description: code }, update: {} });
    await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: fixture.role.id, permissionId: permission.id } }, create: { roleId: fixture.role.id, permissionId: permission.id }, update: {} });
  }
  warehouse = await db.warehouse.create({ data: { companyId, branchId: fixture.branches[0].id, code: 'UI-SOURCE', name: 'Browser source warehouse' } });
  destination = await db.warehouse.create({ data: { companyId, branchId: fixture.branches[1].id, code: 'UI-DEST', name: 'Browser destination warehouse' } });
  const category = await db.category.create({ data: { companyId, name: 'Browser goods', code: 'UI' } });
  const unit = await db.unit.create({ data: { companyId, name: 'Piece', code: 'pc' } });
  product = await db.product.create({ data: { companyId, name: 'Browser receiving product', code: 'UI-PRODUCT', categoryId: category.id, unitId: unit.id, defaultPrice: 100, referenceCost: 50 } });
  supplier = await db.supplier.create({ data: { companyId, name: 'Browser supplier' } });
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
  await page.getByRole('button', { name: 'Receive transfer', exact: true }).click();
  await expect(page.getByText('completed', { exact: true }).first()).toBeVisible();
  const source = await db.warehouseStock.findUniqueOrThrow({ where: { companyId_warehouseId_productId: { companyId: fixture.companyId, warehouseId: warehouse.id, productId: product.id } } });
  const target = await db.warehouseStock.findUniqueOrThrow({ where: { companyId_warehouseId_productId: { companyId: fixture.companyId, warehouseId: destination.id, productId: product.id } } });
  expect(source.qtyOnHand.toString()).toBe('8'); expect(source.qtyReserved.toString()).toBe('0'); expect(source.qtyInTransitOut.toString()).toBe('0'); expect(target.qtyOnHand.toString()).toBe('2');
});
