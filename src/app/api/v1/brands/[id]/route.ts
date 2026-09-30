// PATCH  /api/v1/brands/{id} — update a brands record.
// DELETE /api/v1/brands/{id} — delete it while nothing references it.
import { NextRequest } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { requireIdempotencyKey } from '@/lib/idempotency';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { catalogueMutation } from '@/lib/api/catalogueMutation';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'category.manage');
    const idempotencyKey = requireIdempotencyKey(req);
    return catalogueMutation(req, (await params).id, 'brands', auth, idempotencyKey);
  } catch (e) { return errorResponse(e, getCorrelationId(req)); }
}

export async function DELETE(req: NextRequest, { params }: Context) {
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'category.manage');
    const idempotencyKey = requireIdempotencyKey(req);
    return catalogueMutation(req, (await params).id, 'brands', auth, idempotencyKey);
  } catch (e) { return errorResponse(e, getCorrelationId(req)); }
}
