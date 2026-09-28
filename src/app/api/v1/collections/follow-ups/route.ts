// GET  /api/v1/collections/follow-ups?status=open|done|cancelled&window=overdue|today|upcoming|all&assigned_to=me|{id}&customer_id=&cursor=&limit=
// POST /api/v1/collections/follow-ups — create a collection task (call, visit, escalate...).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { createFollowUp, FOLLOW_UP_TYPES, listFollowUps } from '@/domain/receivables/followUps';

const Query = z.object({
  status: z.enum(['open', 'done', 'cancelled']).optional(),
  window: z.enum(['overdue', 'today', 'upcoming', 'all']).optional(),
  assigned_to: z.union([z.literal('me'), z.string().uuid()]).optional(),
  customer_id: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const Body = z.object({
  customer_id: z.string().uuid(),
  sale_id: z.string().uuid().optional(),
  installment_id: z.string().uuid().optional(),
  promise_id: z.string().uuid().optional(),
  type: z.enum(FOLLOW_UP_TYPES),
  due_at: z.string().datetime({ offset: true }),
  assigned_to: z.string().uuid().optional(),
  note: z.string().max(2000).optional(),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'collection.view.branch');
    const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
    const result = await runInTenantContext(auth.ctx, () => listFollowUps(db as unknown as Prisma.TransactionClient, auth.companyId, {
      status: q.status, window: q.window, assignedTo: q.assigned_to === 'me' ? auth.userId : q.assigned_to,
      customerId: q.customer_id, cursor: q.cursor, limit: q.limit,
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
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/collections/follow-ups', body });
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, async tx => withIdempotency(
      { idempotencyKey, operation: 'collection.follow_up.create', requestHash, companyId: auth.companyId, userId: auth.userId },
      async () => {
        const followUp = await createFollowUp(tx, auth.companyId, {
          customerId: body.customer_id, saleId: body.sale_id, installmentId: body.installment_id, promiseId: body.promise_id,
          type: body.type, dueAt: new Date(body.due_at), assignedTo: body.assigned_to, note: body.note,
        }, auth.userId);
        return { status: 201, body: followUp, resourceType: 'collection_follow_up', resourceId: followUp.id };
      },
      tx,
    )));
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid follow-up', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
