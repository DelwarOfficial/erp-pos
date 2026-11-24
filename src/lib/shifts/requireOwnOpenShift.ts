// src/lib/shifts/requireOwnOpenShift.ts
// A payment may only be tagged to the caller's own open shift in the same
// branch. Tagging another user's or a closed shift let a fake cash-out hide
// inside someone else's drawer count (red-team workstream 2).
// Shared by customer collections and POST /api/v1/payments.

import type { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';

export async function requireOwnOpenShift(
  tx: Prisma.TransactionClient,
  params: { companyId: string; branchId: string; userId: string; shiftId: string },
  httpStatus = 409,
): Promise<string> {
  const shift = await tx.cashierShift.findFirst({
    where: { id: params.shiftId, companyId: params.companyId, branchId: params.branchId, cashierId: params.userId, status: 'open' },
    select: { id: true },
  });
  if (!shift) throw new DomainError('NO_OPEN_SHIFT', 'That shift is not your open shift in this branch', {}, httpStatus);
  return shift.id;
}
