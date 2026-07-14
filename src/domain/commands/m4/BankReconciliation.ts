// src/domain/commands/m4/BankReconciliation.ts
// Banking Reconciliation domain commands per AM-BR.
// Auto-imports system lines from payments + lets the user supply statement lines,
// auto-matches by amount + date, supports manual match, and posts a variance
// adjustment JE on finalise if system ≠ statement closing balance.
//
// Commands:
//   createBankReconciliation       — header + auto-import system lines from payments
//   addStatementLine               — single statement line insert
//   addStatementLinesBulk          — bulk insert
//   autoMatchTransactions          — match system ↔ statement by amount + date
//   manualMatch                    — pair two lines by id
//   postReconciliationVariance     — finalise: post variance JE if any

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/errors/codes';
import { postJournalEntry, JournalLineInput } from './PostJournalEntry';

// ──────────────────────────────────────────────────────────────────────
// createBankReconciliation
// ──────────────────────────────────────────────────────────────────────

export interface CreateBankReconciliationInput {
  companyId: string;
  financialAccountId: string;
  statementDate: Date;
  statementOpeningBalance: number;
  statementClosingBalance: number;
  systemOpeningBalance?: number;
  /** Optional ISO date filter to import only payments since this date (inclusive). */
  importSince?: Date;
  createdBy: string;
}

export interface CreateBankReconciliationResult {
  reconciliationId: string;
  status: string;
  systemLinesImported: number;
  systemClosingBalance: string;
  variance: string;
}

export async function createBankReconciliation(
  tx: Prisma.TransactionClient,
  input: CreateBankReconciliationInput,
  correlationId: string,
): Promise<CreateBankReconciliationResult> {
  // Validate financial account
  const fa = await tx.financialAccount.findFirst({
    where: { id: input.financialAccountId, companyId: input.companyId, isActive: true },
    include: { chartOfAccount: true },
  });
  if (!fa) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Financial account not found', {}, 404);
  }

  // Compute system opening balance = sum of journal lines on this account up to (exclusive) statement_date
  let systemOpening = input.systemOpeningBalance;
  if (systemOpening === undefined) {
    const openingAgg = await tx.journalLine.aggregate({
      where: {
        companyId: input.companyId,
        chartOfAccountId: fa.chartOfAccountId,
        journalEntry: { entryDate: { lt: input.statementDate }, status: 'posted' },
      },
      _sum: { debitBase: true, creditBase: true },
    });
    // For an asset account, normal balance is debit → opening = debit − credit
    systemOpening = parseFloat(openingAgg._sum.debitBase?.toString() ?? '0') - parseFloat(openingAgg._sum.creditBase?.toString() ?? '0');
  }

  // Create the reconciliation header (status = draft; system_closing filled after import)
  const reconciliation = await tx.bankReconciliation.create({
    data: {
      companyId: input.companyId,
      financialAccountId: input.financialAccountId,
      statementDate: input.statementDate,
      statementOpeningBalance: input.statementOpeningBalance,
      statementClosingBalance: input.statementClosingBalance,
      systemOpeningBalance: systemOpening,
      systemClosingBalance: systemOpening, // provisional; updated after importing lines
      status: 'draft',
      variance: 0,
      createdBy: input.createdBy,
    },
  });

  // Auto-import system lines from payments tied to this financial account
  // for the period [importSince || statementDate - 30d, statementDate].
  const importSince = input.importSince ?? new Date(input.statementDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  const payments = await tx.payment.findMany({
    where: {
      companyId: input.companyId,
      financialAccountId: input.financialAccountId,
      paymentStatus: 'posted',
      businessDate: { gte: importSince, lte: input.statementDate },
    },
    orderBy: { businessDate: 'asc' },
    take: 1000,
  });

  let systemClosing = systemOpening;
  for (const p of payments) {
    const amount = parseFloat(p.amount.toString());
    // For an asset (cash/bank) account: incoming increases balance (+), outgoing decreases (−)
    const signedAmount = p.direction === 'incoming' ? amount : -amount;
    systemClosing += signedAmount;

    await tx.bankReconciliationLine.create({
      data: {
        companyId: input.companyId,
        reconciliationId: reconciliation.id,
        lineType: 'system',
        transactionDate: p.businessDate,
        description: `${p.paymentType} — ${p.referenceNo}${p.notes ? ' — ' + p.notes : ''}`,
        amount: signedAmount,
        referenceNo: p.referenceNo,
        paymentId: p.id,
        matchStatus: 'unmatched',
      },
    });
  }

  // Update header with final system_closing_balance + initial variance (statement − system)
  const variance = input.statementClosingBalance - systemClosing;
  await tx.bankReconciliation.update({
    where: { id: reconciliation.id },
    data: {
      systemClosingBalance: systemClosing,
      variance,
      unmatchedSystem: payments.length,
      status: 'in_progress',
    },
  });

  await tx.auditLog.create({
    data: {
      companyId: input.companyId,
      userId: input.createdBy,
      correlationId,
      action: 'bank_reconciliation.create',
      entityType: 'bank_reconciliation',
      entityId: reconciliation.id,
      afterValue: JSON.stringify({
        financial_account_id: input.financialAccountId,
        statement_date: input.statementDate,
        system_lines_imported: payments.length,
        system_closing: systemClosing,
        variance,
      }),
    },
  });

  return {
    reconciliationId: reconciliation.id,
    status: 'in_progress',
    systemLinesImported: payments.length,
    systemClosingBalance: systemClosing.toFixed(2),
    variance: variance.toFixed(2),
  };
}

// ──────────────────────────────────────────────────────────────────────
// addStatementLine / addStatementLinesBulk
// ──────────────────────────────────────────────────────────────────────

export interface StatementLineInput {
  transactionDate: Date;
  description: string;
  amount: number;     // signed: positive = credit (deposit), negative = debit (withdrawal)
  referenceNo?: string;
}

export async function addStatementLine(
  tx: Prisma.TransactionClient,
  params: { reconciliationId: string; companyId: string; line: StatementLineInput; userId: string },
  correlationId: string,
): Promise<{ lineId: string }> {
  const rec = await tx.bankReconciliation.findFirst({
    where: { id: params.reconciliationId, companyId: params.companyId },
  });
  if (!rec) throw new DomainError('RESOURCE_NOT_FOUND', 'Reconciliation not found', {}, 404);
  if (rec.status === 'reconciled') {
    throw new DomainError('VALIDATION_FAILED', 'Cannot add lines to a reconciled statement', {}, 409);
  }
  const line = await tx.bankReconciliationLine.create({
    data: {
      companyId: params.companyId,
      reconciliationId: params.reconciliationId,
      lineType: 'statement',
      transactionDate: params.line.transactionDate,
      description: params.line.description,
      amount: params.line.amount,
      referenceNo: params.line.referenceNo ?? null,
      matchStatus: 'unmatched',
    },
  });
  await updateUnmatchedCounts(tx, params.reconciliationId);
  await tx.auditLog.create({
    data: {
      companyId: params.companyId,
      userId: params.userId,
      correlationId,
      action: 'bank_reconciliation.statement_line_add',
      entityType: 'bank_reconciliation',
      entityId: params.reconciliationId,
      afterValue: JSON.stringify({ line_id: line.id, amount: params.line.amount }),
    },
  });
  return { lineId: line.id };
}

export async function addStatementLinesBulk(
  tx: Prisma.TransactionClient,
  params: { reconciliationId: string; companyId: string; lines: StatementLineInput[]; userId: string },
  correlationId: string,
): Promise<{ added: number }> {
  const rec = await tx.bankReconciliation.findFirst({
    where: { id: params.reconciliationId, companyId: params.companyId },
  });
  if (!rec) throw new DomainError('RESOURCE_NOT_FOUND', 'Reconciliation not found', {}, 404);
  if (rec.status === 'reconciled') {
    throw new DomainError('VALIDATION_FAILED', 'Cannot add lines to a reconciled statement', {}, 409);
  }
  if (params.lines.length === 0) return { added: 0 };

  await tx.bankReconciliationLine.createMany({
    data: params.lines.map(l => ({
      companyId: params.companyId,
      reconciliationId: params.reconciliationId,
      lineType: 'statement',
      transactionDate: l.transactionDate,
      description: l.description,
      amount: l.amount,
      referenceNo: l.referenceNo ?? null,
      matchStatus: 'unmatched' as const,
    })),
  });

  await updateUnmatchedCounts(tx, params.reconciliationId);
  await tx.auditLog.create({
    data: {
      companyId: params.companyId,
      userId: params.userId,
      correlationId,
      action: 'bank_reconciliation.statement_lines_bulk_add',
      entityType: 'bank_reconciliation',
      entityId: params.reconciliationId,
      afterValue: JSON.stringify({ added: params.lines.length }),
    },
  });
  return { added: params.lines.length };
}

// ──────────────────────────────────────────────────────────────────────
// autoMatchTransactions
// ──────────────────────────────────────────────────────────────────────

export interface AutoMatchResult {
  matched: number;
  unmatchedSystem: number;
  unmatchedStatement: number;
}

export async function autoMatchTransactions(
  tx: Prisma.TransactionClient,
  reconciliationId: string,
  correlationId: string,
): Promise<AutoMatchResult> {
  const rec = await tx.bankReconciliation.findFirst({ where: { id: reconciliationId } });
  if (!rec) throw new DomainError('RESOURCE_NOT_FOUND', 'Reconciliation not found', {}, 404);

  const systemLines = await tx.bankReconciliationLine.findMany({
    where: { reconciliationId, lineType: 'system', matchStatus: 'unmatched' },
    orderBy: { transactionDate: 'asc' },
  });
  const statementLines = await tx.bankReconciliationLine.findMany({
    where: { reconciliationId, lineType: 'statement', matchStatus: 'unmatched' },
    orderBy: { transactionDate: 'asc' },
  });

  // Match by amount (exact) + date (within ±3 days tolerance)
  let matched = 0;
  const usedStatementIds = new Set<string>();
  const DAY_MS = 1000 * 60 * 60 * 24;

  for (const s of systemLines) {
    const sAmount = parseFloat(s.amount.toString());
    for (const st of statementLines) {
      if (usedStatementIds.has(st.id)) continue;
      const stAmount = parseFloat(st.amount.toString());
      if (Math.abs(sAmount - stAmount) > 0.01) continue;
      const dateDiff = Math.abs(s.transactionDate.getTime() - st.transactionDate.getTime()) / DAY_MS;
      if (dateDiff > 3) continue;

      // Match found — update both lines
      const now = new Date();
      await tx.bankReconciliationLine.update({
        where: { id: s.id },
        data: {
          matchStatus: 'matched',
          matchMethod: 'auto_amount_date',
          matchedLineId: st.id,
          matchedAt: now,
          matchedBy: rec.createdBy,
        },
      });
      await tx.bankReconciliationLine.update({
        where: { id: st.id },
        data: {
          matchStatus: 'matched',
          matchMethod: 'auto_amount_date',
          matchedLineId: s.id,
          matchedAt: now,
          matchedBy: rec.createdBy,
        },
      });
      usedStatementIds.add(st.id);
      matched++;
      break;
    }
  }

  const counts = await updateUnmatchedCounts(tx, reconciliationId);

  await tx.auditLog.create({
    data: {
      companyId: rec.companyId,
      userId: rec.createdBy,
      correlationId,
      action: 'bank_reconciliation.auto_match',
      entityType: 'bank_reconciliation',
      entityId: reconciliationId,
      afterValue: JSON.stringify({ matched, ...counts }),
    },
  });

  return { matched, ...counts };
}

// ──────────────────────────────────────────────────────────────────────
// manualMatch
// ──────────────────────────────────────────────────────────────────────

export async function manualMatch(
  tx: Prisma.TransactionClient,
  params: { reconciliationId: string; systemLineId: string; statementLineId: string; companyId: string; userId: string },
  correlationId: string,
): Promise<{ matched: true }> {
  const [system, statement] = await Promise.all([
    tx.bankReconciliationLine.findFirst({ where: { id: params.systemLineId, reconciliationId: params.reconciliationId, lineType: 'system' } }),
    tx.bankReconciliationLine.findFirst({ where: { id: params.statementLineId, reconciliationId: params.reconciliationId, lineType: 'statement' } }),
  ]);
  if (!system) throw new DomainError('RESOURCE_NOT_FOUND', 'System line not found in this reconciliation', {}, 404);
  if (!statement) throw new DomainError('RESOURCE_NOT_FOUND', 'Statement line not found in this reconciliation', {}, 404);
  if (system.matchStatus === 'matched' || statement.matchStatus === 'matched') {
    throw new DomainError('VALIDATION_FAILED', 'One of the lines is already matched', {}, 409);
  }

  const now = new Date();
  await tx.bankReconciliationLine.update({
    where: { id: system.id },
    data: { matchStatus: 'manually_matched', matchMethod: 'manual', matchedLineId: statement.id, matchedAt: now, matchedBy: params.userId },
  });
  await tx.bankReconciliationLine.update({
    where: { id: statement.id },
    data: { matchStatus: 'manually_matched', matchMethod: 'manual', matchedLineId: system.id, matchedAt: now, matchedBy: params.userId },
  });

  await updateUnmatchedCounts(tx, params.reconciliationId);
  await tx.auditLog.create({
    data: {
      companyId: params.companyId,
      userId: params.userId,
      correlationId,
      action: 'bank_reconciliation.manual_match',
      entityType: 'bank_reconciliation',
      entityId: params.reconciliationId,
      afterValue: JSON.stringify({ system_line_id: params.systemLineId, statement_line_id: params.statementLineId }),
    },
  });
  return { matched: true };
}

// ──────────────────────────────────────────────────────────────────────
// postReconciliationVariance
// ──────────────────────────────────────────────────────────────────────

export interface PostVarianceResult {
  reconciliationId: string;
  status: string;
  variance: string;
  journalEntryNo: string | null;
}

export async function postReconciliationVariance(
  tx: Prisma.TransactionClient,
  reconciliationId: string,
  userId: string,
  correlationId: string,
): Promise<PostVarianceResult> {
  const rec = await tx.bankReconciliation.findFirst({ where: { id: reconciliationId } });
  if (!rec) throw new DomainError('RESOURCE_NOT_FOUND', 'Reconciliation not found', {}, 404);
  if (rec.status === 'reconciled') {
    throw new DomainError('VALIDATION_FAILED', 'Reconciliation is already finalised', {}, 409);
  }

  // Recompute counts + variance to be sure
  await updateUnmatchedCounts(tx, reconciliationId);
  const fresh = await tx.bankReconciliation.findFirst({ where: { id: reconciliationId } });
  if (!fresh) throw new DomainError('RESOURCE_NOT_FOUND', 'Reconciliation not found', {}, 404);

  const statementClosing = parseFloat(fresh.statementClosingBalance.toString());
  const systemClosing = parseFloat(fresh.systemClosingBalance.toString());
  const variance = statementClosing - systemClosing;

  let journalEntryNo: string | null = null;

  if (Math.abs(variance) > 0.01) {
    // Post a variance adjustment JE: Dr/Cr the financial account's GL account
    // against an expense (loss) or revenue (gain) — here we use the same GL
    // account (bank fee / variance) since no dedicated variance account exists.
    // The convention: positive variance (statement > system) means bank recorded
    // more than system → system needs to be adjusted up → Dr Bank, Cr Variance Revenue.
    // Negative variance: system > statement → Cr Bank, Dr Variance Expense.
    const fa = await tx.financialAccount.findFirst({
      where: { id: fresh.financialAccountId, companyId: fresh.companyId },
      include: { chartOfAccount: true },
    });
    if (!fa) throw new DomainError('RESOURCE_NOT_FOUND', 'Financial account not found', {}, 404);

    // Use the existing rounding/CoA account as the variance counterpart.
    // Prefer 'Rounding' (4300) if present, otherwise fall back to 'Miscellaneous Expense'.
    const counterpartCoa = await tx.chartOfAccount.findFirst({
      where: { companyId: fresh.companyId, accountSubtype: 'rounding', isActive: true },
    }) ?? await tx.chartOfAccount.findFirst({
      where: { companyId: fresh.companyId, accountSubtype: 'miscellaneous', isActive: true },
    });
    if (!counterpartCoa) {
      throw new DomainError('VALIDATION_FAILED', 'No rounding or miscellaneous CoA account found for variance adjustment', {}, 400);
    }

    const lines: JournalLineInput[] = [];
    if (variance > 0) {
      // Dr Bank, Cr Variance
      lines.push({
        chartOfAccountId: fa.chartOfAccountId,
        financialAccountId: fa.id,
        debit: variance,
        credit: 0,
        memo: `Bank reconciliation variance — ${rec.statementDate.toISOString().slice(0, 10)}`,
      });
      lines.push({
        chartOfAccountId: counterpartCoa.id,
        debit: 0,
        credit: variance,
        memo: `Reconciliation variance credit — ${rec.statementDate.toISOString().slice(0, 10)}`,
      });
    } else {
      // Cr Bank, Dr Variance
      const absVar = Math.abs(variance);
      lines.push({
        chartOfAccountId: counterpartCoa.id,
        debit: absVar,
        credit: 0,
        memo: `Reconciliation variance debit — ${rec.statementDate.toISOString().slice(0, 10)}`,
      });
      lines.push({
        chartOfAccountId: fa.chartOfAccountId,
        financialAccountId: fa.id,
        debit: 0,
        credit: absVar,
        memo: `Bank reconciliation variance — ${rec.statementDate.toISOString().slice(0, 10)}`,
      });
    }

    const je = await postJournalEntry(tx, {
      companyId: fresh.companyId,
      entryDate: fresh.statementDate,
      postingKind: 'bank_reconciliation_variance',
      sourceType: 'bank_reconciliation',
      sourceId: fresh.id,
      description: `Bank reconciliation variance: ${fresh.statementDate.toISOString().slice(0, 10)}`,
      currencyCode: fa.currencyCode,
      exchangeRate: 1.0,
      createdBy: userId,
      lines,
    }, correlationId);

    journalEntryNo = je.entryNo;

    await tx.bankReconciliation.update({
      where: { id: reconciliationId },
      data: {
        variance,
        journalEntryId: je.journalEntryId,
        status: 'has_variance',
        reconciledBy: userId,
        reconciledAt: new Date(),
      },
    });
  } else {
    // Zero variance → reconciled cleanly
    await tx.bankReconciliation.update({
      where: { id: reconciliationId },
      data: {
        variance: 0,
        status: 'reconciled',
        reconciledBy: userId,
        reconciledAt: new Date(),
      },
    });
  }

  await tx.auditLog.create({
    data: {
      companyId: rec.companyId,
      userId,
      correlationId,
      action: 'bank_reconciliation.finalise',
      entityType: 'bank_reconciliation',
      entityId: reconciliationId,
      afterValue: JSON.stringify({
        variance,
        status: Math.abs(variance) > 0.01 ? 'has_variance' : 'reconciled',
        journal_entry_no: journalEntryNo,
      }),
    },
  });

  return {
    reconciliationId,
    status: Math.abs(variance) > 0.01 ? 'has_variance' : 'reconciled',
    variance: variance.toFixed(2),
    journalEntryNo,
  };
}

// ──────────────────────────────────────────────────────────────────────
// helper: update unmatched counts + variance on the reconciliation header
// ──────────────────────────────────────────────────────────────────────

async function updateUnmatchedCounts(
  tx: Prisma.TransactionClient,
  reconciliationId: string,
): Promise<{ unmatchedSystem: number; unmatchedStatement: number; matchedTransactions: number }> {
  const [systemUnmatched, statementUnmatched, matchedCount] = await Promise.all([
    tx.bankReconciliationLine.count({ where: { reconciliationId, lineType: 'system', matchStatus: 'unmatched' } }),
    tx.bankReconciliationLine.count({ where: { reconciliationId, lineType: 'statement', matchStatus: 'unmatched' } }),
    tx.bankReconciliationLine.count({ where: { reconciliationId, lineType: 'system', matchStatus: { in: ['matched', 'manually_matched'] } } }),
  ]);

  await tx.bankReconciliation.update({
    where: { id: reconciliationId },
    data: {
      matchedTransactions: matchedCount,
      unmatchedSystem: systemUnmatched,
      unmatchedStatement: statementUnmatched,
    },
  });

  return { unmatchedSystem: systemUnmatched, unmatchedStatement: statementUnmatched, matchedTransactions: matchedCount };
}
