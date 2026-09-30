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

export const ALLOWED_SERVICE_TRANSITIONS: Record<string, string[]> = {
  received: ['diagnosing', 'cancelled'],
  diagnosing: ['awaiting_customer_approval', 'approved', 'received', 'cancelled'],
  awaiting_customer_approval: ['approved', 'received', 'cancelled'],
  approved: ['in_repair', 'cancelled'],
  in_repair: ['awaiting_parts', 'ready', 'unrepairable'],
  awaiting_parts: ['in_repair', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: [],
  unrepairable: ['delivered'],
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
  const warehouse = input.repairWarehouseId ? await tx.warehouse.findFirst({ where: { id: input.repairWarehouseId, companyId: input.companyId, branchId: input.branchId, isActive: true } }) : null;
  if (input.repairWarehouseId && !warehouse) throw new DomainError('VALIDATION_FAILED', 'Repair warehouse must belong to the request branch', {}, 400);
  if (input.customerId && !await tx.customer.findFirst({ where: { id: input.customerId, companyId: input.companyId, deletedAt: null } })) throw new DomainError('VALIDATION_FAILED', 'Customer unavailable', {}, 400);
  if (input.saleId && !await tx.sale.findFirst({ where: { id: input.saleId, companyId: input.companyId, branchId: input.branchId, ...(input.customerId ? { customerId: input.customerId } : {}) } })) throw new DomainError('VALIDATION_FAILED', 'Original sale does not match this branch/customer', {}, 400);
  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId, branchId: input.branchId,
    documentType: 'SERVICE_REQUEST', fiscalYear: new Date().getFullYear(), prefix: 'SR-',
  });

  // Snapshot warranty info from serial if provided
  let warrantyEligible: boolean | null = null;
  let warrantyExpiry: Date | null = null;
  let originalSerial: { id: string; status: string; currentWarehouseId: string | null } | null = null;
  if (input.serialId) {
    const serial = await tx.productSerial.findFirst({
      where: { id: input.serialId, companyId: input.companyId },
    });
    if (!serial || !['sold', 'in_stock'].includes(serial.status) || serial.currentReservationId) throw new DomainError('SERIAL_NOT_AVAILABLE', 'Device serial is unavailable for intake', {}, 409);
    if (await tx.serviceRequest.findFirst({ where: { companyId: input.companyId, serialId: serial.id, status: { notIn: ['delivered', 'cancelled'] } } })) throw new DomainError('VALIDATION_FAILED', 'This serial already has an open service request', {}, 409);
    if (serial.soldSaleItemId) {
      const saleItem = await tx.saleItem.findFirst({ where: { id: serial.soldSaleItemId }, include: { sale: true } });
      if (!saleItem || (input.customerId && saleItem.sale.customerId !== input.customerId) || (input.saleId && saleItem.sale.id !== input.saleId)) throw new DomainError('VALIDATION_FAILED', 'Device does not belong to the selected customer or original sale', {}, 400);
    }
    if (serial) {
      originalSerial = serial;
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
  if (input.serviceType === 'warranty' && !warrantyEligible) throw new DomainError('VALIDATION_FAILED', 'A valid in-warranty device serial is required; use paid repair otherwise', {}, 422);

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
      eventData: JSON.stringify({ from: null, to: 'received', original_serial_status: originalSerial?.status, original_warehouse_id: originalSerial?.currentWarehouseId }),
      createdBy: input.createdBy,
    },
  });
  if (originalSerial) {
    const event = await tx.businessEvent.create({ data: { companyId: input.companyId, eventType: 'service.intake', sourceType: 'service_request', sourceId: sr.id, correlationId, occurredAt: new Date() } });
    await tx.serialEvent.create({ data: { companyId: input.companyId, serialId: originalSerial.id, eventId: event.id, eventLineNo: 1, eventType: 'service.intake', fromStatus: originalSerial.status, toStatus: 'repair', fromWarehouseId: originalSerial.currentWarehouseId, toWarehouseId: originalSerial.currentWarehouseId, referenceType: 'service_request', referenceId: sr.id, createdBy: input.createdBy } });
  }

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
    serialNumbers?: string[];
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
      sourceType: 'service_request', sourceId: eventId,
      correlationId, occurredAt: new Date(),
    },
  });

  const journalLines: Array<{ chartOfAccountId: string; debit: number; credit: number; memo?: string }> = [];
  const previous = await tx.serviceRequestPart.aggregate({ where: { serviceRequestId: sr.id }, _max: { lineNo: true } });
  let lineNo = (previous._max.lineNo ?? 0) + 1;
  let eventLineNo = 1;

  for (const item of input.items) {
    const product = await tx.product.findFirst({
      where: { id: item.productId, companyId: input.companyId, deletedAt: null },
    });
    if (!product) throw new DomainError('VALIDATION_FAILED', `Product ${item.productId} not found`, {}, 404);
    if (!Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0 || product.productType !== 'standard') throw new DomainError('VALIDATION_FAILED', 'Select stock-managed parts with positive quantities and nonnegative prices', {}, 400);
    if (product.trackBatches) throw new DomainError('VALIDATION_FAILED', 'Batch-tracked service parts require batch allocation support', {}, 409);
    const numbers = (item.serialNumbers ?? []).map(number => number.trim());
    if (new Set(numbers).size !== numbers.length || numbers.some(number => !number) || (product.isSerialized ? (!Number.isInteger(item.quantity) || numbers.length !== item.quantity) : numbers.length > 0)) throw new DomainError('VALIDATION_FAILED', 'Provide exactly one unique serial per serialized part', {}, 400);
    const serials = numbers.length ? await tx.productSerial.findMany({ where: { companyId: input.companyId, productId: product.id, currentWarehouseId: warehouseId, status: 'in_stock', currentReservationId: null, serialNumber: { in: numbers } } }) : [];
    if (serials.length !== numbers.length) throw new DomainError('SERIAL_NOT_AVAILABLE', 'A part serial is unavailable in the repair warehouse', {}, 409);

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
    const movement = await postStockMovement(tx, {
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
    for (const serial of serials) {
      validateSerialTransition(serial.status, 'sold');
      await tx.productSerial.update({ where: { id: serial.id }, data: { status: 'sold', currentWarehouseId: null, version: { increment: 1 } } });
      await tx.serialEvent.create({ data: { companyId: input.companyId, serialId: serial.id, eventId, eventLineNo: eventLineNo++, eventType: 'service.part_installed', fromStatus: serial.status, toStatus: 'sold', fromWarehouseId: warehouseId, stockMovementId: movement.movementId, referenceType: 'service_request', referenceId: sr.id, createdBy: input.consumedBy } });
    }

    // Dr Repair WIP, Cr Inventory
    if (totalCost > 0) journalLines.push({
      chartOfAccountId: policies.repairWipAccountId!,
      debit: totalCost, credit: 0,
      memo: `Parts: ${product.name} ×${item.quantity}`,
    });
    if (totalCost > 0) journalLines.push({
      chartOfAccountId: policies.inventoryAccountId,
      debit: 0, credit: totalCost,
      memo: `Parts issued: ${product.name}`,
    });

    lineNo++;
  }

  // Post journal entry
  const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId }, select: { baseCurrencyCode: true } });
  if (journalLines.length) await postJournalEntry(tx, {
    companyId: input.companyId,
    entryDate: new Date(),
    postingKind: 'service_part_consumption',
    sourceType: 'service_request', sourceId: sr.id,
    eventSourceId: eventId,
    description: `Service parts consumed: ${sr.referenceNo}`,
    currencyCode: company.baseCurrencyCode, exchangeRate: 1,
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
