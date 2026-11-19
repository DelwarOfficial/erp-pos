// Courier COD settlement on the Deliveries page, against the local app:
//   a cash sale is shipped with Pathao as cash on delivery and marked delivered
//   (set up through the API) -> Settle courier COD -> tick it, fee 60 ->
//   post -> the settlement is recorded and the delivery is no longer offered.
//
// Local only: demo company from .local/demo-setup.mjs with Delivery switched
// on (tests/e2e/modules-live.spec.ts); DEMO_OWNER_PASSWORD is read from
// .env.local and typed, never logged.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const shots = '.local/cod';
mkdirSync(shots, { recursive: true });
const pw = () => readFileSync('.env.local', 'utf8').split(/\r?\n/).find(l => l.startsWith('DEMO_OWNER_PASSWORD='))!.slice('DEMO_OWNER_PASSWORD='.length).replace(/^"|"$/g, '');
const headers = () => ({ 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'Idempotency-Key': `e2e-${randomUUID()}` });
async function pickEntity(page: Page, label: string, option: RegExp) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).first().click();
}

test.setTimeout(240_000);

test('settle courier COD from the Deliveries page', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@demo-electronics.local');
  await page.getByLabel('Password', { exact: true }).fill(pw());
  await page.getByLabel('Company code (optional)', { exact: true }).fill('DEMO');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });
  const api = page.request;
  const post = async (path: string, data: unknown) => {
    const r = await api.post(path, { headers: headers(), data }); const body = await r.json();
    expect(r.ok(), `${path}: ${JSON.stringify(body).slice(0, 300)}`).toBe(true); return body;
  };

  expect((await api.patch('/api/v1/feature-flags/delivery_courier_enabled', { headers: headers(), data: { enabled: true } })).ok()).toBe(true);
  const warehouse = (await (await api.get('/api/v1/warehouses')).json()).items[0];
  const branchId = warehouse.branch?.id ?? warehouse.branch_id;
  const cable = (await (await api.get('/api/v1/products?limit=50')).json()).items.find((p: { code: string }) => p.code === 'HDMI-2M');
  const cash = (await (await api.get('/api/v1/financial-accounts')).json()).items.find((a: { account_type: string; name: string }) => /cash/i.test(a.account_type + a.name));

  // A paid sale of one cable (350), shipped with Pathao, COD 350, delivered.
  const sale = await post('/api/v1/sales', { branch_id: branchId, warehouse_id: warehouse.id, items: [{ product_id: cable.id, qty: 1, unit_price: 350 }],
    payments: [{ payment_method: 'cash', amount: 350, financial_account_id: cash.id }] });
  const detail = await (await api.get(`/api/v1/sales/${sale.saleId}`)).json();
  const delivery = await post('/api/v1/deliveries', { sale_id: sale.saleId, branch_id: branchId, recipient_name: 'Rafiq', recipient_phone: '01711111111',
    address_snapshot: 'House 1, Road 2, Dhanmondi', delivery_method: 'courier', courier_code: 'pathao', cod_amount: 350,
    items: [{ sale_item_id: detail.items[0].id, quantity: 1 }] });
  const deliveryId = delivery.id ?? delivery.deliveryOrderId;
  for (const to of ['ready', 'dispatched', 'in_transit', 'delivered']) await post(`/api/v1/deliveries/${deliveryId}/transition`, { to_status: to });
  const ref = ((await (await api.get('/api/v1/deliveries?limit=50')).json()).items as Array<{ id: string; reference_no: string }>).find(d => d.id === deliveryId)!.reference_no;

  await page.goto('/dashboard/deliveries');
  await expect(page.getByRole('heading', { name: 'Settle courier COD' })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Courier', { exact: true }).selectOption('pathao');
  await pickEntity(page, 'Branch', /Dhanmondi branch/);
  await pickEntity(page, 'Money received into', /Cash Drawer/i);
  await page.getByLabel(`Include ${ref}`).check();
  await page.getByLabel(`Courier fee for ${ref}`).fill('60');
  await expect(page.getByText(/received ৳290\.00/)).toBeVisible();
  await page.screenshot({ path: `${shots}/01-settle.png`, fullPage: true });
  await page.getByRole('button', { name: 'Post settlement' }).click();
  await page.getByRole('button', { name: 'Post settlement' }).last().click(); // confirmation dialog
  await expect(page.getByText(/Settlement .* posted\./)).toBeVisible({ timeout: 30_000 });

  // Settled once only: it is no longer offered.
  await page.getByLabel('Courier', { exact: true }).selectOption('pathao');
  await expect(page.getByLabel(`Include ${ref}`)).toHaveCount(0);
  await page.screenshot({ path: `${shots}/02-settled.png`, fullPage: true });
  expect(errors).toEqual([]);
});
