// Equal installments: monthly (clamped to month end) versus every N days,
// split exactly with any remainder on the last installment.
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { buildSchedule } from '@/domain/receivables/schedule';

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('equal installments', () => {
  it('monthly from the 31st falls on each month end, then returns to the 31st', () => {
    const rows = buildSchedule(new Prisma.Decimal('900.00'), '2026-01-01', { type: 'equal', count: 3, firstDueDate: '2026-01-31', intervalMonths: 1 });
    expect(rows.map(r => iso(r.dueDate))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('every 30 days is a fixed gap, not a calendar month', () => {
    const rows = buildSchedule(new Prisma.Decimal('900.00'), '2026-01-01', { type: 'equal', count: 3, firstDueDate: '2026-01-31', intervalDays: 30 });
    expect(rows.map(r => iso(r.dueDate))).toEqual(['2026-01-31', '2026-03-02', '2026-04-01']);
  });

  it('splits to the paisa and puts the remainder on the last installment', () => {
    const rows = buildSchedule(new Prisma.Decimal('10000.00'), '2026-01-01', { type: 'equal', count: 3, firstDueDate: '2026-02-01', intervalDays: 30 });
    expect(rows.map(r => r.amount.toFixed(2))).toEqual(['3333.33', '3333.33', '3333.34']);
    expect(rows.reduce((s, r) => s.plus(r.amount), new Prisma.Decimal(0)).toFixed(2)).toBe('10000.00');
  });

  it('refuses monthly and daily together, and out-of-range day gaps', () => {
    expect(() => buildSchedule(new Prisma.Decimal('100'), '2026-01-01', { type: 'equal', count: 2, firstDueDate: '2026-02-01', intervalMonths: 1, intervalDays: 30 })).toThrow(/not both/);
    expect(() => buildSchedule(new Prisma.Decimal('100'), '2026-01-01', { type: 'equal', count: 2, firstDueDate: '2026-02-01', intervalDays: 0 })).toThrow(/1 to 365 days/);
  });

  it('custom rows must add up exactly; nothing is adjusted silently', () => {
    expect(() => buildSchedule(new Prisma.Decimal('1000.00'), '2026-01-01', { type: 'installments', installments: [
      { dueDate: '2026-02-01', amount: '400.00' }, { dueDate: '2026-03-01', amount: '500.00' }] })).toThrow(/total 900.00 but 1000.00 is unpaid/);
  });
});
