// PATCH /api/v1/devices/{id}  { status: 'revoked', reason }  — revoke a lost or
// stolen till (device.revoke). A revoked till can no longer download the
// product list or send sales; sales it already sent stay posted. Revoking is
// final: set up the browser again to use it as a till.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const RevokeSchema = z.object({ status: z.literal('revoked'), reason: z.string().trim().min(3).max(300) });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'device.revoke');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = RevokeSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'PATCH', path: `/api/v1/devices/${id}`, body });
    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async tx =>
        withIdempotency(
          { idempotencyKey, operation: 'device.revoke', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            const device = await tx.device.findFirst({ where: { id, companyId: auth.companyId } });
            if (!device) throw new DomainError('RESOURCE_NOT_FOUND', 'Till not found', {}, 404);
            if (!auth.ctx.allBranches && !auth.ctx.branchIds.includes(device.branchId)) {
              throw new DomainError('FORBIDDEN_SCOPE', 'You cannot revoke a till in this branch', {}, 403);
            }
            if (device.status !== 'revoked') {
              await tx.device.update({ where: { id }, data: { status: 'revoked', revokedAt: new Date() } });
              await tx.auditLog.create({ data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'device.revoke', entityType: 'device', entityId: id,
                beforeValue: JSON.stringify({ status: device.status }), afterValue: JSON.stringify({ status: 'revoked', reason: body.reason }) } });
            }
            return { status: 200, body: { id, status: 'revoked' }, resourceType: 'device', resourceId: id };
          },
          tx,
        )),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Give a reason to revoke the till', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
