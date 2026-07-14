// GET  /api/v1/fiscal-periods  — list fiscal periods
// POST /api/v1/fiscal-periods  — create a fiscal period

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const FiscalPeriodSchema = z.object({
  period_name: z.string().min(1).max(50),
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'fiscal_period.lock');
  await requirePermission(auth, 'journal.read');
    const periods = await db.fiscalPeriod.findMany({
      where: { companyId: auth.companyId },
      orderBy: { periodStart: 'desc' },
    });
    return NextResponse.json({
      items: periods.map(p => ({
        id: p.id, period_name: p.periodName,
        period_start: p.periodStart, period_end: p.periodEnd,
        status: p.status, locked_at: p.lockedAt,
      })),
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const idempotencyKey = requireIdempotencyKey(req);
    const body = FiscalPeriodSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/fiscal-periods', body });

    const start = new Date(body.period_start);
    const end = new Date(body.period_end);
    if (end < start) {
      throw new DomainError('VALIDATION_FAILED', 'period_end must be >= period_start', {}, 400);
    }

    // Check for overlapping periods (SQLite: check in app code)
    const existing = await db.fiscalPeriod.findMany({
      where: { companyId: auth.companyId },
    });
    for (const p of existing) {
      const pStart = new Date(p.periodStart);
      const pEnd = new Date(p.periodEnd);
      if ((start >= pStart && start <= pEnd) || (end >= pStart && end <= pEnd) || (start <= pStart && end >= pEnd)) {
        throw new DomainError('VALIDATION_FAILED', `Period overlaps with "${p.periodName}"`, { overlapping_period: p.periodName }, 409);
      }
    }

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'fiscal_period.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const period = await tx.fiscalPeriod.create({
              data: {
                companyId: auth.companyId,
                periodName: body.period_name,
                periodStart: start,
                periodEnd: end,
                status: 'open',
              },
            });
            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'fiscal_period.create', entityType: 'fiscal_period', entityId: period.id,
                afterValue: JSON.stringify({ name: period.periodName, start: period.periodStart, end: period.periodEnd }) },
            });
            return { status: 201, body: { id: period.id, period_name: period.periodName, status: period.status }, resourceType: 'fiscal_period', resourceId: period.id };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid fiscal period payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
