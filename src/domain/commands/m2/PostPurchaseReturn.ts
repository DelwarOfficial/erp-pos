// src/domain/commands/m2/PostPurchaseReturn.ts
// PostPurchaseReturn per §7.7 — supplier return with stock issue + AP credit.
//
// Two values meet in a return, and they used to be treated as one:
//
//   stock cost      what the units are carried at now: they leave the stock
//                   ledger at moving-average cost (Cr Inventory, this amount);
//   supplier credit what the supplier owes back: units × purchase price
//                   (Dr AP, or Dr GRNI while the purchase is not invoiced).
//
// The journal credited inventory at the purchase price while the stock ledger
// issued at moving-average cost, so the inventory account and the stock ledger
// drifted apart on every return. The difference now goes to purchase variance.
// Serialized units leave as named serials ('returned_to_supplier'); before,
// quantity dropped while every serial stayed 'in_stock' and sellable.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postStockMovement, validateSerialTransition } from '@/domain/inventory/stockMovement';
import { postJournalEntry, type JournalLineInput } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

export interface PostPurchaseReturnInput {
  companyId: string;
  branchId: string;
  warehouseId: string;
  purchaseId: string;
  supplierId: string;
  postedBy: string;
  businessDate: Date;
  reason: string;
  items: Array<{
    purchaseItemId: string;
    qtyReturned: number;
    /** Required for a serialized product: exactly qtyReturned serial numbers. */
    serials?: string[];
  }>;
}

export async function postPurchaseReturn(
  tx: Prisma.TransactionClient, input: PostPurchaseReturnInput, correlationId: string,
): Promise<{ returnId: string; referenceNo: string; status: string; totalCredit: string }> {
  // One return at a time per purchase, so returned quantities cannot race.
  await tx.$queryRaw`SELECT id FROM purchases WHERE id = ${input.purchaseId} AND company_id = ${input.companyId} FOR UPDATE`;
  const purchase = await tx.purchase.findFirst({
    where: { id: input.purchaseId, companyId: input.companyId },
    include: { items: { include: { product: { select: { isSerialized: true } } } } },
  });
  if (!purchase) throw new DomainError('RESOURCE_NOT_FOUND', 'Purchase not found', {}, 404);
  if (purchase.orderStatus === 'cancelled') throw new DomainError('VALIDATION_FAILED', 'This purchase was cancelled', {}, 409);
  if (purchase.supplierId !== input.supplierId) throw new DomainError('VALIDATION_FAILED', 'The supplier does not match the purchase', {}, 400);
  const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, companyId: input.companyId, branchId: input.branchId }, select: { id: true } });
  if (!warehouse) throw new DomainError('VALIDATION_FAILED', 'Warehouse not found in this branch', {}, 404);
  const policies = await tx.accountingPolicy.findUnique({ where: { companyId: input.companyId } });
  if (!policies) throw new DomainError('VALIDATION_FAILED', 'Accounting policies are not configured', {}, 409);

  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId, branchId: input.branchId,
    documentType: 'PURCHASE_RETURN', fiscalYear: input.businessDate.getFullYear(), prefix: 'PRET-',
  });

  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: { id: eventId, companyId: input.companyId, eventType: 'purchase_return.posted',
      sourceType: 'purchase_return', sourceId: referenceNo, correlationId, occurredAt: new Date() },
  });

  const ret = await tx.purchaseReturn.create({
    data: { companyId: input.companyId, branchId: input.branchId, warehouseId: input.warehouseId,
      purchaseId: input.purchaseId, supplierId: input.supplierId, referenceNo, clientTxnId: randomUUID(),
      status: 'posted', businessDate: input.businessDate, reason: input.reason,
      subtotalCredit: 0, totalCredit: 0, baseTotalCredit: 0, postedAt: new Date(), createdBy: input.postedBy },
  });

  const rate = new Prisma.Decimal(purchase.exchangeRate);
  let supplierCredit = new Prisma.Decimal(0);
  let stockCost = new Prisma.Decimal(0);
  let eventLineNo = 1;

  for (const item of input.items) {
    const pi = purchase.items.find(p => p.id === item.purchaseItemId);
    if (!pi) throw new DomainError('VALIDATION_FAILED', `Purchase item ${item.purchaseItemId} not found`, {}, 400);
    const qty = new Prisma.Decimal(item.qtyReturned);
    if (qty.lte(0)) throw new DomainError('VALIDATION_FAILED', 'Return a positive quantity', {}, 400);
    if (new Prisma.Decimal(pi.qtyReturned).plus(qty).gt(pi.qtyReceived)) {
      throw new DomainError('VALIDATION_FAILED', `Return exceeds received quantity`, {}, 409);
    }

    // Serials first, so nothing moves if one is wrong.
    const serials = [...new Set(item.serials ?? [])];
    if (pi.product.isSerialized) {
      if (!qty.isInteger() || serials.length !== qty.toNumber() || (item.serials ?? []).length !== serials.length) {
        throw new DomainError('VALIDATION_FAILED', `Name exactly ${qty.toString()} different serial number(s) for ${pi.productNameSnapshot}`, {}, 400);
      }
    }
    const serialRows = serials.length ? await tx.productSerial.findMany({ where: { companyId: input.companyId, serialNumber: { in: serials } } }) : [];
    for (const number of serials) {
      const row = serialRows.find(s => s.serialNumber === number);
      if (!row || row.productId !== pi.productId || row.currentWarehouseId !== input.warehouseId || row.status !== 'in_stock') {
        throw new DomainError('SERIAL_NOT_AVAILABLE', `Serial ${number} is not in stock in this warehouse for ${pi.productNameSnapshot}`, { serial: number }, 409);
      }
    }

    const supplierUnit = new Prisma.Decimal(pi.unitCost).mul(rate);
    const lineCredit = supplierUnit.mul(qty).toDecimalPlaces(2);
    const retItem = await tx.purchaseReturnItem.create({
      data: { companyId: input.companyId, purchaseReturnId: ret.id, purchaseItemId: item.purchaseItemId,
        qtyReturned: qty, supplierUnitCredit: pi.unitCost, inventoryUnitCost: supplierUnit,
        lineCredit, taxCredit: 0, varianceAmount: 0 },
    });

    const movement = await postStockMovement(tx, {
      companyId: input.companyId, eventId, eventLineNo: eventLineNo++,
      warehouseId: input.warehouseId, productId: pi.productId,
      movementType: 'purchase_return_issue', qtyDelta: qty.neg().toString(),
      unitCost: supplierUnit.toString(),
      referenceType: 'purchase_return', referenceId: ret.id, sourceLineId: retItem.id,
      effectiveAt: input.businessDate, createdBy: input.postedBy,
    });
    const lineStockCost = new Prisma.Decimal(movement.movingAverageCostBefore).mul(qty).toDecimalPlaces(2);
    const variance = lineCredit.minus(lineStockCost);
    await tx.purchaseReturnItem.update({ where: { id: retItem.id }, data: { inventoryUnitCost: new Prisma.Decimal(movement.movingAverageCostBefore), varianceAmount: variance } });

    for (const row of serialRows) {
      validateSerialTransition(row.status, 'returned_to_supplier');
      await tx.productSerial.update({ where: { id: row.id }, data: { status: 'returned_to_supplier', currentWarehouseId: null, version: { increment: 1 }, updatedAt: new Date() } });
      await tx.serialEvent.create({ data: { companyId: input.companyId, serialId: row.id, eventId, eventLineNo: eventLineNo++,
        eventType: 'returned_to_supplier', fromStatus: row.status, toStatus: 'returned_to_supplier',
        fromWarehouseId: input.warehouseId, toWarehouseId: null, referenceType: 'purchase_return', referenceId: ret.id, createdBy: input.postedBy } });
    }

    supplierCredit = supplierCredit.plus(lineCredit);
    stockCost = stockCost.plus(lineStockCost);
    await tx.purchaseItem.update({ where: { id: pi.id }, data: { qtyReturned: { increment: qty } } });
  }

  await tx.purchaseReturn.update({
    where: { id: ret.id },
    data: { subtotalCredit: supplierCredit, totalCredit: supplierCredit, baseTotalCredit: supplierCredit },
  });

  // Dr AP (or GRNI before the supplier's invoice) the supplier credit;
  // Cr Inventory the stock cost; the difference is purchase variance.
  const counterAccount = purchase.invoiceStatus !== 'invoiced' && policies.grniAccountId ? policies.grniAccountId : policies.apAccountId;
  const memo = `Purchase return ${referenceNo}`;
  const lines: JournalLineInput[] = [
    { chartOfAccountId: counterAccount, supplierId: input.supplierId, branchId: input.branchId, debit: supplierCredit, credit: 0, memo: `Supplier credit ${referenceNo}` },
    { chartOfAccountId: policies.inventoryAccountId, branchId: input.branchId, debit: 0, credit: stockCost, memo: `Inventory returned ${referenceNo}` },
  ];
  const variance = supplierCredit.minus(stockCost);
  if (!variance.isZero()) {
    lines.push({ chartOfAccountId: policies.purchaseVarianceAccountId, branchId: input.branchId,
      debit: variance.lt(0) ? variance.abs() : 0, credit: variance.gt(0) ? variance : 0, memo: `Cost difference on ${referenceNo}` });
  }
  if (supplierCredit.gt(0) || stockCost.gt(0)) {
    await postJournalEntry(tx, {
      companyId: input.companyId, entryDate: input.businessDate,
      postingKind: 'purchase_return', sourceType: 'purchase_return', sourceId: ret.id,
      description: memo, currencyCode: 'BDT', exchangeRate: 1, createdBy: input.postedBy,
      lines: lines.filter(l => !new Prisma.Decimal(l.debit).isZero() || !new Prisma.Decimal(l.credit).isZero()),
    }, correlationId);
  }

  await tx.auditLog.create({
    data: { companyId: input.companyId, userId: input.postedBy, correlationId,
      action: 'purchase_return.post', entityType: 'purchase_return', entityId: ret.id,
      afterValue: JSON.stringify({ reference_no: referenceNo, supplier_credit: supplierCredit.toFixed(2), stock_cost: stockCost.toFixed(2) }) },
  });

  return { returnId: ret.id, referenceNo, status: 'posted', totalCredit: supplierCredit.toFixed(2) };
}
