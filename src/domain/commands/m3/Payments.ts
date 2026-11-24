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
    // The business date of the document being reversed, not today: a December
    // payment reversed on 2 January belongs to December's sequence.
    documentType: 'PAYMENT_REVERSAL', fiscalYear: payment.businessDate.getFullYear(), prefix: 'PMT-REV-',
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

  // Reverse the cash movement in the general ledger.
  //
  // This command previously moved the payments subledger and left the GL
  // untouched, so every cheque bounce and manual reversal put the cash and
  // counterparty balances permanently out of step with the subledger and bank
  // reconciliation could not balance.
  //
  // The legs mirror the original posting (see the manual payment route): the
  // cash or bank account against the counterparty control account, swapped.
  const financialAccount = await tx.financialAccount.findFirst({
    where: { id: payment.financialAccountId, companyId: params.companyId },
    select: { chartOfAccountId: true },
  });
  const policies = await tx.accountingPolicy.findUnique({ where: { companyId: params.companyId } });
  if (!financialAccount || !policies) {
    throw new DomainError('VALIDATION_FAILED',
      'A financial account and accounting policies are required to reverse a payment', {}, 409);
  }

  let counterAccountId = policies.arAccountId;
  if (payment.paymentType === 'purchase_payment') counterAccountId = policies.apAccountId;
  else if (payment.paymentType === 'customer_advance') counterAccountId = policies.customerAdvanceAccountId;
  else if (payment.paymentType === 'supplier_advance') counterAccountId = policies.supplierAdvanceAccountId;

  // The original debited cash when incoming; the reversal credits it.
  const cashCredit = payment.direction === 'incoming' ? payment.baseAmount : new Prisma.Decimal(0);
  const cashDebit = payment.direction === 'outgoing' ? payment.baseAmount : new Prisma.Decimal(0);

  await postJournalEntry(tx, {
    companyId: params.companyId,
    entryDate: payment.businessDate,
    postingKind: 'payment_reversal',
    sourceType: 'payment', sourceId: reversedPayment.id,
    description: `Payment reversal ${refNo}: ${params.reason}`,
    currencyCode: payment.currencyCode,
    exchangeRate: parseFloat(payment.exchangeRate.toString()),
    createdBy: params.reversedBy,
    lines: [
      { chartOfAccountId: financialAccount.chartOfAccountId, debit: cashDebit, credit: cashCredit,
        branchId: payment.branchId, memo: `Reversal of ${payment.referenceNo}` },
      { chartOfAccountId: counterAccountId, debit: cashCredit, credit: cashDebit,
        branchId: payment.branchId, memo: `Counterparty for ${refNo}` },
    ],
  }, correlationId);

  await tx.auditLog.create({
    data: { companyId: params.companyId, userId: params.reversedBy, correlationId,
      action: 'payment.reverse', entityType: 'payment', entityId: payment.id,
      afterValue: JSON.stringify({ reversed_by: reversedPayment.id, reason: params.reason }) },
  });

  return { reversedPaymentId: reversedPayment.id };
}

/// ── Cheque commands ──
// Red-team workstream 8. A cheque received is not cash until the bank clears
// it. It is booked to the cheque-clearing account (accounting policy) and
// only moves to the cash/bank account when cleared; a bounce reverses it back
// to whatever it settled (receivable, or the customer-advance liability) and
// marks the payment reversed, so balances that count posted payments see the
// money as owed again. Cheques booked before this change went straight to
// cash; those clear without a journal and bounce out of cash.

/** The ledger account an incoming payment's money lands on: cheque clearing for a cheque, else the payment account. */
export async function receiptDebitAccount(
  tx: Prisma.TransactionClient, companyId: string, paymentMethod: string,
  financialAccount: { id: string; chartOfAccountId: string },
): Promise<{ chartOfAccountId: string; financialAccountId?: string }> {
  if (paymentMethod !== 'cheque') return { chartOfAccountId: financialAccount.chartOfAccountId, financialAccountId: financialAccount.id };
  const policy = await tx.accountingPolicy.findUnique({ where: { companyId }, select: { chequeClearingAccountId: true } });
  if (!policy?.chequeClearingAccountId) {
    throw new DomainError('VALIDATION_FAILED', 'Set a cheque clearing account in accounting policies before taking cheques', {}, 409);
  }
  return { chartOfAccountId: policy.chequeClearingAccountId };
}

async function pendingCheque(tx: Prisma.TransactionClient, companyId: string, paymentId: string, newStatus: string) {
  const payment = await tx.payment.findFirst({
    where: { id: paymentId, companyId },
    include: { financialAccount: { select: { chartOfAccountId: true } }, allocations: { select: { saleId: true } } },
  });
  if (!payment) throw new DomainError('RESOURCE_NOT_FOUND', 'Payment not found', {}, 404);
  if (payment.paymentMethod !== 'cheque') throw new DomainError('VALIDATION_FAILED', 'Payment is not a cheque', {}, 400);
  if (payment.chequeStatus !== 'pending_clearance' || payment.paymentStatus !== 'posted') {
    throw new DomainError('CHEQUE_STATUS_INVALID', `Cheque is ${payment.chequeStatus}, cannot change to ${newStatus}`, {}, 409);
  }
  if (payment.direction !== 'incoming') throw new DomainError('VALIDATION_FAILED', 'Only cheques received can be cleared or bounced here', {}, 400);
  const policy = await tx.accountingPolicy.findUnique({ where: { companyId } });
  if (!policy) throw new DomainError('VALIDATION_FAILED', 'Accounting policies are not configured', {}, 409);
  // Where the receipt was booked: on clearing for cheques taken since
  // workstream 8, on the cash account before it.
  // A sale posts its receipts under "<sale>:revenue".
  const sourceIds = [payment.id, ...payment.allocations.flatMap(a => (a.saleId ? [`${a.saleId}:revenue`] : []))];
  const onClearing = !!policy.chequeClearingAccountId && !!await tx.journalLine.findFirst({
    where: { companyId, chartOfAccountId: policy.chequeClearingAccountId, debitBase: { gt: 0 }, journalEntry: { companyId, sourceId: { in: sourceIds } } },
    select: { id: true },
  });
  return { payment, policy, heldAccountId: onClearing ? policy.chequeClearingAccountId! : payment.financialAccount.chartOfAccountId, onClearing };
}

export async function clearCheque(tx: Prisma.TransactionClient, params: { companyId: string; paymentId: string; clearedBy: string }, correlationId: string) {
  const { payment, heldAccountId, onClearing } = await pendingCheque(tx, params.companyId, params.paymentId, 'cleared');
  if (onClearing) {
    await postJournalEntry(tx, {
      companyId: params.companyId, entryDate: new Date(), postingKind: 'cheque_clearance',
      sourceType: 'payment', sourceId: `${payment.id}:cleared`,
      description: `Cheque ${payment.referenceNo} cleared`,
      currencyCode: 'BDT', exchangeRate: 1, createdBy: params.clearedBy,
      lines: [
        { chartOfAccountId: payment.financialAccount.chartOfAccountId, financialAccountId: payment.financialAccountId, branchId: payment.branchId,
          debit: payment.baseAmount, credit: 0, memo: `Cheque ${payment.referenceNo} cleared` },
        { chartOfAccountId: heldAccountId, branchId: payment.branchId, debit: 0, credit: payment.baseAmount, memo: `Cheque ${payment.referenceNo} cleared` },
      ],
    }, correlationId);
  }
  await tx.payment.update({ where: { id: payment.id }, data: { chequeStatus: 'cleared' } });
  await tx.auditLog.create({
    data: { companyId: params.companyId, userId: params.clearedBy, correlationId, action: 'cheque.cleared', entityType: 'payment', entityId: payment.id,
      afterValue: JSON.stringify({ cheque_status: 'cleared', amount_base: payment.baseAmount.toFixed(2), moved_from_clearing: onClearing }) },
  });
  return { paymentId: payment.id, chequeStatus: 'cleared' };
}

export async function bounceCheque(tx: Prisma.TransactionClient, params: { companyId: string; paymentId: string; bouncedBy: string; reason: string }, correlationId: string) {
  const { payment, policy, heldAccountId, onClearing } = await pendingCheque(tx, params.companyId, params.paymentId, 'bounced');
  const advance = payment.paymentType === 'customer_advance';
  await postJournalEntry(tx, {
    companyId: params.companyId, entryDate: new Date(), postingKind: 'cheque_bounce',
    sourceType: 'payment', sourceId: `${payment.id}:bounced`,
    description: `Cheque ${payment.referenceNo} bounced: ${params.reason}`,
    currencyCode: 'BDT', exchangeRate: 1, createdBy: params.bouncedBy,
    lines: [
      // What the cheque settled is owed again.
      { chartOfAccountId: advance ? policy.customerAdvanceAccountId : policy.arAccountId, customerId: advance ? undefined : payment.customerId ?? undefined,
        branchId: payment.branchId, debit: payment.baseAmount, credit: 0, memo: `Bounced cheque ${payment.referenceNo}` },
      { chartOfAccountId: heldAccountId, financialAccountId: onClearing ? undefined : payment.financialAccountId, branchId: payment.branchId,
        debit: 0, credit: payment.baseAmount, memo: `Bounced cheque ${payment.referenceNo}` },
    ],
  }, correlationId);
  if (advance && payment.customerId) {
    // The advance it funded can no longer be spent.
    const eventId = randomUUID();
    await tx.businessEvent.create({ data: { id: eventId, companyId: params.companyId, eventType: 'customer_advance.reversed',
      sourceType: 'payment', sourceId: payment.id, correlationId, occurredAt: new Date() } });
    await tx.customerAdvanceLedger.create({ data: { companyId: params.companyId, customerId: payment.customerId, paymentId: payment.id,
      entryType: 'reversed', amountDelta: payment.amount.neg(), baseAmountDelta: payment.baseAmount.neg(), eventId, eventLineNo: 1, createdBy: params.bouncedBy } });
  }
  // Reversed: balances that count posted payments treat the dues as open again.
  await tx.payment.update({ where: { id: payment.id }, data: { chequeStatus: 'bounced', paymentStatus: 'reversed' } });
  await tx.auditLog.create({
    data: { companyId: params.companyId, userId: params.bouncedBy, correlationId, action: 'cheque.bounced', entityType: 'payment', entityId: payment.id,
      afterValue: JSON.stringify({ cheque_status: 'bounced', payment_status: 'reversed', reason: params.reason, amount_base: payment.baseAmount.toFixed(2) }) },
  });
  return { paymentId: payment.id, chequeStatus: 'bounced' };
}

export async function cancelCheque(tx: Prisma.TransactionClient, params: { companyId: string; paymentId: string; cancelledBy: string; reason: string }, correlationId: string) {
  // A cancelled cheque never paid: it is accounted for exactly like a bounce.
  return bounceCheque(tx, { companyId: params.companyId, paymentId: params.paymentId, bouncedBy: params.cancelledBy, reason: `Cancelled: ${params.reason}` }, correlationId);
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
