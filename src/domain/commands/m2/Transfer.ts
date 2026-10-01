// src/domain/commands/m2/Transfer.ts
// DispatchTransfer + ReceiveTransfer + CancelTransfer per §5.9.
//
// Transfer lifecycle: draft → pending (reserve stock) → in_transit (dispatch) →
// completed (receive) OR returning → returned. Pending may be cancelled.
//
// Dispatch: consumes reservation, moves on_hand → in_transit_out on source.
// Receive: moves in_transit_out → on_hand on destination (inbound recalculates MAC).
// Cancel (from pending): releases reservation.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postStockMovement, validateSerialTransition } from '@/domain/inventory/stockMovement';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';
import { dispatchTransferBatches, receiveTransferBatches } from '@/domain/inventory/transferBatches';

export interface CreateTransferInput {
  companyId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  requestedBy: string;
  notes?: string;
  items: Array<{
    productId: string;
    qtyRequested: number;
    serialNumbers?: string[];
  }>;
}

export async function createTransfer(
  tx: Prisma.TransactionClient,
  input: CreateTransferInput,
  correlationId: string,
): Promise<{ transferId: string; referenceNo: string; status: string }> {
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw new DomainError('VALIDATION_FAILED', 'From and to warehouse must differ', {}, 400);
  }
  if (!input.items.length || new Set(input.items.map(item => item.productId)).size !== input.items.length) {
    throw new DomainError('VALIDATION_FAILED', 'Provide at least one line and only one line per product', {}, 400);
  }

  const fromWh = await tx.warehouse.findFirst({
    where: { id: input.fromWarehouseId, companyId: input.companyId },
  });
  if (!fromWh) throw new DomainError('VALIDATION_FAILED', 'Source warehouse not found', {}, 404);

  const toWh = await tx.warehouse.findFirst({
    where: { id: input.toWarehouseId, companyId: input.companyId },
  });
  if (!toWh) throw new DomainError('VALIDATION_FAILED', 'Destination warehouse not found', {}, 404);

  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId,
    branchId: fromWh.branchId,
    documentType: 'TRANSFER',
    fiscalYear: new Date().getFullYear(),
    prefix: 'TR-',
  });

  const transfer = await tx.transfer.create({
    data: {
      companyId: input.companyId,
      referenceNo,
      clientTxnId: randomUUID(),
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      status: 'pending',
      requestedBy: input.requestedBy,
      notes: input.notes,
    },
  });

  const reserveEvent = await tx.businessEvent.create({ data: { companyId: input.companyId, eventType: 'transfer.reserved', sourceType: 'transfer', sourceId: transfer.id, correlationId, occurredAt: new Date() } });
  let reserveLineNo = 1;
  let lineNo = 1;
  for (const item of input.items) {
    if (!Number.isFinite(item.qtyRequested) || item.qtyRequested <= 0) {
      throw new DomainError('VALIDATION_FAILED', `Line ${lineNo}: quantity must be > 0`, {}, 400);
    }
    const product = await tx.product.findFirst({
      where: { id: item.productId, companyId: input.companyId, deletedAt: null },
    });
    if (!product) throw new DomainError('VALIDATION_FAILED', `Product ${item.productId} not found`, {}, 404);
    const numbers = (item.serialNumbers ?? []).map(value => value.trim());
    if (new Set(numbers).size !== numbers.length || numbers.some(value => !value) ||
      (product.isSerialized ? (!Number.isInteger(item.qtyRequested) || numbers.length !== item.qtyRequested) : numbers.length > 0)) {
      throw new DomainError('VALIDATION_FAILED', 'Serialized products require one unique serial number per unit; other products cannot include serials', {}, 400);
    }
    const serials = numbers.length ? await tx.productSerial.findMany({ where: {
      companyId: input.companyId, productId: product.id, serialNumber: { in: numbers },
      currentWarehouseId: fromWh.id, status: 'in_stock', currentReservationId: null,
    } }) : [];
    if (serials.length !== numbers.length) throw new DomainError('SERIAL_NOT_AVAILABLE', 'A selected serial is not available at the source warehouse', {}, 409);

    // Create reservation on source warehouse
    const reservation = await tx.stockReservation.create({
      data: {
        companyId: input.companyId,
        warehouseId: input.fromWarehouseId,
        productId: item.productId,
        reservationType: 'transfer',
        referenceId: transfer.id,
        qty: item.qtyRequested,
        status: 'active',
      },
    });

    // Update warehouse_stocks.qty_reserved
    const stock = await tx.warehouseStock.findUnique({
      where: {
        companyId_warehouseId_productId: {
          companyId: input.companyId,
          warehouseId: input.fromWarehouseId,
          productId: item.productId,
        },
      },
    });
    if (!stock) throw new DomainError('INVENTORY_INSUFFICIENT', 'No stock available at the source warehouse', { product_id: item.productId }, 409);
    if (stock) {
      const newReserved = parseFloat(stock.qtyReserved.toString()) + item.qtyRequested;
      const onHand = parseFloat(stock.qtyOnHand.toString());
      if (newReserved > onHand) {
        throw new DomainError(
          'INVENTORY_INSUFFICIENT',
          `Cannot reserve ${item.qtyRequested} — on_hand=${onHand}, already_reserved=${stock.qtyReserved}`,
          { product_id: item.productId, on_hand: onHand, reserved: stock.qtyReserved.toString() },
          409,
        );
      }
      await tx.warehouseStock.update({
        where: { id: stock.id },
        data: { qtyReserved: newReserved, version: { increment: 1 } },
      });
    }

    const transferItem = await tx.transferItem.create({
      data: {
        companyId: input.companyId,
        transferId: transfer.id,
        lineNo,
        productId: item.productId,
        qtyRequested: item.qtyRequested,
        reservationId: reservation.id,
      },
    });
    for (const serial of serials) {
      await tx.transferItemSerial.create({ data: { transferItemId: transferItem.id, serialId: serial.id } });
      await moveTransferSerial(tx, serial, 'reserved', fromWh.id, input.companyId, transfer.id, reserveEvent.id, reserveLineNo++, input.requestedBy, reservation.id);
    }
    lineNo++;
  }

  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.requestedBy, correlationId,
      action: 'transfer.create', entityType: 'transfer', entityId: transfer.id,
      afterValue: JSON.stringify({ reference_no: referenceNo, from: fromWh.code, to: toWh.code, item_count: input.items.length }),
    },
  });

  return { transferId: transfer.id, referenceNo, status: 'pending' };
}

export interface DispatchTransferInput {
  transferId: string;
  companyId: string;
  dispatchedBy: string;
}

export async function dispatchTransfer(
  tx: Prisma.TransactionClient,
  input: DispatchTransferInput,
  correlationId: string,
): Promise<{ transferId: string; status: string }> {
  const transfer = await tx.transfer.findFirst({
    where: { id: input.transferId, companyId: input.companyId },
    include: { items: { include: { serials: { include: { serial: true } } } } },
  });
  if (!transfer) throw new DomainError('RESOURCE_NOT_FOUND', 'Transfer not found', {}, 404);
  if (transfer.status !== 'pending') {
    throw new DomainError('VALIDATION_FAILED', `Transfer is ${transfer.status}, must be pending to dispatch`, {}, 409);
  }

  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: {
      id: eventId, companyId: input.companyId,
      eventType: 'transfer.dispatched', sourceType: 'transfer', sourceId: transfer.id,
      correlationId, occurredAt: new Date(),
    },
  });

  let eventLineNo = 1;
  for (const item of transfer.items) {
    // Consume the reservation
    const reservation = await tx.stockReservation.findUnique({ where: { id: item.reservationId! } });
    if (reservation) {
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: { status: 'consumed', consumedAt: new Date() },
      });
      // Reduce qty_reserved
      const stock = await tx.warehouseStock.findUnique({
        where: {
          companyId_warehouseId_productId: {
            companyId: input.companyId, warehouseId: transfer.fromWarehouseId, productId: item.productId,
          },
        },
      });
      if (stock) {
        await tx.warehouseStock.update({
          where: { id: stock.id },
          data: {
            qtyReserved: parseFloat(stock.qtyReserved.toString()) - parseFloat(reservation.qty.toString()),
            version: { increment: 1 },
          },
        });
      }
    }

    // Post outbound stock movement (sale_issue equivalent for transfer)
    const movement = await postStockMovement(tx, {
      companyId: input.companyId, eventId, eventLineNo,
      warehouseId: transfer.fromWarehouseId, productId: item.productId,
      movementType: 'transfer_dispatch',
      qtyDelta: -parseFloat(item.qtyRequested.toString()),
      unitCost: 0,  // uses pre-movement MAC
      referenceType: 'transfer', referenceId: transfer.id, sourceLineId: item.id,
      effectiveAt: new Date(), createdBy: input.dispatchedBy,
      metadata: { transfer_ref: transfer.referenceNo, to_warehouse: transfer.toWarehouseId },
    });
    await dispatchTransferBatches(tx, { companyId: input.companyId, warehouseId: transfer.fromWarehouseId,
      productId: item.productId, quantity: item.qtyRequested, movementId: movement.movementId });
    for (const { serial } of item.serials) {
      if (serial.status !== 'reserved' || serial.currentWarehouseId !== transfer.fromWarehouseId || serial.currentReservationId !== item.reservationId) {
        throw new DomainError('SERIAL_NOT_AVAILABLE', 'Reserved serial custody changed before dispatch', {}, 409);
      }
      await moveTransferSerial(tx, serial, 'in_transit', transfer.fromWarehouseId, input.companyId, transfer.id, eventId, eventLineNo++, input.dispatchedBy);
    }
    eventLineNo++;

    await postStockMovement(tx, {
      companyId: input.companyId, eventId, eventLineNo: eventLineNo++,
      warehouseId: transfer.fromWarehouseId, productId: item.productId, stockBucket: 'in_transit',
      movementType: 'transfer_dispatch', qtyDelta: item.qtyRequested.toString(), unitCost: movement.movingAverageCostBefore,
      referenceType: 'transfer', referenceId: transfer.id, sourceLineId: item.id,
      effectiveAt: new Date(), createdBy: input.dispatchedBy,
    });

    // Update transfer item
    await tx.transferItem.update({
      where: { id: item.id },
      data: {
        qtyDispatched: item.qtyRequested,
        unitCostSnapshot: movement.movingAverageCostBefore,
      },
    });
  }

  await tx.transfer.update({
    where: { id: transfer.id },
    data: { status: 'in_transit', dispatchedBy: input.dispatchedBy, dispatchedAt: new Date() },
  });

  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.dispatchedBy, correlationId,
      action: 'transfer.dispatch', entityType: 'transfer', entityId: transfer.id,
      afterValue: JSON.stringify({ status: 'in_transit', item_count: transfer.items.length }),
    },
  });

  return { transferId: transfer.id, status: 'in_transit' };
}

export interface ReceiveTransferInput {
  transferId: string;
  companyId: string;
  receivedBy: string;
}

export async function receiveTransfer(
  tx: Prisma.TransactionClient,
  input: ReceiveTransferInput,
  correlationId: string,
): Promise<{ transferId: string; status: string }> {
  const transfer = await tx.transfer.findFirst({
    where: { id: input.transferId, companyId: input.companyId },
    include: { items: { include: { serials: { include: { serial: true } } } } },
  });
  if (!transfer) throw new DomainError('RESOURCE_NOT_FOUND', 'Transfer not found', {}, 404);
  if (transfer.status !== 'in_transit') {
    throw new DomainError('VALIDATION_FAILED', `Transfer is ${transfer.status}, must be in_transit to receive`, {}, 409);
  }

  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: {
      id: eventId, companyId: input.companyId,
      eventType: 'transfer.received', sourceType: 'transfer', sourceId: transfer.id,
      correlationId, occurredAt: new Date(),
    },
  });

  let eventLineNo = 1;
  for (const item of transfer.items) {
    for (const { serial } of item.serials) {
      if (serial.status !== 'in_transit' || serial.currentWarehouseId !== transfer.fromWarehouseId) throw new DomainError('SERIAL_NOT_AVAILABLE', 'Serial is not in this transfer custody', {}, 409);
      await moveTransferSerial(tx, serial, 'in_stock', transfer.toWarehouseId, input.companyId, transfer.id, eventId, eventLineNo++, input.receivedBy);
    }
    // Post inbound stock movement at destination (inbound recalculates MAC)
    const source = await tx.warehouseStock.findUnique({ where: { companyId_warehouseId_productId: { companyId: input.companyId, warehouseId: transfer.fromWarehouseId, productId: item.productId } } });
    if (!source || source.qtyInTransitOut.lt(item.qtyDispatched)) throw new DomainError('INVENTORY_INSUFFICIENT', 'Source transit quantity is insufficient; reconcile this transfer before receiving', {}, 409);
    await postStockMovement(tx, {
      companyId: input.companyId, eventId, eventLineNo: eventLineNo++,
      warehouseId: transfer.fromWarehouseId, productId: item.productId, stockBucket: 'in_transit',
      movementType: 'transfer_receive', qtyDelta: item.qtyDispatched.negated().toString(), unitCost: item.unitCostSnapshot?.toString() ?? '0',
      referenceType: 'transfer', referenceId: transfer.id, sourceLineId: item.id,
      effectiveAt: new Date(), createdBy: input.receivedBy,
    });
    const inbound = await postStockMovement(tx, {
      companyId: input.companyId, eventId, eventLineNo,
      warehouseId: transfer.toWarehouseId, productId: item.productId,
      movementType: 'transfer_receive',
      qtyDelta: parseFloat(item.qtyRequested.toString()),
      unitCost: parseFloat(item.unitCostSnapshot?.toString() ?? '0'),  // carry source cost
      referenceType: 'transfer', referenceId: transfer.id, sourceLineId: item.id,
      effectiveAt: new Date(), createdBy: input.receivedBy,
      metadata: { transfer_ref: transfer.referenceNo, from_warehouse: transfer.fromWarehouseId },
    });
    await receiveTransferBatches(tx, { companyId: input.companyId, transferId: transfer.id, lineId: item.id,
      sourceWarehouseId: transfer.fromWarehouseId, warehouseId: transfer.toWarehouseId,
      productId: item.productId, quantity: item.qtyDispatched, movementId: inbound.movementId });
    eventLineNo++;

    await tx.transferItem.update({
      where: { id: item.id },
      data: { qtyReceived: item.qtyRequested },
    });
  }

  await tx.transfer.update({
    where: { id: transfer.id },
    data: { status: 'completed', receivedBy: input.receivedBy, receivedAt: new Date() },
  });

  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.receivedBy, correlationId,
      action: 'transfer.receive', entityType: 'transfer', entityId: transfer.id,
      afterValue: JSON.stringify({ status: 'completed', item_count: transfer.items.length }),
    },
  });

  return { transferId: transfer.id, status: 'completed' };
}

export async function cancelTransfer(
  tx: Prisma.TransactionClient,
  input: { transferId: string; companyId: string; cancelledBy: string; reason: string },
  correlationId: string,
): Promise<{ transferId: string; status: string }> {
  const transfer = await tx.transfer.findFirst({
    where: { id: input.transferId, companyId: input.companyId },
    include: { items: { include: { serials: { include: { serial: true } } } } },
  });
  if (!transfer) throw new DomainError('RESOURCE_NOT_FOUND', 'Transfer not found', {}, 404);
  if (transfer.status !== 'pending') {
    throw new DomainError('VALIDATION_FAILED', `Cannot cancel a ${transfer.status} transfer (only pending)`, {}, 409);
  }

  // Release all reservations
  const cancelEvent = await tx.businessEvent.create({ data: { companyId: input.companyId, eventType: 'transfer.cancelled', sourceType: 'transfer', sourceId: transfer.id, correlationId, occurredAt: new Date() } });
  let cancelLineNo = 1;
  for (const item of transfer.items) {
    for (const { serial } of item.serials) {
      if (serial.currentReservationId !== item.reservationId || serial.status !== 'reserved') throw new DomainError('SERIAL_NOT_AVAILABLE', 'Reserved serial custody changed before cancellation', {}, 409);
      await moveTransferSerial(tx, serial, 'in_stock', transfer.fromWarehouseId, input.companyId, transfer.id, cancelEvent.id, cancelLineNo++, input.cancelledBy);
    }
    if (item.reservationId) {
      const reservation = await tx.stockReservation.findUnique({ where: { id: item.reservationId } });
      if (reservation && reservation.status === 'active') {
        await tx.stockReservation.update({
          where: { id: reservation.id },
          data: { status: 'released', releasedAt: new Date() },
        });
        // Reduce qty_reserved
        const stock = await tx.warehouseStock.findUnique({
          where: {
            companyId_warehouseId_productId: {
              companyId: input.companyId, warehouseId: transfer.fromWarehouseId, productId: item.productId,
            },
          },
        });
        if (stock) {
          await tx.warehouseStock.update({
            where: { id: stock.id },
            data: {
              qtyReserved: parseFloat(stock.qtyReserved.toString()) - parseFloat(reservation.qty.toString()),
              version: { increment: 1 },
            },
          });
        }
      }
    }
  }

  await tx.transfer.update({
    where: { id: transfer.id },
    data: { status: 'cancelled', cancellationReason: input.reason },
  });

  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.cancelledBy, correlationId,
      action: 'transfer.cancel', entityType: 'transfer', entityId: transfer.id,
      afterValue: JSON.stringify({ status: 'cancelled', reason: input.reason }),
    },
  });

  return { transferId: transfer.id, status: 'cancelled' };
}

async function moveTransferSerial(tx: Prisma.TransactionClient, serial: { id: string; status: string; currentWarehouseId: string | null }, status: string, warehouseId: string, companyId: string, transferId: string, eventId: string, eventLineNo: number, userId: string, reservationId?: string) {
  validateSerialTransition(serial.status, status);
  await tx.productSerial.update({ where: { id: serial.id }, data: { status, currentWarehouseId: warehouseId, currentReservationId: reservationId ?? null, version: { increment: 1 } } });
  await tx.serialEvent.create({ data: { companyId, serialId: serial.id, eventId, eventLineNo,
    eventType: status === 'in_transit' ? 'transfer.dispatched' : status === 'reserved' ? 'transfer.reserved' : serial.status === 'reserved' ? 'transfer.cancelled' : 'transfer.received', fromStatus: serial.status, toStatus: status,
    fromWarehouseId: serial.currentWarehouseId, toWarehouseId: warehouseId, referenceType: 'transfer', referenceId: transferId, createdBy: userId } });
}
