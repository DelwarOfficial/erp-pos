// src/domain/commands/m3/CashierShift.ts
// Open + close cashier shift per §7.21 + §20.D06.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

export interface OpenShiftInput {
  companyId: string;
  branchId: string;
  warehouseId: string;
  cashierId: string;
  cashAccountId: string;  // financial account ID
  openingFloat: number;
}

export async function openCashierShift(
  tx: Prisma.TransactionClient,
  input: OpenShiftInput,
  correlationId: string,
): Promise<{ shiftId: string; status: string; openedAt: Date }> {
  // Check no open shift exists for this cashier + cash account
  const existing = await tx.cashierShift.findFirst({
    where: {
      companyId: input.companyId,
      cashierId: input.cashierId,
      cashAccountId: input.cashAccountId,
      status: 'open',
    },
  });
  if (existing) {
    throw new DomainError('VALIDATION_FAILED', 'Cashier already has an open shift for this cash account', { shift_id: existing.id }, 409);
  }

  const shift = await tx.cashierShift.create({
    data: {
      companyId: input.companyId,
      branchId: input.branchId,
      warehouseId: input.warehouseId,
      cashierId: input.cashierId,
      cashAccountId: input.cashAccountId,
      status: 'open',
      openingFloat: input.openingFloat,
    },
  });

  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.cashierId, correlationId,
      action: 'cashier_shift.open', entityType: 'cashier_shift', entityId: shift.id,
      afterValue: JSON.stringify({ opening_float: input.openingFloat, cash_account: input.cashAccountId }),
    },
  });

  return { shiftId: shift.id, status: 'open', openedAt: shift.openedAt };
}

export interface CloseShiftInput {
  shiftId: string;
  companyId: string;
  closedBy: string;
  countedClosingCash: number;
  varianceReason?: string;
  approvedBy?: string;  // required if variance exceeds threshold
}

export async function closeCashierShift(
  tx: Prisma.TransactionClient,
  input: CloseShiftInput,
  correlationId: string,
): Promise<{ shiftId: string; status: string; variance: number; expectedCash: number; countedCash: number }> {
  const shift = await tx.cashierShift.findFirst({
    where: { id: input.shiftId, companyId: input.companyId },
  });
  if (!shift) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Cashier shift not found', {}, 404);
  }
  if (shift.status !== 'open') {
    throw new DomainError('VALIDATION_FAILED', `Shift is already ${shift.status}`, {}, 409);
  }

  // Compute expected closing cash = opening_float + sum(cash payments in this shift)
  const cashPayments = await tx.payment.findMany({
    where: {
      cashierShiftId: shift.id,
      paymentMethod: 'cash',
      direction: 'incoming',
      paymentStatus: 'posted',
    },
  });
  const totalCashIn = cashPayments.reduce((s, p) => s + parseFloat(p.amount.toString()), 0);
  const expectedCash = parseFloat(shift.openingFloat.toString()) + totalCashIn;

  const variance = input.countedClosingCash - expectedCash;

  // If variance exceeds threshold (configurable per §20.D04), require approval
  const { getApprovalThresholds } = await import('@/lib/approval/thresholds');
  const thresholds = await getApprovalThresholds(input.companyId);
  const requiresApproval = Math.abs(variance) > thresholds.cashier_variance_amount;
  if (requiresApproval && !input.approvedBy) {
    throw new DomainError(
      'APPROVAL_REQUIRED',
      `Variance of ${variance.toFixed(2)} exceeds threshold — supervisor approval required`,
      { variance, threshold: thresholds.cashier_variance_amount },
      409,
    );
  }

  await tx.cashierShift.update({
    where: { id: shift.id },
    data: {
      status: requiresApproval ? 'approved' : 'closed',
      closedAt: new Date(),
      expectedClosingCash: expectedCash,
      countedClosingCash: input.countedClosingCash,
      variance,
      varianceReason: input.varianceReason ?? null,
      approvedBy: input.approvedBy ?? null,
      approvedAt: input.approvedBy ? new Date() : null,
    },
  });

  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.closedBy, correlationId,
      action: 'cashier_shift.close', entityType: 'cashier_shift', entityId: shift.id,
      afterValue: JSON.stringify({
        expected: expectedCash, counted: input.countedClosingCash,
        variance, approved_by: input.approvedBy ?? null,
      }),
    },
  });

  return {
    shiftId: shift.id,
    status: requiresApproval ? 'approved' : 'closed',
    variance,
    expectedCash,
    countedCash: input.countedClosingCash,
  };
}
