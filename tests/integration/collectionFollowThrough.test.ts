// Phase 3 on the disposable MariaDB, MiMSMS mocked: promises to pay, follow-ups,
// due-date changes, bulk reminders, reminder templates, reports and the calendar.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { postSale } from '@/domain/commands/m3/PostSale';
import { collectCustomerPayment } from '@/domain/receivables/CollectCustomerPayment';
import { addDays, dateFromIso, localDate, zonedMidnight } from '@/domain/receivables/calendar';
import { customerCollectionTimeline } from '@/domain/receivables/collections';
import {
  cancelPromise, closeFollowUp, createFollowUp, listFollowUps, listPromises, recordPromise, rescheduleInstallment,
} from '@/domain/receivables/followUps';
import { previewBulkReminders, previewManualReminder, queueBulkReminders, sendOutboundMessage } from '@/domain/receivables/reminders';
import { listReminderTemplates, resetReminderTemplate, saveReminderTemplate } from '@/domain/receivables/templateSettings';
import { collectionCalendar, collectionReport } from '@/domain/receivables/collectionReports';
import { saveSmsCredentials } from '@/lib/sms/credentials';
import { db as appDb } from '@/lib/db';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const A: string = randomUUID();
const TZ = 'Asia/Dhaka';
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let warehouseA: string;
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
  return db.customer.create({ data: { companyId: A, name: `Follow ${randomUUID().slice(0, 5)}`, phone, creditLimit: 1_000_000 } });
}
async function sale(customerId: string, rows: Array<[number, string]>) {
  const total = rows.reduce((s, [, a]) => s + Number(a), 0);
  const result = await withTenant(ctx(), t => postSale(t, {
    companyId: A, branchId: fx.branches[0].id, warehouseId: warehouseA, cashierId: fx.user.id, customerId,
    currencyCode: 'BDT', exchangeRate: 1, businessDate: new Date(), items: [{ productId, qty: 1, unitPrice: total }], payments: [],
    paymentArrangement: { type: 'installments', installments: rows.map(([, amount], i) => ({ dueDate: addDays(today(), i + 1), amount })) },
  }, randomUUID()));
  const installments = await db.installment.findMany({ where: { saleId: result.saleId }, orderBy: { installmentNo: 'asc' } });
  for (const [i, [d]] of rows.entries()) {
    await db.installment.update({ where: { id: installments[i].id }, data: { dueDate: dateFromIso(addDays(today(), d)) } });
  }
  return { saleId: result.saleId, installmentIds: installments.map(i => i.id) };
}
const collect = (customerId: string, amount: string, saleIds?: string[]) => withTenant(ctx(), t => collectCustomerPayment(t, {
  companyId: A, branchId: fx.branches[0].id, customerId, amount, saleIds,
  financialAccountId: fx.cash.id, paymentMethod: 'cash', businessDate: new Date(), collectedBy: fx.user.id,
}, randomUUID()));

beforeAll(async () => {
  fx = await ensureSyntheticIssuerTenant(db, { companyId: A, label: 'FT', code: `SYN-FT-${A.slice(0, 8)}` });
  await db.featureFlag.upsert({ where: { companyId_flagKey: { companyId: A, flagKey: 'credit_sales' } },
    update: { enabled: true }, create: { companyId: A, flagKey: 'credit_sales', enabled: true, updatedBy: fx.user.id } });
  warehouseA = (await db.warehouse.create({ data: { companyId: A, branchId: fx.branches[0].id, name: 'FT A', code: 'FTA' } })).id;
  const category = await db.category.create({ data: { companyId: A, name: 'FT', code: 'FTCAT' } });
  const unit = await db.unit.create({ data: { companyId: A, name: 'Piece', code: 'FTPC' } });
  productId = (await db.product.create({ data: { companyId: A, name: 'Plan', code: 'FT-1', productType: 'service', categoryId: category.id, unitId: unit.id } })).id;
  await withTenant(ctx(), t => saveSmsCredentials(t, A, fx.user.id, { userName: 'ops@example.com', apiKey: 'SECRETKEY123456', senderName: 'MYSHOP' }));
}, 120_000);
afterAll(() => db.$disconnect());

describe('promises to pay', () => {
  it('stays open while part paid, is kept once the promised amount is collected, and never moves the due date', async () => {
    const c = await customer();
    const s = await sale(c.id, [[-5, '1000']]);
    const promise = await withTenant(ctx(), t => recordPromise(t, A, { saleId: s.saleId, installmentId: s.installmentIds[0], promisedDate: addDays(today(), 3), amount: '600' }, fx.user.id));
    expect(promise.originalDueDate?.toISOString().slice(0, 10)).toBe(addDays(today(), -5));
    const status = async () => (await runInTenantContext(ctx(), () => listPromises(tx, A, { ids: [promise.id] }))).items[0];
    expect(await status()).toMatchObject({ status: 'open', collected: '0.00' });
    await collect(c.id, '200');
    expect(await status()).toMatchObject({ status: 'open', collected: '200.00' });
    await collect(c.id, '400');
    expect(await status()).toMatchObject({ status: 'kept', collected: '600.00' });
    const installment = await db.installment.findUniqueOrThrow({ where: { id: s.installmentIds[0] } });
    expect(installment.dueDate.toISOString().slice(0, 10)).toBe(addDays(today(), -5));
  });

  it('is broken once the promised day has passed short, and refuses bad or overlapping promises', async () => {
    const c = await customer();
    const s = await sale(c.id, [[-2, '500']]);
    await expect(withTenant(ctx(), t => recordPromise(t, A, { saleId: s.saleId, promisedDate: addDays(today(), -1), amount: '100' }, fx.user.id))).rejects.toThrow(/past/);
    await expect(withTenant(ctx(), t => recordPromise(t, A, { saleId: s.saleId, promisedDate: today(), amount: '900' }, fx.user.id))).rejects.toThrow(/more than is owed/);
    const promise = await withTenant(ctx(), t => recordPromise(t, A, { saleId: s.saleId, promisedDate: today(), amount: '300' }, fx.user.id));
    await expect(withTenant(ctx(), t => recordPromise(t, A, { saleId: s.saleId, installmentId: s.installmentIds[0], promisedDate: today(), amount: '100' }, fx.user.id)))
      .rejects.toThrow(/open promise already covers/);
    const tomorrow = new Date(zonedMidnight(TZ, addDays(today(), 1)).getTime() + 3_600_000);
    const broken = await runInTenantContext(ctx(), () => listPromises(tx, A, { saleId: s.saleId, status: 'broken' }, tomorrow));
    expect(broken.items.map(p => p.id)).toEqual([promise.id]);
    await expect(withTenant(ctx(), t => cancelPromise(t, A, promise.id, 'x', fx.user.id, tomorrow))).rejects.toThrow(/Only an open promise/);
    await withTenant(ctx(), t => cancelPromise(t, A, promise.id, 'customer disputes the amount', fx.user.id));
    expect((await runInTenantContext(ctx(), () => listPromises(tx, A, { ids: [promise.id] }))).items[0].status).toBe('cancelled');
    expect(await db.auditLog.count({ where: { companyId: A, entityId: promise.id } })).toBe(2);
  });
});

describe('follow-ups', () => {
  it('are created, listed by when they are due, and closed once', async () => {
    const c = await customer();
    const s = await sale(c.id, [[-1, '100']]);
    const due = new Date(zonedMidnight(TZ, today()).getTime() + 15 * 3_600_000);
    const f = await withTenant(ctx(), t => createFollowUp(t, A, { customerId: c.id, saleId: s.saleId, type: 'call', dueAt: due, assignedTo: fx.user.id, note: 'Call after lunch' }, fx.user.id));
    await expect(withTenant(ctx(), t => createFollowUp(t, A, { customerId: c.id, type: 'visit', dueAt: due, assignedTo: randomUUID() }, fx.user.id))).rejects.toThrow(/assignee/);
    const todays = await runInTenantContext(ctx(), () => listFollowUps(tx, A, { status: 'open', window: 'today', customerId: c.id }));
    expect(todays.items.map(x => x.id)).toEqual([f.id]);
    expect((await runInTenantContext(ctx(), () => listFollowUps(tx, A, { status: 'open', window: 'overdue', customerId: c.id }))).items).toHaveLength(0);
    await withTenant(ctx(), t => closeFollowUp(t, A, f.id, 'done', 'Will pay Friday', fx.user.id));
    await expect(withTenant(ctx(), t => closeFollowUp(t, A, f.id, 'cancelled', undefined, fx.user.id))).rejects.toThrow(/already done/);
    const kinds = (await runInTenantContext(ctx(), () => customerCollectionTimeline(tx, A, c.id))).map(e => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['follow_up', 'follow_up_closed']));
  });
});

describe('due-date changes', () => {
  it('moves a date within its neighbours, records it immutably and cancels reminders for the old date', async () => {
    const c = await customer();
    const s = await sale(c.id, [[2, '100'], [10, '100'], [20, '100']]);
    const [first, second] = s.installmentIds;
    const occurrence = await db.reminderOccurrence.create({ data: { companyId: A, installmentId: second, saleId: s.saleId, customerId: c.id,
      stageOffsetDays: -1, dueDate: dateFromIso(addDays(today(), 10)), scheduledFor: new Date() } });
    await expect(withTenant(ctx(), t => rescheduleInstallment(t, A, second, addDays(today(), 25), 'late salary', fx.user.id))).rejects.toThrow(/before installment 3/);
    await expect(withTenant(ctx(), t => rescheduleInstallment(t, A, second, addDays(today(), 2), 'late salary', fx.user.id))).rejects.toThrow(/after installment 1/);
    await expect(withTenant(ctx(), t => rescheduleInstallment(t, A, first, addDays(today(), -1), 'late salary', fx.user.id))).rejects.toThrow(/past/);
    const changed = await withTenant(ctx(), t => rescheduleInstallment(t, A, second, addDays(today(), 15), 'late salary', fx.user.id));
    expect(changed).toMatchObject({ oldDueDate: addDays(today(), 10), newDueDate: addDays(today(), 15), cancelledReminders: 1 });
    expect(await db.reminderOccurrence.findUniqueOrThrow({ where: { id: occurrence.id } })).toMatchObject({ status: 'cancelled', skipReason: 'due_date_changed' });
    const history = await db.installmentDueDateChange.findFirstOrThrow({ where: { installmentId: second } });
    await expect(db.$executeRaw`UPDATE installment_due_date_changes SET reason = 'edited' WHERE id = ${history.id}`).rejects.toThrow(/IMMUTABLE_LEDGER/);
    await expect(db.$executeRaw`DELETE FROM installment_due_date_changes WHERE id = ${history.id}`).rejects.toThrow(/IMMUTABLE_LEDGER/);
  });
});

describe('bulk reminders', () => {
  it('previews who can be reached, queues only the confirmed set, and sends through the normal path', async () => {
    const ok = await customer();
    const noPhone = await customer(null);
    const paid = await customer();
    const s1 = await sale(ok.id, [[-3, '100'], [-1, '100']]); // two installments, one customer
    const s2 = await sale(noPhone.id, [[-3, '100']]);
    const s3 = await sale(paid.id, [[-3, '100']]);
    await collect(paid.id, '100');
    const ids = [...s1.installmentIds, ...s2.installmentIds, ...s3.installmentIds];
    const preview = await runInTenantContext(ctx(), () => previewBulkReminders(tx, A, ids, at(), 'en'));
    expect(preview).toMatchObject({ selected: 4, eligible: 1, missing_phone: 1, already_paid: 1, duplicate_suppressed: 1 });
    expect(preview.sample?.text).toContain('100.00');

    await expect(withTenant(ctx(), t => queueBulkReminders(t, A, ids, '0'.repeat(64), fx.user.id, at(), 'en'))).rejects.toThrow(/preview again/);
    const queued = await withTenant(ctx(), t => queueBulkReminders(t, A, ids, preview.confirmation_token, fx.user.id, at(), 'en'));
    expect(queued.queued).toBe(1);
    const message = await db.outboundMessage.findFirstOrThrow({ where: { companyId: A, triggerSource: 'bulk', customerId: ok.id } });
    expect(message.installmentId).toBe(s1.installmentIds[0]); // the oldest due
    // Reminded today now: a second batch suppresses it.
    const again = await runInTenantContext(ctx(), () => previewBulkReminders(tx, A, ids, at(), 'en'));
    expect(again.eligible).toBe(0);
    expect(await sendOutboundMessage(ctx(), message.id, at(), provider as never)).toBe('sent');
    expect(await db.auditLog.count({ where: { companyId: A, action: 'sms_message.bulk_reminder', entityId: queued.batchId } })).toBe(1);
  });
});

describe('reminder templates', () => {
  it('refuses unknown placeholders, is used once saved, and can be reset', async () => {
    const code = 'due_reminder.overdue.en';
    await expect(withTenant(ctx(), t => saveReminderTemplate(t, A, code, 'Hi {{customer_name}}, pay {{secret}}', fx.user.id))).rejects.toThrow(/Unknown placeholder/);
    await expect(withTenant(ctx(), t => saveReminderTemplate(t, A, 'due_reminder.other.en', 'x', fx.user.id))).rejects.toThrow(/Unknown reminder template/);
    const saved = await withTenant(ctx(), t => saveReminderTemplate(t, A, code, 'OVERDUE {{invoice_no}}: Tk {{due_amount}} since {{days_overdue}} days', fx.user.id));
    expect(saved.version).toBe(1);
    const c = await customer();
    const s = await sale(c.id, [[-4, '250']]);
    const preview = await runInTenantContext(ctx(), () => previewManualReminder(tx, A, s.installmentIds[0], at(), 'en'));
    expect(preview.text).toMatch(/^OVERDUE .+: Tk 250\.00 since 4 days$/);
    await withTenant(ctx(), t => resetReminderTemplate(t, A, code, fx.user.id));
    const list = await runInTenantContext(ctx(), () => listReminderTemplates(tx, A));
    expect(list.items.find(i => i.code === code)).toMatchObject({ custom_active: false, version: 1 });
    expect((await runInTenantContext(ctx(), () => previewManualReminder(tx, A, s.installmentIds[0], at(), 'en'))).text).toMatch(/^Dear /);
  });
});

describe('reports and calendar', () => {
  it('count collections, flag those after a reminder, and place dues on the calendar', async () => {
    const before = await runInTenantContext(ctx(), () => collectionReport(tx, A, { from: addDays(today(), -1), to: today() }));
    const c = await customer();
    const s = await sale(c.id, [[-2, '400'], [3, '100']]);
    await db.outboundMessage.create({ data: { companyId: A, channel: 'sms', purpose: 'transactional', triggerSource: 'manual',
      installmentId: s.installmentIds[0], saleId: s.saleId, customerId: c.id, destinationHash: 'x', destinationEncrypted: 'x',
      renderedBody: 'x', status: 'delivered', sentAt: new Date(Date.now() - 3_600_000) } });
    await collect(c.id, '150');
    const after = await runInTenantContext(ctx(), () => collectionReport(tx, A, { from: addDays(today(), -1), to: today() }));
    const delta = (x: string, y: string) => new Prisma.Decimal(x).minus(y).toFixed(2);
    expect(delta(after.totals.collected, before.totals.collected)).toBe('150.00');
    expect(delta(after.totals.collected_within_days_after_reminder, before.totals.collected_within_days_after_reminder)).toBe('150.00');
    expect(delta(after.daily.at(-1)!.collected, before.daily.at(-1)!.collected)).toBe('150.00');
    await expect(runInTenantContext(ctx(), () => collectionReport(tx, A, { from: addDays(today(), -100), to: today() }))).rejects.toThrow(/At most/);

    const dueDay = addDays(today(), 3);
    const calendar = await runInTenantContext(ctx(), () => collectionCalendar(tx, A, dueDay.slice(0, 7)));
    const day = calendar.days.find(d => d.day === dueDay)!;
    expect(day.installments).toBeGreaterThanOrEqual(1);
    expect(new Prisma.Decimal(day.outstanding).gte(100)).toBe(true);
  });
});
