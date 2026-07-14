// POST /api/v1/sales/{id}/void

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { voidSale } from '@/domain/commands/m3/VoidSale';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const VoidSchema = z.object({ reason: z.string().min(1).max(500) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'sale.void');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = VoidSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/sales/${id}/void`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'sale.void', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const result = await voidSale(tx, {
              saleId: id,
              companyId: auth.companyId,
              voidedBy: auth.userId,
              reason: body.reason,
            }, correlationId);
            return {
              status: 200,
              body: result,
              resourceType: 'sale',
              resourceId: id,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse({ name: 'DomainError', code: 'VALIDATION_FAILED', message: 'Invalid void payload', details: { issues: e.issues }, httpStatus: 400, toJSON: () => ({ error: { code: 'VALIDATION_FAILED', message: 'Invalid void payload', details: { issues: e.issues } } }) } as any, correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
