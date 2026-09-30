// src/domain/commands/m3/CashierShift.ts
// Open + close cashier shift per §7.21 + §20.D06.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';

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

  // Expected closing cash = opening float + cash taken in - cash paid out
  // during the shift (F-27: refunds and other payouts from the drawer used to
  // be ignored, so every such shift showed a false shortage).
  //
  // A reversed payment stays 'reversed' and its reversal is a posted payment in
  // the opposite direction, so counting both leaves the drawer net unchanged.
  // Money is summed in Decimal, never floating point.
  const cashPayments = await tx.payment.findMany({
    where: {
      companyId: input.companyId,
      cashierShiftId: shift.id,
      paymentMethod: 'cash',
      paymentStatus: { in: ['posted', 'reversed'] },
    },
    select: { amount: true, direction: true },
  });
  const netCash = cashPayments.reduce(
    (sum, p) => (p.direction === 'outgoing' ? sum.minus(p.amount) : sum.plus(p.amount)), new Prisma.Decimal(0));
  const expected = new Prisma.Decimal(shift.openingFloat).plus(netCash).toDecimalPlaces(2);
  const counted = new Prisma.Decimal(String(input.countedClosingCash)).toDecimalPlaces(2);
  const varianceAmount = counted.minus(expected);
  const expectedCash = expected.toNumber();
  const variance = varianceAmount.toNumber();

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

  // F-28: a counted shortage or overage is money the ledger still claims (or
  // does not know about): post it against the cash over/short account.
  //   shortage: Dr cash over/short, Cr drawer cash
  //   overage:  Dr drawer cash,     Cr cash over/short
  if (!varianceAmount.isZero()) {
    const [policy, drawer] = await Promise.all([
      tx.accountingPolicy.findUnique({ where: { companyId: input.companyId }, select: { cashOverShortAccountId: true } }),
      tx.financialAccount.findFirst({ where: { id: shift.cashAccountId, companyId: input.companyId }, select: { id: true, chartOfAccountId: true } }),
    ]);
    if (!policy?.cashOverShortAccountId || !drawer) {
      throw new DomainError('VALIDATION_FAILED',
        'Set the cash over/short account in the accounting policy before closing a shift with a variance', {}, 409);
    }
    const amount = varianceAmount.abs();
    const shortage = varianceAmount.isNegative();
    await postJournalEntry(tx, {
      companyId: input.companyId,
      entryDate: new Date(),
      postingKind: 'cash_over_short',
      sourceType: 'cashier_shift', sourceId: shift.id,
      description: `Cash ${shortage ? 'shortage' : 'overage'} at close of the shift opened ${shift.openedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
      currencyCode: 'BDT', exchangeRate: 1,
      createdBy: input.closedBy,
      lines: [
        { chartOfAccountId: policy.cashOverShortAccountId, branchId: shift.branchId,
          debit: shortage ? amount : 0, credit: shortage ? 0 : amount, memo: input.varianceReason ?? undefined },
        { chartOfAccountId: drawer.chartOfAccountId, financialAccountId: drawer.id, branchId: shift.branchId,
          debit: shortage ? 0 : amount, credit: shortage ? amount : 0 },
      ],
    }, correlationId);
  }

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
