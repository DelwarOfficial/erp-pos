// Collection reports and the due calendar (blueprint §5.11A, Phase 3).
//
// Facts only. "Collected within N days after a reminder" counts collections on
// an installment that had a reminder sent to the customer in the N days
// before; it is a correlation, not proof that the reminder caused the payment,
// and the screens say so.
//
// Days are the company's local calendar days. Timestamps are grouped by
// shifting them by the company's UTC offset at the start of the range (exact
// for Asia/Dhaka, which has no daylight saving).

import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';
import { reportSqlScope } from '@/reports/sqlScope';
import { openInstallmentsCte } from './balances';
import { addDays, dateFromIso, daysBetween, isoFromDate, localDate, zonedMidnight, type IsoDate } from './calendar';

type Tx = Prisma.TransactionClient;
const dec = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const REPORT_MAX_DAYS = 92;
export const REMINDER_ATTRIBUTION_DAYS = 3;

async function companyClock(tx: Tx, companyId: string, now: Date) {
  const company = await tx.company.findFirst({ where: { id: companyId }, select: { timezone: true } });
  const timezone = company?.timezone ?? 'Asia/Dhaka';
  return { timezone, today: localDate(timezone, now) };
}

/** Minutes to add to a UTC timestamp to get the company's local time, at `date`. */
function offsetMinutes(timezone: string, date: IsoDate) {
  return Math.round((dateFromIso(date).getTime() - zonedMidnight(timezone, date).getTime()) / 60_000);
}

function days(from: IsoDate, to: IsoDate) {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const localDay = (column: string, offset: number) => Prisma.sql`DATE(DATE_ADD(${Prisma.raw(column)}, INTERVAL ${offset} MINUTE))`;
const isoOf = (v: Date | string) => (typeof v === 'string' ? v.slice(0, 10) : isoFromDate(v));

export async function collectionReport(tx: Tx, companyId: string, range: { from: string; to: string }, now = new Date()) {
  if (!ISO.test(range.from) || !ISO.test(range.to) || range.from > range.to) {
    throw new DomainError('VALIDATION_FAILED', 'Give from and to as YYYY-MM-DD, from not after to', {}, 400);
  }
  if (daysBetween(range.from, range.to) >= REPORT_MAX_DAYS) throw new DomainError('VALIDATION_FAILED', `At most ${REPORT_MAX_DAYS} days`, {}, 400);
  const scope = reportSqlScope(companyId);
  const { timezone, today } = await companyClock(tx, companyId, now);
  const offset = offsetMinutes(timezone, range.from);
  const start = zonedMidnight(timezone, range.from);
  const end = zonedMidnight(timezone, addDays(range.to, 1));
  const todayDate = dateFromIso(today);

  const [aging] = await tx.$queryRaw<Array<Record<string, Prisma.Decimal | bigint | null>>>`
    ${openInstallmentsCte(companyId)}
    SELECT
      SUM(CASE WHEN due_date >= ${todayDate} THEN outstanding ELSE 0 END) AS not_due,
      SUM(CASE WHEN due_date < ${todayDate} AND DATEDIFF(${todayDate}, due_date) BETWEEN 1 AND 30 THEN outstanding ELSE 0 END) AS d1_30,
      SUM(CASE WHEN DATEDIFF(${todayDate}, due_date) BETWEEN 31 AND 60 THEN outstanding ELSE 0 END) AS d31_60,
      SUM(CASE WHEN DATEDIFF(${todayDate}, due_date) BETWEEN 61 AND 90 THEN outstanding ELSE 0 END) AS d61_90,
      SUM(CASE WHEN DATEDIFF(${todayDate}, due_date) > 90 THEN outstanding ELSE 0 END) AS d91_plus
    FROM bal`;

  const dueRows = await tx.$queryRaw<Array<{ day: Date; amount: Prisma.Decimal; installments: bigint }>>`
    SELECT i.due_date AS day, SUM(i.amount) AS amount, COUNT(*) AS installments
      FROM installments i JOIN sales s ON s.id = i.sale_id AND s.company_id = i.company_id
     WHERE i.company_id = ${scope.companyId} AND i.status = 'scheduled'
       AND i.due_date >= ${dateFromIso(range.from)} AND i.due_date <= ${dateFromIso(range.to)}
       ${scope.branch('s.branch_id')}
     GROUP BY i.due_date`;

  // Collections on installments, by the day they were received.
  const collectedRows = await tx.$queryRaw<Array<{ day: Date | string; amount: Prisma.Decimal; after_reminder: Prisma.Decimal | null }>>`
    SELECT ${localDay('p.received_or_paid_at', offset)} AS day, SUM(ia.allocated_amount) AS amount,
           SUM(CASE WHEN EXISTS (
                 SELECT 1 FROM outbound_messages m
                  WHERE m.company_id = ia.company_id AND m.installment_id = ia.installment_id
                    AND m.status IN ('sent', 'delivered') AND m.sent_at <= p.received_or_paid_at
                    AND m.sent_at >= DATE_SUB(p.received_or_paid_at, INTERVAL ${REMINDER_ATTRIBUTION_DAYS} DAY))
               THEN ia.allocated_amount ELSE 0 END) AS after_reminder
      FROM installment_allocations ia
      JOIN installments i ON i.id = ia.installment_id AND i.company_id = ia.company_id
      JOIN sales s ON s.id = i.sale_id AND s.company_id = i.company_id
      JOIN payment_allocations pa ON pa.id = ia.payment_allocation_id AND pa.company_id = ia.company_id
      JOIN payments p ON p.id = pa.payment_id AND p.company_id = pa.company_id
     WHERE ia.company_id = ${scope.companyId} AND p.payment_status = 'posted'
       AND p.received_or_paid_at >= ${start} AND p.received_or_paid_at < ${end}
       ${scope.branch('s.branch_id')}
     GROUP BY ${localDay('p.received_or_paid_at', offset)}`;

  const byBiller = await tx.$queryRaw<Array<{ biller_id: string | null; biller_name: string | null; amount: Prisma.Decimal; payments: bigint }>>`
    SELECT s.biller_id, u.name AS biller_name, SUM(ia.allocated_amount) AS amount, COUNT(DISTINCT p.id) AS payments
      FROM installment_allocations ia
      JOIN installments i ON i.id = ia.installment_id AND i.company_id = ia.company_id
      JOIN sales s ON s.id = i.sale_id AND s.company_id = i.company_id
      LEFT JOIN users u ON u.id = s.biller_id
      JOIN payment_allocations pa ON pa.id = ia.payment_allocation_id AND pa.company_id = ia.company_id
      JOIN payments p ON p.id = pa.payment_id AND p.company_id = pa.company_id
     WHERE ia.company_id = ${scope.companyId} AND p.payment_status = 'posted'
       AND p.received_or_paid_at >= ${start} AND p.received_or_paid_at < ${end}
       ${scope.branch('s.branch_id')}
     GROUP BY s.biller_id, u.name
     ORDER BY amount DESC`;

  const smsRows = await tx.$queryRaw<Array<{ day: Date | string; status: string; messages: bigint; segments: Prisma.Decimal | null }>>`
    SELECT ${localDay('m.created_at', offset)} AS day, m.status, COUNT(*) AS messages, SUM(m.segments) AS segments
      FROM outbound_messages m LEFT JOIN sales s ON s.id = m.sale_id AND s.company_id = m.company_id
     WHERE m.company_id = ${scope.companyId} AND m.channel = 'sms'
       AND m.created_at >= ${start} AND m.created_at < ${end}
       ${scope.branch('s.branch_id')}
     GROUP BY ${localDay('m.created_at', offset)}, m.status`;

  const dueMap = new Map(dueRows.map(r => [isoOf(r.day), r]));
  const colMap = new Map(collectedRows.map(r => [isoOf(r.day), r]));
  const daily = days(range.from, range.to).map(day => ({
    day,
    due: dec(dueMap.get(day)?.amount).toFixed(2),
    installments_due: n(dueMap.get(day)?.installments),
    collected: dec(colMap.get(day)?.amount).toFixed(2),
  }));
  const smsDaily = days(range.from, range.to).map(day => {
    const row = { day, queued: 0, sent: 0, delivered: 0, failed: 0, unknown: 0, skipped: 0, other: 0, segments: 0 };
    for (const r of smsRows.filter(x => isoOf(x.day) === day)) {
      const key = (['queued', 'sent', 'delivered', 'failed', 'unknown', 'skipped'].includes(r.status) ? r.status : 'other') as keyof typeof row;
      (row[key] as number) += n(r.messages);
      row.segments += Number(r.segments ?? 0);
    }
    return row;
  });
  const totalCollected = collectedRows.reduce((s, r) => s.plus(dec(r.amount)), new Prisma.Decimal(0));
  const afterReminder = collectedRows.reduce((s, r) => s.plus(dec(r.after_reminder)), new Prisma.Decimal(0));

  return {
    from: range.from, to: range.to, as_of: today,
    aging: {
      not_due: dec(aging?.not_due as Prisma.Decimal).toFixed(2), days_1_30: dec(aging?.d1_30 as Prisma.Decimal).toFixed(2),
      days_31_60: dec(aging?.d31_60 as Prisma.Decimal).toFixed(2), days_61_90: dec(aging?.d61_90 as Prisma.Decimal).toFixed(2),
      days_91_plus: dec(aging?.d91_plus as Prisma.Decimal).toFixed(2),
    },
    totals: {
      due: daily.reduce((s, d) => s.plus(d.due), new Prisma.Decimal(0)).toFixed(2),
      collected: totalCollected.toFixed(2),
      collected_within_days_after_reminder: afterReminder.toFixed(2),
      attribution_window_days: REMINDER_ATTRIBUTION_DAYS,
      sms: smsDaily.reduce((s, d) => ({ sent: s.sent + d.sent + d.delivered, delivered: s.delivered + d.delivered, failed: s.failed + d.failed, unknown: s.unknown + d.unknown, segments: s.segments + d.segments }),
        { sent: 0, delivered: 0, failed: 0, unknown: 0, segments: 0 }),
    },
    daily,
    sms_daily: smsDaily,
    by_biller: byBiller.map(b => ({ biller_id: b.biller_id, biller_name: b.biller_name ?? 'Unassigned', amount: dec(b.amount).toFixed(2), payments: n(b.payments) })),
  };
}

/** One month of the due calendar: installments, promises and follow-ups per day. */
export async function collectionCalendar(tx: Tx, companyId: string, month: string, now = new Date()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new DomainError('VALIDATION_FAILED', 'Give the month as YYYY-MM', {}, 400);
  const scope = reportSqlScope(companyId);
  const { timezone, today } = await companyClock(tx, companyId, now);
  const first = `${month}-01`;
  const next = (() => { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; })();
  const last = addDays(next, -1);
  const offset = offsetMinutes(timezone, first);

  const installments = await tx.$queryRaw<Array<{ day: Date; installments: bigint; outstanding: Prisma.Decimal; customers: bigint }>>`
    ${openInstallmentsCte(companyId)}
    SELECT due_date AS day, COUNT(*) AS installments, SUM(outstanding) AS outstanding, COUNT(DISTINCT customer_id) AS customers
      FROM bal WHERE outstanding > 0 AND due_date >= ${dateFromIso(first)} AND due_date <= ${dateFromIso(last)}
     GROUP BY due_date`;
  const promises = await tx.$queryRaw<Array<{ day: Date; promises: bigint; amount: Prisma.Decimal }>>`
    SELECT cp.promised_date AS day, COUNT(*) AS promises, SUM(cp.promised_amount) AS amount
      FROM collection_promises cp JOIN sales s ON s.id = cp.sale_id AND s.company_id = cp.company_id
     WHERE cp.company_id = ${scope.companyId} AND cp.cancelled_at IS NULL
       AND cp.promised_date >= ${dateFromIso(first)} AND cp.promised_date <= ${dateFromIso(last)}
       ${scope.branch('s.branch_id')}
     GROUP BY cp.promised_date`;
  const followUps = await tx.$queryRaw<Array<{ day: Date | string; follow_ups: bigint }>>`
    SELECT ${localDay('f.due_at', offset)} AS day, COUNT(*) AS follow_ups
      FROM collection_follow_ups f LEFT JOIN sales s ON s.id = f.sale_id AND s.company_id = f.company_id
     WHERE f.company_id = ${scope.companyId} AND f.status = 'open'
       AND f.due_at >= ${zonedMidnight(timezone, first)} AND f.due_at < ${zonedMidnight(timezone, next)}
       ${scope.branch('s.branch_id')}
     GROUP BY ${localDay('f.due_at', offset)}`;

  return {
    month, today,
    days: days(first, last).map(day => {
      const i = installments.find(r => isoOf(r.day) === day);
      const p = promises.find(r => isoOf(r.day) === day);
      const f = followUps.find(r => isoOf(r.day) === day);
      return {
        day, installments: n(i?.installments), customers: n(i?.customers), outstanding: dec(i?.outstanding).toFixed(2),
        promises: n(p?.promises), promised_amount: dec(p?.amount).toFixed(2), follow_ups: n(f?.follow_ups),
      };
    }),
  };
}
