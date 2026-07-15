// GET   /api/v1/exchange-rates/{id}  — fetch a single exchange rate
// PATCH /api/v1/exchange-rates/{id}  — update rate_to_base / source

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const PatchSchema = z.object({
  rate_to_base: z.number().positive().optional(),
  source: z.string().min(1).max(60).optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'report.execute');
    const { id } = await params;

    const r = await db.exchangeRate.findFirst({
      where: { id, companyId: auth.companyId },
    });
    if (!r) throw new DomainError('RESOURCE_NOT_FOUND', 'Exchange rate not found', {}, 404);

    return NextResponse.json({
      item: {
        id: r.id, currency_code: r.currencyCode, rate_date: r.rateDate,
        rate_to_base: r.rateToBase.toString(), source: r.source,
        approved_by: r.approvedBy, created_at: r.createdAt,
      },
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'tax.manage');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = PatchSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'PATCH', path: `/api/v1/exchange-rates/${id}`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'exchange_rate.update', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const existing = await tx.exchangeRate.findFirst({
              where: { id, companyId: auth.companyId },
            });
            if (!existing) throw new DomainError('RESOURCE_NOT_FOUND', 'Exchange rate not found', {}, 404);

            const updated = await tx.exchangeRate.update({
              where: { id },
              data: {
                rateToBase: body.rate_to_base ?? existing.rateToBase,
                source: body.source ?? existing.source,
              },
            });

            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'exchange_rate.update', entityType: 'exchange_rate', entityId: id,
                beforeValue: JSON.stringify({ rate_to_base: existing.rateToBase.toString(), source: existing.source }),
                afterValue: JSON.stringify({ rate_to_base: updated.rateToBase.toString(), source: updated.source }) },
            });

            return {
              status: 200,
              body: {
                id: updated.id,
                rate_to_base: updated.rateToBase.toString(),
                source: updated.source,
              },
              resourceType: 'exchange_rate', resourceId: id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid exchange rate update payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
