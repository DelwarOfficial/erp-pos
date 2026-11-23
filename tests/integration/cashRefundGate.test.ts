// Red-team workstream 1: manual cash refunds (POST /api/v1/payments with
// sale_refund) and large sale returns need a distinct approver and step-up
// MFA once a sale's cumulative total reaches refund_approval_threshold
// (default 5000). Runs against the disposable MariaDB; only the session and
// the MFA cookie check are stubbed. Permissions are checked for real.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';
import { DomainError } from '@/lib/errors/codes';

const auth = vi.hoisted(() => ({ current: null as unknown }));
const mfa = vi.hoisted(() => ({ fresh: true }));
vi.mock('@/lib/auth/middleware', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/auth/middleware')>()),
  authenticateRequest: async () => auth.current,
}));
vi.mock('@/lib/auth/requireMfa', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/auth/requireMfa')>()),
  requireMfaForAction: async (_req: unknown, action: string) => {
    if (!mfa.fresh) throw new DomainError('INVALID_MFA', `MFA re-verification required for action: ${action}`, { action }, 403);
  },
}));
import { POST as postPayment } from '@/app/api/v1/payments/route';
import { POST as postReturn } from '@/app/api/v1/sale-returns/route';
import { postSale } from '@/domain/commands/m3/PostSale';
import { withTenant } from '@/lib/db/transaction';

const db = new PrismaClient();
const COMPANY_ID = 'c1a5e0f1-0a11-4c3d-9e2f-5a6b7c8d9e01';
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let cashierId: string;
let managerId: string;
let warehouseId: string;
let productId: string;

const tenantCtx = () => ({ companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, userId: undefined,
  correlationId: randomUUID(), requestId: randomUUID() }) as never;

async function paidSale(total: number) {
  const r = await withTenant(tenantCtx(), t => postSale(t, {
    companyId: COMPANY_ID, branchId: fx.branches[0].id, warehouseId, cashierId, currencyCode: 'BDT', exchangeRate: 1,
    businessDate: new Date(), items: [{ productId, qty: 1, unitPrice: total }],
    payments: [{ paymentMethod: 'cash', amount: total, financialAccountId: fx.cash.id }],
  } as never, randomUUID()));
  return r.saleId as string;
}

async function postedReturn(saleId: string, credit: number) {
  return (await db.saleReturn.create({ data: { companyId: COMPANY_ID, branchId: fx.branches[0].id, warehouseId,
    referenceNo: `RET-${randomUUID().slice(0, 8)}`, clientTxnId: randomUUID(), saleId, status: 'posted', businessDate: new Date(),
    reason: 'probe', totalCredit: credit, baseTotalCredit: credit, createdBy: cashierId } })).id;
}

async function approval(saleId: string, refundTotal: string, approvedBy: string | null, status = 'approved') {
  return (await db.approvalRequest.create({ data: { companyId: COMPANY_ID, branchId: fx.branches[0].id, requestType: 'large_refund',
    referenceType: 'sale', referenceId: saleId, requestedBy: cashierId, approvedBy, status, reason: 'test',
    payload: JSON.stringify({ refund_total: refundTotal }), resolvedAt: status === 'pending' ? null : new Date() } })).id;
}

const refund = (saleReturnId: string, amount: number, approvalRequestId?: string) => postPayment(new NextRequest('http://local.test/api/v1/payments', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `t-${randomUUID()}` },
  body: JSON.stringify({ branch_id: fx.branches[0].id, financial_account_id: fx.cash.id, payment_type: 'sale_refund', direction: 'outgoing',
    sale_return_id: saleReturnId, amount, payment_method: 'cash', ...(approvalRequestId && { approval_request_id: approvalRequestId }) }),
}));

async function errorCode(res: Response) {
  return ((await res.json()) as { error?: { code?: string } }).error?.code;
}

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'RG', code: 'SYN-RG' });
  const perms = await db.permission.findMany({ where: { code: { in: ['payment.pay.branch', 'sale.refund.branch', 'sale_return.post'] } } });
  expect(perms).toHaveLength(3);
  const role = await db.role.create({ data: { companyId: COMPANY_ID, name: `refund-cashier-${randomUUID().slice(0, 6)}`,
    permissions: { create: perms.map(p => ({ permissionId: p.id })) } } });
  const user = (name: string, roleId?: string) => db.user.create({ data: { companyId: COMPANY_ID, name, email: `${randomUUID()}@example.invalid`,
    passwordHash: 'x', accessScope: 'global', ...(roleId && { roles: { create: { roleId } } }) } });
  cashierId = (await user('Refund cashier', role.id)).id;
  managerId = (await user('Refund manager')).id;
  const ctx = { companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, userId: cashierId, correlationId: randomUUID(), requestId: randomUUID() };
  auth.current = { userId: cashierId, companyId: COMPANY_ID, branchIds: [], accessScope: 'global', isGlobal: false, ctx };
  warehouseId = (await db.warehouse.create({ data: { companyId: COMPANY_ID, branchId: fx.branches[0].id, name: `RG-${randomUUID().slice(0, 6)}`, code: `RG${randomUUID().slice(0, 4)}` } })).id;
  const category = await db.category.create({ data: { companyId: COMPANY_ID, name: `RG-${randomUUID().slice(0, 6)}`, code: `RG${randomUUID().slice(0, 4)}` } });
  const unit = await db.unit.create({ data: { companyId: COMPANY_ID, name: `Piece-${randomUUID().slice(0, 6)}`, code: `RG${randomUUID().slice(0, 4)}` } });
  productId = (await db.product.create({ data: { companyId: COMPANY_ID, name: 'Service plan', code: `RG-${randomUUID().slice(0, 6)}`,
    productType: 'service', categoryId: category.id, unitId: unit.id } })).id;
}, 120_000);
afterAll(() => db.$disconnect());

describe('manual cash refund gate', () => {
  it('refuses an above-threshold refund without an approval, and records nothing', async () => {
    mfa.fresh = true;
    const saleId = await paidSale(20_000);
    const ret = await postedReturn(saleId, 20_000);
    const res = await refund(ret, 6_000);
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('APPROVAL_REQUIRED');
    expect(await db.payment.count({ where: { companyId: COMPANY_ID, saleReturnId: ret } })).toBe(0);
  });

  it('refuses a self-approved refund', async () => {
    const saleId = await paidSale(20_000);
    const ret = await postedReturn(saleId, 20_000);
    const res = await refund(ret, 6_000, await approval(saleId, '6000', cashierId));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('SELF_APPROVAL_PROHIBITED');
  });

  it('refuses a pending or rejected approval', async () => {
    const saleId = await paidSale(20_000);
    const ret = await postedReturn(saleId, 20_000);
    expect((await refund(ret, 6_000, await approval(saleId, '6000', null, 'pending'))).status).toBe(403);
    expect((await refund(ret, 6_000, await approval(saleId, '6000', managerId, 'rejected'))).status).toBe(403);
  });

  it('refuses an approval for another sale', async () => {
    const saleId = await paidSale(20_000);
    const ret = await postedReturn(saleId, 20_000);
    const other = await paidSale(20_000);
    expect((await refund(ret, 6_000, await approval(other, '6000', managerId))).status).toBe(403);
  });

  it('requires step-up MFA even with a valid approval', async () => {
    const saleId = await paidSale(20_000);
    const ret = await postedReturn(saleId, 20_000);
    mfa.fresh = false;
    try {
      const res = await refund(ret, 6_000, await approval(saleId, '6000', managerId));
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe('INVALID_MFA');
    } finally { mfa.fresh = true; }
  });

  it('allows a refund approved by a second user and audits the approver', async () => {
    const saleId = await paidSale(20_000);
    const ret = await postedReturn(saleId, 20_000);
    const approvalId = await approval(saleId, '6000', managerId);
    const res = await refund(ret, 6_000, approvalId);
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    const audit = await db.auditLog.findFirstOrThrow({ where: { companyId: COMPANY_ID, action: 'payment.create', entityId: id } });
    expect(JSON.parse(audit.afterValue ?? '{}')).toMatchObject({
      approval_request_id: approvalId, approved_by: managerId, refund_total_base: '6000.00', threshold: 5000,
    });

    // The same approval cannot release more than it approved.
    const again = await refund(ret, 6_000, approvalId);
    expect(again.status).toBe(403);
    expect(await errorCode(again)).toBe('APPROVAL_REQUIRED');
  });

  it('still allows a below-threshold refund without approval, and audits it', async () => {
    const saleId = await paidSale(3_000);
    const ret = await postedReturn(saleId, 3_000);
    mfa.fresh = false; // no step-up needed below the threshold
    try {
      const res = await refund(ret, 1_000);
      expect(res.status).toBe(201);
      const { id } = await res.json() as { id: string };
      const audit = await db.auditLog.findFirstOrThrow({ where: { companyId: COMPANY_ID, action: 'payment.create', entityId: id } });
      expect(JSON.parse(audit.afterValue ?? '{}')).toMatchObject({ type: 'sale_refund', refund_total_base: '1000.00', approval_request_id: null });
    } finally { mfa.fresh = true; }
  });

  it('counts earlier refunds on the sale: splitting does not avoid the gate', async () => {
    const saleId = await paidSale(20_000);
    const ret = await postedReturn(saleId, 20_000);
    expect((await refund(ret, 4_000)).status).toBe(201);
    const res = await refund(ret, 4_000); // cumulative 8000
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('APPROVAL_REQUIRED');
  });
});

describe('sale return gate', () => {
  const returnSale = async (saleId: string, approvalRequestId?: string) => {
    const item = await db.saleItem.findFirstOrThrow({ where: { saleId } });
    return postReturn(new NextRequest('http://local.test/api/v1/sale-returns', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `t-${randomUUID()}` },
      body: JSON.stringify({ sale_id: saleId, branch_id: fx.branches[0].id, warehouse_id: warehouseId, disposition: 'scrap',
        reason: 'Customer returned', items: [{ sale_item_id: item.id, qty_returned: 1, condition: 'scrap' }],
        ...(approvalRequestId && { approval_request_id: approvalRequestId }) }),
    }));
  };

  it('rolls back a large return without approval, and posts it with a second-user approval', async () => {
    const saleId = await paidSale(8_000);
    const denied = await returnSale(saleId);
    expect(denied.status).toBe(403);
    expect(await errorCode(denied)).toBe('APPROVAL_REQUIRED');
    expect(await db.saleReturn.count({ where: { companyId: COMPANY_ID, saleId } })).toBe(0);

    const approvalId = await approval(saleId, '8000', managerId);
    const ok = await returnSale(saleId, approvalId);
    expect(ok.status).toBe(201);
    const { saleReturnId } = await ok.json() as { saleReturnId: string };
    const audit = await db.auditLog.findFirstOrThrow({ where: { companyId: COMPANY_ID, action: 'sale_return.large_refund_approved', entityId: saleReturnId } });
    expect(JSON.parse(audit.afterValue ?? '{}')).toMatchObject({ approval_request_id: approvalId, approved_by: managerId });
  });

  it('posts a small return without approval', async () => {
    const saleId = await paidSale(1_500);
    expect((await returnSale(saleId)).status).toBe(201);
  });
});
