// GET /api/v1/customers/{id}/collection-timeline — credit sales, collections, reversals and reminders, newest first.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { customerCollectionTimeline } from '@/domain/receivables/collections';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'collection.view.branch');
    const { id } = await params;
    const events = await runInTenantContext(auth.ctx, async () => {
      const customer = await db.customer.findFirst({ where: { id, companyId: auth.companyId }, select: { id: true } });
      if (!customer) throw new DomainError('RESOURCE_NOT_FOUND', 'Customer not found', {}, 404);
      return customerCollectionTimeline(db as unknown as Prisma.TransactionClient, auth.companyId, id);
    });
    return NextResponse.json({ items: events });
  } catch (e) { return errorResponse(e, correlationId); }
}
