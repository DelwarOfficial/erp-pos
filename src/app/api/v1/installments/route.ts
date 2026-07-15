// GET /api/v1/installments — list installments (scheduled + allocations)

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
    const saleId = url.searchParams.get('sale_id') ?? undefined;
    const status = url.searchParams.get('status') ?? undefined;
    const dueBefore = url.searchParams.get('due_before') ?? undefined;
    const dueAfter = url.searchParams.get('due_after') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (saleId) where.saleId = saleId;
    if (status) where.status = status;
    if (dueBefore || dueAfter) {
      where.dueDate = {
        ...(dueBefore ? { lte: new Date(dueBefore) } : {}),
        ...(dueAfter ? { gte: new Date(dueAfter) } : {}),
      };
    }

    const [items, total] = await Promise.all([
      db.installment.findMany({
        where, take: limit, skip: offset, orderBy: { dueDate: 'asc' },
        include: {
          sale: { select: { id: true, referenceNo: true, customer: { select: { id: true, name: true } } } },
          allocations: { include: { paymentAllocation: { select: { id: true, payment: { select: { id: true, referenceNo: true } } } } } },
        },
      }),
      db.installment.count({ where }),
    ]);

    return NextResponse.json({
      items: items.map(i => {
        const paid = i.allocations.reduce((s, a) => s + parseFloat(a.allocatedAmount.toString()), 0);
        return {
          id: i.id, sale: i.sale, installment_no: i.installmentNo,
          due_date: i.dueDate, amount: i.amount.toString(), status: i.status,
          paid_amount: paid.toFixed(2),
          balance: (parseFloat(i.amount.toString()) - paid).toFixed(2),
          allocations: i.allocations.map(a => ({
            id: a.id, allocated_amount: a.allocatedAmount.toString(),
            allocated_at: a.allocatedAt,
            payment: a.paymentAllocation.payment,
          })),
        };
      }),
      total, limit, offset,
    });
  } catch (e) { return errorResponse(e, correlationId); }
}
