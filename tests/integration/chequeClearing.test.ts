// Red-team workstream 8: a cheque is not cash until it clears, and can bounce.
//   - a cheque payment leaves the cash balance unchanged and shows as pending;
//   - clearing moves it from cheque clearing to cash;
//   - bouncing reverses it (the customer owes again) and the payment shows
//     bounced and reversed, with an audit row.
// Disposable MariaDB; only the session is stubbed.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const auth = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/auth/middleware', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/auth/middleware')>()),
  authenticateRequest: async () => auth.current,
}));
import { GET as listPayments } from '@/app/api/v1/payments/route';
import { POST as clearRoute } from '@/app/api/v1/payments/[id]/cheque/clear/route';
import { POST as bounceRoute } from '@/app/api/v1/payments/[id]/cheque/bounce/route';
import { postSale } from '@/domain/commands/m3/PostSale';
import { withTenant } from '@/lib/db/transaction';

const db = new PrismaClient();
const COMPANY_ID = 'd8b1c2e3-7f88-4da4-a096-c13d4e5f6a78';
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let userId: string;
let warehouseId: string;
let productId: string;
let customerId: string;
let clearingId: string;
let arId: string;
const ctx = () => ({ companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, userId: undefined, correlationId: randomUUID(), requestId: randomUUID() }) as never;

/** Debits minus credits on one ledger account. */
async function balance(chartOfAccountId: string) {
  const s = await db.journalLine.aggregate({ where: { companyId: COMPANY_ID, chartOfAccountId }, _sum: { debitBase: true, creditBase: true } });
  return new Prisma.Decimal(s._sum.debitBase ?? 0).minus(s._sum.creditBase ?? 0).toFixed(2);
}
async function chequeSale() {
  const { saleId } = await withTenant(ctx(), t => postSale(t, { companyId: COMPANY_ID, branchId: fx.branches[0].id, warehouseId, cashierId: userId, customerId,
    currencyCode: 'BDT', exchangeRate: 1, businessDate: new Date(), items: [{ productId, qty: 1, unitPrice: 1000 }],
    payments: [{ paymentMethod: 'cheque', amount: 1000, financialAccountId: fx.cash.id, methodReference: `CHQ-${randomUUID().slice(0, 6)}` }] } as never, randomUUID()));
  return (await db.paymentAllocation.findFirstOrThrow({ where: { saleId }, include: { payment: true } })).payment;
}
const post = (route: typeof clearRoute, id: string, body: unknown = {}) => route(new NextRequest(`http://local.test/api/v1/payments/${id}/cheque/x`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `t-${randomUUID()}` }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'CQ', code: 'SYN-CQ' });
  clearingId = (await db.chartOfAccount.findFirst({ where: { companyId: COMPANY_ID, code: 'cq-clearing' } })
    ?? await db.chartOfAccount.create({ data: { companyId: COMPANY_ID, code: 'cq-clearing', name: 'Cheque clearing', accountClass: 'asset', accountSubtype: 'cheque_clearing', normalBalance: 'D' } })).id;
  arId = (await db.accountingPolicy.update({ where: { companyId: COMPANY_ID }, data: { chequeClearingAccountId: clearingId } })).arAccountId;
  const perms = await db.permission.findMany({ where: { code: { in: ['payment.read', 'cheque.clear', 'cheque.bounce'] } } });
  expect(perms).toHaveLength(3);
  const role = await db.role.create({ data: { companyId: COMPANY_ID, name: `cheques-${randomUUID().slice(0, 6)}`, permissions: { create: perms.map(p => ({ permissionId: p.id })) } } });
  userId = (await db.user.create({ data: { companyId: COMPANY_ID, name: 'Cheques', email: `${randomUUID()}@example.invalid`, passwordHash: 'x', accessScope: 'global', roles: { create: { roleId: role.id } } } })).id;
  auth.current = { userId, companyId: COMPANY_ID, branchIds: [], accessScope: 'global', isGlobal: false,
    ctx: { companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, userId, correlationId: randomUUID(), requestId: randomUUID() } };
  warehouseId = (await db.warehouse.create({ data: { companyId: COMPANY_ID, branchId: fx.branches[0].id, name: `CQ-${randomUUID().slice(0, 6)}`, code: `CQ${randomUUID().slice(0, 4)}` } })).id;
  const category = await db.category.create({ data: { companyId: COMPANY_ID, name: `CQ-${randomUUID().slice(0, 6)}`, code: `CQ${randomUUID().slice(0, 4)}` } });
  const unit = await db.unit.create({ data: { companyId: COMPANY_ID, name: `Piece-${randomUUID().slice(0, 6)}`, code: `CQ${randomUUID().slice(0, 4)}` } });
  productId = (await db.product.create({ data: { companyId: COMPANY_ID, name: 'Service plan', code: `CQ-${randomUUID().slice(0, 6)}`, productType: 'service', categoryId: category.id, unitId: unit.id } })).id;
  customerId = (await db.customer.create({ data: { companyId: COMPANY_ID, name: 'Cheque payer', phone: `017${Math.floor(10_000_000 + Math.random() * 89_999_999)}` } })).id;
}, 120_000);
afterAll(() => db.$disconnect());

describe('cheques', () => {
  it('a cheque payment leaves cash unchanged, shows pending, and clearing moves it to cash', async () => {
    const cash0 = await balance(fx.cash.chartOfAccountId);
    const clearing0 = await balance(clearingId);
    const payment = await chequeSale();
    expect(payment.chequeStatus).toBe('pending_clearance');
    expect(await balance(fx.cash.chartOfAccountId)).toBe(cash0);
    expect(new Prisma.Decimal(await balance(clearingId)).minus(clearing0).toFixed(2)).toBe('1000.00');

    const listed = await (await listPayments(new NextRequest('http://local.test/api/v1/payments?cheque_status=pending_clearance&limit=200'))).json() as { items: Array<{ id: string }> };
    expect(listed.items.map(p => p.id)).toContain(payment.id);

    const res = await post(clearRoute, payment.id);
    expect(res.status).toBe(200);
    expect(new Prisma.Decimal(await balance(fx.cash.chartOfAccountId)).minus(cash0).toFixed(2)).toBe('1000.00');
    expect(await balance(clearingId)).toBe(clearing0);
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).chequeStatus).toBe('cleared');
    // A cleared cheque cannot be cleared or bounced again.
    expect((await post(clearRoute, payment.id)).status).toBe(409);
    expect((await post(bounceRoute, payment.id, { reason: 'late' })).status).toBe(409);
  });

  it('bouncing reverses the receipt: the customer owes again and the payment shows bounced', async () => {
    const cash0 = await balance(fx.cash.chartOfAccountId);
    const ar0 = await balance(arId);
    const payment = await chequeSale();
    const clearing1 = await balance(clearingId);
    const res = await post(bounceRoute, payment.id, { reason: 'Insufficient funds' });
    expect(res.status).toBe(200);
    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after).toMatchObject({ chequeStatus: 'bounced', paymentStatus: 'reversed' });
    expect(await balance(fx.cash.chartOfAccountId)).toBe(cash0);
    expect(new Prisma.Decimal(clearing1).minus(await balance(clearingId)).toFixed(2)).toBe('1000.00');
    expect(new Prisma.Decimal(await balance(arId)).minus(ar0).toFixed(2)).toBe('1000.00');
    const audit = await db.auditLog.findFirstOrThrow({ where: { companyId: COMPANY_ID, action: 'cheque.bounced', entityId: payment.id } });
    expect(JSON.parse(audit.afterValue!)).toMatchObject({ reason: 'Insufficient funds', payment_status: 'reversed' });
  });

  it('a bounce needs a reason', async () => {
    const payment = await chequeSale();
    expect((await post(bounceRoute, payment.id, {})).status).toBe(400);
  });
});
