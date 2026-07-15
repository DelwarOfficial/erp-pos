// GET /api/v1/refunds — list sale returns with their refund payment info

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'sale.read');
    const url = req.nextUrl;
    const refundStatus = url.searchParams.get('refund_status') ?? undefined;
    const saleId = url.searchParams.get('sale_id') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (refundStatus) where.refundStatus = refundStatus;
    if (saleId) where.saleId = saleId;

    const [items, total] = await Promise.all([
      db.saleReturn.findMany({
        where, take: limit, skip: offset, orderBy: { createdAt: 'desc' },
        include: {
          sale: {
            select: {
              id: true, referenceNo: true,
              customer: { select: { id: true, name: true } },
            },
          },
          refundPayments: {
            select: {
              id: true, referenceNo: true, amount: true, paymentMethod: true,
              paymentStatus: true, postedAt: true,
            },
          },
          refundAllocations: {
            select: { id: true, allocatedAmount: true, allocatedBaseAmount: true },
          },
          _count: { select: { items: true } },
        },
      }),
      db.saleReturn.count({ where }),
    ]);

    return NextResponse.json({
      items: items.map(r => {
        const totalRefunded = r.refundPayments.reduce((s, p) => s + parseFloat(p.amount.toString()), 0);
        const totalAllocated = r.refundAllocations.reduce((s, a) => s + parseFloat(a.allocatedAmount.toString()), 0);
        return {
          id: r.id, reference_no: r.referenceNo, status: r.status,
          refund_status: r.refundStatus,
          sale: r.sale,
          total_credit: r.totalCredit.toString(),
          base_total_credit: r.baseTotalCredit.toString(),
          refunded_amount: totalRefunded.toFixed(2),
          allocated_amount: totalAllocated.toFixed(2),
          balance_due: (parseFloat(r.totalCredit.toString()) - totalRefunded).toFixed(2),
          refund_payments: r.refundPayments.map(p => ({
            id: p.id, reference_no: p.referenceNo,
            amount: p.amount.toString(),
            payment_method: p.paymentMethod, payment_status: p.paymentStatus,
            posted_at: p.postedAt,
          })),
          item_count: r._count.items,
          business_date: r.businessDate,
          posted_at: r.postedAt, created_at: r.createdAt,
        };
      }),
      total, limit, offset,
    });
  } catch (e) { return errorResponse(e, correlationId); }
}
