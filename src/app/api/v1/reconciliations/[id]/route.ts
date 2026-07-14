// GET /api/v1/reconciliations/{id} — fetch a reconciliation run with all findings

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'reconciliation.read');
    const { id } = await params;

    const run = await db.reconciliationRun.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        initiatedByUser: { select: { id: true, name: true } },
        findings: { orderBy: { severity: 'asc' } },
      },
    });
    if (!run) throw new DomainError('RESOURCE_NOT_FOUND', 'Reconciliation run not found', {}, 404);

    return NextResponse.json({
      item: {
        id: run.id, run_type: run.runType, status: run.status,
        started_at: run.startedAt, completed_at: run.completedAt,
        initiated_by: run.initiatedByUser,
        summary: (() => { try { return JSON.parse(run.summary); } catch { return {}; } })(),
        findings: run.findings.map(f => ({
          id: f.id, check_code: f.checkCode, severity: f.severity,
          branch_id: f.branchId,
          reference_type: f.referenceType, reference_id: f.referenceId,
          expected_value: f.expectedValue?.toString() ?? null,
          actual_value: f.actualValue?.toString() ?? null,
          variance: f.variance?.toString() ?? null,
          details: (() => { try { return JSON.parse(f.details); } catch { return {}; } })(),
          status: f.status,
          resolved_by: f.resolvedBy, resolved_at: f.resolvedAt,
        })),
      },
    });
  } catch (e) { return errorResponse(e, correlationId); }
}
