// GET   /api/v1/tax-periods/{id}     — fetch a single tax return period
// PATCH /api/v1/tax-periods/{id}     — update status (prepared/reviewed/filed/amended)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const PatchSchema = z.object({
  status: z.enum(['open', 'prepared', 'reviewed', 'filed', 'amended']),
  filed_reference: z.string().max(200).optional(),
  prepared_document_id: z.string().uuid().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'report.execute');
    const { id } = await params;

    const p = await db.taxReturnPeriod.findFirst({
      where: { id, companyId: auth.companyId },
    });
    if (!p) throw new DomainError('RESOURCE_NOT_FOUND', 'Tax return period not found', {}, 404);

    return NextResponse.json({
      item: {
        id: p.id, period_start: p.periodStart, period_end: p.periodEnd,
        return_type: p.returnType, status: p.status,
        prepared_document_id: p.preparedDocumentId,
        filed_at: p.filedAt, filed_reference: p.filedReference,
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
    const requestHash = computeRequestHash({ method: 'PATCH', path: `/api/v1/tax-periods/${id}`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'tax_period.update', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const existing = await tx.taxReturnPeriod.findFirst({
              where: { id, companyId: auth.companyId },
            });
            if (!existing) throw new DomainError('RESOURCE_NOT_FOUND', 'Tax return period not found', {}, 404);

            const updated = await tx.taxReturnPeriod.update({
              where: { id },
              data: {
                status: body.status,
                filedReference: body.filed_reference ?? existing.filedReference,
                filedAt: body.status === 'filed' ? new Date() : existing.filedAt,
                preparedDocumentId: body.prepared_document_id ?? existing.preparedDocumentId,
              },
            });

            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'tax_period.update', entityType: 'tax_return_period', entityId: id,
                beforeValue: JSON.stringify({ status: existing.status }),
                afterValue: JSON.stringify({ status: updated.status, filed_reference: updated.filedReference }) },
            });

            return {
              status: 200,
              body: {
                id: updated.id, status: updated.status,
                filed_at: updated.filedAt, filed_reference: updated.filedReference,
              },
              resourceType: 'tax_return_period', resourceId: id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid tax period update payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
