// Trial balance.
//
// The report whose job is to prove that debits equal credits had four defects:
//
//   Memory      It loaded every posted journal line since inception, joined to
//               its account row by row, and summed in JavaScript. After a year
//               of POS trading that is millions of rows held in the heap.
//   Precision   It summed DECIMAL(65,30) amounts with parseFloat and +=, so the
//               totals carried IEEE-754 error into the one figure that has to
//               be exact.
//   Verdict     is_balanced compared totals rebuilt from per-account balances
//               that had already been rounded to 2dp, with a 0.01 tolerance --
//               rounding noise could report a balanced ledger as unbalanced, or
//               hide a real imbalance smaller than a paisa.
//   Reversals   It counted only status 'posted'. Reversing an entry marks the
//               original 'reversed' and posts the reversal as 'posted', so the
//               reversal was counted without its original and every affected
//               account moved the wrong way. Voids and sale returns both
//               reverse entries, so this hit routine trading.
//
// Aggregation now happens in the database with GROUP BY, amounts stay
// Prisma.Decimal throughout, both posted and reversed entries are counted (a
// reversed original and its reversal net to zero, as they should), and the
// verdict is exact equality of the unrounded sums. Rounding happens once, when
// figures are formatted for display.

import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';

const Decimal = Prisma.Decimal;
type Tx = Pick<Prisma.TransactionClient, 'journalLine' | 'chartOfAccount'>;

/** Entry statuses that are part of the ledger. A draft is not. */
export const LEDGER_STATUSES = ['posted', 'reversed'] as const;

export interface TrialBalanceAccount {
  account_id: string;
  code: string;
  name: string;
  account_class: string;
  normal_balance: string;
  total_debit: string;
  total_credit: string;
  balance: string;
  balance_type: 'Debit' | 'Credit';
}

export interface TrialBalance {
  as_of: string;
  accounts: TrialBalanceAccount[];
  summary: {
    total_accounts: number;
    total_debit: string;
    total_credit: string;
    difference: string;
    is_balanced: boolean;
  };
}

/**
 * Parse an as_of parameter. A bare date means the whole of that day: entries
 * carry a time, so `lte 2026-09-30T00:00` silently dropped the last day.
 */
export function parseAsOf(raw: string | null, now: Date = new Date()): Date {
  if (!raw) return now;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const endOfDay = new Date(`${raw}T23:59:59.999Z`);
    if (!Number.isNaN(endOfDay.getTime())) return endOfDay;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    // Previously an invalid date reached Prisma and came back as a 500.
    throw new DomainError('VALIDATION_FAILED', 'as_of must be a date (YYYY-MM-DD) or an ISO timestamp', { as_of: raw }, 400);
  }
  return parsed;
}

export async function computeTrialBalance(tx: Tx, companyId: string, asOf: Date): Promise<TrialBalance> {
  const grouped = await tx.journalLine.groupBy({
    by: ['chartOfAccountId'],
    where: {
      companyId,
      journalEntry: { companyId, status: { in: [...LEDGER_STATUSES] }, entryDate: { lte: asOf } },
    },
    _sum: { debitBase: true, creditBase: true },
  });

  const accounts = grouped.length === 0 ? [] : await tx.chartOfAccount.findMany({
    where: { companyId, id: { in: grouped.map(row => row.chartOfAccountId) } },
    select: { id: true, code: true, name: true, accountClass: true, normalBalance: true },
  });
  const accountById = new Map(accounts.map(account => [account.id, account]));

  // Turnover totals: every debit against every credit.
  let grandDebit = new Decimal(0);
  let grandCredit = new Decimal(0);
  // The two columns a trial balance presents: sum of debit balances and sum of
  // credit balances. Kept unrounded; they differ by exactly the turnover gap.
  let debitBalances = new Decimal(0);
  let creditBalances = new Decimal(0);
  const rows: TrialBalanceAccount[] = [];

  for (const row of grouped) {
    const account = accountById.get(row.chartOfAccountId);
    if (!account) {
      // A line pointing at an account outside the company is a data-integrity
      // failure, not something to leave out of a report that proves balance.
      throw new DomainError('INTERNAL_ERROR', 'Journal lines reference an unknown account', { account_id: row.chartOfAccountId }, 500);
    }
    const debit = new Decimal(row._sum.debitBase ?? 0);
    const credit = new Decimal(row._sum.creditBase ?? 0);
    grandDebit = grandDebit.plus(debit);
    grandCredit = grandCredit.plus(credit);

    const net = account.normalBalance === 'D' ? debit.minus(credit) : credit.minus(debit);
    const sideIsNormal = net.gte(0);
    const onDebitSide = sideIsNormal === (account.normalBalance === 'D');
    if (onDebitSide) debitBalances = debitBalances.plus(net.abs());
    else creditBalances = creditBalances.plus(net.abs());
    rows.push({
      account_id: account.id,
      code: account.code,
      name: account.name,
      account_class: account.accountClass,
      normal_balance: account.normalBalance,
      total_debit: debit.toFixed(2),
      total_credit: credit.toFixed(2),
      balance: net.abs().toFixed(2),
      balance_type: onDebitSide ? 'Debit' : 'Credit',
    });
  }

  rows.sort((a, b) => a.code.localeCompare(b.code));

  // The proof of double entry: exact equality of the unrounded sums. The
  // balance columns and the turnover totals must tell the same story.
  const difference = debitBalances.minus(creditBalances);
  return {
    as_of: asOf.toISOString(),
    accounts: rows,
    summary: {
      total_accounts: rows.length,
      total_debit: debitBalances.toFixed(2),
      total_credit: creditBalances.toFixed(2),
      difference: difference.toFixed(2),
      is_balanced: difference.isZero() && grandDebit.eq(grandCredit),
    },
  };
}
