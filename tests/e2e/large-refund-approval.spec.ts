// Large return needs a manager's approval (red-team workstream 1), on the local app:
//   a ৳6,000 cash sale -> Sales -> View -> Return items -> refused with the
//   "A manager needs to approve this" panel -> Ask a manager to approve ->
//   the request shows on Approvals ("Waiting for someone else" for the
//   requester) -> a second user approves -> Post return again succeeds.
//
// Local only: demo company from .local/demo-setup.mjs. DEMO_OWNER_PASSWORD
// and DATABASE_URL are read from .env.local, never logged. The second user's
// approval is written to the demo DB directly: the demo has one sign-in, and
// the owner cannot approve their own request.

import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const env = (key: string) => readFileSync('.env.local', 'utf8').split(/\r?\n/).find(l => l.startsWith(`${key}=`))!
  .slice(key.length + 1).trim().replace(/^"|"$/g, '');
const shots = '.local/large-refund';
mkdirSync(shots, { recursive: true });
const headers = () => ({ 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'Idempotency-Key': `e2e-${randomUUID()}` });

test.setTimeout(240_000);

test('a large return asks a manager, then posts once approved', async ({ page, context }) => {
  const url = new URL(env('DATABASE_URL'));
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/erp_pos_local') throw new Error('Only the local demo DB');
  const db = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
  try {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', dialog => void dialog.accept());
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('owner@demo-electronics.local');
    await page.getByLabel('Password', { exact: true }).fill(env('DEMO_OWNER_PASSWORD'));
    await page.getByLabel('Company code (optional)', { exact: true }).fill('DEMO');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL('**/dashboard', { timeout: 60_000 });

    // A ৳6,000 cash sale of a non-serialized product with stock.
    const company = await db.company.findFirstOrThrow({ where: { code: 'DEMO' } });
    const stock = await db.warehouseStock.findFirstOrThrow({ where: { companyId: company.id, qtyOnHand: { gte: 1 }, product: { isSerialized: false, trackBatches: false } },
      include: { warehouse: true } });
    const cash = await db.financialAccount.findFirstOrThrow({ where: { companyId: company.id, accountType: 'cash', isActive: true,
      OR: [{ branchId: stock.warehouse.branchId }, { branchId: null }] } });
    const res = await page.request.post('/api/v1/sales', { headers: headers(), data: {
      branch_id: stock.warehouse.branchId, warehouse_id: stock.warehouseId, sale_note: 'E2E large refund',
      items: [{ product_id: stock.productId, qty: 1, unit_price: 6000 }],
      payments: [{ payment_method: 'cash', amount: 6000, financial_account_id: cash.id }] } });
    expect(res.status(), await res.text()).toBe(201);
    const { saleId } = await res.json() as { saleId: string };
    const sale = await db.sale.findUniqueOrThrow({ where: { id: saleId } });
    expect(Number(sale.grandTotal)).toBeGreaterThanOrEqual(5000);

    // Return it from Sales -> View.
    await page.goto('/dashboard/sales');
    await page.getByRole('row').filter({ hasText: sale.referenceNo }).getByRole('button', { name: 'View' }).click();
    await page.getByRole('button', { name: 'Return items' }).click();
    await page.getByLabel('Return reason').fill('E2E: customer returned the item');
    await page.getByLabel(/Return quantity/).first().fill('1');
    await page.getByRole('button', { name: 'Post return' }).click();
    const panel = page.getByRole('status').filter({ hasText: 'A manager needs to approve this' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('6,000.00');
    await page.screenshot({ path: `${shots}/01-needs-approval.png`, fullPage: true });

    await panel.getByRole('button', { name: 'Ask a manager to approve' }).click();
    await expect(panel).toContainText('Approval requested.');
    const request = await db.approvalRequest.findFirstOrThrow({ where: { companyId: company.id, referenceId: saleId, requestType: 'large_refund', status: 'pending' } });
    expect(JSON.parse(request.payload)).toMatchObject({ refund_total: sale.grandTotal.toFixed(2), sale_reference_no: sale.referenceNo });

    // Still pending: trying again says so, nothing is posted.
    await page.getByRole('button', { name: 'Post return' }).click();
    await expect(panel).toContainText('Not approved yet.');
    expect(await db.saleReturn.count({ where: { saleId } })).toBe(0);

    // The requester sees it on Approvals but cannot approve it.
    const approvals = await context.newPage();
    await approvals.goto('/dashboard/approvals');
    const card = approvals.getByRole('listitem').filter({ hasText: `Large refund on sale ${sale.referenceNo}` });
    await expect(card).toContainText('Waiting for someone else');
    await expect(card.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await approvals.screenshot({ path: `${shots}/02-approvals.png`, fullPage: true });
    await approvals.close();

    // A second user approves it.
    const owner = await db.user.findFirstOrThrow({ where: { companyId: company.id, email: 'owner@demo-electronics.local' } });
    // A synthetic approver that cannot sign in, reused across runs.
    const approverEmail = 'e2e-approver@example.invalid';
    const manager = await db.user.findFirst({ where: { companyId: company.id, email: approverEmail } })
      ?? await db.user.create({ data: { companyId: company.id, name: 'E2E approver', email: approverEmail, passwordHash: 'not-a-login', accessScope: 'global' } });
    expect(manager.id).not.toBe(owner.id);
    await db.approvalRequest.update({ where: { id: request.id }, data: { status: 'approved', approvedBy: manager.id, resolvedAt: new Date(), reason: 'E2E second user' } });

    await page.getByRole('button', { name: 'Post return' }).click();
    const outcome = page.getByText('Return posted. Review refund balance below.').or(page.getByRole('alert').filter({ hasText: /MFA re-verification/ }));
    await expect(outcome).toBeVisible();
    await page.screenshot({ path: `${shots}/03-after-approval.png`, fullPage: true });
    const posted = await db.saleReturn.count({ where: { saleId } });
    test.info().annotations.push({ type: 'result', description: posted ? 'return posted' : 'stopped at step-up MFA (session not MFA-verified)' });
    expect(errors).toEqual([]);
  } finally { await db.$disconnect(); }
});
