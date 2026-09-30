// src/domain/commands/m2/PostStockAdjustment.ts
// PostStockAdjustment per §7.19 + §5.5A.
//
// Posts an inventory adjustment (add/subtract/damage/writeoff/count_variance/correction).
// Each line creates a stock_movement (adjustment_in or adjustment_out) and updates MAC.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postStockMovement, validateSerialTransition } from '@/domain/inventory/stockMovement';
import { postInventoryVarianceJournal } from '@/domain/inventory/varianceJournal';
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
    serialNumbers?: string[];
    batchNo?: string;
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
  if (reasonCode.requiresApproval) throw new DomainError('APPROVAL_REQUIRED', 'This reason requires independent approval; direct adjustment posting is prohibited', {}, 409);
  const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, companyId: input.companyId, branchId: input.branchId, isActive: true } });
  if (!warehouse) throw new DomainError('VALIDATION_FAILED', 'Select an active warehouse in this branch', {}, 400);
  if (!input.items.length || new Set(input.items.map(item => item.productId)).size !== input.items.length) throw new DomainError('VALIDATION_FAILED', 'Provide one line per product', {}, 400);

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
  const journalValues: { value: Prisma.Decimal.Value; reasonCodeId: string }[] = [];
  let lineNo = 1;
  for (const item of input.items) {
    if (!Number.isFinite(item.quantityDelta) || item.quantityDelta === 0) {
      throw new DomainError('VALIDATION_FAILED', `Line ${lineNo}: quantity_delta must be non-zero`, {}, 400);
    }

    const product = await tx.product.findFirst({
      where: { id: item.productId, companyId: input.companyId, deletedAt: null },
    });
    if (!product) throw new DomainError('VALIDATION_FAILED', `Product ${item.productId} not found`, {}, 404);
    if (['add', 'reclassify'].includes(input.adjustmentType) && item.quantityDelta < 0 || ['subtract', 'damage', 'writeoff'].includes(input.adjustmentType) && item.quantityDelta > 0) throw new DomainError('VALIDATION_FAILED', 'Quantity direction must match adjustment type', {}, 400);
    const recovery = input.adjustmentType === 'reclassify';
    const numbers = (item.serialNumbers ?? []).map(number => number.trim());
    if (new Set(numbers).size !== numbers.length || numbers.some(number => !number) || (product.isSerialized ? (!Number.isInteger(item.quantityDelta) || numbers.length !== Math.abs(item.quantityDelta)) : numbers.length > 0)) throw new DomainError('VALIDATION_FAILED', 'Provide one unique serial number per serialized unit', {}, 400);
    const serials = numbers.length ? await tx.productSerial.findMany({ where: { companyId: input.companyId, serialNumber: { in: numbers } } }) : [];
    if (item.quantityDelta > 0 && !recovery) {
      if (serials.length) throw new DomainError('SERIAL_NOT_AVAILABLE', 'Added serial numbers must be new', {}, 409);
    } else if (product.isSerialized && (serials.length !== numbers.length || serials.some(serial => serial.productId !== product.id || serial.currentWarehouseId !== warehouse.id || serial.currentReservationId || serial.status !== (recovery ? 'damaged' : 'in_stock')))) throw new DomainError('SERIAL_NOT_AVAILABLE', 'Selected serials are unavailable in the source bucket', {}, 409);
    let batch = item.batchNo ? await tx.productBatch.findFirst({ where: { companyId: input.companyId, warehouseId: warehouse.id, productId: product.id, batchNo: item.batchNo.trim() } }) : null;
    if (product.trackBatches && !item.batchNo?.trim()) throw new DomainError('VALIDATION_FAILED', 'Enter the product batch number', {}, 400);
    if (product.trackBatches && (recovery || input.adjustmentType === 'damage')) throw new DomainError('VALIDATION_FAILED', 'Batch damage/recovery requires batch bucket tracking, which this schema does not yet support', {}, 409);
    if (product.trackBatches && item.quantityDelta < 0 && (!batch || batch.qtyOnHand.minus(batch.qtyReserved).lt(Math.abs(item.quantityDelta)))) throw new DomainError('INVENTORY_INSUFFICIENT', 'Insufficient available batch stock', {}, 409);

    const isInbound = item.quantityDelta > 0;
    const stock = await tx.warehouseStock.findUnique({
      where: {
        companyId_warehouseId_productId: {
          companyId: input.companyId, warehouseId: input.warehouseId, productId: item.productId,
        },
      },
    });
    const unitCost = isInbound && !recovery
      ? (item.unitCost ?? -1)
      : (stock ? parseFloat(stock.movingAverageCost.toString()) : 0);
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new DomainError('VALIDATION_FAILED', 'Enter a nonnegative cost for added stock', {}, 400);
    if (recovery && (!stock || stock.qtyDamaged.lt(item.quantityDelta))) throw new DomainError('INVENTORY_INSUFFICIENT', 'Insufficient damaged stock to recover', {}, 409);
    const valueDelta = new Prisma.Decimal(item.quantityDelta).mul(unitCost);

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

    const movement = await postStockMovement(tx, {
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
    const persisted = await tx.stockMovement.findUniqueOrThrow({ where: { id: movement.movementId }, select: { totalCostDelta: true } });
    journalValues.push({ value: persisted.totalCostDelta, reasonCodeId: reasonCode.id });
    if (input.adjustmentType === 'damage' || recovery) await postStockMovement(tx, {
      companyId: input.companyId, eventId, eventLineNo: eventLineNo++, warehouseId: warehouse.id, productId: product.id,
      stockBucket: 'damaged', movementType: 'damage_move', qtyDelta: -item.quantityDelta, unitCost,
      referenceType: 'stock_adjustment', referenceId: adjustment.id, sourceLineId: adjustmentItem.id, effectiveAt: input.businessDate, createdBy: input.postedBy,
    });
    if (product.trackBatches) {
      batch = batch ? await tx.productBatch.update({ where: { id: batch.id }, data: { qtyOnHand: { increment: item.quantityDelta } } }) : await tx.productBatch.create({ data: { companyId: input.companyId, productId: product.id, warehouseId: warehouse.id, batchNo: item.batchNo!.trim(), qtyOnHand: item.quantityDelta } });
      await tx.stockAdjustmentItem.update({ where: { id: adjustmentItem.id }, data: { batchId: batch.id } });
      await tx.stockMovementBatch.create({ data: { companyId: input.companyId, stockMovementId: movement.movementId, productBatchId: batch.id, qty: item.quantityDelta } });
    }
    for (const number of numbers) {
      const existing = serials.find(serial => serial.serialNumber === number);
      const status = input.adjustmentType === 'damage' ? 'damaged' : isInbound ? 'in_stock' : 'scrapped';
      if (existing) validateSerialTransition(existing.status, status);
      const serial = existing ? await tx.productSerial.update({ where: { id: existing.id }, data: { status, version: { increment: 1 } } }) : await tx.productSerial.create({ data: { companyId: input.companyId, productId: product.id, serialNumber: number, currentWarehouseId: warehouse.id, status } });
      await tx.stockAdjustmentItemSerial.create({ data: { stockAdjustmentItemId: adjustmentItem.id, serialId: serial.id } });
      await tx.serialEvent.create({ data: { companyId: input.companyId, serialId: serial.id, eventId, eventLineNo: eventLineNo++, eventType: 'stock_adjustment.posted', fromStatus: existing?.status, toStatus: status, fromWarehouseId: existing?.currentWarehouseId, toWarehouseId: warehouse.id, stockMovementId: movement.movementId, referenceType: 'stock_adjustment', referenceId: adjustment.id, createdBy: input.postedBy } });
    }
    lineNo++;
  }

  const journal = await postInventoryVarianceJournal(tx, { companyId: input.companyId, branchId: input.branchId, sourceType: 'stock_adjustment', sourceId: adjustment.id, referenceNo, businessDate: input.businessDate, userId: input.postedBy, values: journalValues }, correlationId);
  if (journal) await tx.stockAdjustment.update({ where: { id: adjustment.id }, data: { journalEntryId: journal.journalEntryId } });

  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.postedBy, correlationId,
      action: 'stock_adjustment.post', entityType: 'stock_adjustment', entityId: adjustment.id,
      afterValue: JSON.stringify({ reference_no: referenceNo, type: input.adjustmentType, item_count: input.items.length }),
    },
  });

  return { adjustmentId: adjustment.id, referenceNo, status: 'posted', itemCount: input.items.length };
}
