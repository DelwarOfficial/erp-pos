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
import { DomainError } from '@/lib/errors/codes';

/**
 * The route's transaction timeout. A 5,000-line count is now some twenty
 * statements, but they insert about 8,300 rows (lines and movements), and on
 * the disposable MariaDB (default 128 MB buffer pool) inserts alone run 1-3 ms
 * a row: 13-25 s, too close to the default 30 s. The count holds its locks for
 * that long either way; the timeout only decides whether it can finish.
 */
export const STOCK_COUNT_TRANSACTION_TIMEOUT_MS = 120_000;

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
  const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, companyId: input.companyId, branchId: input.branchId, isActive: true } });
  if (!warehouse) throw new DomainError('VALIDATION_FAILED', 'Select an active warehouse in the specified branch', {}, 400);
  if (input.scopeType === 'category' && !input.categoryId || input.scopeType === 'brand' && !input.brandId) throw new DomainError('VALIDATION_FAILED', 'Select the category or brand to count', {}, 400);
  const products = await tx.product.findMany({ where: { companyId: input.companyId, deletedAt: null,
    ...(input.items.length ? { id: { in: input.items.map(item => item.productId) } } : { isActive: true }),
    ...(input.scopeType === 'category' ? { categoryId: input.categoryId } : {}),
    ...(input.scopeType === 'brand' ? { brandId: input.brandId } : {}),
  }, select: { id: true, isSerialized: true, trackBatches: true } });
  const productIds = products.map(product => product.id);
  if (!productIds.length || input.items.some(item => !productIds.includes(item.productId))) throw new DomainError('VALIDATION_FAILED', 'No valid products in this count scope', {}, 400);
  if (await tx.stockCount.findFirst({ where: { companyId: input.companyId, warehouseId: input.warehouseId, status: { in: ['draft', 'counting', 'reviewed'] }, items: { some: { productId: { in: productIds } } } } })) throw new DomainError('VALIDATION_FAILED', 'An open count already covers these products. Finish or cancel it first.', {}, 409);
  const stocks = await tx.warehouseStock.findMany({ where: { companyId: input.companyId, warehouseId: input.warehouseId, productId: { in: productIds } } });
  const batches = await tx.productBatch.findMany({ where: { companyId: input.companyId, warehouseId: input.warehouseId, productId: { in: products.filter(product => product.trackBatches).map(product => product.id) } } });
  const stockMap = new Map(stocks.map(stock => [stock.productId, stock]));
  const batchMap = new Map(batches.map(batch => [batch.id, batch]));
  const supplied: StockCountLineInput[] = input.items.length ? input.items : products.flatMap<StockCountLineInput>(product => product.trackBatches
    ? batches.filter(batch => batch.productId === product.id).map(batch => ({ productId: product.id, batchId: batch.id, expectedQuantity: batch.qtyOnHand }))
    : [{ productId: product.id, expectedQuantity: 0 }]);
  if (new Set(supplied.map(item => `${item.productId}:${item.batchId ?? ''}`)).size !== supplied.length) throw new DomainError('VALIDATION_FAILED', 'Duplicate count lines are not allowed', {}, 400);
  const lines: StockCountLineInput[] = supplied.map(item => {
    const product = products.find(product => product.id === item.productId)!;
    const batch = item.batchId ? batchMap.get(item.batchId) : null;
    if (item.countedQuantity !== undefined && (!new Prisma.Decimal(item.countedQuantity).isFinite() || new Prisma.Decimal(item.countedQuantity).lt(0))) throw new DomainError('VALIDATION_FAILED', 'Counted quantities must be finite and nonnegative', {}, 400);
    if (product.trackBatches && !batch || batch && batch.productId !== product.id) throw new DomainError('VALIDATION_FAILED', 'Select a batch belonging to the counted product and warehouse', {}, 400);
    if (product.isSerialized && input.post) throw new DomainError('VALIDATION_FAILED', 'Serialized counts require scanned serials and review before posting', {}, 400);
    return { ...item, expectedQuantity: batch ? batch.qtyOnHand : stockMap.get(item.productId)?.qtyOnHand ?? 0 };
  });
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
      snapshotAt: new Date(),
      blindCount: input.blindCount, movementFreezePolicy: input.movementFreezePolicy,
      notes: input.notes ?? null, createdBy: input.createdBy,
    },
  });

  for (let offset = 0; offset < lines.length; offset += STOCK_COUNT_INSERT_BATCH) {
    await tx.stockCountItem.createMany({
      data: lines.slice(offset, offset + STOCK_COUNT_INSERT_BATCH).map(item => {
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

  const serialized = products.filter(product => product.isSerialized).map(product => product.id);
  if (serialized.length) {
    const countLines = await tx.stockCountItem.findMany({ where: { stockCountId: sc.id, productId: { in: serialized } } });
    const serials = await tx.productSerial.findMany({ where: { companyId: input.companyId, currentWarehouseId: input.warehouseId, productId: { in: serialized }, status: { in: ['in_stock', 'reserved'] } } });
    await tx.stockCountSerial.createMany({ data: serials.map(serial => ({ companyId: input.companyId, stockCountItemId: countLines.find(line => line.productId === serial.productId)!.id, serialId: serial.id, scannedSerialNumber: serial.serialNumber, expectedPresent: true, countedPresent: false, resolution: 'unconfirmed' })) });
  }

  let posted: { status: string; adjustmentsPosted: number } | null = null;
  if (input.post && lines.length > 0) {
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
    itemsCount: lines.length,
    adjustmentsPosted: posted?.adjustmentsPosted ?? 0,
  };
}
