// src/domain/commands/m3/VoidSale.ts
// VoidSale domain command per §7.3.
//
// Voids a posted sale by:
//   1. Reversing all stock movements (posts opposite movements with movementType='reversal')
//   2. Reverting serial status from 'sold' back to 'in_stock'
//   3. Reversing payments (creates reversed payment records)
//   4. Setting sale.saleStatus = 'voided', voided_at, voided_by
//
// Voids after the sale_void_hours threshold (default 24h) require a full reversal
// instead (§20.D04). This implementation supports void within the threshold.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { reverseStockMovement, validateSerialTransition } from '@/domain/inventory/stockMovement';
import { DomainError } from '@/lib/errors/codes';

export interface VoidSaleInput {
  saleId: string;
  companyId: string;
  voidedBy: string;
  reason: string;
}

export async function voidSale(
  tx: Prisma.TransactionClient,
  input: VoidSaleInput,
  correlationId: string,
): Promise<{ saleId: string; saleStatus: string; voidedAt: Date }> {
  const sale = await tx.sale.findFirst({
    where: { id: input.saleId, companyId: input.companyId },
    include: {
      items: { include: { serials: true } },
      payments: true,
    },
  });
  if (!sale) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Sale not found', {}, 404);
  }
  if (sale.saleStatus === 'voided') {
    throw new DomainError('VALIDATION_FAILED', 'Sale is already voided', {}, 409);
  }
  if (sale.saleStatus === 'returned' || sale.saleStatus === 'partially_returned') {
    throw new DomainError('VALIDATION_FAILED', 'Cannot void a sale with returns — use full return instead', {}, 409);
  }

  // Check void threshold (configurable per §20.D04)
  const { getApprovalThresholds } = await import('@/lib/approval/thresholds');
  const thresholds = await getApprovalThresholds(sale.companyId);
  const postedAt = sale.postedAt ?? sale.createdAt;
  const hoursSincePost = (Date.now() - postedAt.getTime()) / (1000 * 60 * 60);
  if (hoursSincePost > thresholds.sale_void_hours) {
    throw new DomainError(
      'APPROVAL_REQUIRED',
      `Sale cannot be voided after ${thresholds.sale_void_hours} hours — requires full reversal (approval required)`,
      { hours_since_post: Math.floor(hoursSincePost), threshold_hours: thresholds.sale_void_hours },
      409,
    );
  }

  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: {
      id: eventId,
      companyId: input.companyId,
      eventType: 'sale.voided',
      sourceType: 'sale',
      sourceId: sale.id,
      correlationId,
      occurredAt: new Date(),
    },
  });

  // Reverse stock movements + revert serials
  let eventLineNo = 1;
  for (const item of sale.items) {
    // Find the original stock movement for this sale item
    const originalMovement = await tx.stockMovement.findFirst({
      where: { referenceType: 'sale', referenceId: sale.id, sourceLineId: item.id },
    });
    if (originalMovement) {
      await reverseStockMovement(tx, {
        originalMovementId: originalMovement.id,
        eventId,
        eventLineNo,
        createdBy: input.voidedBy,
        reason: input.reason,
      });
      eventLineNo++;
    }

    // Revert serials from 'sold' to 'in_stock'
    for (const saleSerial of item.serials) {
      const serial = await tx.productSerial.findUnique({ where: { id: saleSerial.serialId } });
      if (serial && serial.status === 'sold') {
        validateSerialTransition(serial.status, 'in_stock');
        await tx.productSerial.update({
          where: { id: serial.id },
          data: {
            status: 'in_stock',
            currentWarehouseId: sale.warehouseId,
            soldSaleItemId: null,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        await tx.serialEvent.create({
          data: {
            companyId: input.companyId,
            serialId: serial.id,
            eventId,
            eventLineNo,
            eventType: 'voided_return_to_stock',
            fromStatus: 'sold',
            toStatus: 'in_stock',
            fromWarehouseId: null,
            toWarehouseId: sale.warehouseId,
            referenceType: 'sale_void',
            referenceId: sale.id,
            createdBy: input.voidedBy,
          },
        });
        eventLineNo++;
      }
    }
  }

  // Reverse payments
  for (const alloc of sale.payments) {
    const payment = await tx.payment.findUnique({ where: { id: alloc.paymentId } });
    if (payment && payment.paymentStatus === 'posted') {
      await tx.payment.update({
        where: { id: payment.id },
        data: { paymentStatus: 'reversed' },
      });
      // Create a reversal payment (outgoing)
      await tx.payment.create({
        data: {
          companyId: payment.companyId,
          branchId: payment.branchId,
          referenceNo: payment.referenceNo + '-REV',
          clientTxnId: randomUUID(),
          paymentType: 'sale_refund',
          direction: 'outgoing',
          customerId: payment.customerId,
          financialAccountId: payment.financialAccountId,
          currencyCode: payment.currencyCode,
          exchangeRate: payment.exchangeRate,
          amount: payment.amount,
          baseAmount: payment.baseAmount,
          paymentMethod: payment.paymentMethod,
          methodReference: payment.methodReference,
          chequeStatus: 'not_applicable',
          paymentStatus: 'posted',
          businessDate: payment.businessDate,
          receivedOrPaidAt: new Date(),
          reversedPaymentId: payment.id,
          postedAt: new Date(),
          createdBy: input.voidedBy,
          notes: `Reversal of ${payment.referenceNo}: ${input.reason}`,
        },
      });
    }
  }

  // Mark sale as voided
  await tx.sale.update({
    where: { id: sale.id },
    data: {
      saleStatus: 'voided',
      voidedAt: new Date(),
      voidedBy: input.voidedBy,
    },
  });

  await tx.auditLog.create({
    data: {
      companyId: input.companyId,
      userId: input.voidedBy,
      correlationId,
      action: 'sale.void',
      entityType: 'sale',
      entityId: sale.id,
      beforeValue: JSON.stringify({ sale_status: 'completed' }),
      afterValue: JSON.stringify({ sale_status: 'voided', reason: input.reason }),
    },
  });

  return {
    saleId: sale.id,
    saleStatus: 'voided',
    voidedAt: new Date(),
  };
}
