// GET /api/v1/security-events
// List security events for the current tenant. Cursor pagination.
// Filters: severity, event_type, user_id.

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
    const severity = url.searchParams.get('severity') ?? undefined;
    const eventType = url.searchParams.get('event_type') ?? undefined;
    const userId = url.searchParams.get('user_id') ?? undefined;
    const cursor = url.searchParams.get('cursor') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (severity) where.severity = severity;
    if (eventType) where.eventType = eventType;
    if (userId) where.userId = userId;
    if (cursor) where.id = { lt: cursor };

    const events = await db.securityEvent.findMany({
      where,
      take: limit + 1,
      orderBy: { occurredAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    const hasMore = events.length > limit;
    const items = hasMore ? events.slice(0, limit) : events;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return NextResponse.json({
      items: items.map(e => ({
        id: e.id,
        event_type: e.eventType,
        severity: e.severity,
        user: e.user,
        ip_address: e.ipAddress,
        user_agent: e.userAgent,
        metadata: e.metadata ? JSON.parse(e.metadata) : {},
        occurred_at: e.occurredAt,
      })),
      next_cursor: nextCursor,
      has_more: hasMore,
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
