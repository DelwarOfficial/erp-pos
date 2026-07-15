// GET  /api/v1/tax-periods  — list tax return periods
// POST /api/v1/tax-periods  — create a tax return period

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const ReturnTypeEnum = z.enum(['VAT_9_1', 'withholding', 'other']);

const CreateTaxPeriodSchema = z.object({
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
  return_type: ReturnTypeEnum.default('VAT_9_1'),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'report.execute');
    const url = req.nextUrl;
    const status = url.searchParams.get('status') ?? undefined;
    const returnType = url.searchParams.get('return_type') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.status = status;
    if (returnType) where.returnType = returnType;

    const [items, total] = await Promise.all([
      db.taxReturnPeriod.findMany({
        where, take: limit, skip: offset, orderBy: { periodStart: 'desc' },
      }),
      db.taxReturnPeriod.count({ where }),
    ]);

    return NextResponse.json({
      items: items.map(p => ({
        id: p.id, period_start: p.periodStart, period_end: p.periodEnd,
        return_type: p.returnType, status: p.status,
        prepared_document_id: p.preparedDocumentId,
        filed_at: p.filedAt, filed_reference: p.filedReference,
      })),
      total, limit, offset,
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'tax.manage');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = CreateTaxPeriodSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/tax-periods', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'tax_period.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const period = await tx.taxReturnPeriod.create({
              data: {
                companyId: auth.companyId,
                periodStart: new Date(body.period_start),
                periodEnd: new Date(body.period_end),
                returnType: body.return_type,
                status: 'open',
              },
            });
            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'tax_period.create', entityType: 'tax_return_period', entityId: period.id,
                afterValue: JSON.stringify({ return_type: body.return_type, period_start: body.period_start, period_end: body.period_end }) },
            });
            return {
              status: 201,
              body: { id: period.id, status: 'open', return_type: body.return_type },
              resourceType: 'tax_return_period', resourceId: period.id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid tax period payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
