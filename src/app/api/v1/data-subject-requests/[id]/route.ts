// GET /api/v1/data-subject-requests/[id] — get single DSR
// PATCH /api/v1/data-subject-requests/[id] — update DSR status; completing it
// carries the request out (see src/lib/compliance/dataSubjectRequests.ts)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { computeRequestHash, requireIdempotencyKey, withIdempotency } from '@/lib/idempotency';
import { fulfilDataSubjectRequest } from '@/lib/compliance/dataSubjectRequests';
import { z } from 'zod';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    // A read needs no Idempotency-Key. This used to demand one and ignore it,
    // so a plain GET was rejected with 400 until the client invented a key.
    const auth = await authenticateRequest();
    await requirePermission(auth, 'dsr.manage.company');

    const { id } = await params;
    const item = await runInTenantContext(auth.ctx, async () => {
      return db.dataSubjectRequest.findFirst({ where: { id, companyId: auth.companyId } });
    });
    if (!item) return NextResponse.json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'DSR not found' } }, { status: 404 });
    return NextResponse.json({ item });
  } catch (e) { return errorResponse(e, correlationId); }
}

const PatchSchema = z.object({
  status: z.enum(['open', 'in_progress', 'completed', 'rejected']),
  // Required to complete a rectification or objection request, which need a
  // human decision; ignored otherwise.
  resolution_note: z.string().trim().max(2000).optional(),
}).strict();

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const idempotencyKey = requireIdempotencyKey(req);
    await requirePermission(auth, 'dsr.manage.company');

    const { id } = await params;
    const body = PatchSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'PATCH', path: `/api/v1/data-subject-requests/${id}`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async (tx) =>
        withIdempotency(
          { idempotencyKey, operation: 'dsr.update', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            if (body.status === 'completed') {
              // Completing a request now carries it out. It used to write only
              // the status, so an erasure request could be recorded as
              // fulfilled while the subject's data stayed in full.
              const fulfilled = await fulfilDataSubjectRequest(tx, {
                companyId: auth.companyId, requestId: id, resolvedBy: auth.userId!,
                resolutionNote: body.resolution_note, correlationId,
              });
              return { status: 200, body: { item: { id, status: 'completed', ...fulfilled } }, resourceType: 'data_subject_request', resourceId: id };
            }

            const updated = await tx.dataSubjectRequest.updateMany({
              where: { id, companyId: auth.companyId, status: { notIn: ['completed', 'rejected'] } },
              data: {
                status: body.status,
                // The resolver is the authenticated user. This used to accept a
                // `resolved_by` from the request body, so a client could
                // attribute a rejection to somebody else.
                ...(body.status === 'rejected' ? { resolvedBy: auth.userId, resolvedAt: new Date() } : {}),
              },
            });
            if (updated.count === 0) {
              throw new DomainError('RESOURCE_NOT_FOUND', 'DSR not found or already resolved', {}, 404);
            }
            await tx.auditLog.create({
              data: {
                companyId: auth.companyId, userId: auth.userId, correlationId,
                action: `dsr.${body.status}`, entityType: 'data_subject_request', entityId: id,
                afterValue: JSON.stringify({ status: body.status }),
              },
            });
            return { status: 200, body: { item: { id, status: body.status } }, resourceType: 'data_subject_request', resourceId: id };
          },
          tx,
        )),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid patch', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
