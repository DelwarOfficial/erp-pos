// src/domain/commands/m4/PostExpense.ts
// PostExpense domain command per §7.22 + §7 rule 2.
// Posts an expense with items + balanced journal entry (Dr Expense, Cr Cash/Bank).
// Extracted from the API route controller per §7 rule 2.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';
import { postJournalEntry } from './PostJournalEntry';

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

  // Create expense header
  const expense = await tx.expense.create({
    data: {
      companyId: input.companyId, branchId: input.branchId,
      referenceNo, clientTxnId: randomUUID(),
      supplierId: input.supplierId ?? null,
      payeeName: input.payeeName ?? null,
      status: 'posted',
      expenseDate: input.expenseDate,
      currencyCode: input.currencyCode, exchangeRate: input.exchangeRate,
      subtotal, taxTotal, grandTotal, baseGrandTotal,
      description: input.description,
      requestedBy: input.createdBy, approvedBy: input.createdBy,
      postedAt: new Date(),
    },
  });

  // Create expense items + build journal lines
  let lineNo = 1;
  const journalLines: Array<{ chartOfAccountId: string; debit: number | Prisma.Decimal; credit: number | Prisma.Decimal; memo?: string }> = [];

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
    journalLines.push({
      chartOfAccountId: cat.expenseAccountId,
      debit: baseDebit, credit: 0,
      memo: item.description,
    });
    lineNo++;
  }

  // Get payment account for Cr side
  const fa = await tx.financialAccount.findFirst({
    where: { id: input.financialAccountId, companyId: input.companyId },
    include: { chartOfAccount: true },
  });
  if (!fa) throw new DomainError('VALIDATION_FAILED', 'Financial account not found', {}, 404);

  journalLines.push({
    chartOfAccountId: fa.chartOfAccountId,
    debit: 0, credit: baseGrandTotal,
    memo: `Payment for ${referenceNo}`,
  });

  // Post journal entry
  const jeResult = await postJournalEntry(tx, {
    companyId: input.companyId,
    entryDate: input.expenseDate,
    postingKind: 'expense',
    sourceType: 'expense', sourceId: expense.id,
    description: `Expense ${referenceNo}: ${input.description}`,
    currencyCode: input.currencyCode,
    exchangeRate: input.exchangeRate,
    createdBy: input.createdBy,
    lines: journalLines,
  }, correlationId);

  // Link journal entry to expense
  await tx.expense.update({
    where: { id: expense.id },
    data: { journalEntryId: jeResult.journalEntryId },
  });

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
