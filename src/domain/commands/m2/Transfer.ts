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
import { postStockMovement } from '@/domain/inventory/stockMovement';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

export interface CreateTransferInput {
  companyId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  requestedBy: string;
  notes?: string;
  items: Array<{
    productId: string;
    qtyRequested: number;
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

  let lineNo = 1;
  for (const item of input.items) {
    if (item.qtyRequested <= 0) {
      throw new DomainError('VALIDATION_FAILED', `Line ${lineNo}: quantity must be > 0`, {}, 400);
    }
    const product = await tx.product.findFirst({
      where: { id: item.productId, companyId: input.companyId, deletedAt: null },
    });
    if (!product) throw new DomainError('VALIDATION_FAILED', `Product ${item.productId} not found`, {}, 404);

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

    await tx.transferItem.create({
      data: {
        companyId: input.companyId,
        transferId: transfer.id,
        lineNo,
        productId: item.productId,
        qtyRequested: item.qtyRequested,
        reservationId: reservation.id,
      },
    });
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
    include: { items: true },
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
    eventLineNo++;

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
    include: { items: true },
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
    // Post inbound stock movement at destination (inbound recalculates MAC)
    await postStockMovement(tx, {
      companyId: input.companyId, eventId, eventLineNo,
      warehouseId: transfer.toWarehouseId, productId: item.productId,
      movementType: 'transfer_receive',
      qtyDelta: parseFloat(item.qtyRequested.toString()),
      unitCost: parseFloat(item.unitCostSnapshot?.toString() ?? '0'),  // carry source cost
      referenceType: 'transfer', referenceId: transfer.id, sourceLineId: item.id,
      effectiveAt: new Date(), createdBy: input.receivedBy,
      metadata: { transfer_ref: transfer.referenceNo, from_warehouse: transfer.fromWarehouseId },
    });
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
    include: { items: true },
  });
  if (!transfer) throw new DomainError('RESOURCE_NOT_FOUND', 'Transfer not found', {}, 404);
  if (transfer.status !== 'pending') {
    throw new DomainError('VALIDATION_FAILED', `Cannot cancel a ${transfer.status} transfer (only pending)`, {}, 409);
  }

  // Release all reservations
  for (const item of transfer.items) {
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
