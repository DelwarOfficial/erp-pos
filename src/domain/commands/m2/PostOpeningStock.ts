// src/domain/commands/m2/PostOpeningStock.ts
// PostOpeningStock domain command per §7.23 + §5.5.
//
// Posts opening stock balances for a new warehouse or tenant setup.
// Each line creates a stock_movement with movementType='opening_stock' (inbound)
// which sets the initial moving_average_cost.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postStockMovement } from '@/domain/inventory/stockMovement';
import { DomainError } from '@/lib/errors/codes';

export interface PostOpeningStockInput {
  companyId: string;
  warehouseId: string;
  postedBy: string;
  businessDate: Date;
  referenceNo: string;
  notes?: string;
  items: Array<{
    productId: string;
    quantity: number;
    unitCost: number;
    batchNo?: string;
    expiryDate?: Date;
    serials?: string[];
  }>;
}

export interface PostOpeningStockResult {
  event_id: string;
  items: Array<{
    product_id: string;
    quantity: number;
    unit_cost: string;
    movement_id: string;
    qty_on_hand_after: string;
    mac_after: string;
  }>;
}

export async function postOpeningStock(
  tx: Prisma.TransactionClient,
  input: PostOpeningStockInput,
  correlationId: string,
): Promise<PostOpeningStockResult> {
  // Validate: no stock_movements should exist for this warehouse before opening stock
  const existingMovements = await tx.stockMovement.count({
    where: { warehouseId: input.warehouseId, companyId: input.companyId },
  });
  if (existingMovements > 0) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'Opening stock can only be posted for a warehouse with no prior stock movements',
      { warehouse_id: input.warehouseId, existing_movements: existingMovements },
      409,
    );
  }

  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: {
      id: eventId,
      companyId: input.companyId,
      eventType: 'opening_stock.posted',
      sourceType: 'opening_stock',
      sourceId: input.referenceNo,
      correlationId,
      occurredAt: new Date(),
    },
  });

  const resultItems: PostOpeningStockResult['items'] = [];
  let eventLineNo = 1;

  for (const item of input.items) {
    if (item.quantity <= 0) {
      throw new DomainError('VALIDATION_FAILED', 'Opening stock quantity must be > 0', {}, 400);
    }
    if (item.unitCost < 0) {
      throw new DomainError('VALIDATION_FAILED', 'Opening stock unit_cost must be >= 0', {}, 400);
    }

    // For serialized products, create serials
    if (item.serials && item.serials.length > 0) {
      if (item.serials.length !== item.quantity) {
        throw new DomainError(
          'VALIDATION_FAILED',
          `Serial count (${item.serials.length}) must equal quantity (${item.quantity})`,
          {},
          400,
        );
      }
      for (const serialNumber of item.serials) {
        const existing = await tx.productSerial.findUnique({
          where: { companyId_serialNumber: { companyId: input.companyId, serialNumber } },
        });
        if (existing) {
          throw new DomainError('VALIDATION_FAILED', `Serial ${serialNumber} already exists`, {}, 409);
        }
        await tx.productSerial.create({
          data: {
            companyId: input.companyId,
            productId: item.productId,
            serialNumber,
            status: 'in_stock',
            currentWarehouseId: input.warehouseId,
          },
        });
      }
    }

    const movement = await postStockMovement(tx, {
      companyId: input.companyId,
      eventId,
      eventLineNo,
      warehouseId: input.warehouseId,
      productId: item.productId,
      movementType: 'opening_stock',
      qtyDelta: item.quantity,
      unitCost: item.unitCost,
      referenceType: 'opening_stock',
      referenceId: input.referenceNo,
      effectiveAt: input.businessDate,
      createdBy: input.postedBy,
      metadata: { batch_no: item.batchNo, notes: input.notes },
    });

    resultItems.push({
      product_id: item.productId,
      quantity: item.quantity,
      unit_cost: item.unitCost.toString(),
      movement_id: movement.movementId,
      qty_on_hand_after: movement.qtyOnHandAfter,
      mac_after: movement.movingAverageCostAfter,
    });

    eventLineNo++;
  }

  await tx.auditLog.create({
    data: {
      companyId: input.companyId,
      userId: input.postedBy,
      correlationId,
      action: 'opening_stock.post',
      entityType: 'warehouse',
      entityId: input.warehouseId,
      afterValue: JSON.stringify({ reference_no: input.referenceNo, item_count: input.items.length }),
    },
  });

  return { event_id: eventId, items: resultItems };
}
