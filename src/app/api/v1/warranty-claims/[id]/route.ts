// POST /api/v1/warranty-claims/{id}
//   { action: 'approve' | 'reject', reason }            approval.resolve
//   { action: 'fulfill', reference_document_id? }        warranty.fulfill
//
// A submitted claim is decided by someone other than the person who raised
// it (maker-checker, from the audit trail), then fulfilled; see
// src/domain/commands/m5/FulfillWarrantyClaim.ts for what fulfilment does.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { requireFeatureFlag } from '@/lib/featureFlags';
import { getCorrelationId } from '@/lib/http';
import { fulfillWarrantyClaim } from '@/domain/commands/m5/FulfillWarrantyClaim';

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), reason: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal('fulfill'), reference_document_id: z.string().uuid().optional() }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = ActionSchema.parse(await req.json());
    if (body.action === 'fulfill') await requirePermission(auth, 'warranty.fulfill');
    else await requirePermission(auth, 'approval.resolve');
    await runInTenantContext(auth.ctx, async () => { await requireFeatureFlag('service_warranty_enabled'); });
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/warranty-claims/${id}`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async tx =>
        withIdempotency(
          { idempotencyKey, operation: `warranty_claim.${body.action}`, requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            if (body.action === 'fulfill') {
              const done = await fulfillWarrantyClaim(tx, { warrantyClaimId: id, companyId: auth.companyId, fulfilledBy: auth.userId,
                referenceDocumentId: body.reference_document_id }, correlationId);
              return { status: 200, body: { id: done.claimId, status: done.status, replacement_cost: done.replacementCost ?? null }, resourceType: 'warranty_claim', resourceId: id };
            }

            await tx.$queryRaw`SELECT id FROM warranty_claims WHERE id = ${id} AND company_id = ${auth.companyId} FOR UPDATE`;
            const claim = await tx.warrantyClaim.findFirst({ where: { id, companyId: auth.companyId }, include: { serviceRequest: { select: { branchId: true } } } });
            if (!claim) throw new DomainError('RESOURCE_NOT_FOUND', 'Warranty claim not found', {}, 404);
            await requirePermission(auth, 'approval.resolve', claim.serviceRequest.branchId);
            if (claim.status !== 'submitted') throw new DomainError('VALIDATION_FAILED', `Only a submitted claim can be decided (current: ${claim.status})`, {}, 409);
            const raised = await tx.auditLog.findFirst({ where: { companyId: auth.companyId, entityType: 'warranty_claim', entityId: id, action: 'warranty_claim.create' }, select: { userId: true } });
            if (raised?.userId === auth.userId) throw new DomainError('FORBIDDEN_SCOPE', 'Someone other than the person who raised this claim must decide it', {}, 403);

            const status = body.action === 'approve' ? 'approved' : 'rejected';
            await tx.warrantyClaim.update({ where: { id }, data: { status, approvedBy: auth.userId, approvedAt: new Date() } });
            await tx.auditLog.create({ data: { companyId: auth.companyId, userId: auth.userId, correlationId,
              action: `warranty_claim.${body.action}`, entityType: 'warranty_claim', entityId: id,
              beforeValue: JSON.stringify({ status: claim.status }), afterValue: JSON.stringify({ status, reason: body.reason }) } });
            return { status: 200, body: { id, status }, resourceType: 'warranty_claim', resourceId: id };
          },
          tx,
        )),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid warranty claim action', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
