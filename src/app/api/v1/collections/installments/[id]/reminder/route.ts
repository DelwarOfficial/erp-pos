// GET  /api/v1/collections/installments/{id}/reminder — preview a manual reminder (recipient, text, segments). Sends nothing.
// POST /api/v1/collections/installments/{id}/reminder — queue it. The worker sends it within the sending window, re-checking
//      the balance first and using the amount owed at that moment. One manual reminder per installment per day.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { previewManualReminder, queueManualReminder, type ManualReminderPreview } from '@/domain/receivables/reminders';
import { maskBdMobile } from '@/domain/receivables/phone';

const Locale = z.enum(['bn', 'en']).optional();

function present(p: ManualReminderPreview) {
  const { phone, ...rest } = p;
  return {
    installment_id: rest.installmentId, customer_name: rest.customerName, to_masked: phone ? maskBdMobile(phone) : null,
    phone_status: rest.phoneStatus, invoice_no: rest.invoiceNo, installment_no: rest.installmentNo, due_date: rest.dueDate,
    outstanding: rest.outstanding, text: rest.text, encoding: rest.encoding, segments: rest.segments, blocked: rest.blocked,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'collection.view.branch');
    const { id } = await params;
    const locale = Locale.parse(req.nextUrl.searchParams.get('locale') ?? undefined);
    const preview = await runInTenantContext(auth.ctx, () => previewManualReminder(db as unknown as Prisma.TransactionClient, auth.companyId, id, new Date(), locale));
    return NextResponse.json(present(preview));
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'locale must be bn or en', {}, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'communication.transactional.send.branch');
    const idempotencyKey = requireIdempotencyKey(req);
    const { id } = await params;
    const body = z.object({ locale: Locale }).parse(await req.json().catch(() => ({})));
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/collections/installments/${id}/reminder`, body });
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, async tx => withIdempotency(
      { idempotencyKey, operation: 'collection.manual_reminder', requestHash, companyId: auth.companyId, userId: auth.userId },
      async () => {
        const queued = await queueManualReminder(tx, auth.companyId, id, auth.userId, new Date(), body.locale);
        await tx.auditLog.create({ data: { companyId: auth.companyId, userId: auth.userId, correlationId,
          action: 'sms_message.manual_reminder', entityType: 'outbound_message', entityId: queued.messageId,
          afterValue: JSON.stringify({ installment_id: id, segments: queued.preview.segments }) } });
        return { status: 202, body: { message_id: queued.messageId, status: 'queued', ...present(queued.preview) }, resourceType: 'outbound_message', resourceId: queued.messageId };
      },
      tx,
    )));
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid reminder request', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
