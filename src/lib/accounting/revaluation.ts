// src/lib/accounting/revaluation.ts
// Multi-currency period-end revaluation per §20.D12.
//
// For one foreign currency, every account that holds money in it -- the
// company's foreign cash/bank accounts and the receivable, payable and advance
// control accounts -- is brought to the period-end rate:
//
//   foreign balance  Σ (debit − credit) ÷ rate, over the account's lines in
//                    entries made in that currency (lines keep base amounts and
//                    the entry keeps its rate);
//   book value       Σ (debit − credit) in base currency over the same lines,
//                    plus every earlier revaluation of the account;
//   adjustment       foreign balance × period-end rate − book value,
//
// posted Dr/Cr the account against the exchange gain/loss account. Because
// earlier revaluations are part of the book value, each run trues the account
// up to the new rate: nothing needs reversing at the start of the next period,
// and a run repeated at the same rate posts nothing. This used to create only
// a record, with no journal entry at all.

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { postJournalEntry, type JournalLineInput } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError } from '@/lib/errors/codes';

export interface RevaluationResult {
  revaluationId: string;
  journalEntryId: string | null;
  totalUnrealizedGain: string;
  totalUnrealizedLoss: string;
  accountsRevalued: number;
  periodEndRate: number;
  currencyCode: string;
}

export async function runRevaluation(params: {
  companyId: string;
  currencyCode: string;
  periodEndDate: Date;
  periodEndRate: number; // 1 unit of foreign currency = X base currency
  createdBy: string;
}, tx: Prisma.TransactionClient = db as unknown as Prisma.TransactionClient, correlationId = 'revaluation'): Promise<RevaluationResult> {
  const { companyId, currencyCode, periodEndDate, createdBy } = params;
  const rate = new Prisma.Decimal(params.periodEndRate);
  if (rate.lte(0)) throw new DomainError('VALIDATION_FAILED', 'The period-end rate must be positive', {}, 400);

  const company = await tx.company.findUnique({ where: { id: companyId }, select: { baseCurrencyCode: true } });
  if (!company) throw new DomainError('RESOURCE_NOT_FOUND', 'Company not found', {}, 404);
  if (company.baseCurrencyCode === currencyCode) throw new DomainError('VALIDATION_FAILED', 'The base currency is not revalued', {}, 400);
  const policy = await tx.accountingPolicy.findUnique({ where: { companyId } });
  if (!policy?.exchangeGainLossAccountId) {
    throw new DomainError('VALIDATION_FAILED', 'Set the exchange gain/loss account in accounting policies first', {}, 409);
  }

  const foreignCash = await tx.financialAccount.findMany({ where: { companyId, currencyCode }, select: { chartOfAccountId: true } });
  const accountIds = [...new Set([
    ...foreignCash.map(a => a.chartOfAccountId),
    policy.arAccountId, policy.apAccountId, policy.customerAdvanceAccountId, policy.supplierAdvanceAccountId,
  ])];

  // Lines in this currency up to the period end, and every earlier revaluation of it.
  const earlier = await tx.currencyRevaluation.findMany({ where: { companyId, currencyCode, journalEntryId: { not: null } }, select: { journalEntryId: true } });
  const earlierEntryIds = earlier.map(r => r.journalEntryId!);
  const lines = await tx.journalLine.findMany({
    where: {
      companyId, chartOfAccountId: { in: accountIds },
      journalEntry: { status: { in: ['posted', 'reversed'] }, entryDate: { lte: periodEndDate },
        OR: [{ currencyCode }, { id: { in: earlierEntryIds.length ? earlierEntryIds : ['-'] } }] },
    },
    select: { chartOfAccountId: true, debitBase: true, creditBase: true, journalEntryId: true, journalEntry: { select: { currencyCode: true, exchangeRate: true } } },
  });

  const foreign = new Map<string, Prisma.Decimal>();
  const book = new Map<string, Prisma.Decimal>();
  const add = (m: Map<string, Prisma.Decimal>, k: string, v: Prisma.Decimal) => m.set(k, (m.get(k) ?? new Prisma.Decimal(0)).plus(v));
  for (const line of lines) {
    const base = new Prisma.Decimal(line.debitBase).minus(line.creditBase);
    add(book, line.chartOfAccountId, base);
    if (line.journalEntry.currencyCode === currencyCode && !earlierEntryIds.includes(line.journalEntryId)) {
      add(foreign, line.chartOfAccountId, base.div(line.journalEntry.exchangeRate));
    }
  }

  let gain = new Prisma.Decimal(0);
  let loss = new Prisma.Decimal(0);
  const journal: JournalLineInput[] = [];
  for (const accountId of accountIds) {
    const target = (foreign.get(accountId) ?? new Prisma.Decimal(0)).mul(rate).toDecimalPlaces(2);
    const diff = target.minus((book.get(accountId) ?? new Prisma.Decimal(0)).toDecimalPlaces(2));
    if (diff.isZero()) continue;
    const memo = `${currencyCode} revaluation at ${rate.toString()}`;
    if (diff.gt(0)) {
      journal.push({ chartOfAccountId: accountId, debit: diff, credit: 0, memo }, { chartOfAccountId: policy.exchangeGainLossAccountId, debit: 0, credit: diff, memo });
      gain = gain.plus(diff);
    } else {
      journal.push({ chartOfAccountId: accountId, debit: 0, credit: diff.abs(), memo }, { chartOfAccountId: policy.exchangeGainLossAccountId, debit: diff.abs(), credit: 0, memo });
      loss = loss.plus(diff.abs());
    }
  }

  const revaluation = await tx.currencyRevaluation.create({
    data: { companyId, revaluationDate: periodEndDate, totalUnrealizedGain: gain, totalUnrealizedLoss: loss, periodEndRate: rate, currencyCode, createdBy },
  });
  let journalEntryId: string | null = null;
  if (journal.length) {
    const je = await postJournalEntry(tx, {
      companyId, entryDate: periodEndDate, postingKind: 'fx_revaluation', sourceType: 'currency_revaluation', sourceId: revaluation.id,
      description: `${currencyCode} revaluation at ${rate.toString()} on ${periodEndDate.toISOString().slice(0, 10)}`,
      currencyCode: company.baseCurrencyCode, exchangeRate: 1, createdBy, lines: journal,
    }, correlationId);
    journalEntryId = je.journalEntryId;
    await tx.currencyRevaluation.update({ where: { id: revaluation.id }, data: { journalEntryId } });
  }

  return {
    revaluationId: revaluation.id, journalEntryId,
    totalUnrealizedGain: gain.toFixed(2), totalUnrealizedLoss: loss.toFixed(2),
    accountsRevalued: accountIds.length, periodEndRate: params.periodEndRate, currencyCode,
  };
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
