// src/domain/inventory/stockMovement.ts
// post_stock_movement() per §16 + §5.5.

import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';

export type StockBucket = 'on_hand' | 'in_transit' | 'damaged';
export type MovementType =
  | 'purchase_receive'
  | 'sale_issue'
  | 'sale_return_receive'
  | 'purchase_return_issue'
  | 'transfer_dispatch'
  | 'transfer_receive'
  | 'transfer_return_to_source'
  | 'damage_move'
  | 'stock_count_gain'
  | 'stock_count_loss'
  | 'adjustment_in'
  | 'adjustment_out'
  | 'opening_stock'
  | 'reversal';

const INBOUND_TYPES: MovementType[] = [
  'purchase_receive', 'sale_return_receive', 'transfer_receive',
  'adjustment_in', 'opening_stock', 'stock_count_gain',
];
const OUTBOUND_TYPES: MovementType[] = [
  'sale_issue', 'transfer_dispatch', 'adjustment_out',
  'purchase_return_issue', 'stock_count_loss',
];

export interface PostStockMovementParams {
  companyId: string;
  eventId: string;
  eventLineNo: number;
  warehouseId: string;
  productId: string;
  stockBucket?: StockBucket;
  movementType: MovementType;
  qtyDelta: number | string;
  unitCost: number | string;
  referenceType: string;
  referenceId: string;
  sourceLineId?: string;
  effectiveAt: Date;
  createdBy: string;
  metadata?: Record<string, unknown>;
}

export interface StockMovementResult {
  movementId: string;
  qtyOnHandBefore: string;
  qtyOnHandAfter: string;
  movingAverageCostBefore: string;
  movingAverageCostAfter: string;
}

export async function postStockMovement(
  tx: Prisma.TransactionClient,
  params: PostStockMovementParams,
): Promise<StockMovementResult> {
  const qtyDelta = typeof params.qtyDelta === 'string' ? parseFloat(params.qtyDelta) : params.qtyDelta;
  const unitCost = typeof params.unitCost === 'string' ? parseFloat(params.unitCost) : params.unitCost;

  if (qtyDelta === 0) {
    throw new DomainError('VALIDATION_FAILED', 'qty_delta must be non-zero', {}, 400);
  }
  if (unitCost < 0) {
    throw new DomainError('VALIDATION_FAILED', 'unit_cost must be >= 0', {}, 400);
  }

  const stockBucket: StockBucket = params.stockBucket ?? 'on_hand';

  let stock = await tx.warehouseStock.findUnique({
    where: {
      companyId_warehouseId_productId: {
        companyId: params.companyId,
        warehouseId: params.warehouseId,
        productId: params.productId,
      },
    },
  });

  if (!stock) {
    stock = await tx.warehouseStock.create({
      data: {
        companyId: params.companyId,
        warehouseId: params.warehouseId,
        productId: params.productId,
        qtyOnHand: 0,
        qtyReserved: 0,
        qtyInTransitOut: 0,
        qtyDamaged: 0,
        movingAverageCost: 0,
        version: 0,
      },
    });
  }

  const qtyOnHandBefore = parseFloat(stock.qtyOnHand.toString());
  const macBefore = parseFloat(stock.movingAverageCost.toString());
  const qtyDeltaAbs = Math.abs(qtyDelta);

  let newQtyOnHand = qtyOnHandBefore;
  let newQtyDamaged = parseFloat(stock.qtyDamaged.toString());
  let newQtyInTransit = parseFloat(stock.qtyInTransitOut.toString());

  if (stockBucket === 'on_hand') {
    newQtyOnHand = qtyOnHandBefore + qtyDelta;
  } else if (stockBucket === 'damaged') {
    newQtyDamaged = newQtyDamaged + qtyDelta;
  } else if (stockBucket === 'in_transit') {
    newQtyInTransit = newQtyInTransit + qtyDelta;
  }

  if (stockBucket === 'on_hand' && newQtyOnHand < 0) {
    throw new DomainError(
      'INVENTORY_INSUFFICIENT',
      `Insufficient stock: on_hand=${qtyOnHandBefore}, requested=${qtyDeltaAbs}, available=${qtyOnHandBefore}`,
      {
        warehouse_id: params.warehouseId,
        product_id: params.productId,
        on_hand: qtyOnHandBefore,
        requested: qtyDeltaAbs,
        available: qtyOnHandBefore,
      },
      409,
    );
  }

  let macAfter = macBefore;
  const isInbound = INBOUND_TYPES.includes(params.movementType);
  const isOutbound = OUTBOUND_TYPES.includes(params.movementType);

  if (isInbound && stockBucket === 'on_hand') {
    if (qtyOnHandBefore + qtyDeltaAbs > 0) {
      const oldValue = qtyOnHandBefore * macBefore;
      const inboundValue = qtyDeltaAbs * unitCost;
      macAfter = (oldValue + inboundValue) / (qtyOnHandBefore + qtyDeltaAbs);
    }
  }

  const totalCostDelta = qtyDelta * (isOutbound ? macBefore : unitCost);

  const movement = await tx.stockMovement.create({
    data: {
      companyId: params.companyId,
      eventId: params.eventId,
      eventLineNo: params.eventLineNo,
      warehouseId: params.warehouseId,
      productId: params.productId,
      stockBucket,
      movementType: params.movementType,
      qtyDelta,
      unitCost: isOutbound ? macBefore : unitCost,
      totalCostDelta,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      sourceLineId: params.sourceLineId ?? null,
      effectiveAt: params.effectiveAt,
      postedAt: new Date(),
      createdBy: params.createdBy,
      metadata: JSON.stringify(params.metadata ?? {}),
    },
  });

  await tx.warehouseStock.update({
    where: { id: stock.id },
    data: {
      qtyOnHand: newQtyOnHand,
      qtyDamaged: newQtyDamaged,
      qtyInTransitOut: newQtyInTransit,
      movingAverageCost: macAfter,
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  });

  return {
    movementId: movement.id,
    qtyOnHandBefore: qtyOnHandBefore.toString(),
    qtyOnHandAfter: newQtyOnHand.toString(),
    movingAverageCostBefore: macBefore.toString(),
    movingAverageCostAfter: macAfter.toString(),
  };
}

export async function reverseStockMovement(
  tx: Prisma.TransactionClient,
  params: {
    originalMovementId: string;
    eventId: string;
    eventLineNo: number;
    createdBy: string;
    reason: string;
  },
): Promise<StockMovementResult> {
  const original = await tx.stockMovement.findUnique({
    where: { id: params.originalMovementId },
  });
  if (!original) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Original stock movement not found', {}, 404);
  }
  if (original.reversalOfMovementId) {
    throw new DomainError('VALIDATION_FAILED', 'Cannot reverse a reversal movement', {}, 400);
  }

  const existingReversal = await tx.stockMovement.findFirst({
    where: { reversalOfMovementId: params.originalMovementId },
  });
  if (existingReversal) {
    throw new DomainError('VALIDATION_FAILED', 'Movement already reversed', {}, 409);
  }

  const result = await postStockMovement(tx, {
    companyId: original.companyId,
    eventId: params.eventId,
    eventLineNo: params.eventLineNo,
    warehouseId: original.warehouseId,
    productId: original.productId,
    stockBucket: original.stockBucket as StockBucket,
    movementType: 'reversal',
    qtyDelta: -parseFloat(original.qtyDelta.toString()),
    unitCost: parseFloat(original.unitCost.toString()),
    referenceType: 'reversal',
    referenceId: params.originalMovementId,
    effectiveAt: new Date(),
    createdBy: params.createdBy,
    metadata: { reversal_of: params.originalMovementId, reason: params.reason },
  });

  await tx.stockMovement.update({
    where: { id: result.movementId },
    data: { reversalOfMovementId: params.originalMovementId },
  });

  return result;
}

/**
 * Validate a serial state transition per §16 validate_serial_transition().
 * Allowed transitions are defined here; any transition not in the map is rejected.
 */
const ALLOWED_SERIAL_TRANSITIONS: Record<string, string[]> = {
  in_stock: ['reserved', 'sold', 'in_transit', 'damaged', 'returned_to_supplier', 'scrapped'],
  reserved: ['in_stock', 'sold', 'damaged'],
  sold: ['in_stock', 'returned_to_supplier'],  // sold → in_stock (return) or → returned_to_supplier
  in_transit: ['in_stock', 'damaged'],  // received or damaged in transit
  damaged: ['in_stock', 'repair', 'scrapped'],
  repair: ['in_stock', 'scrapped'],
  returned_to_supplier: [],  // terminal (unless re-received, which creates a new serial row)
  replaced: [],  // terminal
  scrapped: [],  // terminal
};

export function validateSerialTransition(fromStatus: string, toStatus: string): void {
  if (fromStatus === toStatus) return;  // no-op
  const allowed = ALLOWED_SERIAL_TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    throw new DomainError(
      'SERIAL_NOT_AVAILABLE',
      `Invalid serial transition: ${fromStatus} → ${toStatus}`,
      { from_status: fromStatus, to_status: toStatus, allowed },
      409,
    );
  }
}
