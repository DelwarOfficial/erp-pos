// GET    /api/v1/products/{id}  — single product with category, brand, unit,
//                                  barcodes, prices, unit options
// PUT    /api/v1/products/{id}  — update product master data
// DELETE /api/v1/products/{id}  — soft-delete (set deletedAt + isActive=false)
//
// DELETE is rejected if the product has stock on hand or is referenced by
// open sales/purchases — those documents must be closed/returned first so
// the catalogue remains auditable. Soft-deleted products are excluded from
// the default list view (which filters `deletedAt: null`) but historical
// documents retain their `productNameSnapshot` / `productCodeSnapshot`.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import {
  withIdempotency,
  computeRequestHash,
  requireIdempotencyKey,
} from '@/lib/idempotency';
import { audit } from '@/lib/audit';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

// Partial-update schema — every field is optional. Only master-data fields
// are mutable here. Code/category/unit are immutable after creation
// (changing them would invalidate historical snapshots). Activation is
// gated behind the dedicated `/activate` subroute.
const ProductUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).nullable().optional(),
  short_description: z.string().max(500).nullable().optional(),
  alert_quantity: z.number().min(0).optional(),
  reference_cost: z.number().min(0).optional(),
  default_price: z.number().min(0).optional(),
  default_tax_code_id: z.string().uuid().nullable().optional(),
  warranty_period_months: z.number().int().min(0).max(600).nullable().optional(),
  is_featured: z.boolean().optional(),
});

// Sales/purchase statuses that block product soft-delete. A product linked
// to one of these open documents must not be archived — the operator should
// complete or cancel the document first.
const OPEN_SALE_STATUSES = new Set(['draft', 'held', 'completed']);
const OPEN_PURCHASE_STATUSES = new Set(['draft', 'ordered']);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'product.read');
    const { id } = await params;

    // findFirst (not findUnique) so RLS-equivalent filter applies. We do
    // NOT exclude soft-deleted rows here — the caller may legitimately need
    // to view a soft-deleted product's details (e.g. from a historical
    // sale's product snapshot link).
    const product = await db.product.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        category: { select: { id: true, name: true, code: true } },
        brand: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true, allowFractional: true } },
        defaultTaxCode: { select: { id: true, code: true, name: true } },
        barcodes: {
          select: {
            id: true,
            code: true,
            symbology: true,
            isPrimary: true,
            packageQuantity: true,
            unitId: true,
          },
          orderBy: { isPrimary: 'desc' },
        },
        unitOptions: {
          include: {
            unit: { select: { id: true, name: true, code: true } },
          },
        },
        prices: {
          include: {
            branch: { select: { id: true, name: true, code: true } },
            customerGroup: { select: { id: true, name: true } },
            currency: { select: { code: true, symbol: true } },
          },
          orderBy: { priority: 'desc' },
        },
      },
    });

    if (!product) {
      throw new DomainError(
        'RESOURCE_NOT_FOUND',
        'Product not found',
        { product_id: id },
        404,
      );
    }

    return NextResponse.json({
      id: product.id,
      name: product.name,
      code: product.code,
      product_type: product.productType,
      is_serialized: product.isSerialized,
      track_batches: product.trackBatches,
      warranty_period_months: product.warrantyPeriodMonths,
      reference_cost: product.referenceCost.toString(),
      default_price: product.defaultPrice.toString(),
      default_tax_code_id: product.defaultTaxCodeId,
      default_tax_code: product.defaultTaxCode,
      alert_quantity: product.alertQuantity.toString(),
      short_description: product.shortDescription,
      description: product.description,
      is_featured: product.isFeatured,
      is_active: product.isActive,
      deleted_at: product.deletedAt,
      created_at: product.createdAt,
      updated_at: product.updatedAt,
      category: product.category,
      brand: product.brand,
      unit: product.unit,
      barcodes: product.barcodes.map((b) => ({
        id: b.id,
        code: b.code,
        symbology: b.symbology,
        is_primary: b.isPrimary,
        package_quantity: b.packageQuantity.toString(),
        unit_id: b.unitId,
      })),
      unit_options: product.unitOptions.map((u) => ({
        unit_id: u.unitId,
        unit: u.unit,
        conversion_to_stock_unit: u.conversionToStockUnit.toString(),
        can_purchase: u.canPurchase,
        can_sell: u.canSell,
        is_default_purchase: u.isDefaultPurchase,
        is_default_sale: u.isDefaultSale,
      })),
      prices: product.prices.map((p) => ({
        id: p.id,
        branch: p.branch,
        customer_group: p.customerGroup,
        currency: p.currency,
        price: p.price.toString(),
        valid_from: p.validFrom,
        valid_to: p.validTo,
        priority: p.priority,
      })),
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'product.update');
    const { id } = await params;

    const idempotencyKey = requireIdempotencyKey(req);
    const body = ProductUpdateSchema.parse(await req.json());
    const requestHash = computeRequestHash({
      method: 'PUT',
      path: `/api/v1/products/${id}`,
      body,
    });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        {
          idempotencyKey,
          operation: 'product.update',
          requestHash,
          companyId: auth.companyId,
          userId: auth.userId,
        },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // 1. Fetch — RLS-scoped. Reject soft-deleted products from edits
            //    (a soft-deleted product must be restored first).
            const existing = await tx.product.findFirst({
              where: { id, companyId: auth.companyId, deletedAt: null },
            });
            if (!existing) {
              throw new DomainError(
                'RESOURCE_NOT_FOUND',
                'Product not found',
                { product_id: id },
                404,
              );
            }

            // 2. If default_tax_code_id is being changed, validate it.
            if (
              body.default_tax_code_id !== undefined &&
              body.default_tax_code_id !== null
            ) {
              const tc = await tx.taxCode.findFirst({
                where: {
                  id: body.default_tax_code_id,
                  companyId: auth.companyId,
                  isActive: true,
                },
              });
              if (!tc) {
                throw new DomainError(
                  'VALIDATION_FAILED',
                  'Tax code not found or inactive',
                  { tax_code_id: body.default_tax_code_id },
                  400,
                );
              }
            }

            // 3. Build the update payload — only fields that were supplied.
            //    Prisma would skip `undefined` keys anyway, but explicit
            //    handling avoids accidentally nulling a column.
            const updateData: Record<string, unknown> = {};
            if (body.name !== undefined) updateData.name = body.name;
            if (body.description !== undefined)
              updateData.description = body.description;
            if (body.short_description !== undefined)
              updateData.shortDescription = body.short_description;
            if (body.alert_quantity !== undefined)
              updateData.alertQuantity = body.alert_quantity;
            if (body.reference_cost !== undefined)
              updateData.referenceCost = body.reference_cost;
            if (body.default_price !== undefined)
              updateData.defaultPrice = body.default_price;
            if (body.default_tax_code_id !== undefined)
              updateData.defaultTaxCodeId = body.default_tax_code_id;
            if (body.warranty_period_months !== undefined)
              updateData.warrantyPeriodMonths = body.warranty_period_months;
            if (body.is_featured !== undefined)
              updateData.isFeatured = body.is_featured;

            // 4. Apply.
            const updated = await tx.product.update({
              where: { id: existing.id },
              data: updateData,
            });

            // 5. Audit.
            await audit({
              action: 'product.update',
              entityType: 'product',
              entityId: updated.id,
              beforeValue: {
                name: existing.name,
                description: existing.description,
                short_description: existing.shortDescription,
                alert_quantity: existing.alertQuantity.toString(),
                reference_cost: existing.referenceCost.toString(),
                default_price: existing.defaultPrice.toString(),
                default_tax_code_id: existing.defaultTaxCodeId,
                warranty_period_months: existing.warrantyPeriodMonths,
                is_featured: existing.isFeatured,
              },
              afterValue: {
                name: updated.name,
                description: updated.description,
                short_description: updated.shortDescription,
                alert_quantity: updated.alertQuantity.toString(),
                reference_cost: updated.referenceCost.toString(),
                default_price: updated.defaultPrice.toString(),
                default_tax_code_id: updated.defaultTaxCodeId,
                warranty_period_months: updated.warrantyPeriodMonths,
                is_featured: updated.isFeatured,
              },
            });

            return {
              status: 200,
              body: {
                id: updated.id,
                code: updated.code,
                name: updated.name,
                reference_cost: updated.referenceCost.toString(),
                default_price: updated.defaultPrice.toString(),
                alert_quantity: updated.alertQuantity.toString(),
                is_featured: updated.isFeatured,
                is_active: updated.isActive,
                updated_at: updated.updatedAt,
              },
              resourceType: 'product',
              resourceId: updated.id,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(
        new DomainError(
          'VALIDATION_FAILED',
          'Invalid product update payload',
          { issues: e.issues },
          400,
        ),
        correlationId,
      );
    }
    return errorResponse(e, correlationId);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    // `product.archive.company` is the closest catalogue match for an
    // archive/soft-delete capability. Fall back to `product.update` for
    // branches that have not been granted the archive permission yet.
    try {
      await requirePermission(auth, 'product.archive.company');
    } catch {
      await requirePermission(auth, 'product.update');
    }
    const { id } = await params;

    const idempotencyKey = requireIdempotencyKey(req);
    // DELETE has no body — hash only method+path so retries are safe.
    const requestHash = computeRequestHash({
      method: 'DELETE',
      path: `/api/v1/products/${id}`,
      body: null,
    });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        {
          idempotencyKey,
          operation: 'product.archive',
          requestHash,
          companyId: auth.companyId,
          userId: auth.userId,
        },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // 1. Fetch — RLS-scoped. Already-deleted products return 404
            //    so the operation is idempotent-ish from the client POV.
            const existing = await tx.product.findFirst({
              where: { id, companyId: auth.companyId, deletedAt: null },
            });
            if (!existing) {
              throw new DomainError(
                'RESOURCE_NOT_FOUND',
                'Product not found or already archived',
                { product_id: id },
                404,
              );
            }

            // 2. Stock guard — any non-zero qty_on_hand blocks the archive.
            //    The operator should first transfer / write off the stock.
            const stockRows = await tx.warehouseStock.findFirst({
              where: {
                productId: existing.id,
                companyId: auth.companyId,
                qtyOnHand: { gt: 0 },
              },
              select: { id: true, qtyOnHand: true, warehouseId: true },
            });
            if (stockRows) {
              throw new DomainError(
                'VALIDATION_FAILED',
                'Cannot archive a product with stock on hand — transfer or write off inventory first',
                {
                  product_id: existing.id,
                  warehouse_id: stockRows.warehouseId,
                  qty_on_hand: stockRows.qtyOnHand.toString(),
                },
                409,
              );
            }

            // 3. Open-sales guard — any sale in draft/held/completed status
            //    referencing this product blocks the archive.
            const openSaleItem = await tx.saleItem.findFirst({
              where: {
                productId: existing.id,
                companyId: auth.companyId,
                sale: {
                  companyId: auth.companyId,
                  saleStatus: { in: Array.from(OPEN_SALE_STATUSES) },
                },
              },
              select: { id: true, saleId: true },
            });
            if (openSaleItem) {
              throw new DomainError(
                'VALIDATION_FAILED',
                'Cannot archive a product referenced by open sales — complete or void those sales first',
                {
                  product_id: existing.id,
                  sale_id: openSaleItem.saleId,
                },
                409,
              );
            }

            // 4. Open-purchases guard.
            const openPurchaseItem = await tx.purchaseItem.findFirst({
              where: {
                productId: existing.id,
                companyId: auth.companyId,
                purchase: {
                  companyId: auth.companyId,
                  orderStatus: { in: Array.from(OPEN_PURCHASE_STATUSES) },
                },
              },
              select: { id: true, purchaseId: true },
            });
            if (openPurchaseItem) {
              throw new DomainError(
                'VALIDATION_FAILED',
                'Cannot archive a product referenced by open purchases — receive or cancel those purchases first',
                {
                  product_id: existing.id,
                  purchase_id: openPurchaseItem.purchaseId,
                },
                409,
              );
            }

            // 5. Soft-delete — set deletedAt + isActive=false. Historical
            //    documents retain their snapshot columns; the product row
            //    is excluded from default list views.
            const archived = await tx.product.update({
              where: { id: existing.id },
              data: {
                deletedAt: new Date(),
                isActive: false,
              },
            });

            // 6. Audit.
            await audit({
              action: 'product.archive',
              entityType: 'product',
              entityId: archived.id,
              beforeValue: {
                name: existing.name,
                code: existing.code,
                is_active: existing.isActive,
                deleted_at: existing.deletedAt,
              },
              afterValue: {
                name: archived.name,
                code: archived.code,
                is_active: archived.isActive,
                deleted_at: archived.deletedAt,
              },
            });

            return {
              status: 200,
              body: {
                id: archived.id,
                code: archived.code,
                name: archived.name,
                is_active: archived.isActive,
                deleted_at: archived.deletedAt,
                archived: true,
              },
              resourceType: 'product',
              resourceId: archived.id,
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
