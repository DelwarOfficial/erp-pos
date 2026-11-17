// Definition-of-done walkthrough for a first-time cashier, against the real
// app and the local disposable database:
//   sign in -> open a shift -> New Sale -> add a serial product -> cash
//   payment with change -> close the shift.
//
// Local only. Needs the demo company created by .local/demo-setup.mjs and its
// test password in .env.local (DEMO_OWNER_PASSWORD). The password is read
// here and typed into the form; it is never logged.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';

const shots = '.local/journey';
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

test('a first-time cashier can sell a serial product for cash and close the shift', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  // 1. Sign in
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@demo-electronics.local');
  await page.getByLabel('Password', { exact: true }).fill(demoPassword());
  await page.getByLabel('Company code (optional)', { exact: true }).fill('DEMO');
  await page.screenshot({ path: `${shots}/01-login.png` });
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome back');
  await page.screenshot({ path: `${shots}/02-home.png` });

  // 2. Open a shift (reuse one left open by an earlier run)
  await page.goto('/dashboard/cashier');
  await expect(page.getByRole('heading', { name: 'Cashier shifts', level: 1 })).toBeVisible();
  await expect(page.getByText(/^Recent shifts \(/)).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  const alreadyOpen = await page.getByLabel('Cash counted in the drawer for Rahim Uddin (৳)', { exact: true }).count() > 0;
  if (!alreadyOpen) {
  await pick(page, 'Warehouse', /Dhanmondi showroom/);
  await pick(page, 'Cash drawer account', /cash/i);
  await page.getByLabel('Opening cash in drawer (৳)', { exact: true }).fill('5000');
  await page.getByRole('button', { name: 'Open shift', exact: true }).click();
  await expect(page.getByText('Shift opened. You are ready to sell.')).toBeVisible({ timeout: 30_000 });
  }
  await page.screenshot({ path: `${shots}/03-shift-open.png`, fullPage: true });

  // 3. New sale: find and add the serial product
  await page.goto('/dashboard/pos');
  const search = page.getByRole('textbox', { name: 'Search products' });
  await expect(search).toBeFocused();
  await search.fill('Samsung');
  await page.getByRole('group', { name: 'Product search results' }).getByRole('button', { name: /Samsung TV 43 inch/ }).click();
  await expect(page.getByRole('button', { name: 'Remove Samsung TV 43 inch' })).toBeVisible();
  await page.getByLabel('Serial numbers for Samsung TV 43 inch', { exact: true }).fill('SN-TV43-0001');
  await expect(page.getByText('1 serial', { exact: true })).toBeVisible();

  // 4. Cash payment with change. With one open shift the screen picks the
  // shift and its warehouse by itself.
  await expect(page.getByRole('combobox', { name: 'Cashier shift' })).toContainText('Rahim Uddin');
  await expect(page.getByRole('combobox', { name: 'Warehouse' })).toContainText('Dhanmondi showroom');
  await page.getByRole('combobox', { name: 'Payment account' }).click();
  await page.getByRole('option', { name: /cash/i }).first().click();
  await expect(page.getByRole('radio', { name: 'Cash' })).toHaveAttribute('aria-checked', 'true');
  const complete = page.getByRole('button', { name: /^Complete sale — / });
  await expect(complete).toBeEnabled({ timeout: 30_000 });
  await expect(complete).toContainText('৳ 38,500.00');
  await page.getByLabel('Cash received from customer', { exact: true }).fill('40000');
  await expect(page.getByText('Give back ৳ 1,500.00 in change.')).toBeVisible();
  await page.screenshot({ path: `${shots}/04-pos-ready.png`, fullPage: true });
  await complete.click();
  const saved = page.getByRole('heading', { name: /^Sale saved: / });
  await expect(saved).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Payment of ৳ 38,500.00 is recorded' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Print receipt' })).toBeVisible();
  await page.screenshot({ path: `${shots}/05-sale-saved.png`, fullPage: true });

  // The sale shows up in Sales
  const reference = (await saved.textContent())!.replace('Sale saved:', '').trim();
  await page.goto('/dashboard/sales');
  await expect(page.getByRole('cell', { name: reference, exact: true })).toBeVisible({ timeout: 30_000 });

  // 5. Close the shift: expected drawer is the float plus the cash sale
  await page.goto('/dashboard/cashier');
  const counted = page.getByLabel('Cash counted in the drawer for Rahim Uddin (৳)', { exact: true });
  // Expected = opening cash + this sale (+ any cash sales left from earlier runs).
  await counted.fill('43500');
  await page.getByRole('button', { name: 'Close shift', exact: true }).first().click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText("Close Rahim Uddin's shift?");
  await expect(dialog).toContainText('৳ 43,500.00');
  await page.screenshot({ path: `${shots}/06-close-confirm.png` });
  await dialog.getByRole('button', { name: 'Close shift', exact: true }).click();
  await expect(page.getByText(/^Shift closed\./)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Drawer balanced|Short by|Over by/).first()).toBeVisible();
  await page.screenshot({ path: `${shots}/07-shift-closed.png`, fullPage: true });

  expect(pageErrors).toEqual([]);
});
