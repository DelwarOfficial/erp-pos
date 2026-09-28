// POST /api/v1/collections/bulk-reminders — queue the batch confirmed from a preview. The eligible set is recomputed
//      and must match the preview's confirmation_token; otherwise 409 and the user previews again. Each message is
//      re-checked just before it is sent. Audited as sms_message.bulk_reminder.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { BULK_MAX, queueBulkReminders } from '@/domain/receivables/reminders';

const Body = z.object({
  installment_ids: z.array(z.string().uuid()).min(1).max(BULK_MAX),
  locale: z.enum(['bn', 'en']).optional(),
  confirmation_token: z.string().regex(/^[0-9a-f]{64}$/),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'communication.bulk_send.company');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = Body.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/collections/bulk-reminders', body });
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, async tx => withIdempotency(
      { idempotencyKey, operation: 'collection.bulk_reminder', requestHash, companyId: auth.companyId, userId: auth.userId },
      async () => {
        const queued = await queueBulkReminders(tx, auth.companyId, body.installment_ids, body.confirmation_token, auth.userId, new Date(), body.locale);
        return { status: 202, body: { batch_id: queued.batchId, queued: queued.queued, preview: queued.preview }, resourceType: 'outbound_message_batch', resourceId: queued.batchId };
      },
      tx,
    ), { timeout: 120_000 }));
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid bulk reminder request', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
