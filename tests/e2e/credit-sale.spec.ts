// A pay-later sale on the New Sale page, end to end in the browser:
//   Optional Features lists "credit_sales" -> switch it on -> sell 2 HDMI
//   cables to Karim Traders, nothing paid now, 2 equal installments every
//   30 days -> the server's schedule adds up to the total -> complete ->
//   Collect Payment shows what Karim owes.
//
// Local only: demo company from .local/demo-setup.mjs; DEMO_OWNER_PASSWORD
// is read from .env.local and typed, never logged. Leaves credit sales
// switched on for the demo company.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const shots = '.local/credit-sale';
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
const headers = () => ({ 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'Idempotency-Key': `e2e-${randomUUID()}` });

test.setTimeout(240_000);

test('a pay-later sale with equal installments, then the due shows for collection', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@demo-electronics.local');
  await page.getByLabel('Password', { exact: true }).fill(demoPassword());
  await page.getByLabel('Company code (optional)', { exact: true }).fill('DEMO');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });

  // 1. The flag is now in the catalogue, so the app can switch it on.
  const flags = await (await page.request.get('/api/v1/feature-flags')).json();
  expect(JSON.stringify(flags)).toContain('credit_sales');
  const toggle = await page.request.patch('/api/v1/feature-flags/credit_sales', { headers: headers(), data: { enabled: true, reason: 'e2e credit sale walkthrough' } });
  expect(toggle.ok(), JSON.stringify(await toggle.json()).slice(-700)).toBe(true);

  // A customer with a credit limit.
  const found = ((await (await page.request.get('/api/v1/customers?search=Karim')).json()).items ?? []).find((c: { name: string }) => c.name === 'Karim Traders');
  if (!found) {
    const r = await page.request.post('/api/v1/customers', { headers: headers(), data: { name: 'Karim Traders', phone: '01812345678', credit_limit: 100000 } });
    expect(r.ok()).toBe(true);
  }

  // 2. New Sale: 2 cables, pay later, 2 equal installments every 30 days.
  await page.goto('/dashboard/pos');
  await page.getByRole('textbox', { name: 'Search products' }).fill('HDMI');
  await page.getByRole('group', { name: 'Product search results' }).getByRole('button', { name: /HDMI cable 2 m/ }).click();
  await page.getByRole('button', { name: 'Increase quantity' }).first().click();
  await page.getByRole('radio', { name: 'Pay later' }).click();
  await page.getByRole('combobox', { name: 'Customer' }).click();
  await page.getByRole('textbox', { name: 'Search customer' }).fill('Karim');
  await page.getByRole('option', { name: /Karim Traders/ }).first().click();
  const warehouse = await page.getByRole('combobox', { name: 'Warehouse' }).textContent();
  if (!warehouse?.includes('Dhanmondi')) await pick(page, 'Warehouse', /Dhanmondi showroom/);
  await page.getByRole('radio', { name: 'Equal installments' }).click();
  await page.getByLabel('Number of installments').fill('2');
  await page.getByLabel('Repeat').selectOption('days');
  await expect(page.getByLabel('Every how many days')).toHaveValue('30');

  // The server's schedule: two rows that add up to the 700 total.
  const table = page.getByRole('table', { name: 'Installment schedule' });
  await expect(table.getByRole('row')).toHaveCount(3, { timeout: 30_000 });
  await expect(table).toContainText(/350\.00[\s\S]*350\.00/);
  await expect(page.getByText('Remaining due')).toBeVisible();
  await page.screenshot({ path: `${shots}/01-schedule.png`, fullPage: true });

  await page.getByRole('button', { name: /^Complete Sale — / }).first().click();
  await expect(page.getByRole('heading', { name: /^Sale saved: INV-/, level: 2 })).toBeVisible({ timeout: 30_000 });

  // 3. Collect Payment shows the due; it collects, it does not sell again.
  await page.goto('/dashboard/collections');
  await expect(page.getByRole('heading', { name: 'Collect Payment', level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'All open' }).click();
  await expect(page.getByText('Karim Traders').first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${shots}/02-collections.png`, fullPage: true });

  expect(pageErrors).toEqual([]);
});
