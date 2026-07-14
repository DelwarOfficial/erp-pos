// src/app/api/v1/tax-codes/route.ts
// GET  /api/v1/tax-codes  — list tax codes
// POST /api/v1/tax-codes  — create a tax code with components

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const TaxCodeCreateSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  price_includes_tax: z.boolean().default(false),
  effective_from: z.string().datetime().or(z.string().date()),
  component_ids: z.array(z.string().uuid()).default([]),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'tax.manage');
  await requirePermission(auth, 'product.read');
    const taxCodes = await db.taxCode.findMany({
      where: { companyId: auth.companyId },
      include: {
        components: { include: { taxComponent: true } },
      },
      orderBy: { code: 'asc' },
    });
    return NextResponse.json({
      items: taxCodes.map(tc => ({
        id: tc.id,
        code: tc.code,
        name: tc.name,
        price_includes_tax: tc.priceIncludesTax,
        effective_from: tc.effectiveFrom,
        effective_to: tc.effectiveTo,
        is_active: tc.isActive,
        components: tc.components.map(c => ({
          id: c.taxComponent.id,
          component_code: c.taxComponent.componentCode,
          name: c.taxComponent.name,
          component_type: c.taxComponent.componentType,
          rate: c.taxComponent.rate.toString(),
          calculation_order: c.taxComponent.calculationOrder,
          compound_on_previous: c.taxComponent.compoundOnPrevious,
        })),
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
    const body = TaxCodeCreateSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/tax-codes', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'tax_code.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const existing = await tx.taxCode.findFirst({
              where: { companyId: auth.companyId, code: body.code },
            });
            if (existing) throw new DomainError('VALIDATION_FAILED', `Tax code "${body.code}" already exists`, {}, 409);

            // Validate all component_ids belong to this company
            if (body.component_ids.length > 0) {
              const components = await tx.taxComponent.findMany({
                where: { id: { in: body.component_ids }, companyId: auth.companyId },
              });
              if (components.length !== body.component_ids.length) {
                throw new DomainError('VALIDATION_FAILED', 'One or more tax components not found in this company', {}, 400);
              }
            }

            const effectiveFrom = new Date(body.effective_from);
            const taxCode = await tx.taxCode.create({
              data: {
                companyId: auth.companyId,
                code: body.code,
                name: body.name,
                priceIncludesTax: body.price_includes_tax,
                effectiveFrom,
                isActive: true,
              },
            });

            // Link components
            for (const componentId of body.component_ids) {
              await tx.taxCodeComponent.create({
                data: { taxCodeId: taxCode.id, taxComponentId: componentId },
              });
            }

            await tx.auditLog.create({
              data: {
                companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'tax_code.create', entityType: 'tax_code', entityId: taxCode.id,
                afterValue: JSON.stringify({ code: taxCode.code, name: taxCode.name, component_count: body.component_ids.length }),
              },
            });

            return {
              status: 201,
              body: { id: taxCode.id, code: taxCode.code, name: taxCode.name, component_count: body.component_ids.length },
              resourceType: 'tax_code',
              resourceId: taxCode.id,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid tax code payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
