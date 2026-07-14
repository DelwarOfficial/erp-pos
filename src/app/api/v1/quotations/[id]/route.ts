// GET /api/v1/quotations/{id} — fetch a single quotation with items

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'sale.read');
    const { id } = await params;

    const q = await db.quotation.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { id: true, name: true } },
        convertedSale: { select: { id: true, referenceNo: true } },
        items: { include: { product: { select: { id: true, code: true, name: true } } }, orderBy: { lineNo: 'asc' } },
      },
    });
    if (!q) throw new DomainError('RESOURCE_NOT_FOUND', 'Quotation not found', {}, 404);

    return NextResponse.json({
      item: {
        id: q.id, reference_no: q.referenceNo, status: q.status,
        branch: q.branch, customer: q.customer,
        customer_name_snapshot: q.customerNameSnapshot,
        currency_code: q.currencyCode, exchange_rate: q.exchangeRate.toString(),
        valid_until: q.validUntil, business_date: q.businessDate,
        subtotal: q.subtotal.toString(),
        discount_total: q.discountTotal.toString(),
        tax_total: q.taxTotal.toString(),
        grand_total: q.grandTotal.toString(),
        notes: q.notes,
        converted_sale: q.convertedSale,
        items: q.items.map(it => ({
          id: it.id, line_no: it.lineNo,
          product: it.product,
          qty: it.qty.toString(),
          unit_price: it.unitPrice.toString(),
          discount_amount: it.discountAmount.toString(),
          tax_amount: it.taxAmount.toString(),
          line_total: it.lineTotal.toString(),
        })),
        created_by: q.createdBy, created_at: q.createdAt,
      },
    });
  } catch (e) { return errorResponse(e, correlationId); }
}
