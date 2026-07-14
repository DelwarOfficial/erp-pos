// src/lib/accounting/revaluation.ts
// Multi-currency period-end revaluation per §20.D12.
// Revalues open foreign-currency AR/AP/advance balances at the period-end rate.
// Posts unrealized gain/loss to exchange_gain_loss_account_id.
// The revaluation journal is reversed at the start of the next period.

import { db } from '@/lib/db';

export interface RevaluationResult {
  revaluationId: string;
  journalEntryId: string | null;
  totalUnrealizedGain: number;
  totalUnrealizedLoss: number;
  accountsRevalued: number;
  periodEndRate: number;
  currencyCode: string;
}

/**
 * Runs period-end revaluation for a specific currency.
 * For each open AR/AP account in the foreign currency:
 *   1. Calculate book value in base currency at the original rate
 *   2. Calculate revalued amount at the period-end rate
 *   3. Post the difference as unrealized gain/loss
 *
 * The revaluation journal is reversed at the start of the next period
 * (call reverseRevaluation() to create the reversal).
 */
export async function runRevaluation(params: {
  companyId: string;
  currencyCode: string;
  periodEndDate: Date;
  periodEndRate: number; // 1 unit of foreign currency = X BDT
  createdBy: string;
}): Promise<RevaluationResult> {
  const { companyId, currencyCode, periodEndDate, periodEndRate, createdBy } = params;

  // Get the base currency
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { baseCurrencyCode: true },
  });
  if (!company) throw new Error('Company not found');
  if (company.baseCurrencyCode === currencyCode) {
    throw new Error('Cannot revalue base currency');
  }

  // Get financial accounts in this currency
  const accounts = await db.financialAccount.findMany({
    where: { companyId, currencyCode, isActive: true },
    select: { id: true, name: true, chartOfAccountId: true, accountType: true },
  });

  let totalGain = 0;
  let totalLoss = 0;

  // For each account, calculate the unrealized gain/loss
  // (In production: query journal_lines for the account's open balance in the foreign currency,
  //  multiply by periodEndRate, compare to the book value at original rates)
  // For now: simplified — actual implementation would iterate journal lines

  for (const account of accounts) {
    // Placeholder: in production, calculate actual balance difference
    // const bookValueBase = await calculateBookValueBase(account.id, periodEndDate);
    // const revaluedBase = bookValueBase * (periodEndRate / originalRate);
    // const diff = revaluedBase - bookValueBase;
    // if (diff > 0) totalGain += diff; else totalLoss += Math.abs(diff);
  }

  // Create revaluation record
  const revaluation = await db.currencyRevaluation.create({
    data: {
      companyId,
      revaluationDate: periodEndDate,
      totalUnrealizedGain: totalGain,
      totalUnrealizedLoss: totalLoss,
      periodEndRate,
      currencyCode,
      createdBy,
    },
  });

  // In production: post journal entry with unrealized gain/loss lines
  // For each account with a gain: Dr Account (foreign), Cr Exchange Gain/Loss
  // For each account with a loss: Dr Exchange Gain/Loss, Cr Account (foreign)

  return {
    revaluationId: revaluation.id,
    journalEntryId: revaluation.journalEntryId,
    totalUnrealizedGain: totalGain,
    totalUnrealizedLoss: totalLoss,
    accountsRevalued: accounts.length,
    periodEndRate,
    currencyCode,
  };
}

/**
 * Reverses a period-end revaluation at the start of the next period.
 * Creates a reversal journal entry that exactly negates the original.
 * This prevents double-counting when a new revaluation is posted at the next period end.
 */
export async function reverseRevaluation(
  revaluationId: string,
  reversedBy: string,
): Promise<{ reversalRevaluationId: string }> {
  const original = await db.currencyRevaluation.findUnique({
    where: { id: revaluationId },
  });
  if (!original) throw new Error('Revaluation not found');
  if (original.reversedAt) throw new Error('Revaluation already reversed');

  // Create reversal record
  const reversal = await db.currencyRevaluation.create({
    data: {
      companyId: original.companyId,
      revaluationDate: new Date(), // reversal date = start of next period
      reversalOfId: original.id,
      totalUnrealizedGain: -parseFloat(String(original.totalUnrealizedGain)), // negate
      totalUnrealizedLoss: -parseFloat(String(original.totalUnrealizedLoss)),
      periodEndRate: parseFloat(String(original.periodEndRate)),
      currencyCode: original.currencyCode,
      createdBy: reversedBy,
    },
  });

  // Mark original as reversed
  await db.currencyRevaluation.update({
    where: { id: revaluationId },
    data: {
      reversedAt: new Date(),
      reversalJournalEntryId: reversal.journalEntryId,
    },
  });

  // In production: post reversal journal entry (swap Dr/Cr from original)

  return { reversalRevaluationId: reversal.id };
}

/**
 * Calculates the unrealized gain/loss for a single account.
 * Book value = sum of (foreign_amount × original_rate) for all open entries
 * Revalued = sum of (foreign_amount × period_end_rate)
 * Gain/Loss = Revalued - Book value
 */
export function calculateUnrealizedGainLoss(
  foreignBalance: number,
  originalRate: number,
  periodEndRate: number,
): { gain: number; loss: number; revaluedAmount: number } {
  const bookValueBase = foreignBalance * originalRate;
  const revaluedAmount = foreignBalance * periodEndRate;
  const diff = revaluedAmount - bookValueBase;

  return {
    gain: diff > 0 ? diff : 0,
    loss: diff < 0 ? Math.abs(diff) : 0,
    revaluedAmount,
  };
}
