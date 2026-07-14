// POST /api/v1/cashier-shifts/open

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { openCashierShift } from '@/domain/commands/m3/CashierShift';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const OpenSchema = z.object({
  branch_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  cash_account_id: z.string().uuid(),
  opening_float: z.number().min(0),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'shift.open');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = OpenSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/cashier-shifts/open', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'cashier_shift.open', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const result = await openCashierShift(tx, {
              companyId: auth.companyId,
              branchId: body.branch_id,
              warehouseId: body.warehouse_id,
              cashierId: auth.userId,
              cashAccountId: body.cash_account_id,
              openingFloat: body.opening_float,
            }, correlationId);
            return {
              status: 201,
              body: result,
              resourceType: 'cashier_shift',
              resourceId: result.shiftId,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid open shift payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
