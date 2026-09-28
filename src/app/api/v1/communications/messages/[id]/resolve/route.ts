// POST /api/v1/communications/messages/{id}/resolve — settle an 'unknown' SMS after checking the provider's
// own send history: { outcome: 'sent' | 'not_sent', note? }. Audited. Never resends anything.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { resolveUnknownMessage } from '@/domain/receivables/reminders';

const ResolveSchema = z.object({ outcome: z.enum(['sent', 'not_sent']), note: z.string().max(300).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'communication.sms_provider.manage.company');
    const idempotencyKey = requireIdempotencyKey(req);
    const { id } = await params;
    const body = ResolveSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/communications/messages/${id}/resolve`, body });
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, async tx => withIdempotency(
      { idempotencyKey, operation: 'sms_message.resolve', requestHash, companyId: auth.companyId, userId: auth.userId },
      async () => {
        await resolveUnknownMessage(tx, auth.companyId, id, body.outcome, auth.userId, body.note);
        return { status: 200, body: { id, status: body.outcome === 'sent' ? 'sent' : 'failed' }, resourceType: 'outbound_message', resourceId: id };
      },
      tx,
    )));
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'outcome must be sent or not_sent', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
