// GET  /api/v1/purchases        — list purchases
// POST /api/v1/purchases        — create a purchase order

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { createPurchase } from '@/domain/commands/m2/CreatePurchase';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { readListPage, listPageArgs, listPageResult } from '@/lib/api/listPage';

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
    await requirePermission(auth, "purchase.read");
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
    const page = readListPage(url);
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from > to)) {
      throw new DomainError('VALIDATION_FAILED', 'Enter a valid date range', {}, 400);
    }

    const where: Record<string, unknown> = { companyId: auth.companyId };
    const search = url.searchParams.get('search')?.trim();
    if (search) where.OR = [{ referenceNo: { contains: search } }, { supplier: { name: { contains: search } } }];
    if (status) where.orderStatus = status;
    if (supplierId) where.supplierId = supplierId;
    if (from || to) {
      where.orderDate = {};
      if (from) (where.orderDate as Record<string, unknown>).gte = from;
      if (to) (where.orderDate as Record<string, unknown>).lte = to;
    }

    // `select` keeps the payload small; `_count` avoids N+1 on items/receivings.
    const rows = await runInTenantContext(auth.ctx, async () => {
      return db.purchase.findMany({
        where,
        ...listPageArgs(page),
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
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
    });

    const { items: purchases, has_more, next_cursor } = listPageResult(rows, page);
    return NextResponse.json({
      has_more, next_cursor,
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
    await requirePermission(auth, "purchase.create");
    const idempotencyKey = requireIdempotencyKey(req);
    const body = PurchaseCreateSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/purchases', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async (tx) =>
        withIdempotency(
          { idempotencyKey, operation: 'purchase.create', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            const purchase = await createPurchase(tx, {
              companyId: auth.companyId,
              branchId: body.branch_id,
              warehouseId: body.warehouse_id,
              supplierId: body.supplier_id,
              supplierInvoiceNo: body.supplier_invoice_no,
              currencyCode: body.currency_code,
              exchangeRate: body.exchange_rate,
              orderDate: new Date(body.order_date),
              expectedDate: body.expected_date ? new Date(body.expected_date) : undefined,
              notes: body.notes,
              createdBy: auth.userId,
              orderStatus: 'ordered',
              items: body.items.map(item => ({
                productId: item.product_id, qtyOrdered: item.qty_ordered, unitCost: item.unit_cost,
                discountAmount: item.discount_amount, taxAmount: item.tax_amount,
              })),
            }, correlationId);

            return {
              status: 201,
              body: {
                id: purchase.id,
                reference_no: purchase.referenceNo,
                order_status: 'ordered',
                grand_total: purchase.grandTotal.toString(),
                base_grand_total: purchase.baseGrandTotal.toString(),
                item_count: purchase.itemCount,
              },
              resourceType: 'purchase',
              resourceId: purchase.id,
            };
          },
          tx,
        )),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid purchase payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
