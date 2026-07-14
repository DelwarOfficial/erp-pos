// GET /api/v1/audit-logs
// List audit logs for the current tenant. Cursor pagination.
// Filters: action, entity_type, entity_id, user_id, date range.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'company.read');
    const url = req.nextUrl;
    const action = url.searchParams.get('action') ?? undefined;
    const entityType = url.searchParams.get('entity_type') ?? undefined;
    const entityId = url.searchParams.get('entity_id') ?? undefined;
    const userId = url.searchParams.get('user_id') ?? undefined;
    const from = url.searchParams.get('from') ? new Date(url.searchParams.get('from')!) : undefined;
    const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : undefined;
    const cursor = url.searchParams.get('cursor') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (userId) where.userId = userId;
    if (from || to) {
      where.occurredAt = {};
      if (from) (where.occurredAt as Record<string, unknown>).gte = from;
      if (to) (where.occurredAt as Record<string, unknown>).lte = to;
    }
    if (cursor) where.id = { lt: cursor };

    const logs = await db.auditLog.findMany({
      where,
      take: limit + 1,
      orderBy: { occurredAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
        device: { select: { id: true, label: true } },
      },
    });

    const hasMore = logs.length > limit;
    const items = hasMore ? logs.slice(0, limit) : logs;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return NextResponse.json({
      items: items.map(l => ({
        id: l.id,
        action: l.action,
        entity_type: l.entityType,
        entity_id: l.entityId,
        user: l.user,
        device: l.device,
        correlation_id: l.correlationId,
        before_value: l.beforeValue ? JSON.parse(l.beforeValue) : null,
        after_value: l.afterValue ? JSON.parse(l.afterValue) : null,
        client_ip: l.clientIp,
        sync_ip: l.syncIp,
        user_agent: l.userAgent,
        occurred_at: l.occurredAt,
      })),
      next_cursor: nextCursor,
      has_more: hasMore,
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
