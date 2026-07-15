// GET /api/v1/legal-holds — list legal holds
// POST /api/v1/legal-holds — declare a legal hold on an entity (blocks deletion/anonymization)
// Per §20.D09 — legal holds block data retention/deletion until released.

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
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const [items, total] = await Promise.all([
      db.legalHold.findMany({
        where: { companyId: auth.companyId, releasedAt: null },
        orderBy: { declaredAt: 'desc' },
        take: limit, skip: offset,
      }),
      db.legalHold.count({ where: { companyId: auth.companyId, releasedAt: null } }),
    ]);
    return NextResponse.json({ items, total, limit, offset });
  } catch (e) { return errorResponse(e, correlationId); }
}

const HoldSchema = z.object({
  entity_type: z.string().min(1).max(50),
  entity_id: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    
    await requirePermission(auth, 'audit_logs:write');

    const idempotencyKey = requireIdempotencyKey(req);
    const body = HoldSchema.parse(await req.json());

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'legal_hold.declare', requestHash: computeRequestHash({ method: 'POST', path: '/api/v1/legal-holds', body }), companyId: auth.companyId, userId: auth.userId },
        async () => withTenant(auth.ctx, async (tx) => {
          const hold = await tx.legalHold.create({
            data: {
              companyId: auth.companyId,
              entityType: body.entity_type,
              entityId: body.entity_id,
              reason: body.reason,
              declaredBy: auth.userId!,
              declaredAt: new Date(),
            },
          });
          await tx.auditLog.create({
            data: {
              companyId: auth.companyId, userId: auth.userId,
              correlationId, action: 'legal_hold.declare',
              entityType: body.entity_type, entityId: body.entity_id,
              afterValue: JSON.stringify({ holdId: hold.id, reason: body.reason }),
              occurredAt: new Date(),
            },
          });
          return { status: 201, body: { item: hold }, resourceType: 'legal_hold', resourceId: hold.id };
        }),
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid legal hold', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
