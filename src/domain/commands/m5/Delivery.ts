// src/domain/commands/m5/Delivery.ts
// CreateDeliveryOrder + validateDeliveryTransition per §7.13 + §5.7A.
//
// Delivery state machine: pending → packing → ready → dispatched → in_transit →
//   delivered | failed | returned | cancelled
// failed → pending/ready requires approval.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending: ['packing', 'ready', 'cancelled'],
  packing: ['ready', 'pending', 'cancelled'],
  ready: ['dispatched', 'pending', 'cancelled'],
  dispatched: ['in_transit', 'cancelled'],
  in_transit: ['delivered', 'failed', 'returned'],
  delivered: [],
  failed: ['pending', 'ready'],  // requires approval — checked by caller
  returned: [],
  cancelled: [],
};

export function validateDeliveryTransition(from: string, to: string): void {
  if (from === to) return;
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new DomainError(
      'DELIVERY_TRANSITION_INVALID',
      `Invalid delivery transition: ${from} → ${to}`,
      { from_status: from, to_status: to, allowed },
      409,
    );
  }
}

export interface CreateDeliveryInput {
  companyId: string;
  branchId: string;
  saleId: string;
  createdBy: string;
  recipientName: string;
  recipientPhone: string;
  addressSnapshot: string;
  district?: string;
  area?: string;
  deliveryMethod: string;  // internal/courier/pickup
  courierCode?: string;
  codAmount?: number;
  deliveryFee?: number;
  expectedDeliveryDate?: Date;
  items: Array<{ saleItemId: string; quantity: number }>;
}

export async function createDeliveryOrder(
  tx: Prisma.TransactionClient,
  input: CreateDeliveryInput,
  correlationId: string,
): Promise<{ deliveryOrderId: string; referenceNo: string; status: string }> {
  // Validate the sale exists and is completed
  const sale = await tx.sale.findFirst({
    where: { id: input.saleId, companyId: input.companyId, saleStatus: { in: ['completed', 'partially_returned'] } },
    include: { items: true },
  });
  if (!sale) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Sale not found or not completed', {}, 404);
  }

  // Validate delivery items reference this sale's items
  for (const item of input.items) {
    const saleItem = sale.items.find(si => si.id === item.saleItemId);
    if (!saleItem) {
      throw new DomainError('VALIDATION_FAILED', `Sale item ${item.saleItemId} not in this sale`, {}, 400);
    }
    if (item.quantity <= 0 || item.quantity > parseFloat(saleItem.qty.toString())) {
      throw new DomainError('VALIDATION_FAILED', `Delivery qty ${item.quantity} invalid for sale item qty ${saleItem.qty}`, {}, 400);
    }
  }

  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId, branchId: input.branchId,
    documentType: 'DELIVERY', fiscalYear: new Date().getFullYear(), prefix: 'DO-',
  });

  const delivery = await tx.deliveryOrder.create({
    data: {
      companyId: input.companyId, branchId: input.branchId, saleId: input.saleId,
      referenceNo, status: 'pending',
      recipientName: input.recipientName, recipientPhone: input.recipientPhone,
      addressSnapshot: input.addressSnapshot,
      district: input.district ?? null, area: input.area ?? null,
      deliveryMethod: input.deliveryMethod,
      courierCode: input.courierCode ?? null,
      codAmount: input.codAmount ?? 0, deliveryFee: input.deliveryFee ?? 0,
      expectedDeliveryDate: input.expectedDeliveryDate ?? null,
      createdBy: input.createdBy,
    },
  });

  for (const item of input.items) {
    await tx.deliveryItem.create({
      data: {
        companyId: input.companyId, deliveryOrderId: delivery.id,
        saleItemId: item.saleItemId, quantity: item.quantity,
      },
    });
  }

  // Create initial delivery event
  await tx.deliveryEvent.create({
    data: {
      companyId: input.companyId, deliveryOrderId: delivery.id,
      fromStatus: null, toStatus: 'pending',
      note: 'Delivery order created',
      createdBy: input.createdBy,
    },
  });

  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.createdBy, correlationId,
      action: 'delivery.create', entityType: 'delivery_order', entityId: delivery.id,
      afterValue: JSON.stringify({ reference_no: referenceNo, sale_id: input.saleId, method: input.deliveryMethod }),
    },
  });

  return { deliveryOrderId: delivery.id, referenceNo, status: 'pending' };
}

export async function transitionDeliveryStatus(
  tx: Prisma.TransactionClient,
  params: {
    deliveryOrderId: string;
    companyId: string;
    toStatus: string;
    userId: string;
    note?: string;
    providerStatus?: string;
    locationText?: string;
  },
  correlationId: string,
): Promise<{ deliveryOrderId: string; status: string }> {
  const delivery = await tx.deliveryOrder.findFirst({
    where: { id: params.deliveryOrderId, companyId: params.companyId },
  });
  if (!delivery) throw new DomainError('RESOURCE_NOT_FOUND', 'Delivery order not found', {}, 404);

  validateDeliveryTransition(delivery.status, params.toStatus);

  // If transitioning to 'delivered', record delivered_at + received_by_name
  const updateData: Record<string, unknown> = { status: params.toStatus };
  if (params.toStatus === 'delivered') {
    updateData.deliveredAt = new Date();
  }

  await tx.deliveryOrder.update({
    where: { id: delivery.id },
    data: updateData,
  });

  await tx.deliveryEvent.create({
    data: {
      companyId: params.companyId, deliveryOrderId: delivery.id,
      fromStatus: delivery.status, toStatus: params.toStatus,
      note: params.note, providerStatus: params.providerStatus,
      locationText: params.locationText,
      createdBy: params.userId,
    },
  });

  await tx.auditLog.create({
    data: {
      companyId: params.companyId, userId: params.userId, correlationId,
      action: 'delivery.transition', entityType: 'delivery_order', entityId: delivery.id,
      beforeValue: JSON.stringify({ status: delivery.status }),
      afterValue: JSON.stringify({ status: params.toStatus }),
    },
  });

  return { deliveryOrderId: delivery.id, status: params.toStatus };
}
