// The due reminder engine on the disposable MariaDB, with MiMSMS mocked.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { withTenant } from '@/lib/db/transaction';
import { postSale } from '@/domain/commands/m3/PostSale';
import { collectCustomerPayment } from '@/domain/receivables/CollectCustomerPayment';
import { addDays, localDate, zonedMidnight } from '@/domain/receivables/calendar';
import {
  planDueReminders, pollDeliveryReports, queueDueReminderMessages, recoverInterruptedSends, sendOutboundMessage, sendableMessageIds,
} from '@/domain/receivables/reminders';
import { saveSmsCredentials } from '@/lib/sms/credentials';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const db = new PrismaClient();
const A: string = randomUUID();
const B: string = randomUUID();
const TZ = 'Asia/Dhaka';
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let fxB: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
let warehouseId: string;
let productId: string;

const ctx = (companyId = A) => ({
  companyId, branchIds: [], allBranches: true, isGlobal: false, correlationId: randomUUID(), requestId: randomUUID(),
}) as never;
const today = () => localDate(TZ);
/** 10:00 in Dhaka today: inside the default 09:00-20:00 window. */
const at = (hour = 10, minutesLater = 0) => new Date(zonedMidnight(TZ, today()).getTime() + hour * 3_600_000 + minutesLater * 60_000);

// ── A mock MiMSMS ──
type Behaviour = 'accept' | 'timeout' | 'unavailable' | 'deliver';
let behaviour: Behaviour = 'accept';
let tracking = 0;
const provider = vi.fn(async (url: string, init: RequestInit) => {
  const body = JSON.parse(init.body as string);
  if (url.endsWith('/DlrApi')) return new Response(JSON.stringify({ statusCode: '200', operatorStatus: 'DELIVERED', trackingId: body.trackingId }), { status: 200 });
  if (behaviour === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  if (behaviour === 'unavailable') return new Response('Service Unavailable', { status: 503 });
  tracking++;
  return new Response(JSON.stringify({ statusCode: '200', status: 'Success', success_Data: [{ mobNumber: body.mobileNumber, trackingId: `TRK${tracking}`, sms_Count: 1 }] }), { status: 200 });
});
const sends = () => provider.mock.calls.filter(([url]) => String(url).endsWith('/SMS'));
const fetchImpl = provider as unknown as typeof fetch;

let phoneSeq = 0;
const uniquePhone = () => `0171${String(Date.now() % 1_000_000 + ++phoneSeq).padStart(7, '0')}`;

async function creditSale(companyId: string, dueInDays: number, amount = 1000, phone: string | null = uniquePhone()) {
  const f = companyId === A ? fx : fxB;
  const customer = await db.customer.create({ data: { companyId, name: 'Reminder customer', phone, creditLimit: 1_000_000 } });
  const sale = await withTenant(ctx(companyId), tx => postSale(tx, {
    companyId, branchId: f.branches[0].id, warehouseId: companyId === A ? warehouseId : warehouseB, cashierId: f.user.id, customerId: customer.id,
    currencyCode: 'BDT', exchangeRate: 1, businessDate: new Date(), items: [{ productId: companyId === A ? productId : productB, qty: 1, unitPrice: amount }],
    payments: [], paymentArrangement: { type: 'due', dueDate: addDays(today(), Math.max(dueInDays, 0)) },
  }, randomUUID()));
  const installment = await db.installment.findFirstOrThrow({ where: { saleId: sale.saleId } });
  if (dueInDays < 0) {
    // PostSale refuses a due date before the sale; age the installment directly.
    await db.installment.update({ where: { id: installment.id }, data: { dueDate: new Date(`${addDays(today(), dueInDays)}T00:00:00Z`) } });
  }
  return { customer, saleId: sale.saleId, installmentId: installment.id };
}

const messageFor = (installmentId: string) => db.outboundMessage.findFirst({ where: { installmentId } });
const occurrenceFor = (installmentId: string) => db.reminderOccurrence.findFirst({ where: { installmentId } });
async function schedule(companyId = A, now = at()) {
  await planDueReminders(ctx(companyId), now);
  return queueDueReminderMessages(ctx(companyId), now);
}

let warehouseB: string;
let productB: string;
beforeAll(async () => {
  fx = await ensureSyntheticIssuerTenant(db, { companyId: A, label: 'DR', code: `SYN-DR-${A.slice(0, 8)}` });
  fxB = await ensureSyntheticIssuerTenant(db, { companyId: B, label: 'DS', code: `SYN-DS-${B.slice(0, 8)}` });
  for (const [companyId, f] of [[A, fx], [B, fxB]] as const) {
    await db.featureFlag.upsert({ where: { companyId_flagKey: { companyId, flagKey: 'credit_sales' } },
      update: { enabled: true }, create: { companyId, flagKey: 'credit_sales', enabled: true, updatedBy: f.user.id } });
    await db.reminderPolicy.create({ data: { companyId, enabled: true, locale: 'en', maxPerCustomerPerDay: 1 } });
    const wh = await db.warehouse.create({ data: { companyId, branchId: f.branches[0].id, name: 'Reminder WH', code: 'DRWH' } });
    const category = await db.category.create({ data: { companyId, name: 'Reminder', code: 'DRCAT' } });
    const unit = await db.unit.create({ data: { companyId, name: 'Piece', code: 'DRPC' } });
    const product = await db.product.create({ data: { companyId, name: 'Plan', code: 'DR-1', productType: 'service', categoryId: category.id, unitId: unit.id } });
    if (companyId === A) { warehouseId = wh.id; productId = product.id; } else { warehouseB = wh.id; productB = product.id; }
  }
  // Company A has a MiMSMS account; company B does not.
  await withTenant(ctx(A), tx => saveSmsCredentials(tx, A, fx.user.id, { userName: 'ops@example.com', apiKey: 'SECRETKEY123456', senderName: 'MYSHOP' }));
}, 120_000);

beforeEach(() => { behaviour = 'accept'; provider.mockClear(); });
afterAll(() => db.$disconnect());

describe('scheduling', () => {
  it('plans each stage once, however often the scheduler runs', async () => {
    const { installmentId } = await creditSale(A, 3); // stage -3 today
    await Promise.all([planDueReminders(ctx(), at()), planDueReminders(ctx(), at())]);
    await planDueReminders(ctx(), at(11));
    const occurrences = await db.reminderOccurrence.findMany({ where: { installmentId } });
    expect(occurrences.map(o => o.stageOffsetDays)).toEqual([-3]);
  });

  it('queues one message per occurrence, rendered with the due amount', async () => {
    const { installmentId } = await creditSale(A, 1, 1500); // stage -1
    await Promise.all([schedule(), schedule()]);
    await schedule();
    const messages = await db.outboundMessage.findMany({ where: { installmentId } });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ status: 'queued', triggerSource: 'reminder', encoding: 'gsm7' });
    expect(messages[0].renderedBody).toContain('Tk 1,500.00');
    // The number is stored encrypted and hashed, never in clear.
    expect(messages[0].destinationEncrypted).not.toMatch(/8801/);
  });

  it('queues nothing outside the sending window', async () => {
    const { installmentId } = await creditSale(A, 0);
    await schedule(A, at(3)); // 03:00
    expect(await messageFor(installmentId)).toBeNull();
    expect(await occurrenceFor(installmentId)).toMatchObject({ status: 'pending' });
  });

  it('skips a customer with no usable mobile number, saying why', async () => {
    const { installmentId } = await creditSale(A, 7 - 7, 1000, null); // due today, no phone
    await schedule();
    expect(await occurrenceFor(installmentId)).toMatchObject({ status: 'skipped', skipReason: 'missing_phone' });
    expect(await messageFor(installmentId)).toBeNull();
  });
});

describe('sending', () => {
  it('sends once, records the tracking ID, and a second attempt does nothing', async () => {
    const { installmentId } = await creditSale(A, 0);
    await schedule();
    const message = (await messageFor(installmentId))!;
    expect(await sendOutboundMessage(ctx(), message.id, at(), fetchImpl)).toBe('sent');
    expect(await sendOutboundMessage(ctx(), message.id, at(), fetchImpl)).toBe('not_claimed');
    expect(sends()).toHaveLength(1);
    expect(await messageFor(installmentId)).toMatchObject({ status: 'sent', providerCode: 'mimsms', providerMessageId: expect.stringMatching(/^TRK/) });
  });

  it('lets only one of two concurrent workers send', async () => {
    const { installmentId } = await creditSale(A, 0);
    await schedule();
    const message = (await messageFor(installmentId))!;
    const results = await Promise.all([1, 2, 3].map(() => sendOutboundMessage(ctx(), message.id, at(), fetchImpl)));
    expect(results.filter(r => r === 'sent')).toHaveLength(1);
    expect(results.filter(r => r === 'not_claimed')).toHaveLength(2);
    expect(sends()).toHaveLength(1);
  });

  it('sends the amount still owed when part was paid after queuing', async () => {
    const { customer, installmentId } = await creditSale(A, 0, 1000);
    await schedule();
    await withTenant(ctx(), tx => collectCustomerPayment(tx, {
      companyId: A, branchId: fx.branches[0].id, customerId: customer.id, amount: '400', financialAccountId: fx.cash.id,
      paymentMethod: 'cash', businessDate: new Date(), collectedBy: fx.user.id,
    }, randomUUID()));
    const message = (await messageFor(installmentId))!;
    expect(await sendOutboundMessage(ctx(), message.id, at(), fetchImpl)).toBe('sent');
    const sent = JSON.parse(sends()[0][1]!.body as string).message as string;
    expect(sent).toContain('Tk 600.00');
    expect(sent).not.toContain('1,000.00');
  });

  it('does not remind a customer who paid in full after queuing', async () => {
    const { customer, installmentId } = await creditSale(A, 0, 1000);
    await schedule();
    await withTenant(ctx(), tx => collectCustomerPayment(tx, {
      companyId: A, branchId: fx.branches[0].id, customerId: customer.id, amount: '1000', financialAccountId: fx.cash.id,
      paymentMethod: 'cash', businessDate: new Date(), collectedBy: fx.user.id,
    }, randomUUID()));
    const message = (await messageFor(installmentId))!;
    expect(await sendOutboundMessage(ctx(), message.id, at(), fetchImpl)).toBe('skipped');
    expect(await messageFor(installmentId)).toMatchObject({ status: 'skipped', lastErrorCode: 'paid' });
    expect(sends()).toHaveLength(0);
  });

  it('cancels a reminder whose due date was moved', async () => {
    const { installmentId } = await creditSale(A, 0);
    await schedule();
    await db.installment.update({ where: { id: installmentId }, data: { dueDate: new Date(`${addDays(today(), 10)}T00:00:00Z`) } });
    const message = (await messageFor(installmentId))!;
    expect(await sendOutboundMessage(ctx(), message.id, at(), fetchImpl)).toBe('cancelled');
    expect(await messageFor(installmentId)).toMatchObject({ status: 'cancelled', lastErrorCode: 'due_date_changed' });
    expect(sends()).toHaveLength(0);
  });

  it('marks a timed-out send unknown and never sends it again', async () => {
    const { installmentId } = await creditSale(A, 0);
    await schedule();
    const message = (await messageFor(installmentId))!;
    behaviour = 'timeout';
    expect(await sendOutboundMessage(ctx(), message.id, at(), fetchImpl)).toBe('unknown');
    behaviour = 'accept';
    expect(await sendOutboundMessage(ctx(), message.id, at(60), fetchImpl)).toBe('not_claimed');
    expect(await sendableMessageIds(ctx(), at(60))).not.toContain(message.id);
    expect(sends()).toHaveLength(1);
    expect(await messageFor(installmentId)).toMatchObject({ status: 'unknown', failureCategory: 'ambiguous' });
  });

  it('retries a temporary refusal later, not immediately', async () => {
    const { installmentId } = await creditSale(A, 0);
    await schedule();
    const message = (await messageFor(installmentId))!;
    behaviour = 'unavailable';
    expect(await sendOutboundMessage(ctx(), message.id, at(), fetchImpl)).toBe('retry');
    expect(await sendOutboundMessage(ctx(), message.id, at(), fetchImpl)).toBe('not_claimed');
    behaviour = 'accept';
    expect(await sendOutboundMessage(ctx(), message.id, at(0, 2), fetchImpl)).toBe('not_claimed'); // hour 0 is before 'at()'
    expect(await sendOutboundMessage(ctx(), message.id, at(10, 2), fetchImpl)).toBe('sent');
    expect(sends()).toHaveLength(2);
  });

  it('turns a send interrupted by a crash into unknown, never resent', async () => {
    const { installmentId } = await creditSale(A, 0);
    await schedule();
    const message = (await messageFor(installmentId))!;
    await db.outboundMessage.update({ where: { id: message.id }, data: { status: 'sending', claimedAt: at() } });
    expect(await recoverInterruptedSends(ctx(), at(10, 5))).toBe(0); // still within the grace period
    expect(await recoverInterruptedSends(ctx(), at(10, 11))).toBeGreaterThanOrEqual(1);
    expect(await messageFor(installmentId)).toMatchObject({ status: 'unknown', lastErrorCode: 'interrupted_during_send' });
  });

  it('records delivery from the provider\'s report', async () => {
    const { installmentId } = await creditSale(A, 0);
    await schedule();
    const message = (await messageFor(installmentId))!;
    await sendOutboundMessage(ctx(), message.id, at(), fetchImpl);
    await pollDeliveryReports(ctx(), at(10, 6), fetchImpl);
    expect(await messageFor(installmentId)).toMatchObject({ status: 'delivered', providerStatus: 'DELIVERED' });
  });

  it('holds a company to one reminder a day per customer', async () => {
    const phone = uniquePhone();
    const first = await creditSale(A, 0, 1000, phone);
    const second = await creditSale(A, 0, 1000, phone);
    await schedule();
    const m1 = (await messageFor(first.installmentId))!;
    const m2 = (await messageFor(second.installmentId))!;
    expect(await sendOutboundMessage(ctx(), m1.id, at(), fetchImpl)).toBe('sent');
    expect(await sendOutboundMessage(ctx(), m2.id, at(), fetchImpl)).toBe('skipped');
    expect(await messageFor(second.installmentId)).toMatchObject({ lastErrorCode: 'customer_daily_limit' });
  });
});

describe('tenancy', () => {
  it('never lets one company claim or send another\'s message', async () => {
    const { installmentId } = await creditSale(A, 0);
    await schedule();
    const message = (await messageFor(installmentId))!;
    expect(await sendOutboundMessage(ctx(B), message.id, at(), fetchImpl)).toBe('not_claimed');
    expect(await messageFor(installmentId)).toMatchObject({ status: 'queued' });
    expect(sends()).toHaveLength(0);
  });

  it('fails, without sending, for a company with no SMS account of its own', async () => {
    const { installmentId } = await creditSale(B, 0);
    await schedule(B);
    const message = (await messageFor(installmentId))!;
    expect(await sendOutboundMessage(ctx(B), message.id, at(), fetchImpl)).toBe('failed');
    expect(await messageFor(installmentId)).toMatchObject({ status: 'failed', lastErrorCode: 'sms_account_not_configured' });
    expect(sends()).toHaveLength(0);
  });
});
