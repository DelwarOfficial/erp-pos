// GET  /api/v1/customers  — list customers
// POST /api/v1/customers  — create a customer

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const CustomerSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(150).optional(),
  address: z.string().optional(),
  tax_identifier: z.string().max(50).optional(),
  customer_group_id: z.string().uuid().optional(),
  credit_limit: z.number().min(0).default(0),
  preferred_branch_id: z.string().uuid().optional(),
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
      where.OR = [
        { name: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
      ];
    }

    const customers = await db.customer.findMany({
      where,
      take: limit,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        taxIdentifier: true,
        creditLimit: true,
        isActive: true,
        customerGroup: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      items: customers.map(c => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        tax_identifier: c.taxIdentifier,
        credit_limit: c.creditLimit.toString(),
        customer_group: c.customerGroup,
        is_active: c.isActive,
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
    const body = CustomerSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/customers', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'customer.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const customer = await tx.customer.create({
              data: {
                companyId: auth.companyId,
                name: body.name,
                phone: body.phone ?? null,
                email: body.email ?? null,
                address: body.address ?? null,
                taxIdentifier: body.tax_identifier ?? null,
                customerGroupId: body.customer_group_id ?? null,
                creditLimit: body.credit_limit,
                preferredBranchId: body.preferred_branch_id ?? null,
              },
            });
            await tx.auditLog.create({
              data: {
                companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'customer.create', entityType: 'customer', entityId: customer.id,
                afterValue: JSON.stringify({ name: customer.name }),
              },
            });
            return {
              status: 201,
              body: { id: customer.id, name: customer.name },
              resourceType: 'customer', resourceId: customer.id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid customer payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
