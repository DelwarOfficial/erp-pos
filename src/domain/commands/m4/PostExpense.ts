// src/domain/commands/m4/PostExpense.ts
// PostExpense domain command per §7.22 + §7 rule 2.
// Posts an expense with items + balanced journal entry (Dr Expense, Cr Cash/Bank).
// Extracted from the API route controller per §7 rule 2.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';
import { postJournalEntry, type JournalLineInput } from './PostJournalEntry';

export interface PostExpenseInput {
  companyId: string;
  branchId: string;
  expenseDate: Date;
  currencyCode: string;
  exchangeRate: number;
  description: string;
  supplierId?: string;
  payeeName?: string;
  financialAccountId: string;
  items: Array<{
    expenseCategoryId: string;
    description?: string;
    amount: number;
    taxAmount: number;
  }>;
  createdBy: string;
}

export interface PostExpenseResult {
  expenseId: string;
  referenceNo: string;
  status: string;
  grandTotal: number;
  journalEntryNo: string;
}

const EXPENSE_CATEGORY_BATCH_SIZE = 500;

export async function postExpense(
  tx: Prisma.TransactionClient,
  input: PostExpenseInput,
  correlationId: string,
): Promise<PostExpenseResult> {
  // Compute totals
  // Decimal throughout: summing JS floats and multiplying by the rate drifts
  // by a cent on multi-line foreign-currency expenses and unbalances the entry.
  const rate = new Prisma.Decimal(input.exchangeRate);
  const toBase = (value: Prisma.Decimal) => value.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  let subtotalDec = new Prisma.Decimal(0);
  let taxTotalDec = new Prisma.Decimal(0);
  let baseGrandTotal = new Prisma.Decimal(0);
  for (const item of input.items) {
    const amount = new Prisma.Decimal(item.amount);
    const tax = new Prisma.Decimal(item.taxAmount);
    subtotalDec = subtotalDec.plus(amount);
    taxTotalDec = taxTotalDec.plus(tax);
    // The credit is the sum of the per-line debits, so the entry balances by
    // construction whatever the rounding of each line.
    baseGrandTotal = baseGrandTotal.plus(toBase(amount.plus(tax)));
  }
  const subtotal = subtotalDec.toNumber();
  const taxTotal = taxTotalDec.toNumber();
  const grandTotal = subtotalDec.plus(taxTotalDec).toNumber();

  // Generate reference number
  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId, branchId: input.branchId,
    documentType: 'EXPENSE', fiscalYear: new Date(input.expenseDate).getFullYear(), prefix: 'EXP-',
  });

  // Above the company's expense approval threshold, the expense waits for
  // someone else to approve it and posts nothing until then (maker-checker).
  // Every expense used to post at once with the creator as its own approver.
  const { getApprovalThresholds } = await import('@/lib/approval/thresholds');
  // The requester's own expenses of the last 24 hours count too, so one large
  // expense split into sub-threshold pieces still waits for approval once the
  // running total crosses the threshold (workstream 7).
  const { checkCumulativeThreshold } = await import('@/lib/approval/cumulative');
  const cumulative = await checkCumulativeThreshold(tx, 'expense', { companyId: input.companyId, userId: input.createdBy,
    amountBase: baseGrandTotal, threshold: (await getApprovalThresholds(input.companyId)).expense_approval_threshold });
  const needsApproval = cumulative.required;

  // The paying account is checked now either way, so an approved expense cannot fail on it later.
  const fa = await tx.financialAccount.findFirst({
    where: { id: input.financialAccountId, companyId: input.companyId, isActive: true },
    include: { chartOfAccount: true },
  });
  if (!fa) throw new DomainError('VALIDATION_FAILED', 'Financial account not found', {}, 404);
  if (fa.branchId && fa.branchId !== input.branchId) throw new DomainError('VALIDATION_FAILED', 'That account belongs to another branch', {}, 400);

  // Create expense header
  const expense = await tx.expense.create({
    data: {
      companyId: input.companyId, branchId: input.branchId,
      referenceNo, clientTxnId: randomUUID(),
      supplierId: input.supplierId ?? null,
      payeeName: input.payeeName ?? null,
      status: needsApproval ? 'pending_approval' : 'posted',
      expenseDate: input.expenseDate,
      currencyCode: input.currencyCode, exchangeRate: input.exchangeRate,
      subtotal, taxTotal, grandTotal, baseGrandTotal,
      description: input.description,
      requestedBy: input.createdBy, approvedBy: needsApproval ? null : input.createdBy,
      postedAt: needsApproval ? null : new Date(),
    },
  });

  // Create expense items + build journal lines
  let lineNo = 1;
  const journalLines: JournalLineInput[] = [];

  const categoryIds = [...new Set(input.items.map(item => item.expenseCategoryId))];
  const categories: Prisma.ExpenseCategoryGetPayload<object>[] = [];
  for (let offset = 0; offset < categoryIds.length; offset += EXPENSE_CATEGORY_BATCH_SIZE) {
    categories.push(...await tx.expenseCategory.findMany({
      where: {
        companyId: input.companyId,
        isActive: true,
        id: { in: categoryIds.slice(offset, offset + EXPENSE_CATEGORY_BATCH_SIZE) },
      },
    }));
  }
  const categoryById = new Map(categories.map(category => [category.id, category]));

  for (const item of input.items) {
    const cat = categoryById.get(item.expenseCategoryId);
    if (!cat) throw new DomainError('VALIDATION_FAILED', 'Expense category not found', {}, 404);

    const baseAmount = toBase(new Prisma.Decimal(item.amount));
    // An expense line carries no tax component, so its tax has no input-VAT
    // account to go to: it is expensed with the line (non-recoverable). The
    // debit previously left tax out while the credit included it, so every
    // taxed expense was rejected as unbalanced.
    const baseDebit = toBase(new Prisma.Decimal(item.amount).plus(item.taxAmount));
    await tx.expenseItem.create({
      data: {
        companyId: input.companyId, expenseId: expense.id, lineNo,
        expenseCategoryId: item.expenseCategoryId,
        description: item.description ?? '',
        amount: item.amount, taxAmount: item.taxAmount,
        baseAmount,
      },
    });
    journalLines.push({ chartOfAccountId: cat.expenseAccountId, branchId: input.branchId, debit: baseDebit, credit: 0, memo: item.description });
    lineNo++;
  }

  if (needsApproval) {
    const request = await tx.approvalRequest.create({ data: {
      companyId: input.companyId, branchId: input.branchId, requestType: 'expense_approval',
      referenceType: 'expense', referenceId: expense.id, requestedBy: input.createdBy,
      reason: cumulative.single
        ? `Expense ${referenceNo} of ${baseGrandTotal.toFixed(2)} is above the approval threshold`
        : `Expense ${referenceNo} of ${baseGrandTotal.toFixed(2)} brings the requester's expenses in the last 24 hours to ${cumulative.cumulative}, above the approval threshold`,
      // What approval needs to post it: the account it is paid from.
      payload: JSON.stringify({ financial_account_id: fa.id }),
    } });
    await tx.expense.update({ where: { id: expense.id }, data: { approvalRequestId: request.id } });
    await tx.auditLog.create({ data: { companyId: input.companyId, userId: input.createdBy, correlationId,
      action: 'expense.submit', entityType: 'expense', entityId: expense.id,
      afterValue: JSON.stringify({ reference_no: referenceNo, grand_total: grandTotal, status: 'pending_approval',
        cumulative_base: cumulative.cumulative, threshold: cumulative.threshold, cumulative_trigger: !cumulative.single }) } });
    return { expenseId: expense.id, referenceNo, status: 'pending_approval', grandTotal, journalEntryNo: '' };
  }

  journalLines.push({ chartOfAccountId: fa.chartOfAccountId, financialAccountId: fa.id, branchId: input.branchId, debit: 0, credit: baseGrandTotal, memo: `Payment for ${referenceNo}` });
  const jeResult = await postJournalEntry(tx, {
    companyId: input.companyId, entryDate: input.expenseDate, postingKind: 'expense',
    sourceType: 'expense', sourceId: expense.id,
    description: `Expense ${referenceNo}: ${input.description}`,
    currencyCode: input.currencyCode, exchangeRate: input.exchangeRate, createdBy: input.createdBy,
    lines: journalLines,
  }, correlationId);
  await tx.expense.update({ where: { id: expense.id }, data: { journalEntryId: jeResult.journalEntryId } });

  // Audit log
  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.createdBy, correlationId,
      action: 'expense.post', entityType: 'expense', entityId: expense.id,
      afterValue: JSON.stringify({ reference_no: referenceNo, grand_total: grandTotal, je_no: jeResult.entryNo }),
    },
  });

  return {
    expenseId: expense.id,
    referenceNo,
    status: 'posted',
    grandTotal,
    journalEntryNo: jeResult.entryNo,
  };
}

/**
 * The expense's journal: Dr each line's expense account (tax included, as it
 * is not recoverable), Cr the paying account. Used when an expense posts at
 * once and when an approved expense is posted.
 */
export async function postExpenseJournal(
  tx: Prisma.TransactionClient,
  input: { companyId: string; expenseId: string; financialAccountId: string; postedBy: string },
  correlationId: string,
): Promise<{ journalEntryId: string; entryNo: string }> {
  const expense = await tx.expense.findFirstOrThrow({ where: { id: input.expenseId, companyId: input.companyId },
    include: { items: { include: { expenseCategory: { select: { expenseAccountId: true } } } } } });
  const fa = await tx.financialAccount.findFirst({ where: { id: input.financialAccountId, companyId: input.companyId, isActive: true } });
  if (!fa) throw new DomainError('VALIDATION_FAILED', 'The paying account is no longer active', {}, 409);
  const rate = new Prisma.Decimal(expense.exchangeRate);
  const toBase = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const lines = expense.items.map(item => ({
    chartOfAccountId: item.expenseCategory.expenseAccountId, branchId: expense.branchId,
    debit: toBase(new Prisma.Decimal(item.amount).plus(item.taxAmount)), credit: new Prisma.Decimal(0), memo: item.description,
  }));
  const total = lines.reduce((t, l) => t.plus(l.debit), new Prisma.Decimal(0));
  const je = await postJournalEntry(tx, {
    companyId: input.companyId, entryDate: expense.expenseDate, postingKind: 'expense',
    sourceType: 'expense', sourceId: expense.id,
    description: `Expense ${expense.referenceNo}: ${expense.description}`,
    currencyCode: expense.currencyCode, exchangeRate: Number(expense.exchangeRate), createdBy: input.postedBy,
    lines: [...lines, { chartOfAccountId: fa.chartOfAccountId, financialAccountId: fa.id, branchId: expense.branchId, debit: new Prisma.Decimal(0), credit: total, memo: `Payment for ${expense.referenceNo}` }],
  }, correlationId);
  await tx.expense.update({ where: { id: expense.id }, data: { journalEntryId: je.journalEntryId, status: 'posted', postedAt: new Date() } });
  return { journalEntryId: je.journalEntryId, entryNo: je.entryNo };
}
