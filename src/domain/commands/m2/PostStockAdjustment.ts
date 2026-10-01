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
  approvedAdjustmentId?: string,
): Promise<{ adjustmentId: string; referenceNo: string; status: string; itemCount: number }> {
  const reasonCode = await tx.inventoryReasonCode.findFirst({
    where: { id: input.reasonCodeId, companyId: input.companyId, isActive: true },
  });
  if (!reasonCode) throw new DomainError('VALIDATION_FAILED', 'Reason code not found', {}, 404);
  const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, companyId: input.companyId, branchId: input.branchId, isActive: true } });
  if (!warehouse) throw new DomainError('VALIDATION_FAILED', 'Select an active warehouse in this branch', {}, 400);
  if (!input.items.length || new Set(input.items.map(item => item.productId)).size !== input.items.length) throw new DomainError('VALIDATION_FAILED', 'Provide one line per product', {}, 400);
  if (!input.notes.trim() || !Number.isFinite(input.businessDate.getTime()) || !['add', 'subtract', 'damage', 'writeoff', 'reclassify', 'count_variance', 'correction'].includes(input.adjustmentType)) throw new DomainError('VALIDATION_FAILED', 'Valid adjustment type, date and explanation are required', {}, 400);
  if (reasonCode.requiresApproval && !approvedAdjustmentId) return requestAdjustmentApproval(tx, input, correlationId);
  const existing = approvedAdjustmentId ? await tx.stockAdjustment.findFirst({ where: { id: approvedAdjustmentId, companyId: input.companyId, status: 'pending_approval' } }) : null;
  const approval = existing?.approvalRequestId ? await tx.approvalRequest.findFirst({ where: { id: existing.approvalRequestId, companyId: input.companyId, referenceType: 'stock_adjustment', referenceId: existing.id, status: 'approved' } }) : null;
  if (approvedAdjustmentId && (!existing || !approval || approval.approvedBy === approval.requestedBy)) throw new DomainError('APPROVAL_REQUIRED', 'Independent approval is required before posting', {}, 409);

  const { documentNumber: referenceNo } = existing ? { documentNumber: existing.referenceNo } : await nextDocumentNumber(tx, {
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

  const adjustment = existing ?? await tx.stockAdjustment.create({
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
    if (product.productType !== 'standard') throw new DomainError('VALIDATION_FAILED', 'Only stock-managed standard products can be adjusted', {}, 400);
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
    if (product.trackBatches && recovery) {
      if (!batch) throw new DomainError('INVENTORY_INSUFFICIENT', 'Select the original damaged batch for recovery', {}, 409);
      const damaged = await tx.stockMovementBatch.aggregate({ where: { companyId: input.companyId, productBatchId: batch.id,
        stockMovement: { companyId: input.companyId, warehouseId: warehouse.id, productId: product.id, stockBucket: 'damaged' } }, _sum: { qty: true } });
      if (!damaged._sum.qty || damaged._sum.qty.lt(item.quantityDelta)) throw new DomainError('INVENTORY_INSUFFICIENT', 'Insufficient damaged quantity in this batch; reconcile untracked legacy damage before recovery', {}, 409);
    }
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

    const lineData = {
      companyId: input.companyId, stockAdjustmentId: adjustment.id, lineNo, productId: item.productId,
      quantityDelta: item.quantityDelta, unitCostSnapshot: unitCost, valueDelta, eventId,
    };
    const adjustmentItem = await tx.stockAdjustmentItem.upsert({
      where: { stockAdjustmentId_lineNo: { stockAdjustmentId: adjustment.id, lineNo } },
      update: lineData,
      create: lineData,
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
    const damagedMovement = input.adjustmentType === 'damage' || recovery ? await postStockMovement(tx, {
      companyId: input.companyId, eventId, eventLineNo: eventLineNo++, warehouseId: warehouse.id, productId: product.id,
      stockBucket: 'damaged', movementType: 'damage_move', qtyDelta: -item.quantityDelta, unitCost,
      referenceType: 'stock_adjustment', referenceId: adjustment.id, sourceLineId: adjustmentItem.id, effectiveAt: input.businessDate, createdBy: input.postedBy,
    }) : null;
    if (product.trackBatches) {
      batch = batch ? await tx.productBatch.update({ where: { id: batch.id }, data: { qtyOnHand: { increment: item.quantityDelta } } }) : await tx.productBatch.create({ data: { companyId: input.companyId, productId: product.id, warehouseId: warehouse.id, batchNo: item.batchNo!.trim(), qtyOnHand: item.quantityDelta } });
      await tx.stockAdjustmentItem.update({ where: { id: adjustmentItem.id }, data: { batchId: batch.id } });
      await tx.stockMovementBatch.create({ data: { companyId: input.companyId, stockMovementId: movement.movementId, productBatchId: batch.id, qty: item.quantityDelta } });
      if (damagedMovement) await tx.stockMovementBatch.create({ data: { companyId: input.companyId, stockMovementId: damagedMovement.movementId, productBatchId: batch.id, qty: -item.quantityDelta } });
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
  await tx.stockAdjustment.update({ where: { id: adjustment.id }, data: { status: 'posted', postedAt: new Date(), journalEntryId: journal?.journalEntryId, approvedBy: approval?.approvedBy } });

  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.postedBy, correlationId,
      action: 'stock_adjustment.post', entityType: 'stock_adjustment', entityId: adjustment.id,
      afterValue: JSON.stringify({ reference_no: referenceNo, type: input.adjustmentType, item_count: input.items.length }),
    },
  });

  return { adjustmentId: adjustment.id, referenceNo, status: 'posted', itemCount: input.items.length };
}

async function requestAdjustmentApproval(tx: Prisma.TransactionClient, input: PostStockAdjustmentInput, correlationId: string) {
  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, { companyId: input.companyId, branchId: input.branchId, documentType: 'STOCK_ADJUSTMENT', fiscalYear: input.businessDate.getFullYear(), prefix: 'SA-' });
  const adjustment = await tx.stockAdjustment.create({ data: { companyId: input.companyId, branchId: input.branchId, warehouseId: input.warehouseId, referenceNo, clientTxnId: randomUUID(), adjustmentType: input.adjustmentType, reasonCodeId: input.reasonCodeId, businessDate: input.businessDate, notes: input.notes, createdBy: input.postedBy, status: 'pending_approval' } });
  for (const [index, item] of input.items.entries()) {
    if (!Number.isFinite(item.quantityDelta) || item.quantityDelta === 0 || (item.unitCost !== undefined && (!Number.isFinite(item.unitCost) || item.unitCost < 0))) throw new DomainError('VALIDATION_FAILED', 'Invalid adjustment quantity or cost', {}, 400);
    const product = await tx.product.findFirst({ where: { companyId: input.companyId, id: item.productId, deletedAt: null } });
    if (!product) throw new DomainError('VALIDATION_FAILED', 'Select an available product', {}, 400);
    const stock = await tx.warehouseStock.findUnique({ where: { companyId_warehouseId_productId: { companyId: input.companyId, warehouseId: input.warehouseId, productId: item.productId } } });
    const cost = item.quantityDelta > 0 ? new Prisma.Decimal(item.unitCost ?? 0) : stock?.movingAverageCost ?? new Prisma.Decimal(0);
    await tx.stockAdjustmentItem.create({ data: { companyId: input.companyId, stockAdjustmentId: adjustment.id, lineNo: index + 1, productId: item.productId, quantityDelta: item.quantityDelta, unitCostSnapshot: cost, valueDelta: cost.mul(item.quantityDelta) } });
  }
  const approval = await tx.approvalRequest.create({ data: { companyId: input.companyId, branchId: input.branchId, requestType: 'stock_adjustment', referenceType: 'stock_adjustment', referenceId: adjustment.id, requestedBy: input.postedBy, reason: input.notes, payload: JSON.stringify(input), status: 'pending' } });
  await tx.stockAdjustment.update({ where: { id: adjustment.id }, data: { approvalRequestId: approval.id } });
  await tx.auditLog.create({ data: { companyId: input.companyId, userId: input.postedBy, correlationId, action: 'stock_adjustment.request_approval', entityType: 'stock_adjustment', entityId: adjustment.id, afterValue: JSON.stringify({ approval_request_id: approval.id }) } });
  return { adjustmentId: adjustment.id, referenceNo, status: 'pending_approval', itemCount: input.items.length };
}

export async function actOnStockAdjustment(tx: Prisma.TransactionClient, input: { companyId: string; id: string; userId: string; action: 'post' | 'cancel' }, correlationId: string) {
  const adjustment = await tx.stockAdjustment.findFirst({ where: { companyId: input.companyId, id: input.id, status: 'pending_approval' } });
  if (!adjustment?.approvalRequestId) throw new DomainError('VALIDATION_FAILED', 'Adjustment is not pending approval', {}, 409);
  const approval = await tx.approvalRequest.findFirst({ where: { id: adjustment.approvalRequestId, companyId: input.companyId, referenceType: 'stock_adjustment', referenceId: adjustment.id } });
  if (!approval) throw new DomainError('VALIDATION_FAILED', 'Approval record unavailable', {}, 409);
  if (input.action === 'cancel') {
    await tx.approvalRequest.update({ where: { id: approval.id }, data: { status: 'cancelled' } });
    await tx.stockAdjustment.update({ where: { id: adjustment.id }, data: { status: 'cancelled' } });
    await tx.auditLog.create({ data: { companyId: input.companyId, userId: input.userId, correlationId, action: 'stock_adjustment.cancel', entityType: 'stock_adjustment', entityId: adjustment.id, afterValue: JSON.stringify({ status: 'cancelled' }) } });
    return { adjustmentId: adjustment.id, referenceNo: adjustment.referenceNo, status: 'cancelled', itemCount: 0 };
  }
  const payload = JSON.parse(approval.payload) as PostStockAdjustmentInput;
  return postStockAdjustment(tx, { ...payload, companyId: input.companyId, postedBy: input.userId, businessDate: new Date(payload.businessDate) }, correlationId, adjustment.id);
}
