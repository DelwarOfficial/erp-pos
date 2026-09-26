// src/domain/commands/m2/CreateStockCount.ts
// CreateStockCount: a stock count and its lines, optionally posted at once.
//
// The route created one line per round trip inside its Serializable, 30-second
// transaction, and posting then read each line's stock row separately again. A
// physical count of a few thousand lines held its locks for the whole of those
// thousands of round trips and could run out the transaction timeout. Lines are
// now inserted in bounded batches; posting reads the stock rows in batches too.

import { Prisma } from '@prisma/client';
import { nextDocumentNumber } from '@/lib/numbering';
import { postStockCount } from './PostStockCount';

/** Rows per multi-row INSERT: large enough to amortise, small enough to bound a statement. */
export const STOCK_COUNT_INSERT_BATCH = 1_000;

export interface StockCountLineInput {
  productId: string;
  batchId?: string;
  expectedQuantity: Prisma.Decimal.Value;
  countedQuantity?: Prisma.Decimal.Value;
  reasonCodeId?: string;
  countNote?: string;
}

export interface CreateStockCountInput {
  companyId: string;
  branchId: string;
  warehouseId: string;
  scopeType: string;
  categoryId?: string;
  brandId?: string;
  blindCount: boolean;
  movementFreezePolicy: string;
  notes?: string;
  items: StockCountLineInput[];
  post: boolean;
  createdBy: string;
}

export async function createStockCount(tx: Prisma.TransactionClient, input: CreateStockCountInput, correlationId: string) {
  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId, branchId: input.branchId,
    documentType: 'STOCK_COUNT', fiscalYear: new Date().getFullYear(), prefix: 'SC-',
  });

  const sc = await tx.stockCount.create({
    data: {
      companyId: input.companyId, branchId: input.branchId, warehouseId: input.warehouseId,
      referenceNo, scopeType: input.scopeType,
      categoryId: input.categoryId ?? null, brandId: input.brandId ?? null,
      status: input.post ? 'reviewed' : 'draft',
      blindCount: input.blindCount, movementFreezePolicy: input.movementFreezePolicy,
      notes: input.notes ?? null, createdBy: input.createdBy,
    },
  });

  for (let offset = 0; offset < input.items.length; offset += STOCK_COUNT_INSERT_BATCH) {
    await tx.stockCountItem.createMany({
      data: input.items.slice(offset, offset + STOCK_COUNT_INSERT_BATCH).map(item => {
        const expected = new Prisma.Decimal(item.expectedQuantity);
        const counted = item.countedQuantity === undefined ? null : new Prisma.Decimal(item.countedQuantity);
        return {
          companyId: input.companyId, stockCountId: sc.id,
          productId: item.productId, batchId: item.batchId ?? null,
          expectedQuantity: expected,
          countedQuantity: counted,
          varianceQuantity: counted === null ? null : counted.minus(expected),
          reasonCodeId: item.reasonCodeId ?? null,
          countNote: item.countNote ?? null,
        };
      }),
    });
  }

  let posted: { status: string; adjustmentsPosted: number } | null = null;
  if (input.post && input.items.length > 0) {
    posted = await postStockCount(tx, { companyId: input.companyId, stockCountId: sc.id, postedBy: input.createdBy }, correlationId);
  }

  await tx.auditLog.create({
    data: { companyId: input.companyId, userId: input.createdBy, correlationId,
      action: 'stock_count.create', entityType: 'stock_count', entityId: sc.id,
      afterValue: JSON.stringify({ reference_no: referenceNo, posted: !!posted, items: input.items.length }) },
  });

  return {
    id: sc.id, referenceNo,
    status: posted ? posted.status : sc.status,
    itemsCount: input.items.length,
    adjustmentsPosted: posted?.adjustmentsPosted ?? 0,
  };
}
