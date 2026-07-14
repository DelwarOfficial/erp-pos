// GET  /api/v1/cashier-shifts        — list shifts
// POST /api/v1/cashier-shifts/open   — open a new shift (separate route)
// POST /api/v1/cashier-shifts/{id}/close — close a shift (separate route)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'shift.open');
    const url = req.nextUrl;
    const status = url.searchParams.get('status') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.status = status;

    const shifts = await db.cashierShift.findMany({
      where,
      take: limit,
      orderBy: { openedAt: 'desc' },
      include: {
        cashier: { select: { id: true, name: true, email: true } },
        branch: { select: { id: true, name: true, code: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        _count: { select: { sales: true, payments: true } },
      },
    });

    return NextResponse.json({
      items: shifts.map(s => ({
        id: s.id,
        status: s.status,
        cashier: s.cashier,
        branch: s.branch,
        warehouse: s.warehouse,
        opened_at: s.openedAt,
        closed_at: s.closedAt,
        opening_float: s.openingFloat.toString(),
        expected_closing_cash: s.expectedClosingCash?.toString() ?? null,
        counted_closing_cash: s.countedClosingCash?.toString() ?? null,
        variance: s.variance?.toString() ?? null,
        variance_reason: s.varianceReason,
        sale_count: s._count.sales,
        payment_count: s._count.payments,
      })),
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
