// src/domain/commands/m2/PostStockCount.ts
// PostStockCount per §7.8 — posts count variances as stock adjustments.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postStockMovement } from '@/domain/inventory/stockMovement';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

/** Stock rows per lookup while posting. */
const STOCK_READ_BATCH = 1_000;

export interface PostStockCountInput {
  companyId: string;
  stockCountId: string;
  postedBy: string;
}

export async function postStockCount(
  tx: Prisma.TransactionClient, input: PostStockCountInput, correlationId: string,
): Promise<{ status: string; adjustmentsPosted: number }> {
  const sc = await tx.stockCount.findFirst({
    where: { id: input.stockCountId, companyId: input.companyId },
    include: { items: true, warehouse: true },
  });
  if (!sc) throw new DomainError('RESOURCE_NOT_FOUND', 'Stock count not found', {}, 404);
  if (sc.status !== 'reviewed' && sc.status !== 'counting') {
    throw new DomainError('VALIDATION_FAILED', `Stock count must be reviewed to post (current: ${sc.status})`, {}, 409);
  }

  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: { id: eventId, companyId: input.companyId, eventType: 'stock_count.posted',
      sourceType: 'stock_count', sourceId: sc.id, correlationId, occurredAt: new Date() },
  });

  let adjustmentsPosted = 0;
  let eventLineNo = 1;

  // Every line's stock row, read in batches rather than one round trip per line.
  const counted = sc.items.filter(item => item.countedQuantity !== null);
  const costByProduct = new Map<string, string>();
  const productIds = [...new Set(counted.map(item => item.productId))];
  for (let offset = 0; offset < productIds.length; offset += STOCK_READ_BATCH) {
    const stocks = await tx.warehouseStock.findMany({
      where: { companyId: input.companyId, warehouseId: sc.warehouseId, productId: { in: productIds.slice(offset, offset + STOCK_READ_BATCH) } },
      select: { productId: true, movingAverageCost: true },
    });
    for (const stock of stocks) costByProduct.set(stock.productId, stock.movingAverageCost.toString());
  }

  for (const item of counted) {
    // Decimal, exactly: a float difference of two DECIMAL(65,30) quantities
    // is not the variance that was counted.
    const expected = new Prisma.Decimal(item.expectedQuantity);
    const countedQty = new Prisma.Decimal(item.countedQuantity!);
    const variance = countedQty.minus(expected);
    if (variance.abs().lt('0.0001')) continue; // no variance

    await postStockMovement(tx, {
      companyId: input.companyId, eventId, eventLineNo,
      warehouseId: sc.warehouseId, productId: item.productId,
      movementType: variance.gt(0) ? 'stock_count_gain' : 'stock_count_loss',
      qtyDelta: variance.toString(), unitCost: costByProduct.get(item.productId) ?? '0',
      referenceType: 'stock_count', referenceId: sc.id, sourceLineId: item.id,
      effectiveAt: new Date(), createdBy: input.postedBy,
      metadata: { expected: expected.toString(), counted: countedQty.toString(), variance: variance.toString() },
    });
    eventLineNo++;
    adjustmentsPosted++;
  }

  await tx.stockCount.update({
    where: { id: sc.id },
    data: { status: 'posted', postedAt: new Date(), postedBy: input.postedBy },
  });

  await tx.auditLog.create({
    data: { companyId: input.companyId, userId: input.postedBy, correlationId,
      action: 'stock_count.post', entityType: 'stock_count', entityId: sc.id,
      afterValue: JSON.stringify({ adjustments: adjustmentsPosted }) },
  });

  return { status: 'posted', adjustmentsPosted };
}
