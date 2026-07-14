// src/domain/commands/m2/PostPurchaseReturn.ts
// PostPurchaseReturn per §7.7 — supplier return with stock issue + AP credit.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postStockMovement } from '@/domain/inventory/stockMovement';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

export interface PostPurchaseReturnInput {
  companyId: string;
  branchId: string;
  warehouseId: string;
  purchaseId: string;
  supplierId: string;
  postedBy: string;
  businessDate: Date;
  reason: string;
  items: Array<{
    purchaseItemId: string;
    qtyReturned: number;
  }>;
}

export async function postPurchaseReturn(
  tx: Prisma.TransactionClient, input: PostPurchaseReturnInput, correlationId: string,
): Promise<{ returnId: string; referenceNo: string; status: string; totalCredit: string }> {
  const purchase = await tx.purchase.findFirst({
    where: { id: input.purchaseId, companyId: input.companyId },
    include: { items: true },
  });
  if (!purchase) throw new DomainError('RESOURCE_NOT_FOUND', 'Purchase not found', {}, 404);

  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId, branchId: input.branchId,
    documentType: 'PURCHASE_RETURN', fiscalYear: input.businessDate.getFullYear(), prefix: 'PRET-',
  });

  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: { id: eventId, companyId: input.companyId, eventType: 'purchase_return.posted',
      sourceType: 'purchase_return', sourceId: referenceNo, correlationId, occurredAt: new Date() },
  });

  let subtotalCredit = 0;
  let eventLineNo = 1;

  const ret = await tx.purchaseReturn.create({
    data: { companyId: input.companyId, branchId: input.branchId, warehouseId: input.warehouseId,
      purchaseId: input.purchaseId, supplierId: input.supplierId, referenceNo, clientTxnId: randomUUID(),
      status: 'posted', businessDate: input.businessDate, reason: input.reason,
      subtotalCredit: 0, totalCredit: 0, baseTotalCredit: 0, postedAt: new Date(), createdBy: input.postedBy },
  });

  let lineNo = 1;
  const journalLines: Array<{ chartOfAccountId: string; debit: number; credit: number; memo?: string }> = [];
  const policies = await tx.accountingPolicy.findUnique({ where: { companyId: input.companyId } });

  for (const item of input.items) {
    const pi = purchase.items.find(p => p.id === item.purchaseItemId);
    if (!pi) throw new DomainError('VALIDATION_FAILED', `Purchase item ${item.purchaseItemId} not found`, {}, 400);
    const qtyAlreadyReturned = parseFloat(pi.qtyReturned.toString());
    if (qtyAlreadyReturned + item.qtyReturned > parseFloat(pi.qtyReceived.toString())) {
      throw new DomainError('VALIDATION_FAILED', `Return exceeds received quantity`, {}, 409);
    }

    const inventoryCost = parseFloat(pi.unitCost.toString()) * parseFloat(purchase.exchangeRate.toString());
    const lineCredit = item.qtyReturned * inventoryCost;

    const retItem = await tx.purchaseReturnItem.create({
      data: { companyId: input.companyId, purchaseReturnId: ret.id, purchaseItemId: item.purchaseItemId,
        qtyReturned: item.qtyReturned, supplierUnitCredit: pi.unitCost, inventoryUnitCost: inventoryCost,
        lineCredit, taxCredit: 0, varianceAmount: 0 },
    });

    await postStockMovement(tx, {
      companyId: input.companyId, eventId, eventLineNo,
      warehouseId: input.warehouseId, productId: pi.productId,
      movementType: 'purchase_return_issue', qtyDelta: -item.qtyReturned,
      unitCost: inventoryCost,
      referenceType: 'purchase_return', referenceId: ret.id, sourceLineId: retItem.id,
      effectiveAt: input.businessDate, createdBy: input.postedBy,
    });
    eventLineNo++;
    subtotalCredit += lineCredit;
    lineNo++;

    await tx.purchaseItem.update({ where: { id: pi.id }, data: { qtyReturned: { increment: item.qtyReturned } } });
  }

  await tx.purchaseReturn.update({
    where: { id: ret.id },
    data: { subtotalCredit, totalCredit: subtotalCredit, baseTotalCredit: subtotalCredit },
  });

  // Journal: Dr AP, Cr Inventory (at current MAC)
  if (policies) {
    await postJournalEntry(tx, {
      companyId: input.companyId, entryDate: input.businessDate,
      postingKind: 'purchase_return', sourceType: 'purchase_return', sourceId: ret.id,
      description: `Purchase return ${referenceNo}`, currencyCode: 'BDT', exchangeRate: 1,
      createdBy: input.postedBy,
      lines: [
        { chartOfAccountId: policies.apAccountId, debit: subtotalCredit, credit: 0, memo: `AP credit ${referenceNo}` },
        { chartOfAccountId: policies.inventoryAccountId, debit: 0, credit: subtotalCredit, memo: `Inventory returned ${referenceNo}` },
      ],
    }, correlationId);
  }

  await tx.auditLog.create({
    data: { companyId: input.companyId, userId: input.postedBy, correlationId,
      action: 'purchase_return.post', entityType: 'purchase_return', entityId: ret.id,
      afterValue: JSON.stringify({ reference_no: referenceNo, total_credit: subtotalCredit }) },
  });

  return { returnId: ret.id, referenceNo, status: 'posted', totalCredit: subtotalCredit.toFixed(2) };
}
