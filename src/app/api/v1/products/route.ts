// src/app/api/v1/products/route.ts
// GET  /api/v1/products         — list products (cursor pagination, search)
// POST /api/v1/products         — create a product (idempotency-protected)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { audit } from '@/lib/audit';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const ProductCreateSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(60),
  category_id: z.string().uuid(),
  brand_id: z.string().uuid().optional(),
  unit_id: z.string().uuid(),
  product_type: z.enum(['standard', 'combo', 'service', 'digital']).default('standard'),
  is_serialized: z.boolean().default(false),
  track_batches: z.boolean().default(false),
  warranty_period_months: z.number().int().min(0).max(600).optional(),
  reference_cost: z.number().min(0).default(0),
  default_price: z.number().min(0).default(0),
  default_tax_code_id: z.string().uuid().optional(),
  alert_quantity: z.number().min(0).default(0),
  short_description: z.string().max(500).optional(),
  description: z.string().optional(),
  is_featured: z.boolean().default(false),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'product.create');
  await requirePermission(auth, 'product.read');
    const url = req.nextUrl;
    const search = url.searchParams.get('search') ?? undefined;
    const productType = url.searchParams.get('product_type') ?? undefined;
    const categoryId = url.searchParams.get('category_id') ?? undefined;
    const isActive = url.searchParams.get('is_active');
    const cursor = url.searchParams.get('cursor') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);

    const where: Record<string, unknown> = {
      companyId: auth.companyId,
      deletedAt: null,
    };
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { code: { contains: search } },
      ];
    }
    if (productType) where.productType = productType;
    if (categoryId) where.categoryId = categoryId;
    if (isActive === 'true') where.isActive = true;
    if (isActive === 'false') where.isActive = false;
    if (cursor) where.id = { gt: cursor };

    const products = await db.product.findMany({
      where,
      take: limit + 1,
      orderBy: { id: 'asc' },
      include: {
        category: { select: { id: true, name: true, code: true } },
        brand: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
      },
    });

    const hasMore = products.length > limit;
    const items = hasMore ? products.slice(0, limit) : products;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return NextResponse.json({
      items: items.map(p => ({
        id: p.id,
        name: p.name,
        code: p.code,
        product_type: p.productType,
        is_serialized: p.isSerialized,
        track_batches: p.trackBatches,
        is_active: p.isActive,
        is_featured: p.isFeatured,
        reference_cost: p.referenceCost.toString(),
        default_price: p.defaultPrice.toString(),
        alert_quantity: p.alertQuantity.toString(),
        warranty_period_months: p.warrantyPeriodMonths,
        category: p.category,
        brand: p.brand,
        unit: p.unit,
      })),
      next_cursor: nextCursor,
      has_more: hasMore,
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
    const body = ProductCreateSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/products', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'product.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // Validate code uniqueness
            const existing = await tx.product.findFirst({
              where: { companyId: auth.companyId, code: body.code, deletedAt: null },
            });
            if (existing) {
              throw new DomainError('VALIDATION_FAILED', `Product code "${body.code}" already exists`, {}, 409);
            }

            // Validate category/brand/unit exist + belong to this company
            const category = await tx.category.findFirst({
              where: { id: body.category_id, companyId: auth.companyId, deletedAt: null, isActive: true },
            });
            if (!category) throw new DomainError('VALIDATION_FAILED', 'Category not found or inactive', {}, 400);

            if (body.brand_id) {
              const brand = await tx.brand.findFirst({
                where: { id: body.brand_id, companyId: auth.companyId, deletedAt: null, isActive: true },
              });
              if (!brand) throw new DomainError('VALIDATION_FAILED', 'Brand not found or inactive', {}, 400);
            }

            const unit = await tx.unit.findFirst({
              where: { id: body.unit_id, companyId: auth.companyId },
            });
            if (!unit) throw new DomainError('VALIDATION_FAILED', 'Unit not found', {}, 400);

            // Serialized → non-fractional unit
            if (body.is_serialized && unit.allowFractional) {
              throw new DomainError('VALIDATION_FAILED', 'Serialized products require a non-fractional unit', {}, 400);
            }

            // Service/digital → no serialization/batches
            if ((body.product_type === 'service' || body.product_type === 'digital')) {
              if (body.is_serialized) throw new DomainError('VALIDATION_FAILED', `${body.product_type} products cannot be serialized`, {}, 400);
              if (body.track_batches) throw new DomainError('VALIDATION_FAILED', `${body.product_type} products cannot track batches`, {}, 400);
            }

            const product = await tx.product.create({
              data: {
                companyId: auth.companyId,
                name: body.name,
                code: body.code,
                categoryId: body.category_id,
                brandId: body.brand_id ?? null,
                unitId: body.unit_id,
                productType: body.product_type,
                isSerialized: body.is_serialized,
                trackBatches: body.track_batches,
                warrantyPeriodMonths: body.warranty_period_months ?? null,
                referenceCost: body.reference_cost,
                defaultPrice: body.default_price,
                defaultTaxCodeId: body.default_tax_code_id ?? null,
                alertQuantity: body.alert_quantity,
                shortDescription: body.short_description ?? null,
                description: body.description ?? null,
                isFeatured: body.is_featured,
                isActive: false, // created inactive — must be activated via /activate
              },
            });

            // Audit
            await tx.auditLog.create({
              data: {
                companyId: auth.companyId,
                userId: auth.userId,
                correlationId,
                action: 'product.create',
                entityType: 'product',
                entityId: product.id,
                beforeValue: null,
                afterValue: JSON.stringify({ code: product.code, name: product.name }),
              },
            });

            return {
              status: 201,
              body: {
                id: product.id,
                code: product.code,
                name: product.name,
                status: 'inactive',
                next_step: 'Add unit options + barcode, then POST /api/v1/products/{id}/activate',
              },
              resourceType: 'product',
              resourceId: product.id,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid product payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
