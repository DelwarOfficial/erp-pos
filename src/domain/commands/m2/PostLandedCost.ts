// src/domain/commands/m2/PostLandedCost.ts
// PostLandedCost per §7.24 + §5.8.
//
// Allocates a landed cost document (freight/insurance/customs/etc.) across
// purchase lines by quantity, value, weight, or manual. Recalculates the
// moving-average cost of the stock still on hand, sends the part already sold
// to cost of sales, and posts the journal (Dr Inventory/COGS, Cr AP).

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';
import { postStockMovement } from '@/domain/inventory/stockMovement';
import { postJournalEntry, type JournalLineInput } from '@/domain/commands/m4/PostJournalEntry';

export interface PostLandedCostInput {
  companyId: string;
  purchaseId: string;
  costType: string;  // freight/insurance/customs/port/clearing/other
  supplierId?: string;
  currencyCode: string;
  exchangeRate: number;
  amount: number;  // in the landed-cost currency
  allocationMethod: string;  // quantity/value/weight/manual
  postedBy: string;
  manualAllocations?: Array<{ purchaseItemId: string; allocatedBaseAmount: number }>;
}

export async function postLandedCost(
  tx: Prisma.TransactionClient,
  input: PostLandedCostInput,
  correlationId: string,
): Promise<{ landedCostDocumentId: string; referenceNo: string; status: string; totalAllocated: number }> {
  if (input.amount <= 0) {
    throw new DomainError('VALIDATION_FAILED', 'Landed cost amount must be > 0', {}, 400);
  }

  const purchase = await tx.purchase.findFirst({
    where: { id: input.purchaseId, companyId: input.companyId },
    include: { items: true },
  });
  if (!purchase) throw new DomainError('RESOURCE_NOT_FOUND', 'Purchase not found', {}, 404);

  const baseAmount = input.amount * input.exchangeRate;

  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId,
    branchId: purchase.branchId,
    documentType: 'LANDED_COST',
    fiscalYear: new Date().getFullYear(),
    prefix: 'LC-',
  });

  const doc = await tx.landedCostDocument.create({
    data: {
      companyId: input.companyId,
      purchaseId: input.purchaseId,
      referenceNo,
      costType: input.costType,
      supplierId: input.supplierId ?? null,
      currencyCode: input.currencyCode,
      exchangeRate: input.exchangeRate,
      amount: input.amount,
      baseAmount,
      allocationMethod: input.allocationMethod,
      status: 'posted',
      createdBy: input.postedBy,
    },
  });

  // Compute allocations, in Decimal; the last line takes the rounding.
  const base = new Prisma.Decimal(baseAmount).toDecimalPlaces(2);
  const allocations: Array<{ purchaseItemId: string; allocatedBaseAmount: Prisma.Decimal }> = [];

  if (input.allocationMethod === 'manual') {
    if (!input.manualAllocations || input.manualAllocations.length === 0) {
      throw new DomainError('VALIDATION_FAILED', 'Manual allocation requires manualAllocations array', {}, 400);
    }
    for (const row of input.manualAllocations) {
      if (!purchase.items.some(pi => pi.id === row.purchaseItemId)) {
        throw new DomainError('VALIDATION_FAILED', 'A manual allocation names a line that is not on this purchase', { purchase_item_id: row.purchaseItemId }, 400);
      }
      if (!(row.allocatedBaseAmount >= 0)) throw new DomainError('VALIDATION_FAILED', 'Allocated amounts must be zero or more', {}, 400);
      allocations.push({ purchaseItemId: row.purchaseItemId, allocatedBaseAmount: new Prisma.Decimal(row.allocatedBaseAmount) });
    }
    const sum = allocations.reduce((t, a) => t.plus(a.allocatedBaseAmount), new Prisma.Decimal(0));
    if (sum.minus(base).abs().gt('0.01')) {
      throw new DomainError('VALIDATION_FAILED', `Manual allocations add up to ${sum.toFixed(2)}, not the cost of ${base.toFixed(2)}`, {}, 400);
    }
  } else {
    // Allocate by quantity or value of received items
    const basis: Array<{ id: string; basis: Prisma.Decimal }> = [];
    for (const item of purchase.items) {
      const qty = new Prisma.Decimal(item.qtyReceived);
      if (qty.lte(0)) continue;
      basis.push({ id: item.id, basis: input.allocationMethod === 'value' ? qty.mul(item.unitCost) : qty });
    }
    const totalBasis = basis.reduce((t, b) => t.plus(b.basis), new Prisma.Decimal(0));
    if (totalBasis.isZero()) {
      throw new DomainError('VALIDATION_FAILED', 'No received items to allocate landed cost to', {}, 400);
    }
    let left = base;
    basis.forEach((b, i) => {
      const share = i === basis.length - 1 ? left : base.mul(b.basis).div(totalBasis).toDecimalPlaces(2);
      left = left.minus(share);
      allocations.push({ purchaseItemId: b.id, allocatedBaseAmount: share });
    });
  }

  // Each line's cost goes onto the stock still on hand where it was received
  // (raising its moving-average cost), and onto cost of sales for the part
  // already sold. Stock is revalued through the stock ledger -- one unit
  // issued at the current average and taken back in carrying the extra cost --
  // so the stock ledger and the inventory account move together.
  const policy = await tx.accountingPolicy.findUnique({ where: { companyId: input.companyId } });
  if (!policy) throw new DomainError('VALIDATION_FAILED', 'Accounting policies are not configured', {}, 409);
  const eventId = randomUUID();
  await tx.businessEvent.create({ data: { id: eventId, companyId: input.companyId, eventType: 'landed_cost.posted',
    sourceType: 'landed_cost', sourceId: doc.id, correlationId, occurredAt: new Date() } });
  let eventLineNo = 1;
  let toInventory = new Prisma.Decimal(0);
  let toCogs = new Prisma.Decimal(0);
  let totalAllocated = 0;

  for (const alloc of allocations) {
    const purchaseItem = purchase.items.find(pi => pi.id === alloc.purchaseItemId)!;
    await tx.landedCostAllocation.create({
      data: { landedCostDocumentId: doc.id, purchaseItemId: alloc.purchaseItemId, allocatedBaseAmount: alloc.allocatedBaseAmount },
    });
    totalAllocated += alloc.allocatedBaseAmount.toNumber();
    const qtyReceived = new Prisma.Decimal(purchaseItem.qtyReceived);
    if (qtyReceived.lte(0) || alloc.allocatedBaseAmount.isZero()) { toCogs = toCogs.plus(alloc.allocatedBaseAmount); continue; }

    await tx.purchaseItem.update({
      where: { id: purchaseItem.id },
      data: { allocatedLandedCostPerUnit: new Prisma.Decimal(purchaseItem.allocatedLandedCostPerUnit).plus(alloc.allocatedBaseAmount.div(qtyReceived)) },
    });

    // Where this line was received, by warehouse.
    const received = await tx.purchaseReceivingItem.findMany({
      where: { companyId: input.companyId, purchaseItemId: purchaseItem.id },
      select: { qtyReceivedNow: true, purchaseReceiving: { select: { warehouseId: true } } },
    });
    const byWarehouse = new Map<string, Prisma.Decimal>();
    for (const r of received) byWarehouse.set(r.purchaseReceiving.warehouseId, (byWarehouse.get(r.purchaseReceiving.warehouseId) ?? new Prisma.Decimal(0)).plus(r.qtyReceivedNow));
    let lineLeft = alloc.allocatedBaseAmount;
    const entries = [...byWarehouse];
    if (entries.length === 0) { toCogs = toCogs.plus(lineLeft); continue; }
    for (let i = 0; i < entries.length; i++) {
      const [warehouseId, qtyHere] = entries[i];
      const share = i === entries.length - 1 ? lineLeft : alloc.allocatedBaseAmount.mul(qtyHere).div(qtyReceived).toDecimalPlaces(2);
      lineLeft = lineLeft.minus(share);
      const stock = await tx.warehouseStock.findUnique({ where: { companyId_warehouseId_productId: { companyId: input.companyId, warehouseId, productId: purchaseItem.productId } } });
      const onHand = new Prisma.Decimal(stock?.qtyOnHand ?? 0);
      const capitalQty = Prisma.Decimal.min(onHand, qtyHere);
      const capital = capitalQty.lte(0) ? new Prisma.Decimal(0) : share.mul(capitalQty).div(qtyHere).toDecimalPlaces(2);
      toCogs = toCogs.plus(share.minus(capital));
      if (capital.gt(0) && stock) {
        const unitQty = Prisma.Decimal.min(1, onHand);
        const mac = new Prisma.Decimal(stock.movingAverageCost);
        const common = { companyId: input.companyId, eventId, warehouseId, productId: purchaseItem.productId,
          referenceType: 'landed_cost', referenceId: doc.id, sourceLineId: purchaseItem.id, effectiveAt: new Date(), createdBy: input.postedBy };
        await postStockMovement(tx, { ...common, eventLineNo: eventLineNo++, movementType: 'adjustment_out', qtyDelta: unitQty.neg().toString(), unitCost: mac.toString() });
        await postStockMovement(tx, { ...common, eventLineNo: eventLineNo++, movementType: 'adjustment_in', qtyDelta: unitQty.toString(),
          unitCost: mac.plus(capital.div(unitQty)).toString() });
        toInventory = toInventory.plus(capital);
      }
    }
  }

  // Dr Inventory (on hand) + Dr COGS (already sold) / Cr AP to whoever bills the cost.
  const memo = `Landed cost ${referenceNo} (${input.costType})`;
  const lines: JournalLineInput[] = [];
  if (toInventory.gt(0)) lines.push({ chartOfAccountId: policy.inventoryAccountId, branchId: purchase.branchId, debit: toInventory, credit: 0, memo });
  if (toCogs.gt(0)) lines.push({ chartOfAccountId: policy.cogsAccountId, branchId: purchase.branchId, debit: toCogs, credit: 0, memo });
  lines.push({ chartOfAccountId: policy.apAccountId, supplierId: input.supplierId ?? purchase.supplierId, branchId: purchase.branchId,
    debit: 0, credit: toInventory.plus(toCogs), memo });
  const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId }, select: { baseCurrencyCode: true } });
  await postJournalEntry(tx, { companyId: input.companyId, entryDate: new Date(), postingKind: 'landed_cost',
    sourceType: 'landed_cost', sourceId: doc.id, description: memo, currencyCode: company.baseCurrencyCode, exchangeRate: 1,
    createdBy: input.postedBy, lines }, correlationId);

  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.postedBy, correlationId,
      action: 'landed_cost.post', entityType: 'landed_cost_document', entityId: doc.id,
      afterValue: JSON.stringify({
        reference_no: referenceNo, purchase_id: input.purchaseId,
        cost_type: input.costType, base_amount: baseAmount, allocated: totalAllocated,
      }),
    },
  });

  return { landedCostDocumentId: doc.id, referenceNo, status: 'posted', totalAllocated };
}
