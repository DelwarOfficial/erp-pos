// GET /api/v1/notifications — list recent notifications for the company

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10), 100);

    const notifications = await db.notification.findMany({
      where: {
        companyId: auth.companyId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      items: notifications.map(n => ({
        id: n.id,
        notification_type: n.notificationType,
        severity: n.severity,
        title: n.title,
        body: n.body,
        action_url: n.actionUrl,
        entity_type: n.entityType,
        entity_id: n.entityId,
        created_at: n.createdAt,
      })),
    });
  } catch (e) { return errorResponse(e, correlationId); }
}
