import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';

/** Allocate available batches at dispatch; movements retain custody during transit. */
export async function dispatchTransferBatches(tx: Prisma.TransactionClient, input: {
  companyId: string; warehouseId: string; productId: string; quantity: Prisma.Decimal; movementId: string;
}) {
  const product = await tx.product.findFirstOrThrow({ where: { id: input.productId, companyId: input.companyId } });
  if (!product.trackBatches) return;
  const batches = await tx.productBatch.findMany({ where: { companyId: input.companyId, warehouseId: input.warehouseId, productId: input.productId, status: 'active' } });
  batches.sort((a, b) => (a.expiryDate?.getTime() ?? Infinity) - (b.expiryDate?.getTime() ?? Infinity) || a.batchNo.localeCompare(b.batchNo));
  let remaining = input.quantity;
  for (const batch of batches) {
    const available = batch.qtyOnHand.minus(batch.qtyReserved);
    if (available.lte(0)) continue;
    const quantity = Prisma.Decimal.min(remaining, available);
    await tx.productBatch.update({ where: { id: batch.id }, data: { qtyOnHand: { decrement: quantity } } });
    await tx.stockMovementBatch.create({ data: { companyId: input.companyId, stockMovementId: input.movementId, productBatchId: batch.id, qty: quantity.negated() } });
    remaining = remaining.minus(quantity);
    if (remaining.isZero()) return;
  }
  throw new DomainError('INVENTORY_INSUFFICIENT', 'Available batch quantities do not cover this transfer. Reconcile batch stock before dispatch.', {}, 409);
}

export async function receiveTransferBatches(tx: Prisma.TransactionClient, input: {
  companyId: string; transferId: string; lineId: string; sourceWarehouseId: string;
  warehouseId: string; productId: string; quantity: Prisma.Decimal; movementId: string;
}) {
  const allocations = await tx.stockMovementBatch.findMany({ where: { companyId: input.companyId,
    stockMovement: { companyId: input.companyId, referenceType: 'transfer', referenceId: input.transferId,
      sourceLineId: input.lineId, warehouseId: input.sourceWarehouseId, stockBucket: 'on_hand', movementType: 'transfer_dispatch' },
  }, include: { productBatch: true } });
  const product = await tx.product.findFirstOrThrow({ where: { id: input.productId, companyId: input.companyId } });
  if (!allocations.length && !product.trackBatches) return;
  const total = allocations.reduce((sum, allocation) => sum.minus(allocation.qty), new Prisma.Decimal(0));
  if (!total.eq(input.quantity) || allocations.some(allocation => allocation.qty.gte(0))) throw new DomainError('VALIDATION_FAILED', 'Dispatched batch custody does not match this transfer. Reconcile before receiving.', {}, 409);
  for (const allocation of allocations) {
    const source = allocation.productBatch;
    const existing = await tx.productBatch.findUnique({ where: { companyId_productId_warehouseId_batchNo: {
      companyId: input.companyId, productId: input.productId, warehouseId: input.warehouseId, batchNo: source.batchNo,
    } } });
    if (existing && (existing.status !== source.status || existing.expiryDate?.getTime() !== source.expiryDate?.getTime() || existing.manufacturedAt?.getTime() !== source.manufacturedAt?.getTime())) throw new DomainError('VALIDATION_FAILED', 'Destination batch has conflicting dates or status. Reconcile before receiving.', {}, 409);
    const quantity = allocation.qty.negated();
    const destination = existing
      ? await tx.productBatch.update({ where: { id: existing.id }, data: { qtyOnHand: { increment: quantity } } })
      : await tx.productBatch.create({ data: { companyId: input.companyId, productId: input.productId,
        warehouseId: input.warehouseId, batchNo: source.batchNo, manufacturedAt: source.manufacturedAt,
        expiryDate: source.expiryDate, status: source.status, qtyOnHand: quantity } });
    await tx.stockMovementBatch.create({ data: { companyId: input.companyId, stockMovementId: input.movementId, productBatchId: destination.id, qty: quantity } });
  }
}
