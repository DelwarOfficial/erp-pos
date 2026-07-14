// GET /api/v1/approvals — list approval requests
// POST /api/v1/approvals — create approval request (called by domain commands when threshold exceeded)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { createApprovalRequest } from '@/lib/approval/workflow';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { z } from 'zod';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    try { await requirePermission(auth, 'audit_logs:read'); } catch (e) { if (e instanceof DomainError && !auth.isGlobal) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus }); }
    await requirePermission(auth, 'audit_logs:read');

    const url = new URL(req.url);
    const status = url.searchParams.get('status') ?? 'pending';
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const [items, total] = await Promise.all([
      db.approvalRequest.findMany({
        where: { companyId: auth.companyId, status },
        orderBy: { requestedAt: 'desc' },
        take: limit, skip: offset,
      }),
      db.approvalRequest.count({ where: { companyId: auth.companyId, status } }),
    ]);
    return NextResponse.json({ items, total, limit, offset });
  } catch (e) { return errorResponse(e, correlationId); }
}

const CreateSchema = z.object({
  request_type: z.string().min(1).max(60),
  reference_type: z.string().min(1).max(60),
  reference_id: z.string().min(1),
  branch_id: z.string().uuid().optional(),
  payload: z.record(z.unknown()).optional(),
  threshold_value: z.number().optional(),
  threshold_name: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    try { await requirePermission(auth, 'audit_logs:read'); } catch (e) { if (e instanceof DomainError && !auth.isGlobal) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.httpStatus }); }
    await requirePermission(auth, 'audit_logs:write');

    const idempotencyKey = requireIdempotencyKey(req);
    const body = CreateSchema.parse(await req.json());

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'approval.create', requestHash: computeRequestHash({ method: 'POST', path: '/api/v1/approvals', body }), companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const approval = await createApprovalRequest({
              companyId: auth.companyId,
              branchId: body.branch_id,
              requestType: body.request_type,
              referenceType: body.reference_type,
              referenceId: body.reference_id,
              payload: body.payload ?? {},
              requestedBy: auth.userId!,
              thresholdValue: body.threshold_value,
              thresholdName: body.threshold_name,
            });
            return { status: 201, body: { item: approval }, resourceType: 'approval_request', resourceId: approval.id };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid approval request', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
