// GET  /api/v1/quotations  — list quotations
// POST /api/v1/quotations  — create a quotation (draft or sent)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { nextDocumentNumber } from '@/lib/numbering';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { randomUUID } from 'node:crypto';

const QuotationItemSchema = z.object({
  product_id: z.string().uuid(),
  qty: z.number().positive(),
  unit_price: z.number().min(0),
  discount_amount: z.number().min(0).default(0),
  tax_amount: z.number().min(0).default(0),
});

const CreateQuotationSchema = z.object({
  branch_id: z.string().uuid(),
  customer_id: z.string().uuid().optional(),
  customer_name_snapshot: z.string().max(200).optional(),
  currency_code: z.string().length(3).default('BDT'),
  exchange_rate: z.number().positive().default(1),
  status: z.enum(['draft', 'sent']).default('draft'),
  valid_until: z.string().datetime().optional(),
  business_date: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(QuotationItemSchema).min(1),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'sale.read');
    const url = req.nextUrl;
    const status = url.searchParams.get('status') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      db.quotation.findMany({
        where, take: limit, skip: offset, orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
      db.quotation.count({ where }),
    ]);

    return NextResponse.json({
      items: items.map(q => ({
        id: q.id, reference_no: q.referenceNo, status: q.status,
        customer: q.customer, customer_name_snapshot: q.customerNameSnapshot,
        currency_code: q.currencyCode,
        subtotal: q.subtotal.toString(),
        discount_total: q.discountTotal.toString(),
        tax_total: q.taxTotal.toString(),
        grand_total: q.grandTotal.toString(),
        valid_until: q.validUntil,
        business_date: q.businessDate,
        converted_sale_id: q.convertedSaleId,
        item_count: q._count.items,
        created_at: q.createdAt,
      })),
      total, limit, offset,
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'sale.post');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = CreateQuotationSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/quotations', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'quotation.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const businessDate = body.business_date ? new Date(body.business_date) : new Date();
            const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
              companyId: auth.companyId, branchId: body.branch_id,
              documentType: 'QUOTATION', fiscalYear: businessDate.getFullYear(), prefix: 'QT-',
            });

            let subtotal = 0, discountTotal = 0, taxTotal = 0;
            const itemLines: Array<Record<string, unknown>> = [];
            let lineNo = 1;
            for (const item of body.items) {
              const product = await tx.product.findFirst({
                where: { id: item.product_id, companyId: auth.companyId, deletedAt: null },
                select: { id: true, name: true, code: true },
              });
              if (!product) throw new DomainError('RESOURCE_NOT_FOUND', `Product ${item.product_id} not found`, {}, 404);
              const gross = item.qty * item.unit_price;
              const lineTotal = gross - item.discount_amount + item.tax_amount;
              subtotal += gross;
              discountTotal += item.discount_amount;
              taxTotal += item.tax_amount;
              itemLines.push({
                companyId: auth.companyId, quotationId: '', lineNo,
                productId: item.product_id, productNameSnapshot: product.name,
                productCodeSnapshot: product.code, qty: item.qty, unitPrice: item.unit_price,
                discountAmount: item.discount_amount, taxAmount: item.tax_amount, lineTotal,
              });
              lineNo++;
            }
            const grandTotal = subtotal - discountTotal + taxTotal;

            const quotation = await tx.quotation.create({
              data: {
                companyId: auth.companyId, branchId: body.branch_id, referenceNo, clientTxnId: randomUUID(),
                customerId: body.customer_id ?? null,
                customerNameSnapshot: body.customer_name_snapshot ?? null,
                currencyCode: body.currency_code, exchangeRate: body.exchange_rate,
                status: body.status, validUntil: body.valid_until ? new Date(body.valid_until) : null,
                businessDate, subtotal, discountTotal, taxTotal, grandTotal,
                notes: body.notes ?? null, createdBy: auth.userId,
              },
            });

            for (const line of itemLines) {
              await tx.quotationItem.create({ data: { ...line, quotationId: quotation.id } as any });
            }

            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'quotation.create', entityType: 'quotation', entityId: quotation.id,
                afterValue: JSON.stringify({ reference_no: referenceNo, grand_total: grandTotal }) },
            });

            return {
              status: 201,
              body: {
                id: quotation.id, reference_no: referenceNo, status: quotation.status,
                grand_total: grandTotal.toFixed(2), currency_code: body.currency_code,
              },
              resourceType: 'quotation', resourceId: quotation.id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid quotation payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
