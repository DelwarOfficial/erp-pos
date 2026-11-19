// GET /api/v1/customers/{id}/points — the customer's spendable reward points
// and the next lot to lapse (customer.read). Points are worth ৳1 each at the till.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { requireFeatureFlag } from '@/lib/featureFlags';
import { getCorrelationId } from '@/lib/http';
import { pointsBalance, TAKA_PER_POINT_SPENT } from '@/domain/loyalty/points';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'customer.read');
    const { id } = await params;
    const result = await runInTenantContext(auth.ctx, async () => {
      await requireFeatureFlag('loyalty_enabled');
      const customer = await db.customer.findFirst({ where: { id, companyId: auth.companyId, deletedAt: null }, select: { id: true } });
      if (!customer) throw new DomainError('RESOURCE_NOT_FOUND', 'Customer not found', {}, 404);
      const points = await pointsBalance(db as never, auth.companyId, id);
      const next = await db.rewardPointTransaction.findFirst({ where: { companyId: auth.companyId, customerId: id, pointsDelta: { gt: 0 }, expiresAt: { gt: new Date() } },
        orderBy: { expiresAt: 'asc' }, select: { expiresAt: true } });
      return { points, value: (points * TAKA_PER_POINT_SPENT).toFixed(2), next_expiry: points > 0 ? next?.expiresAt ?? null : null };
    });
    return NextResponse.json(result);
  } catch (e) { return errorResponse(e, correlationId); }
}
