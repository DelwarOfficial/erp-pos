// src/domain/commands/m5/FulfillWarrantyClaim.ts
// FulfillWarrantyClaim per §7.14 + §20.D15.
//
// An approved claim is fulfilled by what it promised:
//
//   replace         The replacement unit leaves stock through the stock ledger
//                   (one unit out of its warehouse at moving-average cost), its
//                   serial becomes the customer's ('sold'), and its cost is
//                   expensed: Dr service cost (or COGS) / Cr Inventory. The
//                   customer's defective unit is scrapped. Before this, only
//                   the serial statuses changed: on-hand quantity, the stock
//                   ledger and the inventory account all still held the unit.
//   repair          The repair itself is the service job; the claim just closes.
//   refund          Fulfilled by a posted sale return for the customer's sale,
//   supplier_claim  or a posted purchase return to the supplier. The claim
//                   names that document; it used to be marked fulfilled with
//                   nothing behind it.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { validateWarrantyReplacement } from '@/domain/commands/m5/Service';
import { postStockMovement, validateSerialTransition } from '@/domain/inventory/stockMovement';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError } from '@/lib/errors/codes';

export interface FulfillWarrantyClaimInput {
  warrantyClaimId: string;
  companyId: string;
  fulfilledBy: string;
  /** refund: a posted sale return id; supplier_claim: a posted purchase return id. */
  referenceDocumentId?: string;
}

export async function fulfillWarrantyClaim(
  tx: Prisma.TransactionClient, input: FulfillWarrantyClaimInput, correlationId: string,
): Promise<{ claimId: string; status: string; replacementCost?: string }> {
  // One fulfilment per claim, even under concurrent requests.
  await tx.$queryRaw`SELECT id FROM warranty_claims WHERE id = ${input.warrantyClaimId} AND company_id = ${input.companyId} FOR UPDATE`;
  const claim = await tx.warrantyClaim.findFirst({
    where: { id: input.warrantyClaimId, companyId: input.companyId },
    include: { serviceRequest: true },
  });
  if (!claim) throw new DomainError('RESOURCE_NOT_FOUND', 'Warranty claim not found', {}, 404);
  if (claim.status !== 'approved') {
    throw new DomainError('VALIDATION_FAILED', `Claim must be approved to fulfill (current: ${claim.status})`, {}, 409);
  }

  let replacementCost: Prisma.Decimal | undefined;
  let reference: string | null = claim.supplierReference;

  // Check the documents a refund or supplier claim rests on before anything is
  // written, so a refused attempt leaves nothing behind.
  if (claim.claimType === 'refund') {
    if (!input.referenceDocumentId) throw new DomainError('VALIDATION_FAILED', 'Post the sale return for the refund first, then choose it here', {}, 409);
    const sr = await tx.saleReturn.findFirst({ where: { id: input.referenceDocumentId, companyId: input.companyId, status: 'posted' }, select: { referenceNo: true, saleId: true } });
    if (!sr) throw new DomainError('VALIDATION_FAILED', 'That sale return is not posted', {}, 409);
    if (claim.serviceRequest.saleId && sr.saleId !== claim.serviceRequest.saleId) {
      throw new DomainError('VALIDATION_FAILED', 'That sale return is for a different sale than this device', {}, 409);
    }
    reference = sr.referenceNo;
  }

  if (claim.claimType === 'supplier_claim') {
    if (!input.referenceDocumentId) throw new DomainError('VALIDATION_FAILED', 'Post the purchase return to the supplier first, then choose it here', {}, 409);
    const pr = await tx.purchaseReturn.findFirst({ where: { id: input.referenceDocumentId, companyId: input.companyId, status: 'posted' }, select: { referenceNo: true } });
    if (!pr) throw new DomainError('VALIDATION_FAILED', 'That purchase return is not posted', {}, 409);
    reference = pr.referenceNo;
  }

  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: { id: eventId, companyId: input.companyId, eventType: 'warranty_claim.fulfilled',
      sourceType: 'warranty_claim', sourceId: claim.id, correlationId, occurredAt: new Date() },
  });

  if (claim.claimType === 'replace') {
    if (!claim.replacementSerialId) throw new DomainError('VALIDATION_FAILED', 'Choose the replacement unit before fulfilling a replacement claim', {}, 409);
    await tx.$queryRaw`SELECT id FROM product_serials WHERE id = ${claim.replacementSerialId} AND company_id = ${input.companyId} FOR UPDATE`;
    const replacement = await tx.productSerial.findFirst({ where: { id: claim.replacementSerialId, companyId: input.companyId } });
    if (!replacement) throw new DomainError('SERIAL_NOT_AVAILABLE', 'Replacement serial not found', {}, 404);
    validateWarrantyReplacement(replacement);
    if (!replacement.currentWarehouseId) throw new DomainError('SERIAL_NOT_AVAILABLE', 'The replacement unit is not in a warehouse', {}, 409);
    const warehouse = await tx.warehouse.findFirstOrThrow({ where: { id: replacement.currentWarehouseId, companyId: input.companyId }, select: { id: true, branchId: true } });

    // The unit leaves stock at its moving-average cost.
    const movement = await postStockMovement(tx, {
      companyId: input.companyId, eventId, eventLineNo: 1, warehouseId: warehouse.id, productId: replacement.productId,
      movementType: 'adjustment_out', qtyDelta: -1, unitCost: 0,
      referenceType: 'warranty_claim', referenceId: claim.id, effectiveAt: new Date(), createdBy: input.fulfilledBy,
      metadata: { reason: 'warranty_replacement', serial: replacement.serialNumber },
    });
    replacementCost = new Prisma.Decimal(movement.movingAverageCostBefore).toDecimalPlaces(2);

    validateSerialTransition(replacement.status, 'sold');
    await tx.productSerial.update({
      where: { id: replacement.id },
      data: { status: 'sold', currentWarehouseId: null, version: { increment: 1 }, updatedAt: new Date() },
    });
    await tx.serialEvent.create({ data: { companyId: input.companyId, serialId: replacement.id, eventId, eventLineNo: 2,
      eventType: 'warranty_replacement_issued', fromStatus: replacement.status, toStatus: 'sold',
      fromWarehouseId: warehouse.id, toWarehouseId: null, referenceType: 'warranty_claim', referenceId: claim.id, createdBy: input.fulfilledBy } });

    // The customer's defective unit is written off (through 'repair' when it was still marked sold).
    if (claim.serviceRequest.serialId) {
      const old = await tx.productSerial.findFirst({ where: { id: claim.serviceRequest.serialId, companyId: input.companyId } });
      if (old && old.status !== 'scrapped') {
        let from = old.status; let line = 3;
        for (const to of from === 'sold' ? ['repair', 'scrapped'] : ['scrapped']) {
          validateSerialTransition(from, to);
          await tx.serialEvent.create({ data: { companyId: input.companyId, serialId: old.id, eventId, eventLineNo: line++,
            eventType: 'warranty_defective_returned', fromStatus: from, toStatus: to, fromWarehouseId: old.currentWarehouseId,
            toWarehouseId: null, referenceType: 'warranty_claim', referenceId: claim.id, createdBy: input.fulfilledBy } });
          from = to;
        }
        await tx.productSerial.update({ where: { id: old.id }, data: { status: 'scrapped', currentWarehouseId: null, version: { increment: 1 }, updatedAt: new Date() } });
      }
    }

    if (replacementCost.gt(0)) {
      const policy = await tx.accountingPolicy.findUnique({ where: { companyId: input.companyId } });
      if (!policy) throw new DomainError('VALIDATION_FAILED', 'Accounting policies are not configured', {}, 409);
      const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId }, select: { baseCurrencyCode: true } });
      const memo = `Warranty replacement ${replacement.serialNumber}`;
      await postJournalEntry(tx, {
        companyId: input.companyId, entryDate: new Date(), postingKind: 'warranty_replacement',
        sourceType: 'warranty_claim', sourceId: claim.id, description: memo,
        currencyCode: company.baseCurrencyCode, exchangeRate: 1, createdBy: input.fulfilledBy,
        lines: [
          { chartOfAccountId: policy.serviceCogsAccountId ?? policy.cogsAccountId, branchId: warehouse.branchId, debit: replacementCost, credit: 0, memo },
          { chartOfAccountId: policy.inventoryAccountId, branchId: warehouse.branchId, productId: replacement.productId, debit: 0, credit: replacementCost, memo },
        ],
      }, correlationId);
    }
  }

  await tx.warrantyClaim.update({
    where: { id: claim.id },
    data: { status: 'fulfilled', fulfilledAt: new Date(), supplierReference: reference },
  });

  await tx.auditLog.create({
    data: { companyId: input.companyId, userId: input.fulfilledBy, correlationId,
      action: 'warranty_claim.fulfill', entityType: 'warranty_claim', entityId: claim.id,
      afterValue: JSON.stringify({ claim_type: claim.claimType, status: 'fulfilled', reference, replacement_cost: replacementCost?.toFixed(2) ?? null }) },
  });

  return { claimId: claim.id, status: 'fulfilled', ...(replacementCost ? { replacementCost: replacementCost.toFixed(2) } : {}) };
}
