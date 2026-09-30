// POST /api/v1/sales/quote runs the real PostSale and rolls it back: it must
// return the exact schedule and leave no trace. Only authentication is stubbed.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { addDays, localDate } from '@/domain/receivables/calendar';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const A: string = randomUUID();
const auth = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/auth/middleware', () => ({ authenticateRequest: async () => auth.current, requirePermission: async () => undefined }));

const db = new PrismaClient();
let body: Record<string, unknown>;
let customerId: string;

const call = async (path: 'quote' | '', payload: unknown) => {
  const route = await import(path === 'quote' ? '@/app/api/v1/sales/quote/route' : '@/app/api/v1/sales/route');
  return route.POST(new NextRequest(`http://localhost/api/v1/sales${path ? '/' + path : ''}`, {
    method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json', 'idempotency-key': `k-${randomUUID()}` },
  }));
};

beforeAll(async () => {
  const fx = await ensureSyntheticIssuerTenant(db, { companyId: A, label: 'QT', code: `SYN-QT-${A.slice(0, 8)}` });
  auth.current = { companyId: A, userId: fx.user.id, isGlobal: false,
    ctx: { companyId: A, userId: fx.user.id, branchIds: [], allBranches: true, isGlobal: false, correlationId: randomUUID(), requestId: randomUUID() } };
  await db.featureFlag.upsert({ where: { companyId_flagKey: { companyId: A, flagKey: 'credit_sales' } },
    update: { enabled: true }, create: { companyId: A, flagKey: 'credit_sales', enabled: true, updatedBy: fx.user.id } });
  const wh = await db.warehouse.create({ data: { companyId: A, branchId: fx.branches[0].id, name: 'QT', code: 'QTWH' } });
  const category = await db.category.create({ data: { companyId: A, name: 'QT', code: 'QTCAT' } });
  const unit = await db.unit.create({ data: { companyId: A, name: 'Piece', code: 'QTPC' } });
  const product = await db.product.create({ data: { companyId: A, name: 'Plan', code: 'QT-1', productType: 'service', categoryId: category.id, unitId: unit.id } });
  customerId = (await db.customer.create({ data: { companyId: A, name: 'Quote customer', phone: '01711111111', creditLimit: 1_000_000 } })).id;
  body = {
    branch_id: fx.branches[0].id, warehouse_id: wh.id, customer_id: customerId,
    items: [{ product_id: product.id, qty: 1, unit_price: 1000 }],
    payments: [{ payment_method: 'cash', amount: 100, financial_account_id: fx.cash.id }],
    payment_arrangement: { type: 'equal', count: 3, first_due_date: addDays(localDate('Asia/Dhaka'), 10) },
  };
}, 120_000);
afterAll(() => db.$disconnect());

describe('sale quote', () => {
  it('returns the exact schedule and writes nothing', async () => {
    const before = { sales: await db.sale.count({ where: { companyId: A } }), // Journal numbers come from reserved blocks and may have gaps (F-46);
      // every gap-free sequence must be untouched.
      sequences: await db.documentSequence.findMany({ where: { companyId: A, documentType: { not: 'JOURNAL' } } }) };
    const response = await call('quote', body);
    expect(response.status).toBe(200);
    const quote = await response.json();
    expect(quote).toMatchObject({ grand_total: '1000.00', paid_now: '100.00', unpaid: '900.00', reminder_phone: '8801711111111' });
    expect(quote.schedule.map((i: { amount: string }) => i.amount)).toEqual(['300.00', '300.00', '300.00']);
    expect(await db.sale.count({ where: { companyId: A } })).toBe(before.sales);
    expect(await db.installment.count({ where: { companyId: A } })).toBe(0);
    // No document number was consumed.
    expect(await db.documentSequence.findMany({ where: { companyId: A, documentType: { not: 'JOURNAL' } } })).toEqual(before.sequences);
  });

  it('posting the same body produces exactly the quoted schedule', async () => {
    const quote = await (await call('quote', body)).json();
    const posted = await call('', body);
    expect(posted.status).toBe(201);
    const { saleId } = await posted.json();
    const rows = await db.installment.findMany({ where: { saleId }, orderBy: { installmentNo: 'asc' } });
    expect(rows.map(r => ({ installment_no: r.installmentNo, due_date: r.dueDate.toISOString().slice(0, 10), amount: r.amount.toFixed(2) }))).toEqual(quote.schedule);
  });

  it('reports the same refusal posting would', async () => {
    const response = await call('quote', { ...body, reminder_phone: '123' });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toMatch(/not a valid Bangladesh mobile/);
  });
});
