// Money paid out with no supplier needs a manager (red-team workstream 2),
// on the local app: Payments -> Record a payment -> "Something else", money
// out, cash, ৳1,234 -> Save is refused with the approval panel -> Ask a
// manager to approve -> request recorded with that amount and type.
//
// Local only: demo company. DEMO_OWNER_PASSWORD and DATABASE_URL are read
// from .env.local, never logged. The pending request is cancelled at the end.

import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { readFileSync, mkdirSync } from 'node:fs';

const env = (key: string) => readFileSync('.env.local', 'utf8').split(/\r?\n/).find(l => l.startsWith(`${key}=`))!
  .slice(key.length + 1).trim().replace(/^"|"$/g, '');
const shots = '.local/manual-payment';
mkdirSync(shots, { recursive: true });

async function choose(page: Page, label: string, option: string | RegExp) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).first().click();
}

test('an outgoing payment with no supplier asks a manager', async ({ page }) => {
  const url = new URL(env('DATABASE_URL'));
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/erp_pos_local') throw new Error('Only the local demo DB');
  const db = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
  try {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('owner@demo-electronics.local');
    await page.getByLabel('Password', { exact: true }).fill(env('DEMO_OWNER_PASSWORD'));
    await page.getByLabel('Company code (optional)', { exact: true }).fill('DEMO');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL('**/dashboard', { timeout: 60_000 });

    await page.goto('/dashboard/payments');
    await page.getByRole('button', { name: 'Record a payment' }).click();
    const dialog = page.getByRole('dialog');
    await choose(page, 'What is this payment for?', 'Something else');
    await choose(page, 'Money in or out?', 'Money out (we pay)');
    await choose(page, 'Branch', /./);
    await choose(page, 'Payment account', /cash/i);
    await dialog.getByLabel('Amount (৳)').fill('1234');
    await expect(dialog.getByRole('combobox', { name: 'Paid to supplier' })).toBeVisible();
    const before = await db.payment.count();
    await dialog.getByRole('button', { name: 'Save payment' }).click();

    const panel = dialog.getByRole('status').filter({ hasText: 'needs to approve paying out' });
    await expect(panel).toContainText('1,234');
    await page.screenshot({ path: `${shots}/01-needs-approval.png` });
    await panel.getByRole('button', { name: 'Ask a manager to approve' }).click();
    await expect(panel).toContainText('Approval requested.');
    const request = await db.approvalRequest.findFirstOrThrow({ where: { requestType: 'manual_payment', status: 'pending' }, orderBy: { requestedAt: 'desc' } });
    expect(JSON.parse(request.payload)).toMatchObject({ amount: '1234.00', payment_type: 'other' });

    await dialog.getByRole('button', { name: 'Save payment' }).click();
    await expect(panel).toContainText('Not approved yet.');
    expect(await db.payment.count()).toBe(before);
    await page.screenshot({ path: `${shots}/02-waiting.png` });

    await db.approvalRequest.update({ where: { id: request.id }, data: { status: 'cancelled', resolvedAt: new Date(), reason: 'E2E cleanup' } });
    expect(errors).toEqual([]);
  } finally { await db.$disconnect(); }
});
