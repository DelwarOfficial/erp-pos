// src/app/api/v1/brands/route.ts
// GET  /api/v1/brands  — list brands
// POST /api/v1/brands  — create a brand

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const BrandCreateSchema = z.object({ name: z.string().min(1).max(120) });

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'category.manage');
  await requirePermission(auth, 'product.read');
    const brands = await db.brand.findMany({
      where: { companyId: auth.companyId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({
      items: brands.map(b => ({ id: b.id, name: b.name, is_active: b.isActive })),
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const idempotencyKey = requireIdempotencyKey(req);
    const body = BrandCreateSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/brands', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'brand.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const existing = await tx.brand.findFirst({
              where: { companyId: auth.companyId, name: body.name, deletedAt: null },
            });
            if (existing) throw new DomainError('VALIDATION_FAILED', `Brand "${body.name}" already exists`, {}, 409);

            const brand = await tx.brand.create({
              data: { companyId: auth.companyId, name: body.name, isActive: true },
            });

            await tx.auditLog.create({
              data: {
                companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'brand.create', entityType: 'brand', entityId: brand.id,
                afterValue: JSON.stringify({ name: brand.name }),
              },
            });

            return {
              status: 201,
              body: { id: brand.id, name: brand.name },
              resourceType: 'brand',
              resourceId: brand.id,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid brand payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
