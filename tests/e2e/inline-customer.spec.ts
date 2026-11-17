// Adding a customer from inside New Sale, against the local app:
//   - an existing customer is found by mobile and selected
//   - the cart, line discount, "Pay later" and a custom schedule survive the dialog
//   - typing an existing customer's mobile shows them ("same mobile") instead of merging
//   - permission denied (403) and a dropped connection keep the typed details;
//     the retry reuses the same Idempotency-Key, so the customer is saved once
//   - a successful save selects the new customer and closes the dialog
//
// Local only: demo company from .local/demo-setup.mjs; DEMO_OWNER_PASSWORD is
// read from .env.local and typed, never logged. The 403 and the dropped
// connection are simulated in the browser; no other account is touched.

import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const shots = '.local/inline-customer';
mkdirSync(shots, { recursive: true });

function demoPassword(): string {
  const line = readFileSync('.env.local', 'utf8').split(/\r?\n/).find(l => l.startsWith('DEMO_OWNER_PASSWORD='));
  if (!line) throw new Error('DEMO_OWNER_PASSWORD missing: run .local/demo-setup.mjs first');
  return line.slice('DEMO_OWNER_PASSWORD='.length).replace(/^"|"$/g, '');
}

test.setTimeout(240_000);

test('add or pick a customer without leaving the sale', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@demo-electronics.local');
  await page.getByLabel('Password', { exact: true }).fill(demoPassword());
  await page.getByLabel('Company code (optional)', { exact: true }).fill('DEMO');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });

  // An existing customer to find and to collide with.
  const existing = ((await (await page.request.get('/api/v1/customers?search=01812345678')).json()).items ?? [])[0];
  if (!existing) {
    const r = await page.request.post('/api/v1/customers', { headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'Idempotency-Key': `e2e-${randomUUID()}` },
      data: { name: 'Karim Traders', phone: '01812345678', credit_limit: 100000 } });
    expect(r.ok()).toBe(true);
  }

  // A sale in progress: 2 cables, 35 off, pay later, custom schedule.
  await page.goto('/dashboard/pos');
  await page.getByRole('textbox', { name: 'Search products' }).fill('HDMI');
  await page.getByRole('group', { name: 'Product search results' }).getByRole('button', { name: /HDMI cable 2 m/ }).click();
  await page.getByRole('button', { name: 'Increase quantity' }).first().click();
  await page.getByLabel('Line discount (৳)').fill('35');
  await page.getByRole('radio', { name: 'Pay later' }).click();
  await page.getByRole('radio', { name: 'Custom' }).click();
  await page.getByLabel('Installment 1 amount (৳)').fill('300');
  await page.getByLabel('Installment 2 amount (৳)').fill('365');

  // 1. Existing customer found by mobile.
  await page.getByRole('combobox', { name: 'Customer' }).click();
  await page.getByRole('textbox', { name: 'Search customer' }).fill('01812345678');
  await page.getByRole('option', { name: /Karim Traders/ }).first().click();
  await expect(page.getByRole('combobox', { name: 'Customer' })).toContainText('Karim Traders');

  // 2. No results -> Add Customer with the typed name prefilled.
  const newName = `Shopon Store ${Date.now() % 100000}`;
  await page.getByRole('combobox', { name: 'Customer' }).click();
  await page.getByRole('textbox', { name: 'Search customer' }).fill(newName);
  await page.getByRole('listbox', { name: 'Customer' }).getByRole('button', { name: 'Add Customer' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Customer' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Customer name')).toHaveValue(newName);

  // 3. Same mobile as Karim: shown as an existing customer, not merged.
  await dialog.getByLabel('Mobile number (optional)').fill('01812345678');
  await expect(dialog.getByText('same mobile')).toBeVisible({ timeout: 15_000 });
  await dialog.getByLabel('Mobile number (optional)').fill('0181234');
  await expect(dialog.getByText(/Not a valid Bangladeshi mobile/)).toBeVisible();
  const mobile = `017${String(Date.now()).slice(-8)}`;
  await dialog.getByLabel('Mobile number (optional)').fill(mobile);
  await dialog.getByLabel('Credit limit (৳, optional)').fill('50000');
  await page.screenshot({ path: `${shots}/01-dialog.png`, fullPage: true });

  // 4. Permission denied: details kept, actionable message.
  const keys: string[] = [];
  let mode: 'deny' | 'drop' | 'pass' = 'deny';
  await page.route('**/api/v1/customers', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']);
    if (mode === 'deny') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'FORBIDDEN_SCOPE', message: 'Missing permission: customer.create' } }) });
    if (mode === 'drop') { await route.continue(); return; } // reaches the server; the browser loses the reply below
    return route.continue();
  });
  await dialog.getByRole('button', { name: 'Save and select' }).click();
  await expect(dialog.getByRole('alert')).toContainText('You do not have permission to add customers');
  await expect(dialog.getByLabel('Customer name')).toHaveValue(newName);

  // 5. Dropped connection: the request is saved server-side but the reply is lost.
  mode = 'drop';
  await page.unroute('**/api/v1/customers');
  await page.route('**/api/v1/customers', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']);
    if (mode === 'drop') { await route.fetch(); return route.abort('connectionreset'); }
    return route.continue();
  });
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog.getByRole('alert')).toContainText('we don’t know if the customer was saved');
  await expect(dialog.getByLabel('Mobile number (optional)')).toHaveValue(mobile);

  // 6. Retry: same key, so the server replays the first save instead of making a second customer.
  mode = 'pass';
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('combobox', { name: 'Customer' })).toContainText(newName);
  expect(keys[1]).toBe(keys[2]);
  const saved = ((await (await page.request.get(`/api/v1/customers?search=${encodeURIComponent(newName)}`)).json()).items ?? []);
  expect(saved.filter((c: { name: string }) => c.name === newName)).toHaveLength(1);

  // 7. The sale in progress is untouched.
  await expect(page.getByLabel('Line discount (৳)')).toHaveValue('35');
  await expect(page.getByText(/^2 × /)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Pay later' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Installment 1 amount (৳)')).toHaveValue('300');
  await expect(page.getByLabel('Installment 2 amount (৳)')).toHaveValue('365');
  await page.screenshot({ path: `${shots}/02-selected.png`, fullPage: true });

  // 8. Paying in full still allows a walk-in customer.
  await page.getByRole('radio', { name: 'Pay in full' }).click();
  await page.getByRole('button', { name: 'Sell to a walk-in customer instead' }).click();
  await expect(page.getByText(/^Walk-in customer\./)).toBeVisible();

  expect(pageErrors).toEqual([]);
});
