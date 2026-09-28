// The payment schedule of a credit sale.
//
// A credit sale leaves part of its grand total unpaid; that part is booked to
// accounts receivable by PostSale. The schedule says when it is due: one date
// ("due") or several ("installments"). Every credit sale has one -- without an
// arrangement the whole unpaid amount falls due DEFAULT_CREDIT_DAYS after the
// sale -- so every receivable can be tracked, aged and reminded.
//
// The schedule must equal the unpaid amount exactly, in Decimal, to the paisa.
// A schedule that does not add up is rejected rather than adjusted: the
// salesperson sees the difference and decides.

import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';
import { addDays, dateFromIso, type IsoDate } from './calendar';

export const DEFAULT_CREDIT_DAYS = 30;
export const MAX_INSTALLMENTS = 60;

export type PaymentArrangement =
  | { type: 'due'; dueDate: IsoDate }
  /** Explicit rows; the last amount may be 'rest' -- whatever the others leave unpaid. */
  | { type: 'installments'; installments: Array<{ dueDate: IsoDate; amount: Prisma.Decimal.Value | 'rest' }> }
  /**
   * `count` equal installments, `intervalMonths` apart from `firstDueDate`,
   * split by the server to the paisa with any remainder in the last. The
   * salesperson never has to know the tax-inclusive total in advance.
   */
  | { type: 'equal'; count: number; firstDueDate: IsoDate; intervalMonths?: number };

/** A date some months later, clamped to the month's end (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export interface ScheduledInstallment {
  installmentNo: number;
  dueDate: Date;
  amount: Prisma.Decimal;
}

const invalid = (message: string, details: Record<string, unknown> = {}) =>
  new DomainError('VALIDATION_FAILED', message, details, 400);

function safeDecimal(value: Prisma.Decimal.Value): Prisma.Decimal {
  try { return new Prisma.Decimal(value); } catch { return new Prisma.Decimal(0); }
}

/**
 * The installments for an unpaid amount. `saleDate` is the sale's local
 * business date: no installment may fall due before it.
 */
export function buildSchedule(unpaid: Prisma.Decimal, saleDate: IsoDate, arrangement?: PaymentArrangement): ScheduledInstallment[] {
  if (unpaid.lte(0)) {
    if (arrangement) throw invalid('A payment arrangement applies only to a sale with an unpaid amount');
    return [];
  }
  const parse = (value: IsoDate) => {
    try { return dateFromIso(value); } catch { throw invalid(`Due date is not a valid date: ${value}`); }
  };

  if (!arrangement) {
    return [{ installmentNo: 1, dueDate: dateFromIso(addDays(saleDate, DEFAULT_CREDIT_DAYS)), amount: unpaid }];
  }
  if (arrangement.type === 'due') {
    const dueDate = parse(arrangement.dueDate);
    if (dueDate < dateFromIso(saleDate)) throw invalid('The due date is before the sale date', { due_date: arrangement.dueDate });
    return [{ installmentNo: 1, dueDate, amount: unpaid }];
  }

  if (arrangement.type === 'equal') {
    const { count, firstDueDate } = arrangement;
    const interval = arrangement.intervalMonths ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) throw invalid(`Between 1 and ${MAX_INSTALLMENTS} installments`);
    if (!Number.isInteger(interval) || interval < 1 || interval > 12) throw invalid('The interval is 1 to 12 months');
    parse(firstDueDate);
    const share = unpaid.div(count).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    if (share.lte(0)) throw invalid('The unpaid amount is too small to split that many ways');
    return buildSchedule(unpaid, saleDate, { type: 'installments', installments: Array.from({ length: count }, (_, i) => ({
      dueDate: addMonths(firstDueDate, i * interval), amount: i === count - 1 ? 'rest' : share.toFixed(2),
    })) });
  }

  const rows = arrangement.installments;
  if (rows.length === 0) throw invalid('An installment schedule needs at least one installment');
  if (rows.length > MAX_INSTALLMENTS) throw invalid(`At most ${MAX_INSTALLMENTS} installments`);
  let total = new Prisma.Decimal(0);
  let previous: Date | null = null;
  if (rows.slice(0, -1).some(row => row.amount === 'rest')) throw invalid('Only the last installment can take the rest');
  const others = rows.reduce((sum, row) => row.amount === 'rest' ? sum : sum.plus(safeDecimal(row.amount)), new Prisma.Decimal(0));
  const schedule = rows.map((row, i) => {
    let amount: Prisma.Decimal;
    if (row.amount === 'rest') {
      amount = unpaid.minus(others);
      if (amount.lte(0)) throw invalid(`The other installments already cover the unpaid ${unpaid.toFixed(2)}`);
    } else {
      try { amount = new Prisma.Decimal(row.amount); } catch { throw invalid(`Installment ${i + 1}: amount is not a number`); }
      if (amount.lte(0)) throw invalid(`Installment ${i + 1}: amount must be positive`);
      if (amount.decimalPlaces() > 2) throw invalid(`Installment ${i + 1}: amount has more than two decimal places`);
    }
    const dueDate = parse(row.dueDate);
    if (dueDate < dateFromIso(saleDate)) throw invalid(`Installment ${i + 1} falls due before the sale date`);
    if (previous && dueDate <= previous) throw invalid(`Installment ${i + 1} must fall due after installment ${i}`);
    previous = dueDate;
    total = total.plus(amount);
    return { installmentNo: i + 1, dueDate, amount };
  });
  if (!total.eq(unpaid)) {
    throw invalid(`The installments total ${total.toFixed(2)} but ${unpaid.toFixed(2)} is unpaid`,
      { installments_total: total.toFixed(2), unpaid: unpaid.toFixed(2), difference: unpaid.minus(total).toFixed(2) });
  }
  return schedule;
}
