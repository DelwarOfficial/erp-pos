// src/domain/commands/m2/ReceivePurchase.ts
// ReceivePurchase domain command per §7 + §5.8.
//
// Receives a purchase (full or partial). For each line:
//   1. Validates qty_received_now + existing qty_received <= qty_ordered
//   2. For serialized products, creates product_serials with status='in_stock'
//   3. Calls postStockMovement with movementType='purchase_receive' (inbound → recalculates MAC)
//   4. Updates purchase_items.qty_received
//   5. Updates purchase.order_status (partially_received or received)
//
// Per §20.D13 (foreign-currency purchasing): the unit_cost is in the
// purchase currency; the inventory_unit_cost = unit_cost × exchange_rate.
// The moving-average cost is computed in BASE currency (BDT).

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { postStockMovement } from '@/domain/inventory/stockMovement';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

export interface ReceivePurchaseInput {
  purchaseId: string;
  companyId: string;
  branchId: string;
  warehouseId: string;
  receivedBy: string;
  businessDate: Date;
  supplierDocumentNo?: string;
  notes?: string;
  items: Array<{
    purchaseItemId: string;
    qtyReceivedNow: number;
    batchNo?: string;
    manufacturedAt?: Date;
    expiryDate?: Date;
    serials?: string[];  // serial numbers for serialized products
  }>;
}

export interface ReceivePurchaseResult {
  receivingId: string;
  referenceNo: string;
  status: string;
  items: Array<{
    purchaseItemId: string;
    qtyReceivedNow: number;
    inventoryUnitCost: string;
    movementId: string;
  }>;
  purchaseNewStatus: string;
}

export async function receivePurchase(
  tx: Prisma.TransactionClient,
  input: ReceivePurchaseInput,
  correlationId: string,
): Promise<ReceivePurchaseResult> {
  // 1. Load the purchase
  const purchase = await tx.purchase.findFirst({
    where: { id: input.purchaseId, companyId: input.companyId },
    include: { items: true, supplier: true },
  });
  if (!purchase) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Purchase not found', {}, 404);
  }
  if (purchase.orderStatus === 'cancelled' || purchase.orderStatus === 'closed') {
    throw new DomainError('VALIDATION_FAILED', `Cannot receive a ${purchase.orderStatus} purchase`, {}, 409);
  }

  // 2. Validate warehouse + branch match the purchase
  if (purchase.warehouseId !== input.warehouseId || purchase.branchId !== input.branchId) {
    throw new DomainError('VALIDATION_FAILED', 'Warehouse/branch mismatch with purchase', {}, 400);
  }

  // 3. Generate receiving reference number
  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId,
    branchId: input.branchId,
    documentType: 'PURCHASE_RECEIVING',
    fiscalYear: new Date(input.businessDate).getFullYear(),
    prefix: 'PR-',
  });

  // 4. Create the business event
  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: {
      id: eventId,
      companyId: input.companyId,
      eventType: 'purchase.received',
      sourceType: 'purchase_receiving',
      sourceId: referenceNo,
      correlationId,
      occurredAt: new Date(),
    },
  });

  // 5. Create the receiving header
  const receiving = await tx.purchaseReceiving.create({
    data: {
      companyId: input.companyId,
      branchId: input.branchId,
      warehouseId: input.warehouseId,
      purchaseId: input.purchaseId,
      referenceNo,
      clientTxnId: randomUUID(),
      receivingStatus: 'posted',
      businessDate: input.businessDate,
      receivedAt: new Date(),
      supplierDocumentNo: input.supplierDocumentNo ?? null,
      notes: input.notes ?? null,
      postedAt: new Date(),
      receivedBy: input.receivedBy,
    },
  });

  // 6. Process each receiving line
  let eventLineNo = 1;
  const resultItems: ReceivePurchaseResult['items'] = [];

  for (const item of input.items) {
    const purchaseItem = purchase.items.find(pi => pi.id === item.purchaseItemId);
    if (!purchaseItem) {
      throw new DomainError('VALIDATION_FAILED', `Purchase item ${item.purchaseItemId} not found`, {}, 400);
    }

    const qtyAlreadyReceived = parseFloat(purchaseItem.qtyReceived.toString());
    const newQtyReceivedTotal = qtyAlreadyReceived + item.qtyReceivedNow;
    if (newQtyReceivedTotal > parseFloat(purchaseItem.qtyOrdered.toString())) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `Receiving ${newQtyReceivedTotal} exceeds ordered ${purchaseItem.qtyOrdered} for line ${purchaseItem.lineNo}`,
        { line_no: purchaseItem.lineNo, ordered: purchaseItem.qtyOrdered.toString(), would_receive: newQtyReceivedTotal },
        409,
      );
    }

    // Compute inventory unit cost in BASE currency
    // unit_cost is in purchase currency; multiply by exchange_rate
    const unitCostBase = parseFloat(purchaseItem.unitCost.toString()) * parseFloat(purchase.exchangeRate.toString());

    // 7. Create the receiving item
    const receivingItem = await tx.purchaseReceivingItem.create({
      data: {
        companyId: input.companyId,
        purchaseReceivingId: receiving.id,
        purchaseItemId: item.purchaseItemId,
        lineNo: eventLineNo,
        qtyReceivedNow: item.qtyReceivedNow,
        unitCostSnapshot: purchaseItem.unitCost,
        landedCostPerUnitSnapshot: purchaseItem.allocatedLandedCostPerUnit,
        inventoryUnitCost: unitCostBase,
        batchNo: item.batchNo ?? null,
        manufacturedAt: item.manufacturedAt ?? null,
        expiryDate: item.expiryDate ?? null,
      },
    });

    // 8. For serialized products, create product_serials
    if (item.serials && item.serials.length > 0) {
      if (item.serials.length !== item.qtyReceivedNow) {
        throw new DomainError(
          'VALIDATION_FAILED',
          `Serialized count (${item.serials.length}) must equal qty_received_now (${item.qtyReceivedNow})`,
          { line_no: purchaseItem.lineNo, serials: item.serials.length, qty: item.qtyReceivedNow },
          400,
        );
      }
      for (const serialNumber of item.serials) {
        // Check uniqueness within company
        const existing = await tx.productSerial.findUnique({
          where: {
            companyId_serialNumber: {
              companyId: input.companyId,
              serialNumber,
            },
          },
        });
        if (existing) {
          throw new DomainError(
            'VALIDATION_FAILED',
            `Serial number ${serialNumber} already exists in this company`,
            { serial_number: serialNumber },
            409,
          );
        }

        const serial = await tx.productSerial.create({
          data: {
            companyId: input.companyId,
            productId: purchaseItem.productId,
            serialNumber,
            status: 'in_stock',
            currentWarehouseId: input.warehouseId,
            originatingPurchaseItemId: item.purchaseItemId,
            warrantyStartDate: input.businessDate,
          },
        });

        await tx.purchaseReceivingItemSerial.create({
          data: {
            purchaseReceivingItemId: receivingItem.id,
            serialId: serial.id,
          },
        });
      }
    }

    // 9. Post the stock movement (inbound → recalculates MAC)
    const movementResult = await postStockMovement(tx, {
      companyId: input.companyId,
      eventId,
      eventLineNo,
      warehouseId: input.warehouseId,
      productId: purchaseItem.productId,
      movementType: 'purchase_receive',
      qtyDelta: item.qtyReceivedNow,
      unitCost: unitCostBase,
      referenceType: 'purchase_receiving',
      referenceId: receiving.id,
      sourceLineId: receivingItem.id,
      effectiveAt: input.businessDate,
      createdBy: input.receivedBy,
      metadata: {
        purchase_id: input.purchaseId,
        purchase_item_id: item.purchaseItemId,
        batch_no: item.batchNo,
      },
    });

    // 10. Update purchase_items.qty_received
    await tx.purchaseItem.update({
      where: { id: item.purchaseItemId },
      data: { qtyReceived: newQtyReceivedTotal },
    });

    resultItems.push({
      purchaseItemId: item.purchaseItemId,
      qtyReceivedNow: item.qtyReceivedNow,
      inventoryUnitCost: unitCostBase.toString(),
      movementId: movementResult.movementId,
    });

    eventLineNo++;
  }

  // 11. Update purchase order_status
  let newOrderStatus = purchase.orderStatus;
  const allItems = await tx.purchaseItem.findMany({ where: { purchaseId: input.purchaseId } });
  const allFullyReceived = allItems.every(pi =>
    parseFloat(pi.qtyReceived.toString()) >= parseFloat(pi.qtyOrdered.toString())
  );
  const anyReceived = allItems.some(pi => parseFloat(pi.qtyReceived.toString()) > 0);
  if (allFullyReceived) {
    newOrderStatus = 'received';
  } else if (anyReceived) {
    newOrderStatus = 'partially_received';
  }

  await tx.purchase.update({
    where: { id: input.purchaseId },
    data: { orderStatus: newOrderStatus },
  });

  // 12. Audit
  await tx.auditLog.create({
    data: {
      companyId: input.companyId,
      userId: input.receivedBy,
      correlationId,
      action: 'purchase.receive',
      entityType: 'purchase_receiving',
      entityId: receiving.id,
      afterValue: JSON.stringify({
        purchase_id: input.purchaseId,
        reference_no: referenceNo,
        item_count: input.items.length,
        new_status: newOrderStatus,
      }),
    },
  });

  return {
    receivingId: receiving.id,
    referenceNo,
    status: 'posted',
    items: resultItems,
    purchaseNewStatus: newOrderStatus,
  };
}
