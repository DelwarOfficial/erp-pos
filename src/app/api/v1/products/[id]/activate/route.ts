// src/app/api/v1/products/[id]/activate/route.ts
// POST /api/v1/products/{id}/activate
// Validates the product per validateProductActivation() and flips is_active=true.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { validateProductActivation } from '@/domain/invariants/productActivation';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'product.activate');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/products/${id}/activate`, body: { id } });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'product.activate', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const product = await tx.product.findFirst({
              where: { id, companyId: auth.companyId, deletedAt: null },
            });
            if (!product) throw new DomainError('RESOURCE_NOT_FOUND', 'Product not found', {}, 404);

            if (product.isActive) {
              return {
                status: 200,
                body: { id: product.id, code: product.code, status: 'already_active' },
                resourceType: 'product',
                resourceId: product.id,
              };
            }

            // Run full activation validation
            await validateProductActivation(tx, { productId: id, companyId: auth.companyId });

            const updated = await tx.product.update({
              where: { id },
              data: { isActive: true, updatedAt: new Date() },
            });

            await tx.auditLog.create({
              data: {
                companyId: auth.companyId,
                userId: auth.userId,
                correlationId,
                action: 'product.activate',
                entityType: 'product',
                entityId: id,
                beforeValue: JSON.stringify({ is_active: false }),
                afterValue: JSON.stringify({ is_active: true }),
              },
            });

            return {
              status: 200,
              body: { id: updated.id, code: updated.code, status: 'active' },
              resourceType: 'product',
              resourceId: updated.id,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
