// GET /api/v1/communications/messages?status=&trigger=&customer_id=&from=&to=&cursor=&limit=
// SMS history, newest first. Numbers are masked; bodies are what was (or will be) sent.

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext } from '@/lib/db/transaction';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { smsHistory, WORKLIST_PAGE_MAX } from '@/domain/receivables/collections';

const STATUSES = ['queued', 'sending', 'sent', 'delivered', 'failed', 'unknown', 'skipped', 'cancelled', 'dead_letter'];
const TRIGGERS = ['reminder', 'manual', 'bulk'];

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'collection.view.branch');
    const p = req.nextUrl.searchParams;
    const status = p.get('status') ?? undefined;
    const trigger = p.get('trigger') ?? undefined;
    if (status && !STATUSES.includes(status)) throw new DomainError('VALIDATION_FAILED', 'Unknown status', {}, 400);
    if (trigger && !TRIGGERS.includes(trigger)) throw new DomainError('VALIDATION_FAILED', 'Unknown trigger', {}, 400);
    const date = (key: string) => {
      const value = p.get(key);
      if (!value) return undefined;
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) throw new DomainError('VALIDATION_FAILED', `${key} is not a date`, {}, 400);
      return d;
    };
    const limit = p.get('limit') ? Number(p.get('limit')) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > WORKLIST_PAGE_MAX)) throw new DomainError('VALIDATION_FAILED', `limit must be 1-${WORKLIST_PAGE_MAX}`, {}, 400);
    const cursor = p.get('cursor') ?? undefined;
    if (cursor && !/^[0-9a-f-]{36}$/i.test(cursor)) throw new DomainError('VALIDATION_FAILED', 'cursor is not valid', {}, 400);
    const customerId = p.get('customer_id') ?? undefined;
    if (customerId && !/^[0-9a-f-]{36}$/i.test(customerId)) throw new DomainError('VALIDATION_FAILED', 'customer_id is not valid', {}, 400);
    const result = await runInTenantContext(auth.ctx, () => smsHistory(db as unknown as Prisma.TransactionClient, auth.companyId, {
      status, trigger, customerId, from: date('from'), to: date('to'), cursor, limit,
    }));
    return NextResponse.json(result);
  } catch (e) { return errorResponse(e, correlationId); }
}
