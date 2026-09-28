// GET  /api/v1/collections/promises?customer_id=&sale_id=&status=open|kept|broken|cancelled&cursor=&limit=
// POST /api/v1/collections/promises — record a customer's promise to pay part of a sale by a date.
//      The installment's contractual due date is not changed.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { listPromises, recordPromise, type PromiseStatus } from '@/domain/receivables/followUps';

const Query = z.object({
  customer_id: z.string().uuid().optional(),
  sale_id: z.string().uuid().optional(),
  status: z.enum(['open', 'kept', 'broken', 'cancelled']).optional(),
  cursor: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const Body = z.object({
  sale_id: z.string().uuid(),
  installment_id: z.string().uuid().optional(),
  promised_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.string().regex(/^\d{1,15}(\.\d{1,2})?$/),
  note: z.string().max(1000).optional(),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'collection.view.branch');
    const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
    const result = await runInTenantContext(auth.ctx, () => listPromises(db as unknown as Prisma.TransactionClient, auth.companyId, {
      customerId: q.customer_id, saleId: q.sale_id, status: q.status as PromiseStatus | undefined, cursor: q.cursor, limit: q.limit,
    }));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid query', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'collection.manage.branch');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = Body.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/collections/promises', body });
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, async tx => withIdempotency(
      { idempotencyKey, operation: 'collection.promise.record', requestHash, companyId: auth.companyId, userId: auth.userId },
      async () => {
        const promise = await recordPromise(tx, auth.companyId, {
          saleId: body.sale_id, installmentId: body.installment_id, promisedDate: body.promised_date, amount: body.amount, note: body.note,
        }, auth.userId);
        const [row] = (await listPromises(tx, auth.companyId, { ids: [promise.id] })).items;
        return { status: 201, body: row, resourceType: 'collection_promise', resourceId: promise.id };
      },
      tx,
    )));
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid promise', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
