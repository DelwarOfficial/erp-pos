// GET  /api/v1/reconciliations  — list reconciliation runs
// POST /api/v1/reconciliations  — run a reconciliation (uses runReconciliation)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { runReconciliation } from '@/lib/reconciliation/checks';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const RunSchema = z.object({
  run_type: z.enum(['nightly', 'manual', 'pre_close', 'post_restore']).default('manual'),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'reconciliation.read');
    const url = req.nextUrl;
    const status = url.searchParams.get('status') ?? undefined;
    const runType = url.searchParams.get('run_type') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.status = status;
    if (runType) where.runType = runType;

    const [items, total] = await Promise.all([
      db.reconciliationRun.findMany({
        where, take: limit, skip: offset, orderBy: { startedAt: 'desc' },
        include: {
          initiatedByUser: { select: { id: true, name: true } },
          _count: { select: { findings: true } },
        },
      }),
      db.reconciliationRun.count({ where }),
    ]);

    return NextResponse.json({
      items: items.map(r => ({
        id: r.id, run_type: r.runType, status: r.status,
        started_at: r.startedAt, completed_at: r.completedAt,
        initiated_by: r.initiatedByUser,
        summary: (() => { try { return JSON.parse(r.summary); } catch { return {}; } })(),
        finding_count: r._count.findings,
      })),
      total, limit, offset,
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'reconciliation.run');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = RunSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/reconciliations', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'reconciliation.run', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // runReconciliation uses the db client directly; run inside tenant
            // context so audit/security logs carry the tenant.
            const out = await runReconciliation(auth.companyId, body.run_type, auth.userId);
            return {
              status: 201,
              body: {
                run_id: out.runId, run_type: body.run_type,
                status: out.summary.critical ? 'failed' : out.summary.high ? 'partial' : 'passed',
                findings_count: out.findings.length,
                summary: out.summary,
              },
              resourceType: 'reconciliation_run', resourceId: out.runId,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid reconciliation payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
