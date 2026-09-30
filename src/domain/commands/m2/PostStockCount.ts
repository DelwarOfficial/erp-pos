// src/domain/commands/m2/PostStockCount.ts
// PostStockCount per §7.8 — posts count variances as stock adjustments.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { planStockMovement, type StockRowState } from '@/domain/inventory/stockMovement';
import { DomainError } from '@/lib/errors/codes';
import { postInventoryVarianceJournal } from '@/domain/inventory/varianceJournal';

/** Stock rows per lookup, and rows per bulk write, while posting. */
const STOCK_READ_BATCH = 1_000;
const STOCK_WRITE_BATCH = 1_000;

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
    include: { items: { include: { product: true, serials: { include: { serial: true } }, batch: true } }, warehouse: true },
  });
  if (!sc) throw new DomainError('RESOURCE_NOT_FOUND', 'Stock count not found', {}, 404);
  if (sc.status !== 'reviewed') {
    throw new DomainError('VALIDATION_FAILED', `Stock count must be reviewed to post (current: ${sc.status})`, {}, 409);
  }
  if (!sc.items.length || sc.items.some(item => item.countedQuantity === null)) throw new DomainError('VALIDATION_FAILED', 'Every line must be counted and reviewed before posting', {}, 409);
  const approvalReason = await tx.inventoryReasonCode.findFirst({ where: { companyId: input.companyId, id: { in: sc.items.flatMap(item => item.reasonCodeId && !item.varianceQuantity?.isZero() ? [item.reasonCodeId] : []) }, requiresApproval: true } });
  if (approvalReason) {
    const approved = await tx.approvalRequest.findFirst({ where: { companyId: input.companyId, referenceType: 'stock_count', referenceId: sc.id, status: 'approved' }, orderBy: { resolvedAt: 'desc' } });
    if (!approved || approved.approvedBy === approved.requestedBy) throw new DomainError('APPROVAL_REQUIRED', 'An independent approver must approve these count variances before posting', {}, 409);
  }

  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: { id: eventId, companyId: input.companyId, eventType: 'stock_count.posted',
      sourceType: 'stock_count', sourceId: sc.id, correlationId, occurredAt: new Date() },
  });

  let adjustmentsPosted = 0;
  let eventLineNo = 1;

  // Posted in bulk. Each line used to be a postStockMovement call -- read the
  // stock row, insert the movement, update the row -- so a 5,000-line count was
  // some 10,000 sequential round trips inside one Serializable, 30-second
  // transaction, and ran out of it. The arithmetic and checks are the same
  // (planStockMovement); only the writes are batched.
  const counted = sc.items.filter(item => item.countedQuantity !== null);
  const productIds = [...new Set(counted.map(item => item.productId))];

  // Every counted product's stock row, created at zero where none exists yet
  // (as postStockMovement does), read in batches.
  const rows = new Map<string, StockRowState & { productId: string }>();
  const readRows = async (ids: string[]) => {
    for (let offset = 0; offset < ids.length; offset += STOCK_READ_BATCH) {
      const stocks = await tx.warehouseStock.findMany({
        where: { companyId: input.companyId, warehouseId: sc.warehouseId, productId: { in: ids.slice(offset, offset + STOCK_READ_BATCH) } },
        select: { id: true, productId: true, qtyOnHand: true, qtyReserved: true, qtyDamaged: true, qtyInTransitOut: true, movingAverageCost: true, version: true },
      });
      for (const stock of stocks) rows.set(stock.productId, stock);
    }
  };
  await readRows(productIds);
  const missing = productIds.filter(id => !rows.has(id));
  if (missing.length > 0) {
    await tx.warehouseStock.createMany({
      data: missing.map(productId => ({ companyId: input.companyId, warehouseId: sc.warehouseId, productId })),
    });
    await readRows(missing);
  }
  const original = new Map([...rows].map(([productId, row]) => [productId, row.version]));

  // Plan every line in order against the running state of its stock row.
  const movements: Prisma.StockMovementCreateManyInput[] = [];
  const journalValues: { value: Prisma.Decimal.Value; reasonCodeId: string | null }[] = [];
  const moved = new Set<string>();
  for (const item of counted) {
    // Decimal, exactly: a float difference of two DECIMAL(65,30) quantities
    // is not the variance that was counted.
    const expected = new Prisma.Decimal(item.expectedQuantity);
    const countedQty = new Prisma.Decimal(item.countedQuantity!);
    const variance = countedQty.minus(expected);
    if (item.product.isSerialized) {
      if (item.serials.filter(serial => serial.countedPresent).length !== countedQty.toNumber()) throw new DomainError('VALIDATION_FAILED', 'Scan every counted serial before posting', {}, 409);
      for (const entry of item.serials.filter(serial => serial.expectedPresent && !serial.countedPresent)) {
        if (!entry.serial || entry.serial.status !== 'in_stock' || entry.serial.currentReservationId || entry.serial.currentWarehouseId !== sc.warehouseId) throw new DomainError('SERIAL_NOT_AVAILABLE', 'Missing serial is reserved or no longer in this warehouse. Resolve custody before posting.', {}, 409);
        await tx.productSerial.update({ where: { id: entry.serial.id }, data: { status: 'scrapped', version: { increment: 1 } } });
        await tx.serialEvent.create({ data: { companyId: input.companyId, serialId: entry.serial.id, eventId, eventLineNo: eventLineNo++, eventType: 'stock_count.loss', fromStatus: 'in_stock', toStatus: 'scrapped', fromWarehouseId: sc.warehouseId, toWarehouseId: sc.warehouseId, referenceType: 'stock_count', referenceId: sc.id, createdBy: input.postedBy } });
      }
    }
    if (variance.abs().lt('0.0001')) continue; // no variance

    if (item.batch) {
      const nextQuantity = item.batch.qtyOnHand.plus(variance);
      if (nextQuantity.lt(item.batch.qtyReserved)) throw new DomainError('INVENTORY_INSUFFICIENT', 'Count would consume reserved batch stock', {}, 409);
      await tx.productBatch.update({ where: { id: item.batch.id }, data: { qtyOnHand: nextQuantity } });
    }

    const stock = rows.get(item.productId)!;
    const plan = planStockMovement(stock, {
      companyId: input.companyId, eventId, eventLineNo,
      warehouseId: sc.warehouseId, productId: item.productId,
      movementType: variance.gt(0) ? 'stock_count_gain' : 'stock_count_loss',
      qtyDelta: variance.toString(), unitCost: stock.movingAverageCost.toString(),
      referenceType: 'stock_count', referenceId: sc.id, sourceLineId: item.id,
      effectiveAt: new Date(), createdBy: input.postedBy,
      metadata: { expected: expected.toString(), counted: countedQty.toString(), variance: variance.toString() },
    });
    movements.push(plan.movementData);
    journalValues.push({ value: plan.movementData.totalCostDelta, reasonCodeId: item.reasonCodeId });
    moved.add(item.productId);
    rows.set(item.productId, {
      ...stock,
      qtyOnHand: new Prisma.Decimal(String(plan.stockData.qtyOnHand)),
      qtyDamaged: new Prisma.Decimal(String(plan.stockData.qtyDamaged)),
      qtyInTransitOut: new Prisma.Decimal(String(plan.stockData.qtyInTransitOut)),
      movingAverageCost: new Prisma.Decimal(String(plan.stockData.movingAverageCost)),
    });
    eventLineNo++;
    adjustmentsPosted++;
  }

  for (let offset = 0; offset < movements.length; offset += STOCK_WRITE_BATCH) {
    await tx.stockMovement.createMany({ data: movements.slice(offset, offset + STOCK_WRITE_BATCH) });
  }

  // Each moved row's final state, written with the same optimistic version
  // check postStockMovement makes: if any row changed since it was read, the
  // update matches fewer rows than it should and the count is refused.
  const changed = [...rows.values()].filter(row => moved.has(row.productId));
  const now = new Date();
  for (let offset = 0; offset < changed.length; offset += STOCK_WRITE_BATCH) {
    const batch = changed.slice(offset, offset + STOCK_WRITE_BATCH);
    const set = (column: string, value: (row: StockRowState) => Prisma.Decimal) => Prisma.sql`${Prisma.raw(column)} = CASE id ${Prisma.join(
      batch.map(row => Prisma.sql`WHEN ${row.id} THEN ${value(row).toString()}`), ' ')} END`;
    const updated = await tx.$executeRaw`
      UPDATE warehouse_stocks SET
        ${set('qty_on_hand', row => row.qtyOnHand)},
        ${set('qty_damaged', row => row.qtyDamaged)},
        ${set('qty_in_transit_out', row => row.qtyInTransitOut)},
        ${set('moving_average_cost', row => row.movingAverageCost)},
        version = version + 1, updated_at = ${now}
      WHERE company_id = ${input.companyId} AND warehouse_id = ${sc.warehouseId}
        AND (id, version) IN (${Prisma.join(batch.map(row => Prisma.sql`(${row.id}, ${original.get(row.productId)!})`))})`;
    if (updated !== batch.length) {
      throw new DomainError('CONCURRENT_MODIFICATION', 'Stock changed during posting; retry the transaction', {}, 409);
    }
  }

  await postInventoryVarianceJournal(tx, { companyId: input.companyId, branchId: sc.branchId, sourceType: 'stock_count', sourceId: sc.id,
    referenceNo: sc.referenceNo, businessDate: now, userId: input.postedBy, values: journalValues }, correlationId);

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
