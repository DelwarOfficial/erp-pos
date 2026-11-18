// src/domain/commands/m5/PostCourierCodSettlement.ts
// PostCourierCodSettlement per §7.24 + §20.D14.
//
// Posts a courier COD settlement batch:
//   Dr Cash/Bank (net received = gross COD - fee + adjustment)
//   Dr Courier fee expense (fee withheld by the courier)
//   Cr/Dr Courier fee expense (adjustment: positive = courier paid more, so credit)
//   Cr Courier clearing (gross COD)
//
// The fee and the adjustment are expensed to the chart's courier fee account
// (subtype courier_fee; 5300 in the default chart), so clearing nets to zero.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

export interface PostCodSettlementInput {
  companyId: string;
  branchId: string;
  courierCode: string;
  settlementDate: Date;
  financialAccountId: string;
  postedBy: string;
  items: Array<{
    deliveryOrderId: string;
    codAmount: number;
    feeAmount: number;
    adjustmentAmount: number;
  }>;
}

export async function postCourierCodSettlement(
  tx: Prisma.TransactionClient,
  input: PostCodSettlementInput,
  correlationId: string,
): Promise<{ settlementId: string; referenceNo: string; status: string; journalEntryNo: string }> {
  // Load accounting policies to get the COD clearing + courier fee accounts
  const policies = await tx.accountingPolicy.findUnique({
    where: { companyId: input.companyId },
  });
  if (!policies) {
    throw new DomainError('VALIDATION_FAILED', 'Accounting policies not configured — run onboarding or seed CoA', {}, 400);
  }

  if (!policies.courierClearingAccountId) {
    throw new DomainError('VALIDATION_FAILED', 'Courier clearing account is not configured in accounting policies', {}, 400);
  }
  const clearingAccountId = policies.courierClearingAccountId;

  // Every item must be a delivered courier order of this company and courier
  // that has not been settled before. The request previously chose the
  // delivery order ids and COD amounts freely.
  const orderIds = input.items.map(item => item.deliveryOrderId);
  if (new Set(orderIds).size !== orderIds.length) {
    throw new DomainError('VALIDATION_FAILED', 'A delivery order appears more than once in the settlement', {}, 400);
  }
  const orders = await tx.deliveryOrder.findMany({
    where: { companyId: input.companyId, id: { in: orderIds } },
    select: { id: true, referenceNo: true, status: true, deliveryMethod: true, courierCode: true, codAmount: true,
      codSettlementItems: { select: { settlementId: true } } },
  });
  const orderById = new Map(orders.map(order => [order.id, order]));
  for (const item of input.items) {
    const order = orderById.get(item.deliveryOrderId);
    if (!order) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Delivery order not found', { delivery_order_id: item.deliveryOrderId }, 404);
    }
    if (order.deliveryMethod !== 'courier' || order.courierCode !== input.courierCode) {
      throw new DomainError('VALIDATION_FAILED', `Delivery ${order.referenceNo} was not shipped with ${input.courierCode}`, {}, 400);
    }
    if (order.status !== 'delivered') {
      throw new DomainError('VALIDATION_FAILED', `Delivery ${order.referenceNo} is not delivered`, { status: order.status }, 409);
    }
    if (order.codSettlementItems.length > 0) {
      throw new DomainError('VALIDATION_FAILED', `Delivery ${order.referenceNo} is already settled`, {}, 409);
    }
    if (new Prisma.Decimal(item.codAmount).gt(order.codAmount)) {
      throw new DomainError('VALIDATION_FAILED',
        `COD amount for ${order.referenceNo} exceeds the order's COD of ${order.codAmount.toFixed(2)}`, {}, 400);
    }
  }

  // Compute totals in Decimal: float sums drift by a cent over a long batch.
  let grossCodDec = new Prisma.Decimal(0);
  let totalFeeDec = new Prisma.Decimal(0);
  let totalAdjustmentDec = new Prisma.Decimal(0);
  for (const item of input.items) {
    grossCodDec = grossCodDec.plus(item.codAmount);
    totalFeeDec = totalFeeDec.plus(item.feeAmount);
    totalAdjustmentDec = totalAdjustmentDec.plus(item.adjustmentAmount);
  }
  const netReceivedDec = grossCodDec.minus(totalFeeDec).plus(totalAdjustmentDec);
  if (netReceivedDec.lt(0)) {
    throw new DomainError('VALIDATION_FAILED', 'Net received amount cannot be negative', {}, 400);
  }
  const grossCod = grossCodDec.toNumber();
  const totalFee = totalFeeDec.toNumber();
  const totalAdjustment = totalAdjustmentDec.toNumber();
  const netReceived = netReceivedDec.toNumber();

  // Generate reference number
  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId, branchId: input.branchId,
    documentType: 'COD_SETTLEMENT', fiscalYear: new Date(input.settlementDate).getFullYear(), prefix: 'CS-',
  });

  // Create the settlement header
  const settlement = await tx.courierCodSettlement.create({
    data: {
      companyId: input.companyId, branchId: input.branchId,
      referenceNo, courierCode: input.courierCode,
      settlementDate: input.settlementDate,
      grossCodAmount: grossCod, feeAmount: totalFee,
      adjustmentAmount: totalAdjustment, netReceivedAmount: netReceived,
      status: 'posted',
      financialAccountId: input.financialAccountId,
      createdBy: input.postedBy, postedAt: new Date(),
    },
  });

  // Create settlement items
  for (const item of input.items) {
    await tx.courierCodSettlementItem.create({
      data: {
        settlementId: settlement.id,
        deliveryOrderId: item.deliveryOrderId,
        codAmount: item.codAmount,
        feeAmount: item.feeAmount,
        adjustmentAmount: item.adjustmentAmount,
      },
    });
  }

  // Load financial account to get the cash/bank GL account
  const fa = await tx.financialAccount.findFirst({
    where: { id: input.financialAccountId, companyId: input.companyId },
    include: { chartOfAccount: true },
  });
  if (!fa) throw new DomainError('VALIDATION_FAILED', 'Financial account not found', {}, 404);
  if (fa.branchId && fa.branchId !== input.branchId) throw new DomainError('VALIDATION_FAILED', 'That account belongs to another branch', {}, 400);

  // The courier's fee, and any difference in what it paid, is a delivery
  // cost: it goes to the courier fee expense account (5300 in the default
  // chart), so the COD clearing account is cleared by exactly the COD
  // collected. It used to stay on the clearing account, which then never
  // reconciled to zero and hid the expense.
  const feeAccount = (totalFeeDec.gt(0) || !totalAdjustmentDec.isZero())
    ? await tx.chartOfAccount.findFirst({ where: { companyId: input.companyId, accountSubtype: 'courier_fee', isActive: true }, select: { id: true } })
    : null;
  if ((totalFeeDec.gt(0) || !totalAdjustmentDec.isZero()) && !feeAccount) {
    throw new DomainError('VALIDATION_FAILED', 'Add an active expense account of type "courier fee" to the chart of accounts before settling with a fee', {}, 409);
  }

  // Post journal entry. Debits: net + fee (+ |adjustment| when negative).
  // Credits: gross (+ adjustment when positive). With net = gross - fee +
  // adjustment both sides equal gross + max(adjustment, 0). The adjustment
  // was previously on the opposite side, which left every adjusted settlement
  // unbalanced by twice the adjustment; zero-amount lines are skipped because
  // the journal rejects them.
  const zero = new Prisma.Decimal(0);
  const journalLines: Array<{ chartOfAccountId: string; financialAccountId?: string; branchId: string; debit: Prisma.Decimal; credit: Prisma.Decimal; memo?: string }> = [];
  const branchId = input.branchId;
  if (netReceivedDec.gt(0)) {
    journalLines.push({ chartOfAccountId: fa.chartOfAccountId, financialAccountId: fa.id, branchId, debit: netReceivedDec, credit: zero,
      memo: `Net received from ${input.courierCode}` });
  }
  if (totalFeeDec.gt(0)) {
    journalLines.push({ chartOfAccountId: feeAccount!.id, branchId, debit: totalFeeDec, credit: zero,
      memo: `Courier fee for ${referenceNo}` });
  }
  if (totalAdjustmentDec.gt(0)) {
    journalLines.push({ chartOfAccountId: feeAccount!.id, branchId, debit: zero, credit: totalAdjustmentDec,
      memo: 'Settlement adjustment (courier paid more)' });
  } else if (totalAdjustmentDec.lt(0)) {
    journalLines.push({ chartOfAccountId: feeAccount!.id, branchId, debit: totalAdjustmentDec.abs(), credit: zero,
      memo: 'Settlement adjustment (courier paid less)' });
  }
  if (grossCodDec.gt(0)) {
    journalLines.push({ chartOfAccountId: clearingAccountId, branchId, debit: zero, credit: grossCodDec,
      memo: `COD clearing for ${referenceNo}` });
  }

  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: {
      id: eventId, companyId: input.companyId,
      eventType: 'courier_cod_settlement.posted',
      sourceType: 'courier_cod_settlement', sourceId: settlement.id,
      correlationId, occurredAt: new Date(),
    },
  });

  const jeResult = await postJournalEntry(tx, {
    companyId: input.companyId,
    entryDate: input.settlementDate,
    postingKind: 'courier_cod_settlement',
    sourceType: 'courier_cod_settlement', sourceId: settlement.id,
    description: `COD Settlement ${referenceNo} — ${input.courierCode}`,
    currencyCode: 'BDT', exchangeRate: 1,
    createdBy: input.postedBy,
    lines: journalLines,
  }, correlationId);

  // Link journal entry to settlement
  await tx.courierCodSettlement.update({
    where: { id: settlement.id },
    data: { journalEntryId: jeResult.journalEntryId },
  });

  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.postedBy, correlationId,
      action: 'courier_cod_settlement.post', entityType: 'courier_cod_settlement', entityId: settlement.id,
      afterValue: JSON.stringify({
        reference_no: referenceNo, gross_cod: grossCod, fee: totalFee,
        adjustment: totalAdjustment, net_received: netReceived, je_no: jeResult.entryNo,
      }),
    },
  });

  return {
    settlementId: settlement.id,
    referenceNo,
    status: 'posted',
    journalEntryNo: jeResult.entryNo,
  };
}
