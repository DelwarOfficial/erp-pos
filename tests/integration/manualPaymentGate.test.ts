// Red-team workstream 2: an outgoing manual payment must name a customer or
// supplier, or carry a second person's approval, and may only be tagged to
// the caller's own open shift in that branch. Disposable MariaDB; only the
// session is stubbed, permissions are checked for real.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const auth = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/auth/middleware', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/auth/middleware')>()),
  authenticateRequest: async () => auth.current,
}));
import { POST as postPayment } from '@/app/api/v1/payments/route';
import { closeCashierShift } from '@/domain/commands/m3/CashierShift';
import { withTenant } from '@/lib/db/transaction';

const db = new PrismaClient();
const COMPANY_ID = 'd2b6f1a0-1b22-4d4e-8f30-6b7c8d9e0f12';
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let cashierId: string;
let otherId: string;
let warehouseId: string;
let supplierId: string;

const tenantCtx = () => ({ companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, userId: undefined,
  correlationId: randomUUID(), requestId: randomUUID() }) as never;

async function shift(cashier: string, status = 'open', openingFloat = 10_000) {
  return (await db.cashierShift.create({ data: { companyId: COMPANY_ID, branchId: fx.branches[0].id, warehouseId, cashierId: cashier,
    cashAccountId: fx.cash.id, status, openingFloat, ...(status !== 'open' && { closedAt: new Date() }) } })).id;
}

async function approval(amount: string, approvedBy: string | null, paymentType = 'other', status = 'approved') {
  return db.approvalRequest.create({ data: { companyId: COMPANY_ID, branchId: fx.branches[0].id, requestType: 'manual_payment',
    referenceType: 'payment', referenceId: randomUUID(), requestedBy: cashierId, approvedBy, status, reason: 'test',
    payload: JSON.stringify({ amount, payment_type: paymentType }), resolvedAt: new Date() } });
}

const pay = (body: Record<string, unknown>) => postPayment(new NextRequest('http://local.test/api/v1/payments', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `t-${randomUUID()}` },
  body: JSON.stringify({ branch_id: fx.branches[0].id, financial_account_id: fx.cash.id, payment_type: 'other', direction: 'outgoing',
    payment_method: 'cash', amount: 2_000, ...body }),
}));
const code = async (res: Response) => ((await res.json()) as { error?: { code?: string } }).error?.code;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'MP', code: 'SYN-MP' });
  const perms = await db.permission.findMany({ where: { code: 'payment.pay.branch' } });
  expect(perms).toHaveLength(1);
  const role = await db.role.create({ data: { companyId: COMPANY_ID, name: `payer-${randomUUID().slice(0, 6)}`,
    permissions: { create: perms.map(p => ({ permissionId: p.id })) } } });
  const user = (name: string) => db.user.create({ data: { companyId: COMPANY_ID, name, email: `${randomUUID()}@example.invalid`,
    passwordHash: 'x', accessScope: 'global', roles: { create: { roleId: role.id } } } });
  cashierId = (await user('Payer')).id;
  otherId = (await user('Other cashier')).id;
  auth.current = { userId: cashierId, companyId: COMPANY_ID, branchIds: [], accessScope: 'global', isGlobal: false,
    ctx: { companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, userId: cashierId, correlationId: randomUUID(), requestId: randomUUID() } };
  warehouseId = (await db.warehouse.create({ data: { companyId: COMPANY_ID, branchId: fx.branches[0].id, name: `MP-${randomUUID().slice(0, 6)}`, code: `MP${randomUUID().slice(0, 4)}` } })).id;
  supplierId = (await db.supplier.create({ data: { companyId: COMPANY_ID, name: `Supplier ${randomUUID().slice(0, 6)}` } })).id;
}, 120_000);
afterAll(() => db.$disconnect());

describe('outgoing manual payments', () => {
  it('refuses an unanchored payment with no approval, and records nothing', async () => {
    const before = await db.payment.count({ where: { companyId: COMPANY_ID } });
    const res = await pay({});
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('APPROVAL_REQUIRED');
    expect(await db.payment.count({ where: { companyId: COMPANY_ID } })).toBe(before);
  });

  it("refuses another user's shift and a closed shift", async () => {
    const theirs = await pay({ supplier_id: supplierId, cashier_shift_id: await shift(otherId) });
    expect(theirs.status).toBe(403);
    expect(await code(theirs)).toBe('NO_OPEN_SHIFT');
    const closed = await pay({ supplier_id: supplierId, cashier_shift_id: await shift(cashierId, 'closed') });
    expect(closed.status).toBe(403);
    expect(await code(closed)).toBe('NO_OPEN_SHIFT');
  });

  it('accepts a supplier-anchored payment on the own open shift, and the shift close counts it', async () => {
    const shiftId = await shift(cashierId);
    const res = await pay({ supplier_id: supplierId, cashier_shift_id: shiftId, amount: 2_000 });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    const audit = await db.auditLog.findFirstOrThrow({ where: { companyId: COMPANY_ID, action: 'payment.create', entityId: id } });
    expect(JSON.parse(audit.afterValue ?? '{}')).toMatchObject({ supplier_id: supplierId, cashier_shift_id: shiftId });
    // 10,000 float - 2,000 paid out: counting 8,000 closes with no variance.
    const closed = await withTenant(tenantCtx(), t => closeCashierShift(t, { shiftId, companyId: COMPANY_ID, closedBy: cashierId, countedClosingCash: 8_000, closerCanApprove: false }, randomUUID()));
    expect(closed.expectedCash).toBe(8_000);
    expect(closed.variance).toBe(0);
  });

  it('accepts an approved unanchored payment once, and audits the approver', async () => {
    const request = await approval('2000', otherId);
    const res = await pay({ approval_request_id: request.id });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    expect((await db.payment.findUniqueOrThrow({ where: { id } })).clientTxnId).toBe(request.referenceId);
    const audit = await db.auditLog.findFirstOrThrow({ where: { companyId: COMPANY_ID, action: 'payment.create', entityId: id } });
    expect(JSON.parse(audit.afterValue ?? '{}')).toMatchObject({ approval_request_id: request.id, approved_by: otherId });
    expect((await pay({ approval_request_id: request.id })).status).toBe(409);
  });

  it('refuses self-approval, pending approval, a smaller amount and another payment type', async () => {
    expect(await code(await pay({ approval_request_id: (await approval('2000', cashierId)).id }))).toBe('SELF_APPROVAL_PROHIBITED');
    expect((await pay({ approval_request_id: (await approval('2000', null, 'other', 'pending')).id })).status).toBe(403);
    expect((await pay({ approval_request_id: (await approval('1999.99', otherId)).id })).status).toBe(403);
    expect((await pay({ approval_request_id: (await approval('2000', otherId, 'expense_payment')).id })).status).toBe(403);
  });

  it('leaves incoming payments without an anchor unchanged', async () => {
    expect((await pay({ direction: 'incoming', payment_type: 'customer_advance', amount: 500 })).status).toBe(201);
  });
});
