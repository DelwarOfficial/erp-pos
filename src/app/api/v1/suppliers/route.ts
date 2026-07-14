// GET  /api/v1/suppliers  — list suppliers
// POST /api/v1/suppliers  — create a supplier

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const SupplierSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(150).optional(),
  address: z.string().optional(),
  tax_identifier: z.string().max(50).optional(),
  currency_code: z.string().length(3).default('BDT'),
  payment_terms_days: z.number().int().min(0).default(0),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'user.create');
  await requirePermission(auth, 'product.read');
    const search = req.nextUrl.searchParams.get('search') ?? undefined;
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '100', 10), 500);

    const where: Record<string, unknown> = { companyId: auth.companyId, deletedAt: null };
    if (search) {
      where.OR = [{ name: { contains: search } }, { phone: { contains: search } }, { email: { contains: search } }];
    }

    const suppliers = await db.supplier.findMany({
      where, take: limit, orderBy: { name: 'asc' },
    });
    return NextResponse.json({
      items: suppliers.map(s => ({
        id: s.id, name: s.name, phone: s.phone, email: s.email,
        tax_identifier: s.taxIdentifier, currency_code: s.currencyCode,
        payment_terms_days: s.paymentTermsDays, is_active: s.isActive,
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
    const body = SupplierSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/suppliers', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'supplier.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const supplier = await tx.supplier.create({
              data: {
                companyId: auth.companyId,
                name: body.name,
                phone: body.phone ?? null,
                email: body.email ?? null,
                address: body.address ?? null,
                taxIdentifier: body.tax_identifier ?? null,
                currencyCode: body.currency_code,
                paymentTermsDays: body.payment_terms_days,
              },
            });
            await tx.auditLog.create({
              data: {
                companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'supplier.create', entityType: 'supplier', entityId: supplier.id,
                afterValue: JSON.stringify({ name: supplier.name, currency: supplier.currencyCode }),
              },
            });
            return {
              status: 201,
              body: { id: supplier.id, name: supplier.name },
              resourceType: 'supplier', resourceId: supplier.id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid supplier payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
