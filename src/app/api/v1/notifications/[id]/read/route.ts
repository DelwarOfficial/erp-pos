// POST /api/v1/notifications/[id]/read — mark a single notification as read
// for the current user. Upserts the user_notifications row (read_at = now).
//
// No specific permission required — any authenticated user can mark
// notifications in their own company as read. Per-user read state lives in
// the UserNotification table (composite PK notificationId + userId).
//
// CSRF protection is enforced globally by src/middleware.ts (Origin/Referer
// match OR X-CSRF-Token double-submit) for all cookie-auth mutations.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/middleware';
import { withTenant } from '@/lib/db/transaction';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = getCorrelationId(req);
  try {
    // 1. Authenticate — any authenticated user can mark their own
    //    notifications as read. No specific permission is required.
    const auth = await authenticateRequest();

    const { id } = await params;

    // 2. Run inside a serializable Prisma transaction with the tenant context
    //    so the notification existence check + user_notification upsert are
    //    atomic. withTenant sets the AsyncLocalStorage context so downstream
    //    helpers (audit, security events) can read company/user if needed.
    const result = await withTenant(auth.ctx, async (tx) => {
      // 3. Verify the notification exists AND belongs to the caller's company.
      //    Notifications are company-scoped; a user may only mark notifications
      //    visible to their own company as read. A 404 is returned if the
      //    notification does not exist or belongs to a different company
      //    (avoid leaking the existence of cross-tenant notifications).
      const notification = await tx.notification.findFirst({
        where: { id, companyId: auth.companyId },
      });
      if (!notification) {
        throw new DomainError(
          'RESOURCE_NOT_FOUND',
          'Notification not found or does not belong to this user',
          { notification_id: id },
          404,
        );
      }

      // 4. Upsert the per-user read record. The UserNotification table uses
      //    a composite primary key (notificationId, userId). Setting readAt
      //    marks the notification as read for this user. Re-marking an
      //    already-read notification simply refreshes readAt — idempotent.
      const now = new Date();
      await tx.userNotification.upsert({
        where: {
          notificationId_userId: {
            notificationId: id,
            userId: auth.userId,
          },
        },
        create: {
          notificationId: id,
          userId: auth.userId,
          readAt: now,
        },
        update: {
          readAt: now,
        },
      });

      // 5. Lightweight audit log entry for traceability — records who read
      //    which notification and when.
      await tx.auditLog.create({
        data: {
          companyId: auth.companyId,
          userId: auth.userId,
          correlationId,
          action: 'notification.read',
          entityType: 'notification',
          entityId: id,
          afterValue: JSON.stringify({ read_at: now.toISOString() }),
        },
      });

      return {
        status: 200,
        body: { ok: true },
        resourceType: 'notification',
        resourceId: id,
      };
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
