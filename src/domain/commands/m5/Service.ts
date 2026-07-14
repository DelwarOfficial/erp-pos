// src/domain/commands/m5/Service.ts
// PostServicePartConsumption + CompleteServiceRequest per §7.14 + §20.D15.
//
// Service workflow: intake → diagnosis → estimate → approval → parts consumption →
//   repair/test → ready → delivery
//
// Parts consumption posts stock_movements (movementType='adjustment_out') from
// the repair warehouse, posts journal (Dr Repair WIP, Cr Inventory).

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postStockMovement, validateSerialTransition } from '@/domain/inventory/stockMovement';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

const ALLOWED_SERVICE_TRANSITIONS: Record<string, string[]> = {
  received: ['diagnosing', 'cancelled'],
  diagnosing: ['awaiting_customer_approval', 'received', 'cancelled'],
  awaiting_customer_approval: ['approved', 'received', 'cancelled'],
  approved: ['in_repair', 'cancelled'],
  in_repair: ['awaiting_parts', 'ready', 'unrepairable'],
  awaiting_parts: ['in_repair', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: [],
  unrepairable: [],
  cancelled: [],
};

export function validateServiceTransition(from: string, to: string): void {
  if (from === to) return;
  const allowed = ALLOWED_SERVICE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new DomainError(
      'SERVICE_TRANSITION_INVALID',
      `Invalid service transition: ${from} → ${to}`,
      { from_status: from, to_status: to, allowed },
      409,
    );
  }
}

export interface CreateServiceRequestInput {
  companyId: string;
  branchId: string;
  repairWarehouseId?: string;
  customerId?: string;
  saleId?: string;
  serialId?: string;
  serviceType: string;  // warranty/paid_repair/installation/inspection
  issueDescription: string;
  intakeCondition?: string;
  accessoriesReceived?: string;
  estimatedAmount?: number;
  depositRequiredAmount?: number;
  promisedDate?: Date;
  createdBy: string;
}

export async function createServiceRequest(
  tx: Prisma.TransactionClient,
  input: CreateServiceRequestInput,
  correlationId: string,
): Promise<{ serviceRequestId: string; referenceNo: string; status: string }> {
  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId, branchId: input.branchId,
    documentType: 'SERVICE_REQUEST', fiscalYear: new Date().getFullYear(), prefix: 'SR-',
  });

  // Snapshot warranty info from serial if provided
  let warrantyEligible: boolean | null = null;
  let warrantyExpiry: Date | null = null;
  if (input.serialId) {
    const serial = await tx.productSerial.findFirst({
      where: { id: input.serialId, companyId: input.companyId },
    });
    if (serial) {
      warrantyExpiry = serial.warrantyExpiryDate;
      warrantyEligible = warrantyExpiry ? warrantyExpiry > new Date() : false;
      // Move serial to 'repair' status if the company takes custody
      if (serial.status === 'sold' || serial.status === 'in_stock') {
        validateSerialTransition(serial.status, 'repair');
        await tx.productSerial.update({
          where: { id: serial.id },
          data: {
            status: 'repair',
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
      }
    }
  }

  const sr = await tx.serviceRequest.create({
    data: {
      companyId: input.companyId, branchId: input.branchId,
      repairWarehouseId: input.repairWarehouseId ?? null,
      referenceNo, status: 'received',
      customerId: input.customerId ?? null,
      saleId: input.saleId ?? null,
      serialId: input.serialId ?? null,
      serviceType: input.serviceType,
      issueDescription: input.issueDescription,
      intakeCondition: input.intakeCondition ?? null,
      accessoriesReceived: input.accessoriesReceived ?? null,
      estimatedAmount: input.estimatedAmount ?? 0,
      depositRequiredAmount: input.depositRequiredAmount ?? 0,
      promisedDate: input.promisedDate ?? null,
      warrantyEligibleSnapshot: warrantyEligible,
      warrantyExpirySnapshot: warrantyExpiry,
      createdBy: input.createdBy,
    },
  });

  // Create initial service event
  await tx.serviceEvent.create({
    data: {
      companyId: input.companyId, serviceRequestId: sr.id,
      eventType: 'status_change',
      eventData: JSON.stringify({ from: null, to: 'received' }),
      createdBy: input.createdBy,
    },
  });

  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.createdBy, correlationId,
      action: 'service_request.create', entityType: 'service_request', entityId: sr.id,
      afterValue: JSON.stringify({ reference_no: referenceNo, type: input.serviceType, serial: input.serialId }),
    },
  });

  return { serviceRequestId: sr.id, referenceNo, status: 'received' };
}

export interface ConsumeServicePartInput {
  serviceRequestId: string;
  companyId: string;
  consumedBy: string;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    warrantyCovered?: boolean;
  }>;
}

export async function postServicePartConsumption(
  tx: Prisma.TransactionClient,
  input: ConsumeServicePartInput,
  correlationId: string,
): Promise<{ eventId: string; itemCount: number }> {
  const sr = await tx.serviceRequest.findFirst({
    where: { id: input.serviceRequestId, companyId: input.companyId },
  });
  if (!sr) throw new DomainError('RESOURCE_NOT_FOUND', 'Service request not found', {}, 404);
  if (!['in_repair', 'awaiting_parts'].includes(sr.status)) {
    throw new DomainError('SERVICE_TRANSITION_INVALID', `Cannot consume parts when status is ${sr.status}`, {}, 409);
  }

  const policies = await tx.accountingPolicy.findUnique({ where: { companyId: input.companyId } });
  if (!policies || !policies.repairWipAccountId || !policies.inventoryAccountId) {
    throw new DomainError('VALIDATION_FAILED', 'Repair WIP or Inventory account not configured in accounting policies', {}, 400);
  }

  const warehouseId = sr.repairWarehouseId;
  if (!warehouseId) {
    throw new DomainError('VALIDATION_FAILED', 'Service request has no repair warehouse assigned', {}, 400);
  }

  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: {
      id: eventId, companyId: input.companyId,
      eventType: 'service_part.consumed',
      sourceType: 'service_request', sourceId: sr.id,
      correlationId, occurredAt: new Date(),
    },
  });

  const journalLines: Array<{ chartOfAccountId: string; debit: number; credit: number; memo?: string }> = [];
  let lineNo = 1;
  let eventLineNo = 1;

  for (const item of input.items) {
    const product = await tx.product.findFirst({
      where: { id: item.productId, companyId: input.companyId, deletedAt: null },
    });
    if (!product) throw new DomainError('VALIDATION_FAILED', `Product ${item.productId} not found`, {}, 404);

    // Get current MAC
    const stock = await tx.warehouseStock.findUnique({
      where: {
        companyId_warehouseId_productId: {
          companyId: input.companyId, warehouseId, productId: item.productId,
        },
      },
    });
    const unitCost = stock ? parseFloat(stock.movingAverageCost.toString()) : 0;
    const totalCost = unitCost * item.quantity;

    // Create the service request part record
    const part = await tx.serviceRequestPart.create({
      data: {
        companyId: input.companyId, serviceRequestId: sr.id, lineNo,
        productId: item.productId, quantity: item.quantity,
        unitCostSnapshot: unitCost, unitPrice: item.unitPrice,
        warrantyCovered: item.warrantyCovered ?? false,
        consumedEventId: eventId,
      },
    });

    // Post stock movement (outbound from repair warehouse)
    await postStockMovement(tx, {
      companyId: input.companyId, eventId, eventLineNo,
      warehouseId, productId: item.productId,
      movementType: 'adjustment_out',
      qtyDelta: -item.quantity,
      unitCost,
      referenceType: 'service_request', referenceId: sr.id, sourceLineId: part.id,
      effectiveAt: new Date(), createdBy: input.consumedBy,
      metadata: { service_request_ref: sr.referenceNo, warranty_covered: item.warrantyCovered ?? false },
    });
    eventLineNo++;

    // Dr Repair WIP, Cr Inventory
    journalLines.push({
      chartOfAccountId: policies.repairWipAccountId!,
      debit: totalCost, credit: 0,
      memo: `Parts: ${product.name} ×${item.quantity}`,
    });
    journalLines.push({
      chartOfAccountId: policies.inventoryAccountId,
      debit: 0, credit: totalCost,
      memo: `Parts issued: ${product.name}`,
    });

    lineNo++;
  }

  // Post journal entry
  await postJournalEntry(tx, {
    companyId: input.companyId,
    entryDate: new Date(),
    postingKind: 'service_part_consumption',
    sourceType: 'service_request', sourceId: sr.id,
    description: `Service parts consumed: ${sr.referenceNo}`,
    currencyCode: 'BDT', exchangeRate: 1,
    createdBy: input.consumedBy,
    lines: journalLines,
  }, correlationId);

  // Create service event
  await tx.serviceEvent.create({
    data: {
      companyId: input.companyId, serviceRequestId: sr.id,
      eventType: 'part_used',
      eventData: JSON.stringify({ item_count: input.items.length, event_id: eventId }),
      createdBy: input.consumedBy,
    },
  });

  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.consumedBy, correlationId,
      action: 'service_part.consume', entityType: 'service_request', entityId: sr.id,
      afterValue: JSON.stringify({ item_count: input.items.length }),
    },
  });

  return { eventId, itemCount: input.items.length };
}

/**
 * Validate warranty replacement per §16 validate_warranty_replacement().
 * Replacement serial cannot be already sold/damaged/scrapped.
 */
export function validateWarrantyReplacement(serial: { status: string }): void {
  if (serial.status !== 'in_stock') {
    throw new DomainError(
      'SERIAL_NOT_AVAILABLE',
      `Replacement serial must be in_stock (current: ${serial.status})`,
      { status: serial.status },
      409,
    );
  }
}
