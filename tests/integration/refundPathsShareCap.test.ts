// Red-team workstream 6: gateway and manual refunds must see each other.
// The gateway cap counted rows linked by reversed_payment_id; the manual cap
// counted rows linked to sale returns. Each path could refund the same money
// again. Disposable MariaDB; only the session is stubbed. Amounts stay below
// the large-refund threshold so workstream 1's gate does not apply.
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
import { POST as gatewayRefund } from '@/app/api/v1/payments/[id]/refund/route';
import { postSale } from '@/domain/commands/m3/PostSale';
import { voidSale } from '@/domain/commands/m3/VoidSale';
import { withTenant } from '@/lib/db/transaction';

const db = new PrismaClient();
const COMPANY_ID = 'b6fad5e4-5f66-4b82-8d74-af1a2b3c4d56';
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let userId: string;
let warehouseId: string;
let productId: string;
const ctx = () => ({ companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, userId: undefined, correlationId: randomUUID(), requestId: randomUUID() }) as never;

/** A ৳1,000 sale paid by bKash, with a posted return crediting all of it. */
async function refundableSale() {
  const txn = `TXN-${randomUUID().slice(0, 8)}`;
  const { saleId } = await withTenant(ctx(), t => postSale(t, { companyId: COMPANY_ID, branchId: fx.branches[0].id, warehouseId, cashierId: userId,
    currencyCode: 'BDT', exchangeRate: 1, businessDate: new Date(), items: [{ productId, qty: 1, unitPrice: 1000 }],
    payments: [{ paymentMethod: 'bkash', amount: 1000, financialAccountId: fx.cash.id, methodReference: txn }] } as never, randomUUID()));
  const payment = (await db.paymentAllocation.findFirstOrThrow({ where: { saleId }, include: { payment: true } })).payment;
  const ret = await db.saleReturn.create({ data: { companyId: COMPANY_ID, branchId: fx.branches[0].id, warehouseId, referenceNo: `RET-${randomUUID().slice(0, 8)}`,
    clientTxnId: randomUUID(), saleId, status: 'posted', businessDate: new Date(), reason: 'probe', totalCredit: 1000, baseTotalCredit: 1000, createdBy: userId } });
  return { saleId, payment, returnId: ret.id, txn };
}

const manual = (returnId: string, amount: number) => postPayment(new NextRequest('http://local.test/api/v1/payments', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `t-${randomUUID()}` },
  body: JSON.stringify({ branch_id: fx.branches[0].id, financial_account_id: fx.cash.id, payment_type: 'sale_refund', direction: 'outgoing',
    sale_return_id: returnId, amount, payment_method: 'bkash' }) }));
const gateway = (paymentId: string, txn: string, amount: string) => gatewayRefund(new NextRequest(`http://local.test/api/v1/payments/${paymentId}/refund`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `t-${randomUUID()}` },
  body: JSON.stringify({ amount, provider_code: 'bkash', gateway_txn_id: txn }) }), { params: Promise.resolve({ id: paymentId }) });
/** A gateway refund as the gateway path leaves it: linked to the payment, no sale return. */
const gatewayRow = (paymentId: string, amount: number, status = 'posted') => db.payment.create({ data: { companyId: COMPANY_ID, branchId: fx.branches[0].id,
  referenceNo: `REFUND-${randomUUID().slice(0, 8)}`, clientTxnId: randomUUID(), paymentType: 'sale_refund', direction: 'outgoing',
  financialAccountId: fx.cash.id, amount, baseAmount: amount, paymentMethod: 'bkash', paymentStatus: status, businessDate: new Date(),
  reversedPaymentId: paymentId, createdBy: userId } });

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'RF', code: 'SYN-RF' });
  const perms = await db.permission.findMany({ where: { code: { in: ['payment.pay.branch', 'sale.refund.branch', 'payment.refund.branch'] } } });
  expect(perms).toHaveLength(3);
  const role = await db.role.create({ data: { companyId: COMPANY_ID, name: `refunder-${randomUUID().slice(0, 6)}`, permissions: { create: perms.map(p => ({ permissionId: p.id })) } } });
  userId = (await db.user.create({ data: { companyId: COMPANY_ID, name: 'Refunder', email: `${randomUUID()}@example.invalid`, passwordHash: 'x', accessScope: 'global', roles: { create: { roleId: role.id } } } })).id;
  auth.current = { userId, companyId: COMPANY_ID, branchIds: [], accessScope: 'global', isGlobal: false,
    ctx: { companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, userId, correlationId: randomUUID(), requestId: randomUUID() } };
  warehouseId = (await db.warehouse.create({ data: { companyId: COMPANY_ID, branchId: fx.branches[0].id, name: `RF-${randomUUID().slice(0, 6)}`, code: `RF${randomUUID().slice(0, 4)}` } })).id;
  const category = await db.category.create({ data: { companyId: COMPANY_ID, name: `RF-${randomUUID().slice(0, 6)}`, code: `RF${randomUUID().slice(0, 4)}` } });
  const unit = await db.unit.create({ data: { companyId: COMPANY_ID, name: `Piece-${randomUUID().slice(0, 6)}`, code: `RF${randomUUID().slice(0, 4)}` } });
  productId = (await db.product.create({ data: { companyId: COMPANY_ID, name: 'Service plan', code: `RF-${randomUUID().slice(0, 6)}`, productType: 'service', categoryId: category.id, unitId: unit.id } })).id;
}, 120_000);
afterAll(() => db.$disconnect());

describe('one refund cap for every path', () => {
  it('manual first: the manual refund links the payment, and a gateway refund of it is refused', async () => {
    const s = await refundableSale();
    const res = await manual(s.returnId, 1000);
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    expect((await db.payment.findUniqueOrThrow({ where: { id } })).reversedPaymentId).toBe(s.payment.id);
    expect((await gateway(s.payment.id, s.txn, '1000.00')).status).toBe(409);
    expect((await gateway(s.payment.id, s.txn, '0.01')).status).toBe(409);
  });

  it('gateway first: a manual refund of the same money is refused', async () => {
    const s = await refundableSale();
    await gatewayRow(s.payment.id, 1000);
    expect((await manual(s.returnId, 1000)).status).toBe(409);
    expect((await manual(s.returnId, 1)).status).toBe(409);
  });

  it('a pending gateway refund holds its amount too', async () => {
    const s = await refundableSale();
    await gatewayRow(s.payment.id, 700, 'pending');
    expect((await manual(s.returnId, 400)).status).toBe(409);
    expect((await manual(s.returnId, 300)).status).toBe(201);
  });

  it('partial refunds add up across paths', async () => {
    const s = await refundableSale();
    expect((await manual(s.returnId, 600)).status).toBe(201);
    expect((await gateway(s.payment.id, s.txn, '500.00')).status).toBe(409);
    // 400 fits under both caps; it then stops at the unregistered gateway, not the cap.
    expect((await gateway(s.payment.id, s.txn, '400.00')).status).not.toBe(409);
  });

  it('a void after a refund is refused', async () => {
    const s = await refundableSale();
    expect((await manual(s.returnId, 200)).status).toBe(201);
    await expect(withTenant(ctx(), t => voidSale(t, { saleId: s.saleId, companyId: COMPANY_ID, voidedBy: userId, reason: 'probe' }, randomUUID())))
      .rejects.toMatchObject({ httpStatus: 409 });
  });
});
