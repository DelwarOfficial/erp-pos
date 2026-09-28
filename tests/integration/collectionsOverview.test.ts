// Phase 2 read side and manual reminders on the disposable MariaDB, MiMSMS mocked.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { postSale } from '@/domain/commands/m3/PostSale';
import { collectCustomerPayment } from '@/domain/receivables/CollectCustomerPayment';
import { installmentBalances, openInstallmentsCte } from '@/domain/receivables/balances';
import { addDays, localDate, zonedMidnight } from '@/domain/receivables/calendar';
import { collectionOverview, collectionWorklist, customerCollectionTimeline, smsHistory } from '@/domain/receivables/collections';
import { previewManualReminder, queueManualReminder, resolveUnknownMessage, sendOutboundMessage } from '@/domain/receivables/reminders';
import { saveSmsCredentials } from '@/lib/sms/credentials';
import { db as appDb } from '@/lib/db';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const A: string = randomUUID();
const TZ = 'Asia/Dhaka';
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let warehouseA: string;
let warehouseB: string;
let productId: string;

const ctx = (branchIds?: string[]) => ({
  companyId: A, branchIds: branchIds ?? [], allBranches: !branchIds, isGlobal: false, userId: undefined,
  correlationId: randomUUID(), requestId: randomUUID(),
}) as never;
const tx = appDb as unknown as Prisma.TransactionClient;
const today = () => localDate(TZ);
const at = (hour = 10) => new Date(zonedMidnight(TZ, today()).getTime() + hour * 3_600_000);

const provider = vi.fn(async () => new Response(JSON.stringify({ statusCode: '200', status: 'Success', success_Data: [{ trackingId: `TRK${randomUUID().slice(0, 6)}`, sms_Count: 1 }] }), { status: 200 }));

let seq = 0;
async function customer(phone: string | null = `0171${String(Date.now() % 1_000_000 + ++seq).padStart(7, '0')}`) {
  return db.customer.create({ data: { companyId: A, name: `Collect ${randomUUID().slice(0, 5)}`, phone, creditLimit: 1_000_000 } });
}
async function sale(customerId: string, branch: 0 | 1, rows: Array<[number, string]>, paid = 0) {
  const total = rows.reduce((s, [, a]) => s + Number(a), 0) + paid;
  const result = await withTenant(ctx(), t => postSale(t, {
    companyId: A, branchId: fx.branches[branch].id, warehouseId: branch === 0 ? warehouseA : warehouseB, cashierId: fx.user.id, customerId,
    currencyCode: 'BDT', exchangeRate: 1, businessDate: new Date(), items: [{ productId, qty: 1, unitPrice: total }],
    payments: paid ? [{ paymentMethod: 'cash', amount: paid, financialAccountId: fx.cash.id }] : [],
    // Posted on placeholder dates (a sale cannot schedule into the past), then set.
    paymentArrangement: { type: 'installments', installments: rows.map(([, amount], i) => ({ dueDate: addDays(today(), i + 1), amount })) },
  }, randomUUID()));
  const installments = await db.installment.findMany({ where: { saleId: result.saleId }, orderBy: { installmentNo: 'asc' } });
  for (const [i, [d]] of rows.entries()) {
    await db.installment.update({ where: { id: installments[i].id }, data: { dueDate: new Date(`${addDays(today(), d)}T00:00:00Z`) } });
  }
  return { saleId: result.saleId, installmentIds: installments.map(i => i.id) };
}

beforeAll(async () => {
  fx = await ensureSyntheticIssuerTenant(db, { companyId: A, label: 'CO', code: `SYN-CO-${A.slice(0, 8)}` });
  await db.featureFlag.upsert({ where: { companyId_flagKey: { companyId: A, flagKey: 'credit_sales' } },
    update: { enabled: true }, create: { companyId: A, flagKey: 'credit_sales', enabled: true, updatedBy: fx.user.id } });
  warehouseA = (await db.warehouse.create({ data: { companyId: A, branchId: fx.branches[0].id, name: 'CO A', code: 'COA' } })).id;
  warehouseB = (await db.warehouse.create({ data: { companyId: A, branchId: fx.branches[1].id, name: 'CO B', code: 'COB' } })).id;
  const category = await db.category.create({ data: { companyId: A, name: 'CO', code: 'COCAT' } });
  const unit = await db.unit.create({ data: { companyId: A, name: 'Piece', code: 'COPC' } });
  productId = (await db.product.create({ data: { companyId: A, name: 'Plan', code: 'CO-1', productType: 'service', categoryId: category.id, unitId: unit.id } })).id;
  await withTenant(ctx(), t => saveSmsCredentials(t, A, fx.user.id, { userName: 'ops@example.com', apiKey: 'SECRETKEY123456', senderName: 'MYSHOP' }));
}, 120_000);
afterAll(() => db.$disconnect());

describe('balances in SQL', () => {
  it('agree exactly with installmentBalances, including a return that caps the oldest installment', async () => {
    const c = await customer();
    const s = await sale(c.id, 0, [[5, '100'], [20, '200'], [40, '300']]);
    await withTenant(ctx(), t => collectCustomerPayment(t, { companyId: A, branchId: fx.branches[0].id, customerId: c.id, amount: '60',
      financialAccountId: fx.cash.id, paymentMethod: 'cash', businessDate: new Date(), collectedBy: fx.user.id }, randomUUID()));
    // A posted return credits 150 to the sale without touching an installment.
    await db.saleReturn.create({ data: { companyId: A, branchId: fx.branches[0].id, warehouseId: warehouseA, referenceNo: `RET-${randomUUID().slice(0, 6)}`,
      clientTxnId: randomUUID(), saleId: s.saleId, status: 'posted', businessDate: new Date(), reason: 'probe', totalCredit: '150', baseTotalCredit: '150', createdBy: fx.user.id } });

    const js = await runInTenantContext(ctx(), () => installmentBalances(tx, A, { saleIds: [s.saleId] }));
    const sql = await runInTenantContext(ctx(), () => tx.$queryRaw<Array<{ installment_id: string; outstanding: Prisma.Decimal }>>`
      ${openInstallmentsCte(A)} SELECT installment_id, outstanding FROM bal WHERE sale_id = ${s.saleId} ORDER BY due_date`);
    // 100-60 = 40, then the 150 credit: 40 off #1, 110 off #2 -> 0, 90, 300.
    expect(js.map(b => b.outstanding.toFixed(2))).toEqual(['0.00', '90.00', '300.00']);
    expect(sql.map(r => new Prisma.Decimal(r.outstanding).toFixed(2))).toEqual(js.map(b => b.outstanding.toFixed(2)));
  });
});

describe('overview and worklist', () => {
  it('counts what is due today, overdue and upcoming, and who cannot be texted', async () => {
    const before = await runInTenantContext(ctx(), () => collectionOverview(tx, A));
    const c1 = await customer();
    const c2 = await customer(null); // missing number
    const c3 = await customer('12345'); // invalid number
    await sale(c1.id, 0, [[0, '1000'], [-3, '500'], [4, '250']]);
    await sale(c2.id, 0, [[-10, '700']]);
    await sale(c3.id, 0, [[0, '300']]);
    const after = await runInTenantContext(ctx(), () => collectionOverview(tx, A));
    const delta = (x: string, y: string) => new Prisma.Decimal(x).minus(y).toFixed(2);
    expect(delta(after.due_today.amount, before.due_today.amount)).toBe('1300.00');
    expect(after.due_today.installments - before.due_today.installments).toBe(2);
    expect(delta(after.overdue.amount, before.overdue.amount)).toBe('1200.00');
    expect(after.overdue.customers - before.overdue.customers).toBe(2);
    expect(delta(after.upcoming_7_days.amount, before.upcoming_7_days.amount)).toBe('250.00');
    expect(after.customers_without_valid_phone.missing - before.customers_without_valid_phone.missing).toBe(1);
    expect(after.customers_without_valid_phone.invalid - before.customers_without_valid_phone.invalid).toBe(1);
    expect(after.ledger_receivable).not.toBeNull();
  });

  it('lists the overdue oldest first and pages through them with a cursor', async () => {
    const c = await customer();
    await sale(c.id, 0, [[-30, '10'], [-20, '20'], [-15, '30']]);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 50; i++) {
      const page = await runInTenantContext(ctx(), () => collectionWorklist(tx, A, { view: 'overdue', limit: 2, cursor }));
      seen.push(...page.items.map(r => r.installment_id));
      for (let j = 1; j < page.items.length; j++) expect(page.items[j - 1].due_date <= page.items[j].due_date).toBe(true);
      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }
    expect(new Set(seen).size).toBe(seen.length);
    const mine = (await runInTenantContext(ctx(), () => collectionWorklist(tx, A, { view: 'overdue', q: c.name, limit: 50 }))).items;
    expect(mine.map(r => r.days_overdue)).toEqual([30, 20, 15]);
    expect(mine[0]).toMatchObject({ phone_status: 'ok', phone_masked: expect.stringMatching(/^88017\*{5}\d{3}$/) });
  });

  it('shows a branch-limited user only their branch\'s dues', async () => {
    const c = await customer();
    await sale(c.id, 1, [[-2, '999']]);
    const all = await runInTenantContext(ctx(), () => collectionWorklist(tx, A, { view: 'overdue', q: c.name }));
    const branchA = await runInTenantContext(ctx([fx.branches[0].id]), () => collectionWorklist(tx, A, { view: 'overdue', q: c.name }));
    expect(all.items).toHaveLength(1);
    expect(branchA.items).toHaveLength(0);
  });
});

describe('manual reminders', () => {
  it('previews, queues once a day, and sends the amount owed then', async () => {
    const c = await customer();
    const s = await sale(c.id, 0, [[-5, '800']]);
    const [installmentId] = s.installmentIds;
    const preview = await runInTenantContext(ctx(), () => previewManualReminder(tx, A, installmentId, at(), 'en'));
    expect(preview).toMatchObject({ blocked: null, phoneStatus: 'ok', outstanding: '800.00', encoding: 'gsm7', segments: 1 });
    expect(preview.text).toContain('800.00');

    const queued = await withTenant(ctx(), t => queueManualReminder(t, A, installmentId, fx.user.id, at(), 'en'));
    await expect(withTenant(ctx(), t => queueManualReminder(t, A, installmentId, fx.user.id, at(), 'en'))).rejects.toThrow(/already sent or queued today/);

    // Part paid before the worker gets to it: the text follows the balance.
    await withTenant(ctx(), t => collectCustomerPayment(t, { companyId: A, branchId: fx.branches[0].id, customerId: c.id, amount: '300',
      financialAccountId: fx.cash.id, paymentMethod: 'cash', businessDate: new Date(), collectedBy: fx.user.id }, randomUUID()));
    expect(await sendOutboundMessage(ctx(), queued.messageId, at(), provider as never)).toBe('sent');
    const body = JSON.parse((provider.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body as string);
    expect(body.message).toContain('500.00');
  });

  it('will not remind for an installment that is paid', async () => {
    const c = await customer();
    const s = await sale(c.id, 0, [[-1, '100']]);
    await withTenant(ctx(), t => collectCustomerPayment(t, { companyId: A, branchId: fx.branches[0].id, customerId: c.id, amount: '100',
      financialAccountId: fx.cash.id, paymentMethod: 'cash', businessDate: new Date(), collectedBy: fx.user.id }, randomUUID()));
    expect((await runInTenantContext(ctx(), () => previewManualReminder(tx, A, s.installmentIds[0], at()))).blocked).toBe('paid');
    await expect(withTenant(ctx(), t => queueManualReminder(t, A, s.installmentIds[0], fx.user.id, at()))).rejects.toThrow(/cannot be sent: paid/);
  });

  it('settles an unknown message once, and audits it', async () => {
    const c = await customer();
    const s = await sale(c.id, 0, [[-1, '100']]);
    const queued = await withTenant(ctx(), t => queueManualReminder(t, A, s.installmentIds[0], fx.user.id, at()));
    await db.outboundMessage.update({ where: { id: queued.messageId }, data: { status: 'unknown' } });
    await withTenant(ctx(), t => resolveUnknownMessage(t, A, queued.messageId, 'sent', fx.user.id, 'seen in MiMSMS panel'));
    expect(await db.outboundMessage.findUniqueOrThrow({ where: { id: queued.messageId } })).toMatchObject({ status: 'sent', providerStatus: 'confirmed_by_staff' });
    await expect(withTenant(ctx(), t => resolveUnknownMessage(t, A, queued.messageId, 'not_sent', fx.user.id))).rejects.toThrow(/Only a message in state unknown/);
    expect(await db.auditLog.count({ where: { companyId: A, action: 'sms_message.resolve_unknown', entityId: queued.messageId } })).toBe(1);
  });
});

describe('timeline and history', () => {
  it('tells the customer\'s story newest first, and history masks numbers', async () => {
    const c = await customer();
    const s = await sale(c.id, 0, [[-2, '400']]);
    await withTenant(ctx(), t => collectCustomerPayment(t, { companyId: A, branchId: fx.branches[0].id, customerId: c.id, amount: '100',
      financialAccountId: fx.cash.id, paymentMethod: 'cash', businessDate: new Date(), collectedBy: fx.user.id }, randomUUID()));
    await withTenant(ctx(), t => queueManualReminder(t, A, s.installmentIds[0], fx.user.id, at()));
    const events = await runInTenantContext(ctx(), () => customerCollectionTimeline(tx, A, c.id));
    expect(events.map(e => e.kind).sort()).toEqual(['collection', 'credit_sale', 'sms']);
    const history = await runInTenantContext(ctx(), () => smsHistory(tx, A, { customerId: c.id }));
    expect(history.items).toHaveLength(1);
    expect(history.items[0].to_masked).toMatch(/^88017\*{5}\d{3}$/);
    expect(JSON.stringify(history)).not.toContain(c.phone!.slice(1));
  });
});
