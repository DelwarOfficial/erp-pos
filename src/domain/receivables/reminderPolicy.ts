// A company's due reminder policy (reminder_policies).
//
// Stages are day offsets from an installment's due date: -3 is three days
// before, 0 the due date, 7 a week overdue. Reminders go out only inside the
// sending window, in the company's time zone, only above a minimum
// outstanding amount, at most maxPerCustomerPerDay a day to one customer and
// dailyCompanyLimit a day for the company. Nothing is sent until the company
// turns the policy on.

import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';

export interface ReminderPolicySettings {
  enabled: boolean;
  stageOffsets: number[];
  sendWindowStartMinute: number;
  sendWindowEndMinute: number;
  minOutstanding: Prisma.Decimal;
  maxPerCustomerPerDay: number;
  dailyCompanyLimit: number;
  locale: 'bn' | 'en';
}

export const STAGE_MIN = -30;
export const STAGE_MAX = 180;
export const MAX_STAGES = 12;

export function parseStageOffsets(raw: unknown): number[] {
  const value = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STAGES
    || !value.every(v => Number.isInteger(v) && v >= STAGE_MIN && v <= STAGE_MAX)) {
    throw new DomainError('VALIDATION_FAILED',
      `Reminder stages are 1-${MAX_STAGES} whole day offsets between ${STAGE_MIN} and ${STAGE_MAX}`, {}, 400);
  }
  return [...new Set(value as number[])].sort((a, b) => a - b);
}

type PolicyRow = {
  enabled: boolean; stageOffsets: string; sendWindowStartMinute: number; sendWindowEndMinute: number;
  minOutstanding: Prisma.Decimal; maxPerCustomerPerDay: number; dailyCompanyLimit: number; locale: string;
};

export function policyFromRow(row: PolicyRow | null): ReminderPolicySettings | null {
  if (!row) return null;
  return {
    enabled: row.enabled,
    stageOffsets: parseStageOffsets(row.stageOffsets),
    sendWindowStartMinute: row.sendWindowStartMinute,
    sendWindowEndMinute: row.sendWindowEndMinute,
    minOutstanding: new Prisma.Decimal(row.minOutstanding),
    maxPerCustomerPerDay: row.maxPerCustomerPerDay,
    dailyCompanyLimit: row.dailyCompanyLimit,
    locale: row.locale === 'en' ? 'en' : 'bn',
  };
}
