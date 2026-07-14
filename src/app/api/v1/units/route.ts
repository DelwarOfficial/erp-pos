// src/app/api/v1/units/route.ts
// GET  /api/v1/units  — list units
// POST /api/v1/units  — create a unit (base or derived)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { validateUnitConversion } from '@/domain/invariants/productActivation';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const UnitCreateSchema = z.object({
  name: z.string().min(1).max(80),
  code: z.string().min(1).max(20),
  base_unit_id: z.string().uuid().optional(),
  conversion_factor: z.number().positive().default(1),
  allow_fractional: z.boolean().default(false),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'category.manage');
  await requirePermission(auth, 'product.read');
    const units = await db.unit.findMany({
      where: { companyId: auth.companyId },
      include: { baseUnit: { select: { id: true, name: true, code: true } } },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({
      items: units.map(u => ({
        id: u.id,
        name: u.name,
        code: u.code,
        allow_fractional: u.allowFractional,
        conversion_factor: u.conversionFactor.toString(),
        base_unit: u.baseUnit,
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
    const body = UnitCreateSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/units', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'unit.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const existing = await tx.unit.findFirst({
              where: { companyId: auth.companyId, code: body.code },
            });
            if (existing) throw new DomainError('VALIDATION_FAILED', `Unit code "${body.code}" already exists`, {}, 409);

            // Validate conversion + cycle detection
            await validateUnitConversion(tx, {
              companyId: auth.companyId,
              unitId: 'pending', // not yet created
              baseUnitId: body.base_unit_id ?? null,
              conversionFactor: body.conversion_factor,
            });

            const unit = await tx.unit.create({
              data: {
                companyId: auth.companyId,
                name: body.name,
                code: body.code,
                baseUnitId: body.base_unit_id ?? null,
                conversionFactor: body.conversion_factor,
                allowFractional: body.allow_fractional,
              },
            });

            await tx.auditLog.create({
              data: {
                companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'unit.create', entityType: 'unit', entityId: unit.id,
                afterValue: JSON.stringify({ code: unit.code, name: unit.name }),
              },
            });

            return {
              status: 201,
              body: { id: unit.id, code: unit.code, name: unit.name },
              resourceType: 'unit',
              resourceId: unit.id,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid unit payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
