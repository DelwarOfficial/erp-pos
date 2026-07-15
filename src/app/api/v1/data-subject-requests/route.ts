// GET /api/v1/data-subject-requests — list DSR requests
// POST /api/v1/data-subject-requests — create new DSR (access/rectification/erasure/portability/objection)
// Per §20.D09 — GDPR-style privacy controls.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { z } from 'zod';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    
    await requirePermission(auth, 'audit_logs:read');

    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      db.dataSubjectRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      db.dataSubjectRequest.count({ where }),
    ]);
    return NextResponse.json({ items, total, limit, offset });
  } catch (e) { return errorResponse(e, correlationId); }
}

const DSRSchema = z.object({
  request_type: z.enum(['access', 'rectification', 'erasure', 'portability', 'objection']),
  customer_id: z.string().uuid().optional(),
  details: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    
    await requirePermission(auth, 'audit_logs:write');

    const idempotencyKey = requireIdempotencyKey(req);
    const body = DSRSchema.parse(await req.json());

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'dsr.create', requestHash: computeRequestHash({ method: 'POST', path: '/api/v1/data-subject-requests', body }), companyId: auth.companyId, userId: auth.userId },
        async () => withTenant(auth.ctx, async (tx) => {
          const dsr = await tx.dataSubjectRequest.create({
            data: {
              companyId: auth.companyId,
              requestType: body.request_type,
              customerId: body.customer_id ?? null,
              status: 'open',
              details: body.details ?? null,
            },
          });
          await tx.auditLog.create({
            data: {
              companyId: auth.companyId, userId: auth.userId,
              correlationId, action: 'dsr.create',
              entityType: 'data_subject_request', entityId: dsr.id,
              afterValue: JSON.stringify({ requestType: body.request_type, customerId: body.customer_id }),
              occurredAt: new Date(),
            },
          });
          return { status: 201, body: { item: dsr }, resourceType: 'data_subject_request', resourceId: dsr.id };
        }),
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid DSR payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
