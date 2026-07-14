// src/app/api/v1/tax-components/route.ts
// GET  /api/v1/tax-components  — list tax components
// POST /api/v1/tax-components  — create a tax component (VAT/SD/RD/ATV/OTHER)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const TaxComponentCreateSchema = z.object({
  component_code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  component_type: z.enum(['VAT', 'SD', 'RD', 'ATV', 'OTHER']).default('VAT'),
  rate: z.number().min(0).max(100),
  calculation_order: z.number().int().min(1).default(1),
  compound_on_previous: z.boolean().default(false),
  effective_from: z.string().datetime().or(z.string().date()),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'tax.manage');
  await requirePermission(auth, 'product.read');
    const components = await db.taxComponent.findMany({
      where: { companyId: auth.companyId },
      orderBy: [{ componentType: 'asc' }, { calculationOrder: 'asc' }],
    });
    return NextResponse.json({
      items: components.map(c => ({
        id: c.id,
        component_code: c.componentCode,
        name: c.name,
        component_type: c.componentType,
        rate: c.rate.toString(),
        calculation_order: c.calculationOrder,
        compound_on_previous: c.compoundOnPrevious,
        effective_from: c.effectiveFrom,
        effective_to: c.effectiveTo,
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
    const body = TaxComponentCreateSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/tax-components', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'tax_component.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const existing = await tx.taxComponent.findFirst({
              where: { companyId: auth.companyId, componentCode: body.component_code },
            });
            if (existing) throw new DomainError('VALIDATION_FAILED', `Tax component "${body.component_code}" already exists`, {}, 409);

            const component = await tx.taxComponent.create({
              data: {
                companyId: auth.companyId,
                componentCode: body.component_code,
                name: body.name,
                componentType: body.component_type,
                rate: body.rate,
                calculationOrder: body.calculation_order,
                compoundOnPrevious: body.compound_on_previous,
                effectiveFrom: new Date(body.effective_from),
              },
            });

            await tx.auditLog.create({
              data: {
                companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'tax_component.create', entityType: 'tax_component', entityId: component.id,
                afterValue: JSON.stringify({ code: component.componentCode, type: component.componentType, rate: component.rate.toString() }),
              },
            });

            return {
              status: 201,
              body: { id: component.id, component_code: component.componentCode },
              resourceType: 'tax_component',
              resourceId: component.id,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid tax component payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
