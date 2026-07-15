// GET /api/v1/data-subject-requests/[id] — get single DSR
// PATCH /api/v1/data-subject-requests/[id] — update DSR status (resolve/reject)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { requireIdempotencyKey } from '@/lib/idempotency';
import { z } from 'zod';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const idempotencyKey = requireIdempotencyKey(req);
    if ('error' in auth) return NextResponse.json(auth, { status: auth.status });
    await requirePermission(auth, 'audit_logs:read');

    const { id } = await params;
    const item = await db.dataSubjectRequest.findFirst({ where: { id, companyId: auth.companyId } });
    if (!item) return NextResponse.json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'DSR not found' } }, { status: 404 });
    return NextResponse.json({ item });
  } catch (e) { return errorResponse(e, correlationId); }
}

const PatchSchema = z.object({
  status: z.enum(['open', 'in_progress', 'completed', 'rejected']).optional(),
  resolved_by: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const idempotencyKey = requireIdempotencyKey(req);
    if ('error' in auth) return NextResponse.json(auth, { status: auth.status });
    await requirePermission(auth, 'audit_logs:write');

    const { id } = await params;
    const body = PatchSchema.parse(await req.json());

    const item = await db.dataSubjectRequest.updateMany({
      where: { id, companyId: auth.companyId },
      data: {
        ...(body.status && { status: body.status }),
        ...(body.status === 'completed' || body.status === 'rejected' ? { resolvedBy: body.resolved_by ?? auth.userId, resolvedAt: new Date() } : {}),
      },
    });
    if (item.count === 0) return NextResponse.json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'DSR not found' } }, { status: 404 });
    return NextResponse.json({ item: { id, updated: true } });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid patch', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
