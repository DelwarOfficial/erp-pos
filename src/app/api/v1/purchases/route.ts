// GET  /api/v1/purchases        — list purchases
// POST /api/v1/purchases        — create a purchase order

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { nextDocumentNumber } from '@/lib/numbering';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const PurchaseItemSchema = z.object({
  product_id: z.string().uuid(),
  qty_ordered: z.number().positive(),
  unit_cost: z.number().min(0),
  discount_amount: z.number().min(0).default(0),
  tax_amount: z.number().min(0).default(0),
});

const PurchaseCreateSchema = z.object({
  branch_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  supplier_id: z.string().uuid(),
  supplier_invoice_no: z.string().max(100).optional(),
  currency_code: z.string().length(3).default('BDT'),
  exchange_rate: z.number().positive().default(1),
  order_date: z.string().datetime(),
  expected_date: z.string().datetime().optional(),
  notes: z.string().optional(),
  items: z.array(PurchaseItemSchema).min(1),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'purchase.create');
  await requirePermission(auth, 'inventory.read');
    const url = req.nextUrl;
    const status = url.searchParams.get('status') ?? undefined;
    const supplierId = url.searchParams.get('supplier_id') ?? undefined;
    // Default to last 30 days unless explicitly bypassed.
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    const applyDateFilter = url.searchParams.get('all_dates') !== 'true';
    const from = fromParam ? new Date(fromParam) : (applyDateFilter ? thirtyDaysAgo : undefined);
    const to = toParam ? new Date(toParam) : undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.orderStatus = status;
    if (supplierId) where.supplierId = supplierId;
    if (from || to) {
      where.orderDate = {};
      if (from) (where.orderDate as Record<string, unknown>).gte = from;
      if (to) (where.orderDate as Record<string, unknown>).lte = to;
    }

    // `select` keeps the payload small; `_count` avoids N+1 on items/receivings.
    const purchases = await db.purchase.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        referenceNo: true,
        orderStatus: true,
        invoiceStatus: true,
        currencyCode: true,
        exchangeRate: true,
        orderDate: true,
        grandTotal: true,
        baseGrandTotal: true,
        createdAt: true,
        supplier: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true, code: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        _count: { select: { items: true, receivings: true } },
      },
    });

    return NextResponse.json({
      items: purchases.map(p => ({
        id: p.id,
        reference_no: p.referenceNo,
        supplier: p.supplier,
        branch: p.branch,
        warehouse: p.warehouse,
        order_status: p.orderStatus,
        invoice_status: p.invoiceStatus,
        currency_code: p.currencyCode,
        exchange_rate: p.exchangeRate.toString(),
        order_date: p.orderDate,
        grand_total: p.grandTotal.toString(),
        base_grand_total: p.baseGrandTotal.toString(),
        item_count: p._count.items,
        receiving_count: p._count.receivings,
        created_at: p.createdAt,
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
    const body = PurchaseCreateSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/purchases', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'purchase.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // Validate supplier + branch + warehouse belong to this company
            const supplier = await tx.supplier.findFirst({
              where: { id: body.supplier_id, companyId: auth.companyId, deletedAt: null },
            });
            if (!supplier) throw new DomainError('VALIDATION_FAILED', 'Supplier not found', {}, 404);

            const branch = await tx.branch.findFirst({
              where: { id: body.branch_id, companyId: auth.companyId },
            });
            if (!branch) throw new DomainError('VALIDATION_FAILED', 'Branch not found', {}, 404);

            const warehouse = await tx.warehouse.findFirst({
              where: { id: body.warehouse_id, companyId: auth.companyId, branchId: body.branch_id },
            });
            if (!warehouse) throw new DomainError('VALIDATION_FAILED', 'Warehouse not found or not in this branch', {}, 404);

            // Generate reference number
            const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
              companyId: auth.companyId,
              branchId: body.branch_id,
              documentType: 'PURCHASE',
              fiscalYear: new Date(body.order_date).getFullYear(),
              prefix: 'PO-',
            });

            // Compute totals
            let subtotal = 0;
            let discountTotal = 0;
            let taxTotal = 0;
            for (const item of body.items) {
              const lineTotal = item.qty_ordered * item.unit_cost - item.discount_amount + item.tax_amount;
              subtotal += item.qty_ordered * item.unit_cost;
              discountTotal += item.discount_amount;
              taxTotal += item.tax_amount;
            }
            const grandTotal = subtotal - discountTotal + taxTotal;
            const baseGrandTotal = grandTotal * body.exchange_rate;

            const purchase = await tx.purchase.create({
              data: {
                companyId: auth.companyId,
                branchId: body.branch_id,
                warehouseId: body.warehouse_id,
                referenceNo,
                supplierInvoiceNo: body.supplier_invoice_no ?? null,
                supplierId: body.supplier_id,
                orderStatus: 'ordered',
                currencyCode: body.currency_code,
                exchangeRate: body.exchange_rate,
                orderDate: new Date(body.order_date),
                expectedDate: body.expected_date ? new Date(body.expected_date) : null,
                subtotal,
                discountTotal,
                taxTotal,
                grandTotal,
                baseGrandTotal,
                notes: body.notes ?? null,
                createdBy: auth.userId,
              },
            });

            // Create items
            let lineNo = 1;
            for (const item of body.items) {
              const product = await tx.product.findFirst({
                where: { id: item.product_id, companyId: auth.companyId, deletedAt: null },
              });
              if (!product) throw new DomainError('VALIDATION_FAILED', `Product ${item.product_id} not found`, {}, 404);

              const lineTotal = item.qty_ordered * item.unit_cost - item.discount_amount + item.tax_amount;
              await tx.purchaseItem.create({
                data: {
                  companyId: auth.companyId,
                  purchaseId: purchase.id,
                  lineNo,
                  productId: item.product_id,
                  productNameSnapshot: product.name,
                  productCodeSnapshot: product.code,
                  qtyOrdered: item.qty_ordered,
                  unitCost: item.unit_cost,
                  discountAmount: item.discount_amount,
                  taxAmount: item.tax_amount,
                  lineTotal,
                },
              });
              lineNo++;
            }

            await tx.auditLog.create({
              data: {
                companyId: auth.companyId,
                userId: auth.userId,
                correlationId,
                action: 'purchase.create',
                entityType: 'purchase',
                entityId: purchase.id,
                afterValue: JSON.stringify({ reference_no: referenceNo, supplier: supplier.name, item_count: body.items.length, grand_total: grandTotal }),
              },
            });

            return {
              status: 201,
              body: {
                id: purchase.id,
                reference_no: referenceNo,
                order_status: 'ordered',
                grand_total: grandTotal.toString(),
                base_grand_total: baseGrandTotal.toString(),
                item_count: body.items.length,
              },
              resourceType: 'purchase',
              resourceId: purchase.id,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid purchase payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
