// Offline till on the local app:
//   New Sale -> set this browser up as a till (product list saved) -> the
//   connection drops -> cash sale of two cables from the saved list, change
//   shown -> saved on the till -> connection back -> sent automatically and
//   posted as a real sale.
//
// Local only: demo company from .local/demo-setup.mjs; offline sales are
// switched on for the run. DEMO_OWNER_PASSWORD is read from .env.local and
// typed, never logged.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const shots = '.local/offline-till';
mkdirSync(shots, { recursive: true });
const pw = () => readFileSync('.env.local', 'utf8').split(/\r?\n/).find(l => l.startsWith('DEMO_OWNER_PASSWORD='))!.slice('DEMO_OWNER_PASSWORD='.length).replace(/^"|"$/g, '');
const headers = () => ({ 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'Idempotency-Key': `e2e-${randomUUID()}` });
async function pick(page: Page, label: string, option: RegExp) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option }).first().click();
}

test.setTimeout(240_000);

test('take a cash sale offline and have it posted when back online', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@demo-electronics.local');
  await page.getByLabel('Password', { exact: true }).fill(pw());
  await page.getByLabel('Company code (optional)', { exact: true }).fill('DEMO');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });
  expect((await page.request.patch('/api/v1/feature-flags/offline_pos_enabled', { headers: headers(), data: { enabled: true } })).ok()).toBe(true);
  const salesBefore = (await (await page.request.get('/api/v1/sales?limit=1')).json()).total ?? null;

  // 1. Set the till up from New Sale.
  await page.goto('/dashboard/pos');
  await page.evaluate(() => new Promise(resolve => { const r = indexedDB.deleteDatabase('erp-pos-till'); r.onsuccess = r.onerror = r.onblocked = () => resolve(null); }));
  await page.reload();
  const wh = await page.getByRole('combobox', { name: 'Warehouse' }).textContent();
  if (!wh?.includes('Dhanmondi')) await pick(page, 'Warehouse', /Dhanmondi showroom/);
  await pick(page, 'Payment account', /cash/i);
  await expect(page.getByRole('heading', { name: 'Keep selling if the internet drops' })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Till name').fill('Counter 1');
  await page.getByRole('button', { name: 'Set up this till' }).click();
  await expect(page.getByRole('heading', { name: 'Offline till: Counter 1' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/products saved for offline sales/)).toBeVisible();
  await page.screenshot({ path: `${shots}/01-till-ready.png`, fullPage: true });

  // 2. The connection drops: the offline cash screen takes over.
  await context.setOffline(true);
  await expect(page.getByRole('heading', { name: 'New Sale (offline)' })).toBeVisible();
  await expect(page.getByText("You're offline")).toBeVisible();
  await page.getByLabel('Search saved products').fill('HDMI');
  await page.getByRole('group', { name: 'Saved products' }).getByRole('button', { name: /HDMI cable 2 m/ }).click();
  await page.getByRole('button', { name: 'One more HDMI cable 2 m' }).click();
  await expect(page.getByRole('button', { name: /^Save cash sale — / })).toContainText('700.00');
  await page.getByLabel('Cash received from customer').fill('1000');
  await expect(page.getByText(/Give back .*300\.00/)).toBeVisible();
  await page.screenshot({ path: `${shots}/02-offline-sale.png`, fullPage: true });
  await page.getByRole('button', { name: /^Save cash sale — / }).click();
  await expect(page.getByText(/Offline sale 1 saved on this till/)).toBeVisible();
  await expect(page.getByText(/Counter 1 · 1 waiting to be sent/)).toBeVisible();

  // 3. Back online: sent by itself and posted.
  await context.setOffline(false);
  await expect(page.getByRole('heading', { name: 'Offline till: Counter 1' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('All offline sales have been sent.')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${shots}/03-sent.png`, fullPage: true });
  const salesAfter = (await (await page.request.get('/api/v1/sales?limit=1')).json()).total ?? null;
  if (salesBefore !== null && salesAfter !== null) expect(salesAfter).toBe(salesBefore + 1);

  expect(errors).toEqual([]);
});
