// Coupons and reward points on the local app:
//   Gift Cards -> New coupon (10% off, up to ৳50) -> New Sale: two cables,
//   apply the code, the coupon line and new total show -> sale saved with the
//   discount -> the customer's points balance shows on a points tender.
//
// Local only: demo company from .local/demo-setup.mjs. Loyalty is switched on
// for the run. DEMO_OWNER_PASSWORD is read from .env.local and typed, never logged.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const shots = '.local/loyalty';
mkdirSync(shots, { recursive: true });
const pw = () => readFileSync('.env.local', 'utf8').split(/\r?\n/).find(l => l.startsWith('DEMO_OWNER_PASSWORD='))!.slice('DEMO_OWNER_PASSWORD='.length).replace(/^"|"$/g, '');
const headers = () => ({ 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'Idempotency-Key': `e2e-${randomUUID()}` });
async function pick(page: Page, label: string, option: RegExp) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option }).first().click();
}

test.setTimeout(240_000);

test('make a coupon, use it at the till, and see the customer points', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@demo-electronics.local');
  await page.getByLabel('Password', { exact: true }).fill(pw());
  await page.getByLabel('Company code (optional)', { exact: true }).fill('DEMO');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });
  expect((await page.request.patch('/api/v1/feature-flags/loyalty_enabled', { headers: headers(), data: { enabled: true } })).ok()).toBe(true);

  // 1. A coupon from the Gift Cards page.
  const code = `E2E${randomUUID().slice(0, 6).toUpperCase()}`;
  await page.goto('/dashboard/gift-cards');
  await page.getByRole('button', { name: 'New coupon' }).click();
  await expect(page.getByLabel('Code', { exact: true })).toBeFocused();
  await page.getByLabel('Code', { exact: true }).fill(code);
  await page.getByLabel('Name', { exact: true }).fill('E2E 10% off');
  await page.getByLabel('Discount type').selectOption('percentage');
  await page.getByLabel('Percent off').fill('10');
  await page.getByLabel('Most it can take off (৳, optional)').fill('50');
  await page.getByRole('button', { name: 'Create coupon' }).click();
  await expect(page.getByRole('row').filter({ hasText: code })).toContainText('10% off, up to');
  await page.screenshot({ path: `${shots}/01-coupons.png`, fullPage: true });

  // 2. Two cables (700), coupon takes min(70, 50) = 50.
  await page.goto('/dashboard/pos');
  await page.getByRole('textbox', { name: 'Search products' }).fill('HDMI');
  await page.getByRole('group', { name: 'Product search results' }).getByRole('button', { name: /HDMI cable 2 m/ }).click();
  await page.getByRole('button', { name: 'Increase quantity' }).first().click();
  await page.getByLabel('Coupon code').fill(code.toLowerCase());
  await page.getByRole('button', { name: 'Apply coupon' }).click();
  await expect(page.getByText(`Coupon ${code}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/E2E 10% off applied — .*50\.00 off\./)).toBeVisible();
  // The totals show the coupon once: only the cart line's own breakdown says "Discount".
  await expect(page.getByText('Discount', { exact: true })).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Customer' }).click();
  await page.getByRole('textbox', { name: 'Search customer' }).fill('Karim');
  await page.getByRole('option', { name: /Karim Traders/ }).first().click();
  const wh = await page.getByRole('combobox', { name: 'Warehouse' }).textContent();
  if (!wh?.includes('Dhanmondi')) await pick(page, 'Warehouse', /Dhanmondi showroom/);
  await pick(page, 'Payment account', /cash/i);
  await page.screenshot({ path: `${shots}/02-coupon-applied.png`, fullPage: true });
  await page.getByRole('button', { name: /^Complete Sale — / }).first().click();
  await expect(page.getByRole('heading', { name: /^Sale saved: INV-/, level: 2 })).toBeVisible({ timeout: 30_000 });

  // 3. A wrong code says so and can be removed.
  await page.goto('/dashboard/pos');
  await page.getByRole('textbox', { name: 'Search products' }).fill('HDMI');
  await page.getByRole('group', { name: 'Product search results' }).getByRole('button', { name: /HDMI cable 2 m/ }).click();
  await page.getByLabel('Coupon code').fill('NOSUCHCODE');
  await page.getByRole('button', { name: 'Apply coupon' }).click();
  await expect(page.getByText(/That coupon code is not valid/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Remove coupon' }).first().click();
  await expect(page.getByText(/That coupon code is not valid/)).toHaveCount(0);

  // 4. A points tender shows the customer's balance from the server.
  await page.getByRole('combobox', { name: 'Customer' }).click();
  await page.getByRole('textbox', { name: 'Search customer' }).fill('Karim');
  await page.getByRole('option', { name: /Karim Traders/ }).first().click();
  await page.getByRole('button', { name: 'Add split payment' }).click();
  await page.getByLabel('Method', { exact: true }).last().selectOption('reward_points');
  await expect(page.getByText(/points available \(worth /)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Points to use (1 point = ৳1)')).toBeVisible();
  await page.screenshot({ path: `${shots}/03-points.png`, fullPage: true });

  expect(errors).toEqual([]);
});
