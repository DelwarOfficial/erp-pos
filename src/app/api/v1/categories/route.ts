// src/app/api/v1/categories/route.ts
// GET  /api/v1/categories  — list categories (hierarchical)
// POST /api/v1/categories  — create a category

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const CategoryCreateSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(40),
  parent_id: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'category.manage');
  await requirePermission(auth, 'product.read');
    const categories = await db.category.findMany({
      where: { companyId: auth.companyId, deletedAt: null },
      include: { parent: { select: { id: true, name: true, code: true } } },
      orderBy: [{ name: 'asc' }],
    });
    return NextResponse.json({
      items: categories.map(c => ({
        id: c.id,
        name: c.name,
        code: c.code,
        is_active: c.isActive,
        parent: c.parent,
      })),
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
    const body = CategoryCreateSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/categories', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'category.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // Validate code uniqueness
            const existing = await tx.category.findFirst({
              where: { companyId: auth.companyId, code: body.code, deletedAt: null },
            });
            if (existing) throw new DomainError('VALIDATION_FAILED', `Category code "${body.code}" already exists`, {}, 409);

            // Validate parent (if provided)
            if (body.parent_id) {
              const parent = await tx.category.findFirst({
                where: { id: body.parent_id, companyId: auth.companyId, deletedAt: null },
              });
              if (!parent) throw new DomainError('VALIDATION_FAILED', 'Parent category not found', {}, 400);
            }

            const category = await tx.category.create({
              data: {
                companyId: auth.companyId,
                name: body.name,
                code: body.code,
                parentId: body.parent_id ?? null,
                isActive: true,
              },
            });

            await tx.auditLog.create({
              data: {
                companyId: auth.companyId,
                userId: auth.userId,
                correlationId,
                action: 'category.create',
                entityType: 'category',
                entityId: category.id,
                afterValue: JSON.stringify({ code: category.code, name: category.name }),
              },
            });

            return {
              status: 201,
              body: { id: category.id, code: category.code, name: category.name },
              resourceType: 'category',
              resourceId: category.id,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid category payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
