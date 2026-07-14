// src/domain/commands/m5/FulfillWarrantyClaim.ts
// FulfillWarrantyClaim per §7.14 + §20.D15.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { validateWarrantyReplacement } from '@/domain/commands/m5/Service';
import { postStockMovement } from '@/domain/inventory/stockMovement';
import { DomainError } from '@/lib/errors/codes';

export interface FulfillWarrantyClaimInput {
  warrantyClaimId: string;
  companyId: string;
  fulfilledBy: string;
}

export async function fulfillWarrantyClaim(
  tx: Prisma.TransactionClient, input: FulfillWarrantyClaimInput, correlationId: string,
): Promise<{ claimId: string; status: string }> {
  const claim = await tx.warrantyClaim.findFirst({
    where: { id: input.warrantyClaimId, companyId: input.companyId },
    include: { serviceRequest: true },
  });
  if (!claim) throw new DomainError('RESOURCE_NOT_FOUND', 'Warranty claim not found', {}, 404);
  if (claim.status !== 'approved') {
    throw new DomainError('VALIDATION_FAILED', `Claim must be approved to fulfill (current: ${claim.status})`, {}, 409);
  }

  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: { id: eventId, companyId: input.companyId, eventType: 'warranty_claim.fulfilled',
      sourceType: 'warranty_claim', sourceId: claim.id, correlationId, occurredAt: new Date() },
  });

  // For replacement: lock old serial + new serial
  if (claim.claimType === 'replace' && claim.replacementSerialId) {
    const replacementSerial = await tx.productSerial.findFirst({
      where: { id: claim.replacementSerialId, companyId: input.companyId },
    });
    if (!replacementSerial) throw new DomainError('SERIAL_NOT_AVAILABLE', 'Replacement serial not found', {}, 404);
    validateWarrantyReplacement(replacementSerial);

    // Mark replacement as sold (to the customer)
    await tx.productSerial.update({
      where: { id: replacementSerial.id },
      data: { status: 'sold', version: { increment: 1 }, updatedAt: new Date() },
    });

    // Mark old serial as scrapped or returned_to_supplier
    if (claim.serviceRequest.serialId) {
      const oldSerial = await tx.productSerial.findUnique({ where: { id: claim.serviceRequest.serialId } });
      if (oldSerial) {
        await tx.productSerial.update({
          where: { id: oldSerial.id },
          data: { status: 'scrapped', currentWarehouseId: null, version: { increment: 1 }, updatedAt: new Date() },
        });
      }
    }
  }

  // For supplier_claim: create purchase return for defective unit
  if (claim.claimType === 'supplier_claim') {
    // Defer to PostPurchaseReturn — just mark as fulfilled for now
  }

  // For refund: create sale return
  if (claim.claimType === 'refund') {
    // Defer to PostSaleReturn — just mark as fulfilled for now
  }

  await tx.warrantyClaim.update({
    where: { id: claim.id },
    data: { status: 'fulfilled', fulfilledAt: new Date() },
  });

  await tx.auditLog.create({
    data: { companyId: input.companyId, userId: input.fulfilledBy, correlationId,
      action: 'warranty_claim.fulfill', entityType: 'warranty_claim', entityId: claim.id,
      afterValue: JSON.stringify({ claim_type: claim.claimType, status: 'fulfilled' }) },
  });

  return { claimId: claim.id, status: 'fulfilled' };
}
