// Customer receivables: phone numbers, SMS segments, calendar dates, schedules.
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { maskBdMobile, normalizeBdMobile } from '@/domain/receivables/phone';
import { smsSegments } from '@/domain/receivables/smsSegments';
import { addDays, dateFromIso, daysBetween, localDate, localMinuteOfDay } from '@/domain/receivables/calendar';
import { buildSchedule, DEFAULT_CREDIT_DAYS } from '@/domain/receivables/schedule';

const D = (v: string) => new Prisma.Decimal(v);

describe('Bangladesh mobile numbers', () => {
  it.each([
    ['01712345678', '8801712345678'],
    ['8801712345678', '8801712345678'],
    ['+8801712345678', '8801712345678'],
    ['008801712345678', '8801712345678'],
    [' 017-1234 5678 ', '8801712345678'],
    ['(+880) 1912-345678', '8801912345678'],
    ['01312345678', '8801312345678'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeBdMobile(input)).toBe(expected);
  });

  it.each([
    [''], ['0171234567'], ['017123456789'], ['01212345678'], ['01112345678'], ['02712345678'],
    ['+441712345678'], ['8801712345678x'], ['০১৭১২৩৪৫৬৭৮'], [null], [undefined],
  ])('rejects %s', input => {
    expect(normalizeBdMobile(input as string)).toBeNull();
  });

  it('masks all but the operator and the last three digits', () => {
    expect(maskBdMobile('8801712345678')).toBe('88017*****678');
  });
});

describe('SMS segments', () => {
  it('counts GSM text in 160 and then 153 septets', () => {
    expect(smsSegments('a'.repeat(160))).toEqual({ encoding: 'gsm7', units: 160, segments: 1 });
    expect(smsSegments('a'.repeat(161))).toEqual({ encoding: 'gsm7', units: 161, segments: 2 });
    expect(smsSegments('a'.repeat(306))).toEqual({ encoding: 'gsm7', units: 306, segments: 2 });
    expect(smsSegments('a'.repeat(307)).segments).toBe(3);
  });

  it('counts GSM extension characters twice', () => {
    expect(smsSegments('{}€').units).toBe(6);
    expect(smsSegments('€'.repeat(80))).toMatchObject({ encoding: 'gsm7', units: 160, segments: 1 });
    expect(smsSegments('€'.repeat(81)).segments).toBe(2);
  });

  it('sends Bangla as UCS-2 in 70 and then 67 characters', () => {
    const bangla = 'প্রিয় গ্রাহক, আপনার বকেয়া ৳৩০,০০০ পরিশোধের তারিখ ১০ অক্টোবর।';
    expect(smsSegments(bangla).encoding).toBe('ucs2');
    expect(smsSegments('ক'.repeat(70))).toEqual({ encoding: 'ucs2', units: 70, segments: 1 });
    expect(smsSegments('ক'.repeat(71)).segments).toBe(2);
    expect(smsSegments('ক'.repeat(134)).segments).toBe(2);
    expect(smsSegments('ক'.repeat(135)).segments).toBe(3);
  });

  it('switches a whole message to UCS-2 for one non-GSM character', () => {
    // 100 Latin letters would be one GSM SMS; one taka sign makes it two UCS-2 parts.
    expect(smsSegments(`${'a'.repeat(100)}৳`)).toMatchObject({ encoding: 'ucs2', segments: 2 });
  });
});

describe('calendar dates', () => {
  it('uses the company date, not the server date', () => {
    // 2026-10-09 20:30 UTC is already 10 October in Dhaka (UTC+6).
    const at = new Date('2026-10-09T20:30:00Z');
    expect(localDate('Asia/Dhaka', at)).toBe('2026-10-10');
    expect(localDate('UTC', at)).toBe('2026-10-09');
    expect(localMinuteOfDay('Asia/Dhaka', at)).toBe(2 * 60 + 30);
  });

  it('adds days and counts them across months', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(daysBetween('2026-10-10', '2026-10-17')).toBe(7);
    expect(daysBetween('2026-10-10', '2026-10-07')).toBe(-3);
  });

  it('rejects impossible dates', () => {
    expect(() => dateFromIso('2026-02-30')).toThrow();
    expect(() => dateFromIso('10/10/2026')).toThrow();
  });
});

describe('payment schedule', () => {
  it('defaults a credit sale to one installment after the credit period', () => {
    const [only] = buildSchedule(D('15000'), '2026-10-01');
    expect(only).toMatchObject({ installmentNo: 1 });
    expect(only.amount.toFixed(2)).toBe('15000.00');
    expect(only.dueDate.toISOString().slice(0, 10)).toBe(addDays('2026-10-01', DEFAULT_CREDIT_DAYS));
  });

  it('takes a single due date for the whole amount', () => {
    const [only] = buildSchedule(D('15000'), '2026-10-01', { type: 'due', dueDate: '2026-10-20' });
    expect(only.dueDate.toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(only.amount.toFixed(2)).toBe('15000.00');
  });

  it('takes installments that add up exactly', () => {
    const schedule = buildSchedule(D('30000'), '2026-09-28', { type: 'installments', installments: [
      { dueDate: '2026-10-10', amount: '10000' }, { dueDate: '2026-11-10', amount: '10000' }, { dueDate: '2026-12-10', amount: '10000.00' },
    ] });
    expect(schedule.map(i => [i.installmentNo, i.dueDate.toISOString().slice(0, 10), i.amount.toFixed(2)])).toEqual([
      [1, '2026-10-10', '10000.00'], [2, '2026-11-10', '10000.00'], [3, '2026-12-10', '10000.00'],
    ]);
  });

  it('adds up in Decimal, where floating point does not', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point.
    expect(() => buildSchedule(D('0.30'), '2026-09-28', { type: 'installments', installments: [
      { dueDate: '2026-10-10', amount: '0.10' }, { dueDate: '2026-11-10', amount: '0.20' },
    ] })).not.toThrow();
  });

  it.each([
    ['a total short by one paisa', [['2026-10-10', '10000'], ['2026-11-10', '19999.99']], /total 29999.99 but 30000.00 is unpaid/],
    ['a total over', [['2026-10-10', '20000'], ['2026-11-10', '10000.01']], /unpaid/],
    ['a zero amount', [['2026-10-10', '0'], ['2026-11-10', '30000']], /positive/],
    ['a negative amount', [['2026-10-10', '-1'], ['2026-11-10', '30001']], /positive/],
    ['three decimal places', [['2026-10-10', '10000.005'], ['2026-11-10', '19999.995']], /two decimal places/],
    ['dates out of order', [['2026-11-10', '10000'], ['2026-10-10', '20000']], /after installment/],
    ['the same date twice', [['2026-10-10', '10000'], ['2026-10-10', '20000']], /after installment/],
    ['a date before the sale', [['2026-09-27', '10000'], ['2026-10-10', '20000']], /before the sale date/],
    ['an impossible date', [['2026-02-30', '10000'], ['2026-10-10', '20000']], /not a valid date/],
  ])('rejects %s', (_label, rows, message) => {
    expect(() => buildSchedule(D('30000'), '2026-09-28', {
      type: 'installments', installments: (rows as string[][]).map(([dueDate, amount]) => ({ dueDate, amount })),
    })).toThrow(message as RegExp);
  });

  it('refuses an arrangement on a sale paid in full', () => {
    expect(buildSchedule(D('0'), '2026-09-28')).toEqual([]);
    expect(() => buildSchedule(D('0'), '2026-09-28', { type: 'due', dueDate: '2026-10-10' })).toThrow(/unpaid amount/);
  });
});

describe('server-computed schedules', () => {
  it('splits equally to the paisa, the remainder in the last installment', () => {
    const schedule = buildSchedule(D('1000'), '2026-09-28', { type: 'equal', count: 3, firstDueDate: '2026-10-10' });
    expect(schedule.map(i => [i.dueDate.toISOString().slice(0, 10), i.amount.toFixed(2)])).toEqual([
      ['2026-10-10', '333.33'], ['2026-11-10', '333.33'], ['2026-12-10', '333.34'],
    ]);
    expect(schedule.reduce((s, i) => s.plus(i.amount), D('0')).toFixed(2)).toBe('1000.00');
  });

  it('clamps monthly dates to the end of shorter months', () => {
    const schedule = buildSchedule(D('300'), '2026-01-01', { type: 'equal', count: 3, firstDueDate: '2027-01-31' });
    expect(schedule.map(i => i.dueDate.toISOString().slice(0, 10))).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('takes the rest in the last custom installment only', () => {
    const schedule = buildSchedule(D('1234.56'), '2026-09-28', { type: 'installments', installments: [
      { dueDate: '2026-10-10', amount: '500' }, { dueDate: '2026-11-10', amount: 'rest' },
    ] });
    expect(schedule.map(i => i.amount.toFixed(2))).toEqual(['500.00', '734.56']);
    expect(() => buildSchedule(D('100'), '2026-09-28', { type: 'installments', installments: [
      { dueDate: '2026-10-10', amount: 'rest' }, { dueDate: '2026-11-10', amount: '50' },
    ] })).toThrow(/Only the last/);
    expect(() => buildSchedule(D('100'), '2026-09-28', { type: 'installments', installments: [
      { dueDate: '2026-10-10', amount: '100' }, { dueDate: '2026-11-10', amount: 'rest' },
    ] })).toThrow(/already cover/);
  });

  it('refuses a split too fine for the amount', () => {
    expect(() => buildSchedule(D('0.05'), '2026-09-28', { type: 'equal', count: 10, firstDueDate: '2026-10-10' })).toThrow(/too small/);
  });
});
