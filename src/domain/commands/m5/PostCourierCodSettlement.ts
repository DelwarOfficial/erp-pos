// src/domain/commands/m5/PostCourierCodSettlement.ts
// PostCourierCodSettlement per §7.24 + §20.D14.
//
// Posts a courier COD settlement batch:
//   Dr Cash/Bank (net received)
//   Dr Courier Fee Expense
//   Dr/Cr Settlement Adjustment
//   Cr Courier COD Receivable (gross COD)

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

  // Compute totals
  let grossCod = 0;
  let totalFee = 0;
  let totalAdjustment = 0;
  for (const item of input.items) {
    grossCod += item.codAmount;
    totalFee += item.feeAmount;
    totalAdjustment += item.adjustmentAmount;
  }
  const netReceived = grossCod - totalFee + totalAdjustment;
  if (netReceived < 0) {
    throw new DomainError('VALIDATION_FAILED', 'Net received amount cannot be negative', {}, 400);
  }

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

  // Post journal entry:
  //   Dr Cash/Bank (net received)
  //   Dr Courier Fee Expense
  //   Dr/Cr Settlement Adjustment (positive = Dr, negative = Cr)
  //   Cr Courier COD Receivable (gross COD)
  const journalLines: Array<{ chartOfAccountId: string; debit: number; credit: number; memo?: string }> = [
    {
      chartOfAccountId: fa.chartOfAccountId,
      debit: netReceived, credit: 0,
      memo: `Net received from ${input.courierCode}`,
    },
    {
      chartOfAccountId: policies.courierClearingAccountId!,  // Courier Fee Expense (5300)
      debit: totalFee, credit: 0,
      memo: `Courier fee for ${referenceNo}`,
    },
  ];

  // Settlement adjustment (positive = extra debit, negative = credit)
  if (totalAdjustment > 0) {
    journalLines.push({
      chartOfAccountId: policies.courierClearingAccountId!,
      debit: totalAdjustment, credit: 0,
      memo: `Settlement adjustment (debit)`,
    });
  } else if (totalAdjustment < 0) {
    journalLines.push({
      chartOfAccountId: policies.courierClearingAccountId!,
      debit: 0, credit: Math.abs(totalAdjustment),
      memo: `Settlement adjustment (credit)`,
    });
  }

  // Credit the COD receivable for the gross COD amount
  journalLines.push({
    chartOfAccountId: policies.courierClearingAccountId!,  // Courier COD Receivable (1400)
    debit: 0, credit: grossCod,
    memo: `COD clearing for ${referenceNo}`,
  });

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
