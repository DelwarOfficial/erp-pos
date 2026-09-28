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
  | { type: 'installments'; installments: Array<{ dueDate: IsoDate; amount: Prisma.Decimal.Value }> };

export interface ScheduledInstallment {
  installmentNo: number;
  dueDate: Date;
  amount: Prisma.Decimal;
}

const invalid = (message: string, details: Record<string, unknown> = {}) =>
  new DomainError('VALIDATION_FAILED', message, details, 400);

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

  const rows = arrangement.installments;
  if (rows.length === 0) throw invalid('An installment schedule needs at least one installment');
  if (rows.length > MAX_INSTALLMENTS) throw invalid(`At most ${MAX_INSTALLMENTS} installments`);
  let total = new Prisma.Decimal(0);
  let previous: Date | null = null;
  const schedule = rows.map((row, i) => {
    let amount: Prisma.Decimal;
    try { amount = new Prisma.Decimal(row.amount); } catch { throw invalid(`Installment ${i + 1}: amount is not a number`); }
    if (amount.lte(0)) throw invalid(`Installment ${i + 1}: amount must be positive`);
    if (amount.decimalPlaces() > 2) throw invalid(`Installment ${i + 1}: amount has more than two decimal places`);
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
