// Collection follow-through (blueprint §5.11A, Phase 3): promises to pay,
// follow-up tasks and changes to an installment's contractual due date.
//
// A promise never changes the due date: the installment keeps its
// contractual date (aging, reminders) and the promise keeps its own. Whether a
// promise was kept is derived, never stored: the posted collections on the
// promised sale (or installment) received between recording the promise and
// the end of the promised day. A reversed payment therefore turns a kept
// promise back into an open or broken one.
//
// Changing a due date is a separate, audited act: the old and new dates go to
// the append-only installment_due_date_changes, pending reminder stages for
// the old date are cancelled, and the planner schedules the new ones.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/errors/codes';
import { reportSqlScope } from '@/reports/sqlScope';
import { installmentBalances, OPEN_SALE_STATUSES } from './balances';
import { addDays, dateFromIso, isoFromDate, localDate, zonedMidnight, type IsoDate } from './calendar';

type Tx = Prisma.TransactionClient;
const dec = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_MAX = 200;
export const PROMISE_HORIZON_DAYS = 180;

async function timezoneOf(tx: Tx, companyId: string) {
  const company = await tx.company.findFirst({ where: { id: companyId }, select: { timezone: true } });
  return company?.timezone ?? 'Asia/Dhaka';
}

function invalid(message: string, status = 400, details: Record<string, unknown> = {}): never {
  throw new DomainError('VALIDATION_FAILED', message, details, status);
}

async function audit(tx: Tx, companyId: string, userId: string, action: string, entityType: string, entityId: string, before: unknown, after: unknown) {
  await tx.auditLog.create({ data: { companyId, userId, correlationId: randomUUID(), action, entityType, entityId,
    beforeValue: before === null ? null : JSON.stringify(before), afterValue: JSON.stringify(after) } });
}

// ── promises ────────────────────────────────────────────────────────────────

export type PromiseStatus = 'open' | 'kept' | 'broken' | 'cancelled';

export interface PromiseRow {
  id: string; customer_id: string; customer_name: string; sale_id: string; reference_no: string;
  installment_id: string | null; installment_no: number | null; original_due_date: string | null;
  promised_date: string; promised_amount: string; collected: string; status: PromiseStatus;
  note: string | null; recorded_by: string; recorded_by_name: string; created_at: Date;
  cancelled_at: Date | null; cancel_reason: string | null;
}

export interface PromiseQuery { ids?: string[]; customerId?: string; saleId?: string; status?: PromiseStatus; cursor?: string; limit?: number }

/**
 * Promises with their derived status, newest first. `collected` counts posted
 * collections on the promised sale (or installment) received from when the
 * promise was recorded until the end of the promised day.
 */
export async function listPromises(tx: Tx, companyId: string, query: PromiseQuery = {}, now = new Date()) {
  const scope = reportSqlScope(companyId);
  const limit = Math.min(Math.max(query.limit ?? 50, 1), PAGE_MAX);
  const filters: Prisma.Sql[] = [];
  if (query.ids) filters.push(query.ids.length ? Prisma.sql`AND cp.id IN (${Prisma.join(query.ids)})` : Prisma.sql`AND 1 = 0`);
  if (query.customerId) filters.push(Prisma.sql`AND cp.customer_id = ${query.customerId}`);
  if (query.saleId) filters.push(Prisma.sql`AND cp.sale_id = ${query.saleId}`);
  if (query.cursor) {
    const [at, id] = query.cursor.split('|');
    const after = new Date(at);
    if (Number.isNaN(after.getTime()) || !id) invalid('Invalid cursor');
    filters.push(Prisma.sql`AND (cp.created_at < ${after} OR (cp.created_at = ${after} AND cp.id < ${id}))`);
  }
  const rows = await tx.$queryRaw<Array<Omit<PromiseRow, 'status' | 'promised_date' | 'original_due_date' | 'promised_amount' | 'collected'> & {
    promised_date: Date; original_due_date: Date | null; deadline_at: Date; promised_amount: Prisma.Decimal; collected: Prisma.Decimal | null }>>`
    SELECT * FROM (
      SELECT cp.id, cp.customer_id, c.name AS customer_name, cp.sale_id, s.reference_no, cp.installment_id, i.installment_no,
             cp.original_due_date, cp.promised_date, cp.deadline_at, cp.promised_amount, cp.note, cp.recorded_by,
             u.name AS recorded_by_name, cp.created_at, cp.cancelled_at, cp.cancel_reason,
             (SELECT SUM(ia.allocated_amount)
                FROM installment_allocations ia
                JOIN installments ii ON ii.id = ia.installment_id AND ii.company_id = ia.company_id
                JOIN payment_allocations pa ON pa.id = ia.payment_allocation_id AND pa.company_id = ia.company_id
                JOIN payments p ON p.id = pa.payment_id AND p.company_id = pa.company_id
               WHERE ii.sale_id = cp.sale_id AND ii.company_id = cp.company_id
                 AND (cp.installment_id IS NULL OR ii.id = cp.installment_id)
                 AND p.payment_status = 'posted'
                 AND p.received_or_paid_at >= cp.created_at AND p.received_or_paid_at < cp.deadline_at) AS collected
        FROM collection_promises cp
        JOIN sales s ON s.id = cp.sale_id AND s.company_id = cp.company_id
        JOIN customers c ON c.id = cp.customer_id AND c.company_id = cp.company_id
        JOIN users u ON u.id = cp.recorded_by
        LEFT JOIN installments i ON i.id = cp.installment_id AND i.company_id = cp.company_id
       WHERE cp.company_id = ${scope.companyId}
         ${scope.branch('s.branch_id')}
         ${Prisma.join(filters, ' ')}
    ) t
    WHERE ${query.status === 'cancelled' ? Prisma.sql`t.cancelled_at IS NOT NULL`
      : query.status === 'kept' ? Prisma.sql`t.cancelled_at IS NULL AND COALESCE(t.collected, 0) >= t.promised_amount`
      : query.status === 'broken' ? Prisma.sql`t.cancelled_at IS NULL AND COALESCE(t.collected, 0) < t.promised_amount AND t.deadline_at <= ${now}`
      : query.status === 'open' ? Prisma.sql`t.cancelled_at IS NULL AND COALESCE(t.collected, 0) < t.promised_amount AND t.deadline_at > ${now}`
      : Prisma.sql`1 = 1`}
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT ${limit + 1}`;
  const page = rows.slice(0, limit);
  const items: PromiseRow[] = page.map(r => {
    const collected = dec(r.collected);
    const amount = dec(r.promised_amount);
    const status: PromiseStatus = r.cancelled_at ? 'cancelled' : collected.gte(amount) ? 'kept' : r.deadline_at.getTime() <= now.getTime() ? 'broken' : 'open';
    return {
      id: r.id, customer_id: r.customer_id, customer_name: r.customer_name, sale_id: r.sale_id, reference_no: r.reference_no,
      installment_id: r.installment_id, installment_no: r.installment_no === null ? null : Number(r.installment_no),
      original_due_date: r.original_due_date ? isoFromDate(r.original_due_date) : null, promised_date: isoFromDate(r.promised_date),
      promised_amount: amount.toFixed(2), collected: Prisma.Decimal.min(collected, amount).toFixed(2), status,
      note: r.note, recorded_by: r.recorded_by, recorded_by_name: r.recorded_by_name, created_at: r.created_at,
      cancelled_at: r.cancelled_at, cancel_reason: r.cancel_reason,
    };
  });
  const last = page[page.length - 1];
  return { items, has_more: rows.length > limit, next_cursor: rows.length > limit && last ? `${last.created_at.toISOString()}|${last.id}` : null };
}

export interface RecordPromiseInput { saleId: string; installmentId?: string; promisedDate: string; amount: string; note?: string }

export async function recordPromise(tx: Tx, companyId: string, input: RecordPromiseInput, userId: string, now = new Date()) {
  if (!ISO.test(input.promisedDate)) invalid('The promised date must be YYYY-MM-DD');
  if (!/^\d{1,15}(\.\d{1,2})?$/.test(input.amount) || dec(input.amount).lte(0)) invalid('The promised amount must be a positive amount with at most two decimals');
  const timezone = await timezoneOf(tx, companyId);
  const today = localDate(timezone, now);
  if (input.promisedDate < today) invalid('The promised date cannot be in the past');
  if (input.promisedDate > addDays(today, PROMISE_HORIZON_DAYS)) invalid(`The promised date must be within ${PROMISE_HORIZON_DAYS} days`);

  const sale = await tx.sale.findFirst({ where: { id: input.saleId, companyId }, select: { id: true, customerId: true, saleStatus: true } });
  if (!sale || !sale.customerId) throw new DomainError('RESOURCE_NOT_FOUND', 'Sale not found', {}, 404);
  if (!OPEN_SALE_STATUSES.includes(sale.saleStatus as never)) invalid('The sale is not open', 409);
  // Serialise promises on the same sale.
  await tx.$queryRaw`SELECT id FROM sales WHERE id = ${sale.id} AND company_id = ${companyId} FOR UPDATE`;

  const balances = await installmentBalances(tx, companyId, { saleIds: [sale.id] });
  let owed: Prisma.Decimal;
  let originalDueDate: Date | null = null;
  if (input.installmentId) {
    const installment = balances.find(b => b.installmentId === input.installmentId);
    if (!installment) throw new DomainError('RESOURCE_NOT_FOUND', 'Installment not found on this sale', {}, 404);
    owed = installment.outstanding;
    originalDueDate = installment.dueDate;
  } else {
    owed = balances.reduce((sum, b) => sum.plus(b.outstanding), new Prisma.Decimal(0));
  }
  if (owed.lte(0)) invalid('Nothing is owed here', 409);
  if (dec(input.amount).gt(owed)) invalid(`The promised amount is more than is owed (${owed.toFixed(2)})`, 409, { outstanding: owed.toFixed(2) });

  const open = await listPromises(tx, companyId, { saleId: sale.id, status: 'open', limit: PAGE_MAX }, now);
  const clash = open.items.find(p => !input.installmentId || !p.installment_id || p.installment_id === input.installmentId);
  if (clash) invalid(`An open promise already covers this (due ${clash.promised_date}); cancel it first`, 409, { promise_id: clash.id });

  const promise = await tx.collectionPromise.create({ data: {
    companyId, customerId: sale.customerId, saleId: sale.id, installmentId: input.installmentId ?? null,
    originalDueDate, promisedDate: dateFromIso(input.promisedDate as IsoDate),
    deadlineAt: zonedMidnight(timezone, addDays(input.promisedDate as IsoDate, 1)),
    promisedAmount: input.amount, note: input.note?.trim() || null, recordedBy: userId, createdAt: now,
  } });
  await audit(tx, companyId, userId, 'collection_promise.record', 'collection_promise', promise.id, null,
    { sale_id: sale.id, installment_id: input.installmentId ?? null, promised_date: input.promisedDate, amount: input.amount });
  return promise;
}

export async function cancelPromise(tx: Tx, companyId: string, promiseId: string, reason: string, userId: string, now = new Date()) {
  if (!reason.trim()) invalid('Give a reason');
  const [current] = (await listPromises(tx, companyId, { ids: [promiseId] }, now)).items;
  if (!current) throw new DomainError('RESOURCE_NOT_FOUND', 'Promise not found', {}, 404);
  if (current.status !== 'open') invalid(`Only an open promise can be cancelled (this one is ${current.status})`, 409);
  const moved = await tx.collectionPromise.updateMany({ where: { id: promiseId, companyId, cancelledAt: null },
    data: { cancelledAt: now, cancelledBy: userId, cancelReason: reason.trim().slice(0, 190) } });
  if (moved.count !== 1) invalid('The promise changed; reload', 409);
  await audit(tx, companyId, userId, 'collection_promise.cancel', 'collection_promise', promiseId, { status: 'open' }, { status: 'cancelled', reason });
}

// ── follow-ups ──────────────────────────────────────────────────────────────

export const FOLLOW_UP_TYPES = ['call', 'visit', 'send_reminder', 'call_later', 'payment_promised', 'escalate', 'other'] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];

export interface CreateFollowUpInput {
  customerId: string; saleId?: string; installmentId?: string; promiseId?: string;
  type: FollowUpType; dueAt: Date; assignedTo?: string; note?: string;
}

export async function createFollowUp(tx: Tx, companyId: string, input: CreateFollowUpInput, userId: string) {
  const customer = await tx.customer.findFirst({ where: { id: input.customerId, companyId }, select: { id: true } });
  if (!customer) throw new DomainError('RESOURCE_NOT_FOUND', 'Customer not found', {}, 404);
  if (input.saleId) {
    const sale = await tx.sale.findFirst({ where: { id: input.saleId, companyId, customerId: input.customerId }, select: { id: true } });
    if (!sale) throw new DomainError('RESOURCE_NOT_FOUND', 'Sale not found for this customer', {}, 404);
  }
  if (input.installmentId) {
    if (!input.saleId) invalid('An installment needs its sale');
    const installment = await tx.installment.findFirst({ where: { id: input.installmentId, companyId, saleId: input.saleId }, select: { id: true } });
    if (!installment) throw new DomainError('RESOURCE_NOT_FOUND', 'Installment not found on this sale', {}, 404);
  }
  if (input.promiseId) {
    const promise = await tx.collectionPromise.findFirst({ where: { id: input.promiseId, companyId, customerId: input.customerId }, select: { id: true } });
    if (!promise) throw new DomainError('RESOURCE_NOT_FOUND', 'Promise not found for this customer', {}, 404);
  }
  if (input.assignedTo) {
    const user = await tx.user.findFirst({ where: { id: input.assignedTo, companyId, isActive: true }, select: { id: true } });
    if (!user) invalid('The assignee is not an active user of this company');
  }
  const followUp = await tx.collectionFollowUp.create({ data: {
    companyId, customerId: input.customerId, saleId: input.saleId ?? null, installmentId: input.installmentId ?? null,
    promiseId: input.promiseId ?? null, followUpType: input.type, dueAt: input.dueAt, assignedTo: input.assignedTo ?? null,
    note: input.note?.trim() || null, createdBy: userId,
  } });
  await audit(tx, companyId, userId, 'collection_follow_up.create', 'collection_follow_up', followUp.id, null,
    { customer_id: input.customerId, type: input.type, due_at: input.dueAt, assigned_to: input.assignedTo ?? null });
  return followUp;
}

export async function closeFollowUp(tx: Tx, companyId: string, id: string, outcome: 'done' | 'cancelled', outcomeNote: string | undefined, userId: string, now = new Date()) {
  const moved = await tx.collectionFollowUp.updateMany({ where: { id, companyId, status: 'open' },
    data: { status: outcome, closedAt: now, closedBy: userId, outcomeNote: outcomeNote?.trim() || null } });
  if (moved.count !== 1) {
    const exists = await tx.collectionFollowUp.findFirst({ where: { id, companyId }, select: { status: true } });
    if (!exists) throw new DomainError('RESOURCE_NOT_FOUND', 'Follow-up not found', {}, 404);
    invalid(`This follow-up is already ${exists.status}`, 409);
  }
  await audit(tx, companyId, userId, `collection_follow_up.${outcome === 'done' ? 'complete' : 'cancel'}`, 'collection_follow_up', id, { status: 'open' }, { status: outcome, note: outcomeNote ?? null });
}

export type FollowUpWindow = 'overdue' | 'today' | 'upcoming' | 'all';
export interface FollowUpQuery { status?: 'open' | 'done' | 'cancelled'; window?: FollowUpWindow; assignedTo?: string; customerId?: string; cursor?: string; limit?: number }

export async function listFollowUps(tx: Tx, companyId: string, query: FollowUpQuery, now = new Date()) {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), PAGE_MAX);
  const timezone = await timezoneOf(tx, companyId);
  const today = localDate(timezone, now);
  const start = zonedMidnight(timezone, today);
  const end = zonedMidnight(timezone, addDays(today, 1));
  const dueAt = query.window === 'overdue' ? { lt: start } : query.window === 'today' ? { gte: start, lt: end }
    : query.window === 'upcoming' ? { gte: end } : undefined;
  const rows = await tx.collectionFollowUp.findMany({
    where: { companyId, ...(query.status ? { status: query.status } : {}), ...(dueAt ? { dueAt } : {}),
      ...(query.assignedTo ? { assignedTo: query.assignedTo } : {}), ...(query.customerId ? { customerId: query.customerId } : {}) },
    include: { customer: { select: { id: true, name: true } }, sale: { select: { id: true, referenceNo: true } },
      installment: { select: { id: true, installmentNo: true } }, assignee: { select: { id: true, name: true } },
      creator: { select: { id: true, name: true } } },
    orderBy: [{ dueAt: query.status === 'open' || !query.status ? 'asc' : 'desc' }, { id: 'asc' }],
    take: limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, limit);
  return { items: page, has_more: rows.length > limit, next_cursor: rows.length > limit ? page[page.length - 1].id : null };
}

// ── due-date changes ────────────────────────────────────────────────────────

export async function rescheduleInstallment(tx: Tx, companyId: string, installmentId: string, newDueDate: string, reason: string, userId: string, now = new Date()) {
  if (!ISO.test(newDueDate)) invalid('The new due date must be YYYY-MM-DD');
  if (!reason.trim()) invalid('Give a reason for changing the due date');
  const target = await tx.installment.findFirst({ where: { id: installmentId, companyId },
    select: { id: true, saleId: true, sale: { select: { saleStatus: true } } } });
  if (!target) throw new DomainError('RESOURCE_NOT_FOUND', 'Installment not found', {}, 404);
  // Lock the sale's schedule, then read it.
  await tx.$queryRaw`SELECT id FROM installments WHERE sale_id = ${target.saleId} AND company_id = ${companyId} FOR UPDATE`;
  const schedule = await tx.installment.findMany({ where: { saleId: target.saleId, companyId, status: 'scheduled' }, orderBy: { installmentNo: 'asc' } });
  const index = schedule.findIndex(i => i.id === installmentId);
  if (index < 0) invalid('Only a scheduled installment can be rescheduled', 409);
  if (!OPEN_SALE_STATUSES.includes(target.sale.saleStatus as never)) invalid('The sale is not open', 409);
  const current = schedule[index];
  const oldIso = isoFromDate(current.dueDate);
  if (oldIso === newDueDate) invalid('That is already the due date');
  const timezone = await timezoneOf(tx, companyId);
  const today = localDate(timezone, now);
  if (newDueDate < today) invalid('The new due date cannot be in the past');
  const [balance] = await installmentBalances(tx, companyId, { installmentIds: [installmentId] });
  if (!balance || balance.outstanding.lte(0)) invalid('This installment is already paid', 409);
  const previous = schedule[index - 1];
  const next = schedule[index + 1];
  if (previous && newDueDate <= isoFromDate(previous.dueDate)) invalid(`Must be after installment ${previous.installmentNo} (${isoFromDate(previous.dueDate)})`);
  if (next && newDueDate >= isoFromDate(next.dueDate)) invalid(`Must be before installment ${next.installmentNo} (${isoFromDate(next.dueDate)})`);

  const newDate = dateFromIso(newDueDate as IsoDate);
  await tx.installment.update({ where: { id: installmentId }, data: { dueDate: newDate } });
  await tx.installmentDueDateChange.create({ data: {
    companyId, installmentId, saleId: current.saleId, oldDueDate: current.dueDate, newDueDate: newDate,
    reason: reason.trim(), changedBy: userId, changedAt: now,
  } });
  // Reminders planned for the old date no longer apply; queued ones are
  // cancelled at send time by the due-date check.
  const cancelled = await tx.reminderOccurrence.updateMany({
    where: { companyId, installmentId, status: 'pending', dueDate: current.dueDate },
    data: { status: 'cancelled', skipReason: 'due_date_changed' },
  });
  await audit(tx, companyId, userId, 'installment.reschedule', 'installment', installmentId, { due_date: oldIso }, { due_date: newDueDate, reason: reason.trim() });
  return { installmentId, oldDueDate: oldIso, newDueDate, cancelledReminders: cancelled.count };
}

export async function dueDateHistory(tx: Tx, companyId: string, by: { saleIds?: string[]; installmentId?: string }) {
  return tx.installmentDueDateChange.findMany({
    where: { companyId, ...(by.installmentId ? { installmentId: by.installmentId } : {}), ...(by.saleIds ? { saleId: { in: by.saleIds } } : {}) },
    include: { changer: { select: { name: true } }, installment: { select: { installmentNo: true } }, sale: { select: { referenceNo: true } } },
    orderBy: { changedAt: 'desc' }, take: PAGE_MAX,
  });
}
