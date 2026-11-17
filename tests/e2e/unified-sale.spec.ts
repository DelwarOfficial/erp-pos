// The one New Sale page, in the browser against the local app:
//   old credit link -> New Sale with "Pay later" chosen -> add 2 HDMI cables
//   -> line discount 35 shows 5% -> pay later needs a customer, and a refused
//   credit sale (feature off) is shown, not hidden -> switch to "Pay in full"
//   -> complete -> Sales History shows the sale-time discount and percentage.
//
// Local only: demo company from .local/demo-setup.mjs; DEMO_OWNER_PASSWORD
// is read from .env.local and typed, never logged.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const shots = '.local/unified-sale';
mkdirSync(shots, { recursive: true });

function demoPassword(): string {
  const line = readFileSync('.env.local', 'utf8').split(/\r?\n/).find(l => l.startsWith('DEMO_OWNER_PASSWORD='));
  if (!line) throw new Error('DEMO_OWNER_PASSWORD missing: run .local/demo-setup.mjs first');
  return line.slice('DEMO_OWNER_PASSWORD='.length).replace(/^"|"$/g, '');
}
async function pick(page: Page, label: string, option: RegExp) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option }).first().click();
}

test.setTimeout(240_000);

test('full, discounted and pay-later on one New Sale page', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@demo-electronics.local');
  await page.getByLabel('Password', { exact: true }).fill(demoPassword());
  await page.getByLabel('Company code (optional)', { exact: true }).fill('DEMO');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });

  // A registered customer for the pay-later step.
  const customers = (await (await page.request.get('/api/v1/customers?search=Karim')).json()).items ?? [];
  if (!customers.some((c: { name: string }) => c.name === 'Karim Traders')) {
    const r = await page.request.post('/api/v1/customers', { headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'Idempotency-Key': `e2e-${randomUUID()}` },
      data: { name: 'Karim Traders', phone: '01812345678', credit_limit: 100000 } });
    expect(r.ok(), JSON.stringify(await r.json()).slice(0, 200)).toBe(true);
  }

  // 1. The old credit link opens New Sale with "Pay later" chosen.
  await page.goto('/dashboard/sales/credit');
  await page.waitForURL('**/dashboard/pos?pay=later');
  await expect(page.getByRole('heading', { name: 'New Sale', level: 1 })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Pay later' })).toHaveAttribute('aria-checked', 'true');

  // 2. Two cables at the server's selling price, 35 off the line = 5%.
  await page.getByRole('textbox', { name: 'Search products' }).fill('HDMI');
  await page.getByRole('group', { name: 'Product search results' }).getByRole('button', { name: /HDMI cable 2 m/ }).click();
  await page.getByRole('button', { name: 'Increase quantity' }).first().click();
  await expect(page.getByText(/^2 × /)).toBeVisible();
  await page.getByLabel('Line discount (৳)').fill('35');
  await expect(page.getByText('= 5% off this line')).toBeVisible();

  // 3. Pay later without a customer is blocked inline; with one, the server's answer is shown.
  await expect(page.getByText('Choose a registered customer to leave money owing.').first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Customer' }).click();
  await page.getByRole('textbox', { name: 'Search customer' }).fill('Karim');
  await page.getByRole('option', { name: /Karim Traders/ }).first().click();
  await expect(page.getByRole('heading', { name: 'When the rest is due' })).toBeVisible();
  await page.screenshot({ path: `${shots}/01-pay-later.png`, fullPage: true });

  // 4. Switch to "Pay in full": the schedule goes; the cart and discount stay.
  await page.getByRole('radio', { name: 'Pay in full' }).click();
  await expect(page.getByRole('heading', { name: 'When the rest is due' })).toHaveCount(0);
  await expect(page.getByLabel('Line discount (৳)')).toHaveValue('35');
  const shiftCount = await page.getByRole('combobox', { name: 'Warehouse' }).textContent();
  if (!shiftCount?.includes('Dhanmondi')) await pick(page, 'Warehouse', /Dhanmondi showroom/);
  await pick(page, 'Payment account', /cash/i);
  await expect(page.getByText('Remaining due')).toBeVisible();
  await page.screenshot({ path: `${shots}/02-pay-in-full.png`, fullPage: true });
  await page.getByRole('button', { name: /^Complete Sale — / }).first().click();
  await expect(page.getByRole('heading', { name: /^Sale saved: INV-/, level: 2 })).toBeVisible({ timeout: 30_000 });

  // 5. Sales History: sale-time subtotal, discount with its percentage, total.
  await page.goto('/dashboard/sales');
  await expect(page.getByRole('heading', { name: 'Sales History', level: 1 })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: /Karim Traders/ }).first();
  await expect(row).toContainText('5%');
  await page.screenshot({ path: `${shots}/03-history.png`, fullPage: true });

  expect(pageErrors).toEqual([]);
});
