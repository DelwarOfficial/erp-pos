// src/domain/commands/m3/Payments.ts
// Payment-related commands: ApplyCustomerAdvance, PostAccountTransfer, ReversePayment,
// ClearCheque, BounceCheque, CancelCheque, PostAccountAdjustment, PostJournalAdjustment.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

// ── ApplyCustomerAdvance ──
export async function applyCustomerAdvance(
  tx: Prisma.TransactionClient,
  params: { companyId: string; customerId: string; paymentId: string; saleId: string; amount: number; appliedBy: string },
  correlationId: string,
): Promise<{ allocationId: string }> {
  const policies = await tx.accountingPolicy.findUnique({ where: { companyId: params.companyId } });
  if (!policies) throw new DomainError('VALIDATION_FAILED', 'Accounting policies not configured', {}, 400);

  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: { id: eventId, companyId: params.companyId, eventType: 'customer_advance.applied',
      sourceType: 'payment_allocation', sourceId: params.paymentId, correlationId, occurredAt: new Date() },
  });

  const allocation = await tx.paymentAllocation.create({
    data: { companyId: params.companyId, paymentId: params.paymentId, eventId, eventLineNo: 1,
      saleId: params.saleId, allocationSource: 'advance',
      allocatedAmount: params.amount, allocatedBaseAmount: params.amount, createdBy: params.appliedBy },
  });

  // Dr Customer Advance Liability, Cr AR
  await postJournalEntry(tx, {
    companyId: params.companyId, entryDate: new Date(),
    postingKind: 'customer_advance_applied', sourceType: 'payment_allocation', sourceId: allocation.id,
    description: `Advance applied to sale`, currencyCode: 'BDT', exchangeRate: 1, createdBy: params.appliedBy,
    lines: [
      { chartOfAccountId: policies.customerAdvanceAccountId, debit: params.amount, credit: 0, memo: 'Advance applied' },
      { chartOfAccountId: policies.arAccountId, debit: 0, credit: params.amount, memo: 'AR reduced' },
    ],
  }, correlationId);

  return { allocationId: allocation.id };
}

// ── PostAccountTransfer ──
export async function postAccountTransfer(
  tx: Prisma.TransactionClient,
  params: { companyId: string; branchId: string; fromFaId: string; toFaId: string;
    fromAmount: number; toAmount: number; exchangeRate: number; fee: number;
    businessDate: Date; postedBy: string; notes?: string },
  correlationId: string,
): Promise<{ transferId: string; journalEntryNo: string }> {
  if (params.fromFaId === params.toFaId) throw new DomainError('VALIDATION_FAILED', 'From and to accounts must differ', {}, 400);

  const { documentNumber: refNo } = await nextDocumentNumber(tx, {
    companyId: params.companyId, branchId: params.branchId,
    documentType: 'ACCOUNT_TRANSFER', fiscalYear: params.businessDate.getFullYear(), prefix: 'AT-',
  });

  const fromFa = await tx.financialAccount.findFirst({ where: { id: params.fromFaId, companyId: params.companyId }, include: { chartOfAccount: true } });
  const toFa = await tx.financialAccount.findFirst({ where: { id: params.toFaId, companyId: params.companyId }, include: { chartOfAccount: true } });
  if (!fromFa || !toFa) throw new DomainError('VALIDATION_FAILED', 'Financial account not found', {}, 404);

  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: { id: eventId, companyId: params.companyId, eventType: 'account_transfer.posted',
      sourceType: 'account_transfer', sourceId: refNo, correlationId, occurredAt: new Date() },
  });

  const lines = [
    { chartOfAccountId: toFa.chartOfAccountId, debit: params.toAmount, credit: 0, memo: `Transfer to ${toFa.name}` },
    { chartOfAccountId: fromFa.chartOfAccountId, debit: 0, credit: params.fromAmount, memo: `Transfer from ${fromFa.name}` },
  ];
  if (params.fee > 0) {
    const policies = await tx.accountingPolicy.findUnique({ where: { companyId: params.companyId } });
    if (policies?.chequeClearingAccountId) {
      lines.push({ chartOfAccountId: policies.chequeClearingAccountId, debit: params.fee, credit: 0, memo: 'Transfer fee' });
    }
  }

  const je = await postJournalEntry(tx, {
    companyId: params.companyId, entryDate: params.businessDate,
    postingKind: 'account_transfer', sourceType: 'account_transfer', sourceId: refNo,
    description: `Account transfer ${refNo}: ${fromFa.name} → ${toFa.name}`,
    currencyCode: 'BDT', exchangeRate: params.exchangeRate, createdBy: params.postedBy, lines,
  }, correlationId);

  return { transferId: refNo, journalEntryNo: je.entryNo };
}

// ── ReversePayment ──
export async function reversePayment(
  tx: Prisma.TransactionClient,
  params: { companyId: string; paymentId: string; reversedBy: string; reason: string },
  correlationId: string,
): Promise<{ reversedPaymentId: string }> {
  const payment = await tx.payment.findFirst({ where: { id: params.paymentId, companyId: params.companyId } });
  if (!payment) throw new DomainError('RESOURCE_NOT_FOUND', 'Payment not found', {}, 404);
  if (payment.paymentStatus === 'reversed') throw new DomainError('VALIDATION_FAILED', 'Payment already reversed', {}, 409);

  const { documentNumber: refNo } = await nextDocumentNumber(tx, {
    companyId: params.companyId, branchId: payment.branchId,
    documentType: 'PAYMENT_REVERSAL', fiscalYear: new Date().getFullYear(), prefix: 'PMT-REV-',
  });

  const reversedPayment = await tx.payment.create({
    data: { companyId: params.companyId, branchId: payment.branchId, referenceNo: refNo, clientTxnId: randomUUID(),
      paymentType: payment.paymentType === 'sale_receipt' ? 'sale_refund' : 'other',
      direction: payment.direction === 'incoming' ? 'outgoing' : 'incoming',
      customerId: payment.customerId, supplierId: payment.supplierId,
      financialAccountId: payment.financialAccountId, cashierShiftId: payment.cashierShiftId,
      currencyCode: payment.currencyCode, exchangeRate: payment.exchangeRate,
      amount: payment.amount, baseAmount: payment.baseAmount,
      paymentMethod: payment.paymentMethod, methodReference: payment.methodReference,
      chequeStatus: 'not_applicable', paymentStatus: 'posted', businessDate: payment.businessDate,
      receivedOrPaidAt: new Date(), reversedPaymentId: payment.id, postedAt: new Date(),
      createdBy: params.reversedBy, notes: `Reversal: ${params.reason}` },
  });

  await tx.payment.update({ where: { id: payment.id }, data: { paymentStatus: 'reversed' } });

  await tx.auditLog.create({
    data: { companyId: params.companyId, userId: params.reversedBy, correlationId,
      action: 'payment.reverse', entityType: 'payment', entityId: payment.id,
      afterValue: JSON.stringify({ reversed_by: reversedPayment.id, reason: params.reason }) },
  });

  return { reversedPaymentId: reversedPayment.id };
}

// ── Cheque commands ──
export async function clearCheque(tx: Prisma.TransactionClient, params: { companyId: string; paymentId: string; clearedBy: string }, correlationId: string) {
  return updateChequeStatus(tx, params.companyId, params.paymentId, 'cleared', params.clearedBy, correlationId, 'Cheque cleared');
}
export async function bounceCheque(tx: Prisma.TransactionClient, params: { companyId: string; paymentId: string; bouncedBy: string; reason: string }, correlationId: string) {
  return updateChequeStatus(tx, params.companyId, params.paymentId, 'bounced', params.bouncedBy, correlationId, params.reason);
}
export async function cancelCheque(tx: Prisma.TransactionClient, params: { companyId: string; paymentId: string; cancelledBy: string; reason: string }, correlationId: string) {
  return updateChequeStatus(tx, params.companyId, params.paymentId, 'cancelled', params.cancelledBy, correlationId, params.reason);
}

async function updateChequeStatus(tx: Prisma.TransactionClient, companyId: string, paymentId: string, newStatus: string, userId: string, correlationId: string, reason: string) {
  const payment = await tx.payment.findFirst({ where: { id: paymentId, companyId } });
  if (!payment) throw new DomainError('RESOURCE_NOT_FOUND', 'Payment not found', {}, 404);
  if (payment.paymentMethod !== 'cheque') throw new DomainError('VALIDATION_FAILED', 'Payment is not a cheque', {}, 400);
  if (!['pending_clearance'].includes(payment.chequeStatus)) {
    throw new DomainError('CHEQUE_STATUS_INVALID', `Cheque is ${payment.chequeStatus}, cannot change to ${newStatus}`, {}, 409);
  }
  await tx.payment.update({ where: { id: paymentId }, data: { chequeStatus: newStatus } });
  await tx.auditLog.create({
    data: { companyId, userId, correlationId, action: `cheque.${newStatus}`, entityType: 'payment', entityId: paymentId,
      afterValue: JSON.stringify({ cheque_status: newStatus, reason }) },
  });
  return { paymentId, chequeStatus: newStatus };
}

// ── PostJournalAdjustment ── (wrapper around postJournalEntry with manual_adjustment kind)
export { postJournalEntry as postJournalAdjustment };

// ── ReverseJournalEntry ── (re-export from m4)
export { reverseJournalEntry } from '../m4/PostJournalEntry';

// ── PostAccountAdjustment ──
export async function postAccountAdjustment(
  tx: Prisma.TransactionClient,
  params: { companyId: string; branchId: string; accountIds: string[]; debits: number[]; credits: number[];
    description: string; entryDate: Date; postedBy: string },
  correlationId: string,
): Promise<{ journalEntryNo: string }> {
  const lines = params.accountIds.map((id, i) => ({
    chartOfAccountId: id, debit: params.debits[i] || 0, credit: params.credits[i] || 0, branchId: params.branchId,
  }));
  const je = await postJournalEntry(tx, {
    companyId: params.companyId, entryDate: params.entryDate,
    postingKind: 'account_adjustment', sourceType: 'manual', sourceId: 'manual',
    description: params.description, currencyCode: 'BDT', exchangeRate: 1,
    createdBy: params.postedBy, lines,
  }, correlationId);
  return { journalEntryNo: je.entryNo };
}
