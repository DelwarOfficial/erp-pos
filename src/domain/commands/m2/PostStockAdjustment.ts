// src/domain/commands/m2/PostStockAdjustment.ts
// PostStockAdjustment per §7.19 + §5.5A.
//
// Posts an inventory adjustment (add/subtract/damage/writeoff/count_variance/correction).
// Each line creates a stock_movement (adjustment_in or adjustment_out) and updates MAC.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postStockMovement } from '@/domain/inventory/stockMovement';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

export interface PostStockAdjustmentInput {
  companyId: string;
  branchId: string;
  warehouseId: string;
  adjustmentType: string;  // add/subtract/damage/writeoff/reclassify/count_variance/correction
  reasonCodeId: string;
  businessDate: Date;
  notes: string;
  postedBy: string;
  items: Array<{
    productId: string;
    quantityDelta: number;  // positive for add, negative for subtract
    unitCost?: number;      // for inbound; uses MAC for outbound
  }>;
}

export async function postStockAdjustment(
  tx: Prisma.TransactionClient,
  input: PostStockAdjustmentInput,
  correlationId: string,
): Promise<{ adjustmentId: string; referenceNo: string; status: string; itemCount: number }> {
  const reasonCode = await tx.inventoryReasonCode.findFirst({
    where: { id: input.reasonCodeId, companyId: input.companyId, isActive: true },
  });
  if (!reasonCode) throw new DomainError('VALIDATION_FAILED', 'Reason code not found', {}, 404);

  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId,
    branchId: input.branchId,
    documentType: 'STOCK_ADJUSTMENT',
    fiscalYear: new Date(input.businessDate).getFullYear(),
    prefix: 'SA-',
  });

  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: {
      id: eventId, companyId: input.companyId,
      eventType: 'stock_adjustment.posted', sourceType: 'stock_adjustment', sourceId: referenceNo,
      correlationId, occurredAt: new Date(),
    },
  });

  const adjustment = await tx.stockAdjustment.create({
    data: {
      companyId: input.companyId,
      branchId: input.branchId,
      warehouseId: input.warehouseId,
      referenceNo,
      clientTxnId: randomUUID(),
      adjustmentType: input.adjustmentType,
      reasonCodeId: input.reasonCodeId,
      status: 'posted',
      businessDate: input.businessDate,
      notes: input.notes,
      postedAt: new Date(),
      createdBy: input.postedBy,
    },
  });

  let eventLineNo = 1;
  let lineNo = 1;
  for (const item of input.items) {
    if (item.quantityDelta === 0) {
      throw new DomainError('VALIDATION_FAILED', `Line ${lineNo}: quantity_delta must be non-zero`, {}, 400);
    }

    const product = await tx.product.findFirst({
      where: { id: item.productId, companyId: input.companyId, deletedAt: null },
    });
    if (!product) throw new DomainError('VALIDATION_FAILED', `Product ${item.productId} not found`, {}, 404);

    const isInbound = item.quantityDelta > 0;
    const stock = await tx.warehouseStock.findUnique({
      where: {
        companyId_warehouseId_productId: {
          companyId: input.companyId, warehouseId: input.warehouseId, productId: item.productId,
        },
      },
    });
    const unitCost = isInbound
      ? (item.unitCost ?? 0)
      : (stock ? parseFloat(stock.movingAverageCost.toString()) : 0);
    const valueDelta = item.quantityDelta * unitCost;

    const adjustmentItem = await tx.stockAdjustmentItem.create({
      data: {
        companyId: input.companyId,
        stockAdjustmentId: adjustment.id,
        lineNo,
        productId: item.productId,
        quantityDelta: item.quantityDelta,
        unitCostSnapshot: unitCost,
        valueDelta,
        eventId,
      },
    });

    await postStockMovement(tx, {
      companyId: input.companyId, eventId, eventLineNo,
      warehouseId: input.warehouseId, productId: item.productId,
      movementType: isInbound ? 'adjustment_in' : 'adjustment_out',
      qtyDelta: item.quantityDelta,
      unitCost,
      referenceType: 'stock_adjustment', referenceId: adjustment.id, sourceLineId: adjustmentItem.id,
      effectiveAt: input.businessDate, createdBy: input.postedBy,
      metadata: { adjustment_type: input.adjustmentType, reason_code: reasonCode.code },
    });

    eventLineNo++;
    lineNo++;
  }

  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.postedBy, correlationId,
      action: 'stock_adjustment.post', entityType: 'stock_adjustment', entityId: adjustment.id,
      afterValue: JSON.stringify({ reference_no: referenceNo, type: input.adjustmentType, item_count: input.items.length }),
    },
  });

  return { adjustmentId: adjustment.id, referenceNo, status: 'posted', itemCount: input.items.length };
}
