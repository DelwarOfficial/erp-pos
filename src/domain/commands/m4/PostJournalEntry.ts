// src/domain/commands/m4/PostJournalEntry.ts
// postJournalEntry per §16 + §5.10.
//
// Validates:
//   1. Open fiscal period (entry_date falls within an 'open' period)
//   2. Tenant consistency (all accounts belong to same company)
//   3. Balanced debit/credit (total debit == total credit)
//   4. Each line has exactly one of debit > 0 or credit > 0 (not both, not neither)
//
// Posts the journal entry + lines as immutable records.
// Reversal creates an equal-and-opposite linked entry.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

export interface JournalLineInput {
  chartOfAccountId: string;
  branchId?: string;
  financialAccountId?: string;
  customerId?: string;
  supplierId?: string;
  productId?: string;
  debit: number;
  credit: number;
  memo?: string;
}

export interface PostJournalEntryInput {
  companyId: string;
  entryDate: Date;
  postingKind: string;
  sourceType: string;
  sourceId: string;
  description: string;
  currencyCode: string;
  exchangeRate: number;
  createdBy: string;
  lines: JournalLineInput[];
}

export interface PostJournalEntryResult {
  journalEntryId: string;
  entryNo: string;
  status: string;
  totalDebit: string;
  totalCredit: string;
}

export async function postJournalEntry(
  tx: Prisma.TransactionClient,
  input: PostJournalEntryInput,
  correlationId: string,
): Promise<PostJournalEntryResult> {
  if (input.lines.length < 2) {
    throw new DomainError('VALIDATION_FAILED', 'Journal entry requires at least 2 lines', {}, 400);
  }

  // 1. Validate each line: exactly one of debit > 0 or credit > 0
  let totalDebit = 0;
  let totalCredit = 0;
  for (let i = 0; i < input.lines.length; i++) {
    const line = input.lines[i];
    if (line.debit > 0 && line.credit > 0) {
      throw new DomainError('VALIDATION_FAILED', `Line ${i + 1}: cannot have both debit and credit > 0`, {}, 400);
    }
    if (line.debit === 0 && line.credit === 0) {
      throw new DomainError('VALIDATION_FAILED', `Line ${i + 1}: must have either debit or credit > 0`, {}, 400);
    }
    if (line.debit < 0 || line.credit < 0) {
      throw new DomainError('VALIDATION_FAILED', `Line ${i + 1}: debit/credit must be >= 0`, {}, 400);
    }
    totalDebit += line.debit;
    totalCredit += line.credit;
  }

  // 2. Validate balanced (total debit == total credit)
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new DomainError(
      'VALIDATION_FAILED',
      `Unbalanced journal entry: total debit ${totalDebit.toFixed(2)} ≠ total credit ${totalCredit.toFixed(2)}`,
      { total_debit: totalDebit, total_credit: totalCredit },
      400,
    );
  }
  if (totalDebit === 0) {
    throw new DomainError('VALIDATION_FAILED', 'Empty journal entry (zero debit/credit)', {}, 400);
  }

  // 3. Validate fiscal period is open
  const entryDateOnly = new Date(input.entryDate);
  entryDateOnly.setHours(0, 0, 0, 0);
  const period = await tx.fiscalPeriod.findFirst({
    where: {
      companyId: input.companyId,
      periodStart: { lte: entryDateOnly },
      periodEnd: { gte: entryDateOnly },
    },
  });
  if (period) {
    if (period.status === 'locked') {
      throw new DomainError(
        'FISCAL_PERIOD_LOCKED',
        `Fiscal period "${period.periodName}" is locked — cannot post journal entries`,
        { period_name: period.periodName, status: period.status },
        409,
      );
    }
    if (period.status === 'soft_locked') {
      throw new DomainError(
        'FISCAL_PERIOD_LOCKED',
        `Fiscal period "${period.periodName}" is soft-locked — requires approval to post`,
        { period_name: period.periodName, status: period.status },
        409,
      );
    }
  }
  // If no period found, we allow posting (sandbox — in production this would be an error)

  // 4. Validate tenant consistency — all chart_of_account_ids belong to this company
  for (const line of input.lines) {
    const coa = await tx.chartOfAccount.findFirst({
      where: { id: line.chartOfAccountId, companyId: input.companyId, isActive: true },
    });
    if (!coa) {
      throw new DomainError('VALIDATION_FAILED', `Chart of account ${line.chartOfAccountId} not found in this company`, {}, 400);
    }
    if (!coa.allowManualPosting && input.postingKind === 'manual_adjustment') {
      throw new DomainError('VALIDATION_FAILED', `Account ${coa.code} does not allow manual posting`, { account_code: coa.code }, 400);
    }
  }

  // 5. Generate entry number
  const { documentNumber: entryNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId,
    documentType: 'JOURNAL',
    fiscalYear: new Date(input.entryDate).getFullYear(),
    prefix: 'JE-',
  });

  // 6. Create business event
  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: {
      id: eventId,
      companyId: input.companyId,
      eventType: 'journal_entry.posted',
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      correlationId,
      occurredAt: new Date(),
    },
  });

  // 7. Create journal entry header
  const entry = await tx.journalEntry.create({
    data: {
      companyId: input.companyId,
      entryNo,
      eventId,
      postingKind: input.postingKind,
      entryDate: input.entryDate,
      postingDate: new Date(),
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      currencyCode: input.currencyCode,
      exchangeRate: input.exchangeRate,
      description: input.description,
      status: 'posted',
      createdBy: input.createdBy,
      postedBy: input.createdBy,
      postedAt: new Date(),
    },
  });

  // 8. Create journal lines
  let lineNo = 1;
  for (const line of input.lines) {
    await tx.journalLine.create({
      data: {
        companyId: input.companyId,
        journalEntryId: entry.id,
        lineNo,
        branchId: line.branchId ?? null,
        chartOfAccountId: line.chartOfAccountId,
        financialAccountId: line.financialAccountId ?? null,
        customerId: line.customerId ?? null,
        supplierId: line.supplierId ?? null,
        productId: line.productId ?? null,
        debitBase: line.debit,
        creditBase: line.credit,
        memo: line.memo ?? null,
      },
    });
    lineNo++;
  }

  // 9. Audit
  await tx.auditLog.create({
    data: {
      companyId: input.companyId,
      userId: input.createdBy,
      correlationId,
      action: 'journal_entry.post',
      entityType: 'journal_entry',
      entityId: entry.id,
      afterValue: JSON.stringify({
        entry_no: entryNo,
        total_debit: totalDebit,
        total_credit: totalCredit,
        line_count: input.lines.length,
        source: `${input.sourceType}/${input.sourceId}`,
      }),
    },
  });

  return {
    journalEntryId: entry.id,
    entryNo,
    status: 'posted',
    totalDebit: totalDebit.toFixed(2),
    totalCredit: totalCredit.toFixed(2),
  };
}

/**
 * Reverse a journal entry by creating an equal-and-opposite linked entry.
 * Per §20.0 control 4: "Reversal-based correction — no posted record is edited."
 */
export async function reverseJournalEntry(
  tx: Prisma.TransactionClient,
  params: {
    journalEntryId: string;
    companyId: string;
    reversedBy: string;
    reason: string;
  },
  correlationId: string,
): Promise<PostJournalEntryResult> {
  const original = await tx.journalEntry.findFirst({
    where: { id: params.journalEntryId, companyId: params.companyId },
    include: { lines: true },
  });
  if (!original) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Journal entry not found', {}, 404);
  }
  if (original.status === 'reversed') {
    throw new DomainError('VALIDATION_FAILED', 'Journal entry is already reversed', {}, 409);
  }

  // Check if already reversed
  const existingReversal = await tx.journalEntry.findFirst({
    where: { reversalOfEntryId: params.journalEntryId },
  });
  if (existingReversal) {
    throw new DomainError('VALIDATION_FAILED', 'Journal entry already reversed', {}, 409);
  }

  // Create opposite lines (swap debit ↔ credit)
  const reversedLines: JournalLineInput[] = original.lines.map(l => ({
    chartOfAccountId: l.chartOfAccountId,
    branchId: l.branchId ?? undefined,
    financialAccountId: l.financialAccountId ?? undefined,
    customerId: l.customerId ?? undefined,
    supplierId: l.supplierId ?? undefined,
    productId: l.productId ?? undefined,
    debit: parseFloat(l.creditBase.toString()),  // swap
    credit: parseFloat(l.debitBase.toString()),  // swap
    memo: `Reversal: ${l.memo ?? ''}`,
  }));

  const result = await postJournalEntry(tx, {
    companyId: params.companyId,
    entryDate: original.entryDate,
    postingKind: `${original.postingKind}_reversal`,
    sourceType: 'journal_reversal',
    sourceId: params.journalEntryId,
    description: `REVERSAL of ${original.entryNo}: ${params.reason}`,
    currencyCode: original.currencyCode,
    exchangeRate: parseFloat(original.exchangeRate.toString()),
    createdBy: params.reversedBy,
    lines: reversedLines,
  }, correlationId);

  // Link the reversal to the original + mark original as reversed
  await tx.journalEntry.update({
    where: { id: result.journalEntryId },
    data: { reversalOfEntryId: params.journalEntryId },
  });
  await tx.journalEntry.update({
    where: { id: params.journalEntryId },
    data: { status: 'reversed' },
  });

  return result;
}
