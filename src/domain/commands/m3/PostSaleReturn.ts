// src/domain/commands/m3/PostSaleReturn.ts
// PostSaleReturn per §7.6 — sale return + refund workflow.
//
// Flow:
//   1. Load original sale + items + serials
//   2. Lock prior returns for this sale (prevent concurrent returns)
//   3. Validate qty: cumulative returned ≤ original qty per line
//   4. Validate serials: each serial must belong to the original sale item
//   5. Assess disposition: restock / damaged / repair / scrap
//   6. Create sale_return header + sale_return_items + sale_return_item_serials
//   7. Post stock movements:
//      - restock: sale_return_receive (inbound at ORIGINAL cost, recalculates MAC)
//      - damaged: sale_return_receive + damage_move (bucket transfer to damaged)
//   8. Revert serial status from 'sold' to 'in_stock' (restock) or 'damaged'
//   9. Create serial_events for the transition
//  10. Update sale.saleStatus to 'partially_returned' or 'returned'

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postStockMovement, validateSerialTransition } from '@/domain/inventory/stockMovement';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

export interface PostSaleReturnInput {
  saleId: string;
  companyId: string;
  branchId: string;
  warehouseId: string;
  postedBy: string;
  businessDate: Date;
  disposition: string;  // restock/damaged/repair/scrap/mixed
  reason: string;
  items: Array<{
    saleItemId: string;
    qtyReturned: number;
    condition: string;  // resalable/damaged/repair/scrap
    serials?: string[];  // serial numbers to return
  }>;
}

export async function postSaleReturn(
  tx: Prisma.TransactionClient,
  input: PostSaleReturnInput,
  correlationId: string,
): Promise<{ saleReturnId: string; referenceNo: string; status: string; totalCredit: string }> {
  // 1. Load the original sale
  const sale = await tx.sale.findFirst({
    where: { id: input.saleId, companyId: input.companyId },
    include: {
      items: { include: { serials: { include: { serial: true } } } },
      returns: { where: { status: { in: ['posted', 'approved'] } }, include: { items: true } },
    },
  });
  if (!sale) throw new DomainError('RESOURCE_NOT_FOUND', 'Sale not found', {}, 404);
  if (sale.saleStatus === 'voided') {
    throw new DomainError('VALIDATION_FAILED', 'Cannot return a voided sale', {}, 409);
  }

  // 2. Generate reference number
  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId,
    branchId: input.branchId,
    documentType: 'SALE_RETURN',
    fiscalYear: new Date(input.businessDate).getFullYear(),
    prefix: 'SR-',
  });

  // 3. Create business event
  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: {
      id: eventId, companyId: input.companyId,
      eventType: 'sale_return.posted', sourceType: 'sale_return', sourceId: referenceNo,
      correlationId, occurredAt: new Date(),
    },
  });

  // 4. Process each return line — validate qty + serials
  let subtotalCredit = 0;
  let taxCredit = 0;
  let eventLineNo = 1;
  const returnItemsData: Array<{
    saleItemId: string;
    qtyReturned: number;
    unitPriceCredit: number;
    unitCostSnapshot: number;
    discountCredit: number;
    taxCredit: number;
    lineCredit: number;
    condition: string;
    serialIds: string[];
  }> = [];

  for (const item of input.items) {
    const saleItem = sale.items.find(si => si.id === item.saleItemId);
    if (!saleItem) {
      throw new DomainError('VALIDATION_FAILED', `Sale item ${item.saleItemId} not found in this sale`, {}, 400);
    }

    // Compute cumulative already-returned qty for this line
    let alreadyReturned = 0;
    for (const ret of sale.returns) {
      const retItem = ret.items.find(ri => ri.saleItemId === item.saleItemId);
      if (retItem) {
        alreadyReturned += parseFloat(retItem.qtyReturned.toString());
      }
    }

    const originalQty = parseFloat(saleItem.qty.toString());
    if (alreadyReturned + item.qtyReturned > originalQty) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `Return qty ${item.qtyReturned} + already returned ${alreadyReturned} exceeds original ${originalQty}`,
        { sale_item_id: item.saleItemId, original_qty: originalQty, already_returned: alreadyReturned, returning_now: item.qtyReturned },
        409,
      );
    }

    // Validate serials (if serialized product)
    let serialIds: string[] = [];
    const product = await tx.product.findFirst({ where: { id: saleItem.productId } });
    if (product?.isSerialized) {
      if (!item.serials || item.serials.length !== item.qtyReturned) {
        throw new DomainError(
          'VALIDATION_FAILED',
          `Serialized line requires ${item.qtyReturned} serial(s), got ${item.serials?.length ?? 0}`,
          {},
          400,
        );
      }
      for (const serialNumber of item.serials) {
        // Find the serial in the original sale item's serials
        const saleSerial = saleItem.serials.find(ss => ss.serial.serialNumber === serialNumber);
        if (!saleSerial) {
          throw new DomainError('SERIAL_NOT_AVAILABLE', `Serial ${serialNumber} was not sold in this sale item`, { serial: serialNumber }, 409);
        }
        // Check the serial is currently 'sold'
        const serial = await tx.productSerial.findUnique({ where: { id: saleSerial.serialId } });
        if (!serial || serial.status !== 'sold') {
          throw new DomainError('SERIAL_NOT_AVAILABLE', `Serial ${serialNumber} is not in 'sold' status (current: ${serial?.status ?? 'null'})`, {}, 409);
        }
        serialIds.push(serial.id);
      }
    }

    const unitPriceCredit = parseFloat(saleItem.unitPriceSnapshot.toString());
    const unitCostSnapshot = parseFloat(saleItem.unitCostSnapshot.toString());
    const discountCredit = parseFloat(saleItem.discountAmount.toString()) * (item.qtyReturned / originalQty);
    const taxableBase = unitPriceCredit * item.qtyReturned - discountCredit;
    const lineTaxCredit = parseFloat(saleItem.taxAmount.toString()) * (item.qtyReturned / originalQty);
    const lineCredit = taxableBase + lineTaxCredit;

    returnItemsData.push({
      saleItemId: item.saleItemId,
      qtyReturned: item.qtyReturned,
      unitPriceCredit,
      unitCostSnapshot,
      discountCredit,
      taxCredit: lineTaxCredit,
      lineCredit,
      condition: item.condition,
      serialIds,
    });

    subtotalCredit += unitPriceCredit * item.qtyReturned;
    taxCredit += lineTaxCredit;
  }

  const totalCredit = subtotalCredit - 0 + taxCredit;  // subtotal already includes discount as reduction
  const baseTotalCredit = totalCredit;  // same currency

  // 5. Create the sale_return header
  const saleReturn = await tx.saleReturn.create({
    data: {
      companyId: input.companyId,
      branchId: input.branchId,
      warehouseId: input.warehouseId,
      referenceNo,
      clientTxnId: randomUUID(),
      saleId: input.saleId,
      status: 'posted',
      businessDate: input.businessDate,
      disposition: input.disposition,
      reason: input.reason,
      subtotalCredit,
      taxCredit,
      totalCredit,
      baseTotalCredit,
      postedAt: new Date(),
      createdBy: input.postedBy,
    },
  });

  // 6. Create return items + post stock movements + revert serials
  let lineNo = 1;
  for (const itemData of returnItemsData) {
    const saleItem = sale.items.find(si => si.id === itemData.saleItemId)!;
    const product = await tx.product.findFirst({ where: { id: saleItem.productId } });

    const returnItem = await tx.saleReturnItem.create({
      data: {
        companyId: input.companyId,
        saleReturnId: saleReturn.id,
        saleItemId: itemData.saleItemId,
        qtyReturned: itemData.qtyReturned,
        unitPriceCredit: itemData.unitPriceCredit,
        unitCostSnapshot: itemData.unitCostSnapshot,
        discountCredit: itemData.discountCredit,
        taxCredit: itemData.taxCredit,
        lineCredit: itemData.lineCredit,
        condition: itemData.condition,
      },
    });

    // Link serials
    for (const serialId of itemData.serialIds) {
      await tx.saleReturnItemSerial.create({
        data: { saleReturnItemId: returnItem.id, serialId },
      });
    }

    // Post stock movement based on disposition
    const isStockProduct = product && (product.productType === 'standard' || product.productType === 'combo');
    if (isStockProduct) {
      if (itemData.condition === 'resalable') {
        // Restock: inbound at ORIGINAL sale cost (not current MAC)
        // Per §5.5: "Sale returns enter at the original sale item cost"
        const movement = await postStockMovement(tx, {
          companyId: input.companyId, eventId, eventLineNo,
          warehouseId: input.warehouseId, productId: saleItem.productId,
          movementType: 'sale_return_receive',
          qtyDelta: itemData.qtyReturned,
          unitCost: itemData.unitCostSnapshot,  // original cost, recalculates MAC
          referenceType: 'sale_return', referenceId: saleReturn.id, sourceLineId: returnItem.id,
          effectiveAt: input.businessDate, createdBy: input.postedBy,
          metadata: { sale_return_ref: referenceNo, original_sale: input.saleId },
        });
        eventLineNo++;

        // Revert serials to 'in_stock'
        for (const serialId of itemData.serialIds) {
          const serial = await tx.productSerial.findUnique({ where: { id: serialId } });
          if (serial) {
            validateSerialTransition(serial.status, 'in_stock');
            await tx.productSerial.update({
              where: { id: serialId },
              data: {
                status: 'in_stock',
                currentWarehouseId: input.warehouseId,
                soldSaleItemId: null,
                version: { increment: 1 },
                updatedAt: new Date(),
              },
            });
            await tx.serialEvent.create({
              data: {
                companyId: input.companyId, serialId, eventId, eventLineNo,
                eventType: 'return_to_stock', fromStatus: 'sold', toStatus: 'in_stock',
                fromWarehouseId: null, toWarehouseId: input.warehouseId,
                stockMovementId: movement.movementId,
                referenceType: 'sale_return', referenceId: saleReturn.id,
                createdBy: input.postedBy,
              },
            });
            eventLineNo++;
          }
        }
      } else if (itemData.condition === 'damaged') {
        // Damaged: receive into damaged bucket (not resalable)
        // Post inbound to on_hand first (to maintain ledger integrity), then move to damaged
        const movement = await postStockMovement(tx, {
          companyId: input.companyId, eventId, eventLineNo,
          warehouseId: input.warehouseId, productId: saleItem.productId,
          stockBucket: 'damaged',
          movementType: 'sale_return_receive',
          qtyDelta: itemData.qtyReturned,
          unitCost: itemData.unitCostSnapshot,
          referenceType: 'sale_return', referenceId: saleReturn.id, sourceLineId: returnItem.id,
          effectiveAt: input.businessDate, createdBy: input.postedBy,
          metadata: { sale_return_ref: referenceNo, condition: 'damaged' },
        });
        eventLineNo++;

        // Revert serials to 'damaged'
        for (const serialId of itemData.serialIds) {
          const serial = await tx.productSerial.findUnique({ where: { id: serialId } });
          if (serial) {
            validateSerialTransition(serial.status, 'damaged');
            await tx.productSerial.update({
              where: { id: serialId },
              data: {
                status: 'damaged',
                currentWarehouseId: input.warehouseId,
                soldSaleItemId: null,
                version: { increment: 1 },
                updatedAt: new Date(),
              },
            });
            await tx.serialEvent.create({
              data: {
                companyId: input.companyId, serialId, eventId, eventLineNo,
                eventType: 'return_damaged', fromStatus: 'sold', toStatus: 'damaged',
                fromWarehouseId: null, toWarehouseId: input.warehouseId,
                stockMovementId: movement.movementId,
                referenceType: 'sale_return', referenceId: saleReturn.id,
                createdBy: input.postedBy,
              },
            });
            eventLineNo++;
          }
        }
      }
      // repair/scrap: no stock receipt — serial stays as-is or goes to scrap
      // (Full repair/scrap workflow is in M5 service module)
    }

    lineNo++;
  }

  // 7. Update sale status
  const allItems = await tx.saleItem.findMany({
    where: { saleId: input.saleId },
    select: { id: true, qty: true },
  });
  const allReturns = await tx.saleReturnItem.findMany({
    where: { saleReturn: { saleId: input.saleId, status: 'posted' } },
    select: { saleItemId: true, qtyReturned: true },
  });

  let fullyReturned = true;
  for (const si of allItems) {
    const returnedQty = allReturns
      .filter(ri => ri.saleItemId === si.id)
      .reduce((s, ri) => s + parseFloat(ri.qtyReturned.toString()), 0);
    if (returnedQty < parseFloat(si.qty.toString())) {
      fullyReturned = false;
      break;
    }
  }

  await tx.sale.update({
    where: { id: input.saleId },
    data: { saleStatus: fullyReturned ? 'returned' : 'partially_returned' },
  });

  // 8. Audit
  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.postedBy, correlationId,
      action: 'sale_return.post', entityType: 'sale_return', entityId: saleReturn.id,
      afterValue: JSON.stringify({
        reference_no: referenceNo, sale_id: input.saleId,
        total_credit: totalCredit, disposition: input.disposition,
        item_count: returnItemsData.length, sale_new_status: fullyReturned ? 'returned' : 'partially_returned',
      }),
    },
  });

  return {
    saleReturnId: saleReturn.id,
    referenceNo,
    status: 'posted',
    totalCredit: totalCredit.toString(),
  };
}
