// src/domain/commands/m2/PostStockCount.ts
// PostStockCount per §7.8 — posts count variances as stock adjustments.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postStockMovement } from '@/domain/inventory/stockMovement';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

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

  for (const item of sc.items) {
    if (item.countedQuantity === null) continue;
    const expected = parseFloat(item.expectedQuantity.toString());
    const counted = parseFloat(item.countedQuantity.toString());
    const variance = counted - expected;
    if (Math.abs(variance) < 0.0001) continue; // no variance

    const stock = await tx.warehouseStock.findUnique({
      where: { companyId_warehouseId_productId: {
        companyId: input.companyId, warehouseId: sc.warehouseId, productId: item.productId,
      }},
    });
    const unitCost = stock ? parseFloat(stock.movingAverageCost.toString()) : 0;

    await postStockMovement(tx, {
      companyId: input.companyId, eventId, eventLineNo,
      warehouseId: sc.warehouseId, productId: item.productId,
      movementType: variance > 0 ? 'stock_count_gain' : 'stock_count_loss',
      qtyDelta: variance, unitCost,
      referenceType: 'stock_count', referenceId: sc.id, sourceLineId: item.id,
      effectiveAt: new Date(), createdBy: input.postedBy,
      metadata: { expected, counted, variance },
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
