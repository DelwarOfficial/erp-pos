// src/domain/inventory/stockMovement.ts
// post_stock_movement() per §16 + §5.5.

import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';
import { projectStockValue } from './valuation';

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
  // Set ONLY by reverseStockMovement at creation time. The stock_movements
  // table is immutable (IMMUTABLE_LEDGER trigger): provenance must be complete
  // in the initial INSERT — never attached via a later UPDATE.
  reversalOfMovementId?: string;
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

/** The stock row a movement is planned against. */
export interface StockRowState {
  id: string;
  qtyOnHand: Prisma.Decimal;
  qtyReserved?: Prisma.Decimal;
  qtyDamaged: Prisma.Decimal;
  qtyInTransitOut: Prisma.Decimal;
  movingAverageCost: Prisma.Decimal;
  version: number;
}

/**
 * The arithmetic and checks of one movement against one stock row, without
 * touching the database: the movement row to insert and the stock row's next
 * values. postStockMovement applies one; postStockCount applies many in bulk.
 */
export function planStockMovement(stock: StockRowState, params: PostStockMovementParams) {
  const qtyDelta = typeof params.qtyDelta === 'string' ? parseFloat(params.qtyDelta) : params.qtyDelta;
  const unitCost = typeof params.unitCost === 'string' ? parseFloat(params.unitCost) : params.unitCost;

  if (!Number.isFinite(qtyDelta) || qtyDelta === 0) {
    throw new DomainError('VALIDATION_FAILED', 'qty_delta must be non-zero', {}, 400);
  }
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    throw new DomainError('VALIDATION_FAILED', 'unit_cost must be >= 0', {}, 400);
  }

  const stockBucket: StockBucket = params.stockBucket ?? 'on_hand';

  // Quantities in Decimal (F-33): every bucket is checked here, so a movement
  // that would drive one negative is a 409 naming the bucket, not a raw CHECK
  // violation from the database.
  const delta = new Prisma.Decimal(params.qtyDelta);
  const bucketBefore = { on_hand: stock.qtyOnHand, damaged: stock.qtyDamaged, in_transit: stock.qtyInTransitOut }[stockBucket];
  const bucketAfter = new Prisma.Decimal(bucketBefore).plus(delta);
  const newQtyOnHand = stockBucket === 'on_hand' ? bucketAfter : new Prisma.Decimal(stock.qtyOnHand);
  const newQtyDamaged = stockBucket === 'damaged' ? bucketAfter : new Prisma.Decimal(stock.qtyDamaged);
  const newQtyInTransit = stockBucket === 'in_transit' ? bucketAfter : new Prisma.Decimal(stock.qtyInTransitOut);

  if (bucketAfter.isNegative()) {
    const label = { on_hand: '', damaged: 'damaged ', in_transit: 'in-transit ' }[stockBucket];
    throw new DomainError(
      'INVENTORY_INSUFFICIENT',
      `Insufficient ${label}stock: ${bucketBefore.toString()} available, ${delta.abs().toString()} requested`,
      {
        warehouse_id: params.warehouseId,
        product_id: params.productId,
        bucket: stockBucket,
        available: bucketBefore.toString(),
        requested: delta.abs().toString(),
      },
      409,
    );
  }
  if (stockBucket === 'on_hand' && delta.isNegative() && stock.qtyReserved && newQtyOnHand.lt(stock.qtyReserved)) {
    throw new DomainError('INVENTORY_INSUFFICIENT', 'Stock is reserved for another operation', { reserved: stock.qtyReserved.toString() }, 409);
  }

  const isOutbound = OUTBOUND_TYPES.includes(params.movementType);

  const totalCostDelta = delta.mul(isOutbound ? stock.movingAverageCost : new Prisma.Decimal(params.unitCost));
  const projection = stockBucket === 'on_hand' ? projectStockValue({
    quantity: stock.qtyOnHand.toString(), averageCost: stock.movingAverageCost.toString(),
    quantityDelta: String(params.qtyDelta),
    movementUnitCost: isOutbound ? stock.movingAverageCost.toString() : String(params.unitCost),
  }) : null;

  const movementData = {
      companyId: params.companyId,
      eventId: params.eventId,
      eventLineNo: params.eventLineNo,
      warehouseId: params.warehouseId,
      productId: params.productId,
      stockBucket,
      movementType: params.movementType,
      qtyDelta: delta,
      unitCost: isOutbound ? stock.movingAverageCost : params.unitCost,
      totalCostDelta: projection?.valueDelta ?? totalCostDelta,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      sourceLineId: params.sourceLineId ?? null,
      reversalOfMovementId: params.reversalOfMovementId ?? null,
      effectiveAt: params.effectiveAt,
      postedAt: new Date(),
      createdBy: params.createdBy,
      metadata: JSON.stringify(params.metadata ?? {}),
  };
  const stockData = {
      qtyOnHand: projection?.quantity ?? newQtyOnHand,
      qtyDamaged: newQtyDamaged,
      qtyInTransitOut: newQtyInTransit,
      // On hand, the projection revalues the average cost; the other buckets leave it.
      movingAverageCost: projection?.averageCost ?? stock.movingAverageCost,
  };
  return {
    movementData, stockData,
    qtyOnHandBefore: stock.qtyOnHand.toString(),
    qtyOnHandAfter: String(projection?.quantity ?? newQtyOnHand),
    movingAverageCostBefore: stock.movingAverageCost.toString(),
    movingAverageCostAfter: String(stockData.movingAverageCost),
  };
}

export async function postStockMovement(
  tx: Prisma.TransactionClient,
  params: PostStockMovementParams,
): Promise<StockMovementResult> {
  const frozen = await tx.stockCount.findFirst({ where: { companyId: params.companyId, warehouseId: params.warehouseId,
    movementFreezePolicy: 'block', status: { in: ['draft', 'counting', 'reviewed'] }, items: { some: { productId: params.productId } },
  }, select: { referenceNo: true } });
  if (frozen) throw new DomainError('VALIDATION_FAILED', `Stock movement blocked by count ${frozen.referenceNo}. Post or cancel the count first.`, {}, 409);
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

  const plan = planStockMovement(stock, params);

  const movement = await tx.stockMovement.create({ data: plan.movementData });

  const updated = await tx.warehouseStock.updateMany({
    where: { id: stock.id, companyId: params.companyId, version: stock.version },
    data: { ...plan.stockData, version: { increment: 1 }, updatedAt: new Date() },
  });
  if (updated.count !== 1) throw new DomainError('CONCURRENT_MODIFICATION', 'Stock changed during posting; retry the transaction', {}, 409);

  return {
    movementId: movement.id,
    qtyOnHandBefore: plan.qtyOnHandBefore,
    qtyOnHandAfter: plan.qtyOnHandAfter,
    movingAverageCostBefore: plan.movingAverageCostBefore,
    movingAverageCostAfter: plan.movingAverageCostAfter,
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

  // INSERT-ONCE: provenance rides on the initial INSERT. A post-create UPDATE
  // is rejected by the IMMUTABLE_LEDGER trigger — and must stay rejected.
  // Duplicate delivery (retry / concurrent double-reverse) fails closed via
  // @@unique(companyId, eventId, eventLineNo) and is mapped to 409 below.
  try {
    return await postStockMovement(tx, {
      companyId: original.companyId,
      eventId: params.eventId,
      eventLineNo: params.eventLineNo,
      warehouseId: original.warehouseId,
      productId: original.productId,
      stockBucket: original.stockBucket as StockBucket,
      movementType: 'reversal',
      qtyDelta: original.qtyDelta.negated().toString(),
      unitCost: original.unitCost.toString(),
      referenceType: 'reversal',
      referenceId: params.originalMovementId,
      reversalOfMovementId: params.originalMovementId,
      effectiveAt: new Date(),
      createdBy: params.createdBy,
      metadata: { reversal_of: params.originalMovementId, reason: params.reason },
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const raced = await tx.stockMovement.findFirst({
        where: { reversalOfMovementId: params.originalMovementId },
      });
      if (raced) {
        throw new DomainError('VALIDATION_FAILED', 'Movement already reversed', {}, 409);
      }
    }
    throw e;
  }
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? '';
  const msg = e instanceof Error ? e.message : String(e);
  return (
    code === 'P2002' ||
    msg.includes('Unique constraint') ||
    msg.includes('UNIQUE constraint failed') ||
    msg.includes('ER_DUP_ENTRY') ||
    msg.includes('Duplicate entry') ||
    msg.includes('1062')
  );
}

/**
 * Validate a serial state transition per §16 validate_serial_transition().
 * Allowed transitions are defined here; any transition not in the map is rejected.
 */
const ALLOWED_SERIAL_TRANSITIONS: Record<string, string[]> = {
  in_stock: ['reserved', 'sold', 'in_transit', 'damaged', 'repair', 'returned_to_supplier', 'scrapped'],
  reserved: ['in_stock', 'sold', 'in_transit', 'damaged'],
  sold: ['in_stock', 'repair', 'returned_to_supplier'],
  in_transit: ['in_stock', 'damaged'],  // received or damaged in transit
  damaged: ['in_stock', 'repair', 'scrapped'],
  repair: ['in_stock', 'sold', 'scrapped'],
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
