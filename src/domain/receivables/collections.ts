// Read side of collection management: the overview, the worklist, the
// customer timeline and SMS history (blueprint §5.11A, Phase 2).
//
// Amounts come from openInstallmentsCte (balances.ts) -- the same derivation
// as installmentBalances, computed in the database so a company's whole book
// never has to be loaded. The total receivable is the AR control account from
// the ledger, the authoritative figure; the installment totals beside it are
// what the schedules say is still to be collected. Everything is scoped to the
// caller's company and, for branch-limited users, their branches.

import { Prisma } from '@prisma/client';
import { LEDGER_STATUSES } from '@/lib/accounting/trialBalance';
import { decryptString } from '@/lib/crypto';
import { reportSqlScope } from '@/reports/sqlScope';
import { openInstallmentsCte } from './balances';
import { addDays, dateFromIso, localDate, zonedMidnight } from './calendar';
import { maskBdMobile, normalizeBdMobile } from './phone';

type Tx = Prisma.TransactionClient;
const dec = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

/** A stored or entered number that normalizeBdMobile would accept, in SQL. */
const VALID_PHONE = (column: string) =>
  Prisma.sql`(REGEXP_REPLACE(COALESCE(${Prisma.raw(column)}, ''), '[ .()+-]', '') REGEXP '^(0088|88)?01[3-9][0-9]{8}$')`;

export async function companyToday(tx: Tx, companyId: string, now = new Date()) {
  const company = await tx.company.findFirst({ where: { id: companyId }, select: { timezone: true } });
  const timezone = company?.timezone ?? 'Asia/Dhaka';
  return { timezone, today: localDate(timezone, now) };
}

// ── overview ────────────────────────────────────────────────────────────────

export async function collectionOverview(tx: Tx, companyId: string, now = new Date()) {
  const { timezone, today } = await companyToday(tx, companyId, now);
  const todayDate = dateFromIso(today);
  const weekEnd = dateFromIso(addDays(today, 7));
  const since = zonedMidnight(timezone, today);
  const scope = reportSqlScope(companyId);

  const [book] = await tx.$queryRaw<Array<Record<string, bigint | Prisma.Decimal | null>>>`
    ${openInstallmentsCte(companyId)}
    SELECT
      SUM(outstanding) AS scheduled_outstanding,
      SUM(CASE WHEN outstanding > 0 AND due_date = ${todayDate} THEN 1 ELSE 0 END) AS due_today_count,
      SUM(CASE WHEN due_date = ${todayDate} THEN outstanding ELSE 0 END) AS due_today_amount,
      SUM(CASE WHEN outstanding > 0 AND due_date < ${todayDate} THEN 1 ELSE 0 END) AS overdue_count,
      SUM(CASE WHEN due_date < ${todayDate} THEN outstanding ELSE 0 END) AS overdue_amount,
      COUNT(DISTINCT CASE WHEN outstanding > 0 AND due_date < ${todayDate} THEN customer_id END) AS overdue_customers,
      SUM(CASE WHEN outstanding > 0 AND due_date > ${todayDate} AND due_date <= ${weekEnd} THEN 1 ELSE 0 END) AS upcoming_count,
      SUM(CASE WHEN due_date > ${todayDate} AND due_date <= ${weekEnd} THEN outstanding ELSE 0 END) AS upcoming_amount
    FROM bal`;

  const [phones] = await tx.$queryRaw<Array<{ missing: bigint; invalid: bigint }>>`
    ${openInstallmentsCte(companyId)}
    , owing AS (SELECT DISTINCT customer_id, phone_snapshot FROM bal WHERE outstanding > 0 AND customer_id IS NOT NULL)
    SELECT
      SUM(CASE WHEN NOT ${VALID_PHONE('o.phone_snapshot')} AND NOT ${VALID_PHONE('c.phone')}
               AND COALESCE(o.phone_snapshot, '') = '' AND COALESCE(c.phone, '') = '' THEN 1 ELSE 0 END) AS missing,
      SUM(CASE WHEN NOT ${VALID_PHONE('o.phone_snapshot')} AND NOT ${VALID_PHONE('c.phone')}
               AND (COALESCE(o.phone_snapshot, '') <> '' OR COALESCE(c.phone, '') <> '') THEN 1 ELSE 0 END) AS invalid
    FROM owing o JOIN customers c ON c.id = o.customer_id AND c.company_id = ${companyId}`;

  // Collected against dues today: installment allocations of live payments.
  const [collected] = await tx.$queryRaw<Array<{ amount: Prisma.Decimal | null }>>`
    SELECT SUM(ia.allocated_amount) AS amount
    FROM installment_allocations ia
    JOIN payment_allocations pa ON pa.id = ia.payment_allocation_id AND pa.company_id = ia.company_id
    JOIN payments p ON p.id = pa.payment_id AND p.company_id = pa.company_id
    WHERE ia.company_id = ${companyId} AND ia.allocated_at >= ${since} AND p.payment_status = 'posted'
      ${scope.branch('p.branch_id')}`;

  const sms = await tx.outboundMessage.groupBy({
    by: ['status'], where: { companyId, channel: 'sms', createdAt: { gte: since } }, _count: { _all: true },
  });
  const needsAttention = await tx.outboundMessage.groupBy({
    by: ['status'], where: { companyId, channel: 'sms', status: { in: ['unknown', 'failed', 'dead_letter'] }, createdAt: { gte: new Date(since.getTime() - 7 * 86_400_000) } },
    _count: { _all: true },
  });

  const policy = await tx.accountingPolicy.findUnique({ where: { companyId }, select: { arAccountId: true } });
  const ar = policy ? await tx.journalLine.aggregate({
    where: { companyId, chartOfAccountId: policy.arAccountId, journalEntry: { companyId, status: { in: [...LEDGER_STATUSES] } } },
    _sum: { debitBase: true, creditBase: true },
  }) : null;

  const count = (rows: Array<{ status: string; _count: { _all: number } }>, status: string) => rows.find(r => r.status === status)?._count._all ?? 0;
  return {
    as_of: today,
    ledger_receivable: ar ? dec(ar._sum.debitBase).minus(dec(ar._sum.creditBase)).toFixed(2) : null,
    scheduled_outstanding: dec(book?.scheduled_outstanding as Prisma.Decimal).toFixed(2),
    due_today: { installments: n(book?.due_today_count as bigint), amount: dec(book?.due_today_amount as Prisma.Decimal).toFixed(2) },
    overdue: { installments: n(book?.overdue_count as bigint), customers: n(book?.overdue_customers as bigint), amount: dec(book?.overdue_amount as Prisma.Decimal).toFixed(2) },
    upcoming_7_days: { installments: n(book?.upcoming_count as bigint), amount: dec(book?.upcoming_amount as Prisma.Decimal).toFixed(2) },
    collected_today: dec(collected?.amount).toFixed(2),
    customers_without_valid_phone: { missing: n(phones?.missing), invalid: n(phones?.invalid) },
    sms_today: {
      queued: count(sms, 'queued') + count(sms, 'sending'), sent: count(sms, 'sent'), delivered: count(sms, 'delivered'),
      failed: count(sms, 'failed') + count(sms, 'dead_letter'), unknown: count(sms, 'unknown'), skipped: count(sms, 'skipped') + count(sms, 'cancelled'),
    },
    sms_needing_attention_7_days: {
      unknown: count(needsAttention, 'unknown'), failed: count(needsAttention, 'failed'), dead_letter: count(needsAttention, 'dead_letter'),
    },
  };
}

// ── worklist ────────────────────────────────────────────────────────────────

export type WorklistView = 'due_today' | 'overdue' | 'upcoming' | 'all_open';
export const WORKLIST_PAGE_MAX = 200;

export interface WorklistQuery {
  view: WorklistView;
  days?: number;           // upcoming window, default 7
  q?: string;              // customer name, invoice number or mobile digits
  billerId?: string;
  branchId?: string;
  cursor?: string;         // "YYYY-MM-DD|installmentId"
  limit?: number;
}

export async function collectionWorklist(tx: Tx, companyId: string, query: WorklistQuery, now = new Date()) {
  const { today } = await companyToday(tx, companyId, now);
  const todayDate = dateFromIso(today);
  const limit = Math.min(Math.max(query.limit ?? 50, 1), WORKLIST_PAGE_MAX);
  const filters: Prisma.Sql[] = [Prisma.sql`b.outstanding > 0`];
  if (query.view === 'due_today') filters.push(Prisma.sql`b.due_date = ${todayDate}`);
  if (query.view === 'overdue') filters.push(Prisma.sql`b.due_date < ${todayDate}`);
  if (query.view === 'upcoming') {
    filters.push(Prisma.sql`b.due_date > ${todayDate} AND b.due_date <= ${dateFromIso(addDays(today, Math.min(Math.max(query.days ?? 7, 1), 90)))}`);
  }
  if (query.billerId) filters.push(Prisma.sql`b.biller_id = ${query.billerId}`);
  if (query.branchId) filters.push(Prisma.sql`b.branch_id = ${query.branchId}`);
  if (query.q?.trim()) {
    const q = query.q.trim();
    const like = `%${q.replace(/[%_\\]/g, m => `\\${m}`)}%`;
    const digits = q.replace(/\D/g, '');
    filters.push(digits.length >= 4
      ? Prisma.sql`(c.name LIKE ${like} OR b.reference_no LIKE ${like} OR REGEXP_REPLACE(COALESCE(c.phone, ''), '[^0-9]', '') LIKE ${`%${digits.slice(-10)}%`} OR COALESCE(b.phone_snapshot, '') LIKE ${`%${digits.slice(-10)}%`})`
      : Prisma.sql`(c.name LIKE ${like} OR b.reference_no LIKE ${like})`);
  }
  if (query.cursor) {
    const [date, id] = query.cursor.split('|');
    if (date && id) filters.push(Prisma.sql`(b.due_date, b.installment_id) > (${dateFromIso(date)}, ${id})`);
  }

  const rows = await tx.$queryRaw<Array<{
    installment_id: string; sale_id: string; reference_no: string; customer_id: string; customer_name: string; customer_phone: string | null;
    phone_snapshot: string | null; biller_name: string | null; branch_id: string; installment_no: number; due_date: Date; amount: Prisma.Decimal;
    collected: Prisma.Decimal; outstanding: Prisma.Decimal; reminders_enabled: number | boolean;
    last_payment_at: Date | null; last_sms_status: string | null; last_sms_at: Date | null;
  }>>`
    ${openInstallmentsCte(companyId)}
    SELECT b.installment_id, b.sale_id, b.reference_no, b.customer_id, c.name AS customer_name, c.phone AS customer_phone,
           b.phone_snapshot, u.name AS biller_name, b.branch_id, b.installment_no, b.due_date, b.amount, b.collected, b.outstanding,
           b.reminders_enabled,
           (SELECT MAX(p.business_date) FROM payments p
             WHERE p.company_id = ${companyId} AND p.customer_id = b.customer_id AND p.payment_status = 'posted'
               AND p.payment_type = 'sale_receipt' AND p.direction = 'incoming') AS last_payment_at,
           (SELECT m.status FROM outbound_messages m WHERE m.company_id = ${companyId} AND m.installment_id = b.installment_id
             ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_sms_status,
           (SELECT m.created_at FROM outbound_messages m WHERE m.company_id = ${companyId} AND m.installment_id = b.installment_id
             ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_sms_at
    FROM bal b
    JOIN customers c ON c.id = b.customer_id AND c.company_id = ${companyId}
    LEFT JOIN users u ON u.id = b.biller_id AND u.company_id = ${companyId}
    WHERE ${Prisma.join(filters, ' AND ')}
    ORDER BY b.due_date, b.installment_id
    LIMIT ${limit + 1}`;

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    as_of: today,
    items: page.map(r => {
      const phone = normalizeBdMobile(r.phone_snapshot) ?? normalizeBdMobile(r.customer_phone);
      const due = r.due_date.toISOString().slice(0, 10);
      return {
        installment_id: r.installment_id, sale_id: r.sale_id, invoice_no: r.reference_no, installment_no: Number(r.installment_no),
        customer: { id: r.customer_id, name: r.customer_name },
        phone_masked: phone ? maskBdMobile(phone) : null,
        phone_status: phone ? 'ok' : (r.phone_snapshot || r.customer_phone ? 'invalid' : 'missing'),
        salesperson: r.biller_name, branch_id: r.branch_id,
        due_date: due, amount: dec(r.amount).toFixed(2), collected: dec(r.collected).toFixed(2), outstanding: dec(r.outstanding).toFixed(2),
        days_overdue: Math.max(0, Math.round((todayDate.getTime() - r.due_date.getTime()) / 86_400_000)),
        reminders_enabled: Boolean(Number(r.reminders_enabled)),
        last_payment_at: r.last_payment_at, last_sms: r.last_sms_status ? { status: r.last_sms_status, at: r.last_sms_at } : null,
      };
    }),
    has_more: rows.length > limit,
    next_cursor: rows.length > limit && last ? `${last.due_date.toISOString().slice(0, 10)}|${last.installment_id}` : null,
  };
}

// ── customer timeline ───────────────────────────────────────────────────────

export interface TimelineEvent { at: Date; kind: string; title: string; amount?: string; reference?: string; status?: string; detail?: string }
const TIMELINE_MAX = 200;

/** A customer's collection history, newest first: links to the records, never copies of them. */
export async function customerCollectionTimeline(tx: Tx, companyId: string, customerId: string): Promise<TimelineEvent[]> {
  const [sales, collections, messages] = await Promise.all([
    tx.sale.findMany({
      where: { companyId, customerId, installments: { some: {} } },
      select: { referenceNo: true, grandTotal: true, postedAt: true, businessDate: true, saleStatus: true,
        installments: { select: { installmentNo: true, dueDate: true, amount: true }, orderBy: { installmentNo: 'asc' } } },
      orderBy: { businessDate: 'desc' }, take: 50,
    }),
    tx.payment.findMany({
      where: { companyId, customerId, allocations: { some: { installments: { some: {} } } } },
      select: { referenceNo: true, amount: true, paymentStatus: true, businessDate: true, receivedOrPaidAt: true, paymentMethod: true,
        reversingPayment: { select: { referenceNo: true, createdAt: true } } },
      orderBy: { businessDate: 'desc' }, take: 100,
    }),
    tx.outboundMessage.findMany({
      where: { companyId, customerId },
      select: { status: true, triggerSource: true, createdAt: true, sentAt: true, deliveredAt: true, lastErrorCode: true,
        installment: { select: { installmentNo: true } }, sale: { select: { referenceNo: true } } },
      orderBy: { createdAt: 'desc' }, take: 100,
    }),
  ]);

  const events: TimelineEvent[] = [];
  for (const s of sales) {
    events.push({ at: s.postedAt ?? s.businessDate, kind: 'credit_sale', title: `Credit sale ${s.referenceNo}`, amount: dec(s.grandTotal).toFixed(2), reference: s.referenceNo, status: s.saleStatus,
      detail: s.installments.map(i => `#${i.installmentNo} ${i.dueDate.toISOString().slice(0, 10)} ${dec(i.amount).toFixed(2)}`).join(', ') });
  }
  for (const p of collections) {
    events.push({ at: p.receivedOrPaidAt, kind: 'collection', title: `Payment ${p.referenceNo} (${p.paymentMethod})`, amount: dec(p.amount).toFixed(2), reference: p.referenceNo, status: p.paymentStatus });
    for (const r of p.reversingPayment) events.push({ at: r.createdAt, kind: 'payment_reversed', title: `Payment ${p.referenceNo} reversed by ${r.referenceNo}`, reference: r.referenceNo });
  }
  for (const m of messages) {
    const about = m.sale ? `${m.sale.referenceNo}${m.installment ? ` #${m.installment.installmentNo}` : ''}` : '';
    events.push({ at: m.deliveredAt ?? m.sentAt ?? m.createdAt, kind: 'sms', title: `${m.triggerSource === 'manual' ? 'Manual' : 'Automatic'} reminder ${about}`.trim(), status: m.status, detail: m.lastErrorCode ?? undefined });
  }
  return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, TIMELINE_MAX);
}

// ── SMS history ─────────────────────────────────────────────────────────────

export interface MessageHistoryQuery { status?: string; trigger?: string; customerId?: string; from?: Date; to?: Date; cursor?: string; limit?: number }

export async function smsHistory(tx: Tx, companyId: string, query: MessageHistoryQuery) {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), WORKLIST_PAGE_MAX);
  const rows = await tx.outboundMessage.findMany({
    where: {
      companyId, channel: 'sms',
      ...(query.status ? { status: query.status } : {}),
      ...(query.trigger ? { triggerSource: query.trigger } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
    },
    select: { id: true, status: true, triggerSource: true, renderedBody: true, encoding: true, segments: true, providerCode: true,
      providerMessageId: true, providerStatus: true, failureCategory: true, lastErrorCode: true, attemptCount: true,
      destinationEncrypted: true, createdAt: true, claimedAt: true, sentAt: true, deliveredAt: true,
      customer: { select: { id: true, name: true } }, sale: { select: { id: true, referenceNo: true } }, installment: { select: { id: true, installmentNo: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, limit);
  return {
    items: page.map(({ destinationEncrypted, ...m }) => {
      let masked: string | null = null;
      try { masked = maskBdMobile(decryptString(Buffer.from(destinationEncrypted, 'base64'))); } catch { masked = null; }
      return { ...m, to_masked: masked };
    }),
    has_more: rows.length > limit,
    next_cursor: rows.length > limit ? page[page.length - 1].id : null,
  };
}
