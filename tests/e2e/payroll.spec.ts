// Payroll from the HR page, against the local app:
//   an employee with expense and payable accounts -> Run payroll -> enter an
//   allowance and tax withheld -> Post payroll (BEFTN file downloads) ->
//   Pay from the cash drawer -> the run shows as paid.
//
// Local only: demo company from .local/demo-setup.mjs with HR switched on
// (tests/e2e/modules-live.spec.ts); DEMO_OWNER_PASSWORD is read from
// .env.local and typed, never logged. Creates a Salaries Payable account and
// an employee in the demo company if they are missing.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const shots = '.local/payroll';
mkdirSync(shots, { recursive: true });
const pw = () => readFileSync('.env.local', 'utf8').split(/\r?\n/).find(l => l.startsWith('DEMO_OWNER_PASSWORD='))!.slice('DEMO_OWNER_PASSWORD='.length).replace(/^"|"$/g, '');
const headers = () => ({ 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'Idempotency-Key': `e2e-${randomUUID()}` });
async function pickEntity(page: Page, label: string, option: RegExp) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).first().click();
}

test.setTimeout(240_000);

test('run and pay payroll from the HR page', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@demo-electronics.local');
  await page.getByLabel('Password', { exact: true }).fill(pw());
  await page.getByLabel('Company code (optional)', { exact: true }).fill('DEMO');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });
  const api = page.request;

  const flag = await api.patch('/api/v1/feature-flags/hr_payroll_enabled', { headers: headers(), data: { enabled: true } });
  expect(flag.ok()).toBe(true);
  const coa = (await (await api.get('/api/v1/chart-of-accounts?limit=500')).json()).items as Array<{ id: string; code: string; account_subtype?: string; accountSubtype?: string }>;
  const expense = coa.find(a => a.code === '6000')!;
  let payable = coa.find(a => a.code === '2400');
  if (!payable) {
    const r = await api.post('/api/v1/chart-of-accounts', { headers: headers(), data: { code: '2400', name: 'Salaries Payable', account_class: 'liability', account_subtype: 'payroll_payable', normal_balance: 'C' } });
    expect(r.ok(), JSON.stringify(await r.json()).slice(0, 300)).toBe(true);
    payable = (await r.json().catch(() => null)) ?? ((await (await api.get('/api/v1/chart-of-accounts?limit=500')).json()).items as typeof coa).find(a => a.code === '2400');
  }
  const branch = ((await (await api.get('/api/v1/branches')).json()).items)[0];
  const employees = (await (await api.get('/api/v1/employees?limit=100')).json()).items as Array<{ name: string }>;
  if (!employees.some(e => e.name === 'Nasima Akter')) {
    const r = await api.post('/api/v1/employees', { headers: headers(), data: { employee_no: `EMP-${Date.now() % 100000}`, branch_id: branch.id, name: 'Nasima Akter',
      join_date: new Date('2026-01-01').toISOString(), base_salary: 18000, payroll_expense_account_id: expense.id, payroll_payable_account_id: payable!.id } });
    expect(r.ok(), JSON.stringify(await r.json()).slice(0, 300)).toBe(true);
  }

  await page.goto('/dashboard/hr');
  await expect(page.getByRole('heading', { name: 'Payroll' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Run payroll' }).click();
  await expect(page.getByLabel('Base salary for Nasima Akter')).toHaveValue('18000.00');
  await page.getByLabel('Allowances for Nasima Akter').fill('2000');
  await page.getByLabel('Tax withheld for Nasima Akter').fill('500');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Post payroll' }).click();
  await page.getByRole('button', { name: 'Post payroll' }).last().click(); // confirmation dialog
  expect((await download).suggestedFilename()).toMatch(/beftn\.txt$/);
  const run = page.getByRole('row').filter({ hasText: 'posted' }).first();
  await expect(run).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${shots}/01-posted.png`, fullPage: true });

  await run.getByRole('button', { name: 'Pay' }).click();
  await pickEntity(page, 'Paying branch', /./);
  await pickEntity(page, 'Paid from account', /cash/i);
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByRole('button', { name: 'Record payment' }).last().click(); // confirmation dialog
  await expect(page.getByText(/Payroll paid \(/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('row').filter({ hasText: 'paid' }).first()).toBeVisible();
  await page.screenshot({ path: `${shots}/02-paid.png`, fullPage: true });
  expect(errors).toEqual([]);
});
