// Till revocation from Access → Users, against the local app:
//   a till is registered (API) -> the Tills list shows it -> Revoke explains
//   what happens, needs a reason -> revoked -> the till can no longer download
//   the product list.
//
// Local only: demo company from .local/demo-setup.mjs; offline sales switched
// on for the run. DEMO_OWNER_PASSWORD is read from .env.local, never logged.

import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const shots = '.local/tills';
mkdirSync(shots, { recursive: true });
const pw = () => readFileSync('.env.local', 'utf8').split(/\r?\n/).find(l => l.startsWith('DEMO_OWNER_PASSWORD='))!.slice('DEMO_OWNER_PASSWORD='.length).replace(/^"|"$/g, '');
const headers = () => ({ 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'Idempotency-Key': `e2e-${randomUUID()}` });

test.setTimeout(180_000);

test('a manager revokes a lost till', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@demo-electronics.local');
  await page.getByLabel('Password', { exact: true }).fill(pw());
  await page.getByLabel('Company code (optional)', { exact: true }).fill('DEMO');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });
  const api = page.request;
  expect((await api.patch('/api/v1/feature-flags/offline_pos_enabled', { headers: headers(), data: { enabled: true } })).ok()).toBe(true);
  const branchId = (await (await api.get('/api/v1/warehouses')).json()).items[0].branch.id;
  const label = `Lost till ${randomUUID().slice(0, 4)}`;
  const till = await (await api.post('/api/v1/devices', { headers: headers(), data: { label, branch_id: branchId, device_key: randomUUID() } })).json();

  await page.goto('/dashboard/access/users');
  const row = page.getByRole('row').filter({ hasText: label });
  await expect(row).toContainText('Active', { timeout: 30_000 });
  await row.getByRole('button', { name: `Revoke ${label}` }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('cannot be sent after this');
  await expect(dialog).toContainText('does not sign anyone out');
  await expect(dialog.getByRole('button', { name: `Revoke ${label}` })).toBeDisabled(); // needs a reason
  await dialog.getByLabel('Reason').fill('Laptop stolen from the counter');
  await page.screenshot({ path: `${shots}/01-confirm.png` });
  await dialog.getByRole('button', { name: `Revoke ${label}` }).click();
  await expect(row).toContainText('Revoked', { timeout: 30_000 });
  await expect(row.getByRole('button', { name: `Revoke ${label}` })).toHaveCount(0);
  await page.screenshot({ path: `${shots}/02-revoked.png`, fullPage: true });

  const after = await api.post('/api/v1/offline/bootstrap', { headers: headers(), data: { device_id: till.id, branch_id: branchId } });
  expect(after.status()).toBe(404);
  expect(errors).toEqual([]);
});
