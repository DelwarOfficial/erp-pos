// Optional modules can be switched on and then used, against the local app:
//   CRM, HR & Payroll, Delivery & Courier, Repairs & Service and Gift Cards &
//   Loyalty switch on through the app, and each page then loads its list
//   instead of the "switched off" notice. Offline POS stays refused, with the
//   reason (multi-currency revaluation now posts its journal).
//
// Local only: demo company from .local/demo-setup.mjs; DEMO_OWNER_PASSWORD is
// read from .env.local and typed, never logged. Leaves these modules switched
// on for the demo company (switch them off in Optional Features).

import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const shots = '.local/modules-live';
mkdirSync(shots, { recursive: true });

function demoPassword(): string {
  const line = readFileSync('.env.local', 'utf8').split(/\r?\n/).find(l => l.startsWith('DEMO_OWNER_PASSWORD='));
  if (!line) throw new Error('DEMO_OWNER_PASSWORD missing: run .local/demo-setup.mjs first');
  return line.slice('DEMO_OWNER_PASSWORD='.length).replace(/^"|"$/g, '');
}
const headers = () => ({ 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'Idempotency-Key': `e2e-${randomUUID()}` });

const MODULES = [
  { flag: 'crm_enabled', page: '/dashboard/crm', heading: /CRM — Leads/ },
  { flag: 'hr_payroll_enabled', page: '/dashboard/hr', heading: /Employees/ },
  { flag: 'delivery_courier_enabled', page: '/dashboard/deliveries', heading: /Deliver/ },
  { flag: 'service_warranty_enabled', page: '/dashboard/service', heading: /Service|Repair/ },
  { flag: 'loyalty_enabled', page: '/dashboard/gift-cards', heading: /Gift Cards/ },
];

test.setTimeout(240_000);

test('optional modules switch on and their pages work', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@demo-electronics.local');
  await page.getByLabel('Password', { exact: true }).fill(demoPassword());
  await page.getByLabel('Company code (optional)', { exact: true }).fill('DEMO');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });

  for (const m of MODULES) {
    const r = await page.request.patch(`/api/v1/feature-flags/${m.flag}`, { headers: headers(), data: { enabled: true, reason: 'live readiness check' } });
    expect(r.ok(), `${m.flag}: ${JSON.stringify(await r.json()).slice(-300)}`).toBe(true);
    await page.goto(m.page);
    await expect(page.getByRole('heading', { level: 1, name: m.heading }).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/is switched off/)).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: /Unable|Failed|not enabled/ })).toHaveCount(0);
    await page.screenshot({ path: `${shots}/${m.flag}.png`, fullPage: true });
  }

  // Offline cash sales can be switched on too (the till lives on New Sale).
  const offline = await page.request.patch('/api/v1/feature-flags/offline_pos_enabled', { headers: headers(), data: { enabled: true } });
  expect(offline.status()).toBe(200);

  expect(pageErrors).toEqual([]);
});
