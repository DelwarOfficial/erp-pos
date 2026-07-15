// PATCH /api/v1/legal-holds/[id] — release a legal hold (allows deletion/anonymization to proceed)
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { requireIdempotencyKey } from '@/lib/idempotency';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const idempotencyKey = requireIdempotencyKey(req);
    if ('error' in auth) return NextResponse.json(auth, { status: auth.status });
    await requirePermission(auth, 'audit_logs:write');

    const { id } = await params;
    const item = await db.legalHold.updateMany({
      where: { id, companyId: auth.companyId, releasedAt: null },
      data: { releasedAt: new Date() },
    });
    if (item.count === 0) return NextResponse.json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Legal hold not found or already released' } }, { status: 404 });
    return NextResponse.json({ item: { id, released: true } });
  } catch (e) { return errorResponse(e, correlationId); }
}
