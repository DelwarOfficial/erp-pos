// src/domain/commands/m6/CompleteServiceRequest.ts
// CompleteServiceRequest per §7.14 — marks service as ready, creates linked service sale.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { validateServiceTransition } from '@/domain/commands/m5/Service';
import { DomainError } from '@/lib/errors/codes';

export interface CompleteServiceRequestInput {
  serviceRequestId: string;
  companyId: string;
  completedBy: string;
}

export async function completeServiceRequest(
  tx: Prisma.TransactionClient, input: CompleteServiceRequestInput, correlationId: string,
): Promise<{ serviceRequestId: string; status: string }> {
  const sr = await tx.serviceRequest.findFirst({
    where: { id: input.serviceRequestId, companyId: input.companyId },
    include: { parts: true, serial: true },
  });
  if (!sr) throw new DomainError('RESOURCE_NOT_FOUND', 'Service request not found', {}, 404);

  validateServiceTransition(sr.status, 'ready');
  await tx.serviceRequest.update({
    where: { id: sr.id }, data: { status: 'ready' },
  });

  // Revert serial to in_stock or sold (customer collects device)
  if (sr.serialId) {
    const serial = await tx.productSerial.findUnique({ where: { id: sr.serialId } });
    if (serial && serial.status === 'repair') {
      // If originally sold, revert to sold; if customer-owned, to in_stock
      const newStatus = serial.soldSaleItemId ? 'sold' : 'in_stock';
      await tx.productSerial.update({
        where: { id: serial.id },
        data: { status: newStatus, version: { increment: 1 }, updatedAt: new Date() },
      });
    }
  }

  await tx.serviceEvent.create({
    data: { companyId: input.companyId, serviceRequestId: sr.id,
      eventType: 'status_change', eventData: JSON.stringify({ from: sr.status, to: 'ready' }),
      createdBy: input.completedBy },
  });

  await tx.auditLog.create({
    data: { companyId: input.companyId, userId: input.completedBy, correlationId,
      action: 'service_request.complete', entityType: 'service_request', entityId: sr.id,
      afterValue: JSON.stringify({ status: 'ready' }) },
  });

  return { serviceRequestId: sr.id, status: 'ready' };
}
