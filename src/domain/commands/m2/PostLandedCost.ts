// src/domain/commands/m2/PostLandedCost.ts
// PostLandedCost per §7.24 + §5.8.
//
// Allocates a landed cost document (freight/insurance/customs/etc.) across
// purchase lines by quantity, value, weight, or manual. Recalculates the
// moving-average cost for already-received items.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

export interface PostLandedCostInput {
  companyId: string;
  purchaseId: string;
  costType: string;  // freight/insurance/customs/port/clearing/other
  supplierId?: string;
  currencyCode: string;
  exchangeRate: number;
  amount: number;  // in the landed-cost currency
  allocationMethod: string;  // quantity/value/weight/manual
  postedBy: string;
  manualAllocations?: Array<{ purchaseItemId: string; allocatedBaseAmount: number }>;
}

export async function postLandedCost(
  tx: Prisma.TransactionClient,
  input: PostLandedCostInput,
  correlationId: string,
): Promise<{ landedCostDocumentId: string; referenceNo: string; status: string; totalAllocated: number }> {
  if (input.amount <= 0) {
    throw new DomainError('VALIDATION_FAILED', 'Landed cost amount must be > 0', {}, 400);
  }

  const purchase = await tx.purchase.findFirst({
    where: { id: input.purchaseId, companyId: input.companyId },
    include: { items: true },
  });
  if (!purchase) throw new DomainError('RESOURCE_NOT_FOUND', 'Purchase not found', {}, 404);

  const baseAmount = input.amount * input.exchangeRate;

  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId,
    branchId: purchase.branchId,
    documentType: 'LANDED_COST',
    fiscalYear: new Date().getFullYear(),
    prefix: 'LC-',
  });

  const doc = await tx.landedCostDocument.create({
    data: {
      companyId: input.companyId,
      purchaseId: input.purchaseId,
      referenceNo,
      costType: input.costType,
      supplierId: input.supplierId ?? null,
      currencyCode: input.currencyCode,
      exchangeRate: input.exchangeRate,
      amount: input.amount,
      baseAmount,
      allocationMethod: input.allocationMethod,
      status: 'posted',
      createdBy: input.postedBy,
    },
  });

  // Compute allocations
  let totalAllocated = 0;
  const allocations: Array<{ purchaseItemId: string; allocatedBaseAmount: number }> = [];

  if (input.allocationMethod === 'manual') {
    if (!input.manualAllocations || input.manualAllocations.length === 0) {
      throw new DomainError('VALIDATION_FAILED', 'Manual allocation requires manualAllocations array', {}, 400);
    }
    allocations.push(...input.manualAllocations);
  } else {
    // Allocate by quantity or value of received items
    let totalBasis = 0;
    const basisMap = new Map<string, number>();
    for (const item of purchase.items) {
      const qtyReceived = parseFloat(item.qtyReceived.toString());
      if (qtyReceived <= 0) continue;
      let basis = qtyReceived;
      if (input.allocationMethod === 'value') {
        basis = qtyReceived * parseFloat(item.unitCost.toString());
      }
      basisMap.set(item.id, basis);
      totalBasis += basis;
    }
    if (totalBasis === 0) {
      throw new DomainError('VALIDATION_FAILED', 'No received items to allocate landed cost to', {}, 400);
    }
    for (const [itemId, basis] of basisMap) {
      allocations.push({
        purchaseItemId: itemId,
        allocatedBaseAmount: (baseAmount * basis) / totalBasis,
      });
    }
  }

  // Create allocation records + update purchase_items.allocated_landed_cost_per_unit
  for (const alloc of allocations) {
    const purchaseItem = purchase.items.find(pi => pi.id === alloc.purchaseItemId);
    if (!purchaseItem) continue;

    await tx.landedCostAllocation.create({
      data: {
        landedCostDocumentId: doc.id,
        purchaseItemId: alloc.purchaseItemId,
        allocatedBaseAmount: alloc.allocatedBaseAmount,
      },
    });

    // Update the per-unit landed cost on the purchase item
    const qtyReceived = parseFloat(purchaseItem.qtyReceived.toString());
    if (qtyReceived > 0) {
      const perUnitLanded = alloc.allocatedBaseAmount / qtyReceived;
      const existingLanded = parseFloat(purchaseItem.allocatedLandedCostPerUnit.toString());
      await tx.purchaseItem.update({
        where: { id: purchaseItem.id },
        data: { allocatedLandedCostPerUnit: existingLanded + perUnitLanded },
      });
    }

    totalAllocated += alloc.allocatedBaseAmount;
  }

  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.postedBy, correlationId,
      action: 'landed_cost.post', entityType: 'landed_cost_document', entityId: doc.id,
      afterValue: JSON.stringify({
        reference_no: referenceNo, purchase_id: input.purchaseId,
        cost_type: input.costType, base_amount: baseAmount, allocated: totalAllocated,
      }),
    },
  });

  return { landedCostDocumentId: doc.id, referenceNo, status: 'posted', totalAllocated };
}
