// GET  /api/v1/collections/installments/{id}/due-date — the installment's due-date change history.
// POST /api/v1/collections/installments/{id}/due-date — change its contractual due date, with a reason.
//      Recorded in the append-only installment_due_date_changes and the audit log; reminders for the old
//      date are cancelled and the planner schedules the new ones.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { dueDateHistory, rescheduleInstallment } from '@/domain/receivables/followUps';

const Body = z.object({ due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().min(3).max(1000) });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'collection.view.branch');
    const { id } = await params;
    const rows = await runInTenantContext(auth.ctx, () => dueDateHistory(db as unknown as Prisma.TransactionClient, auth.companyId, { installmentId: id }));
    return NextResponse.json({ items: rows.map(r => ({
      old_due_date: r.oldDueDate.toISOString().slice(0, 10), new_due_date: r.newDueDate.toISOString().slice(0, 10),
      reason: r.reason, changed_by: r.changer.name, changed_at: r.changedAt,
    })) });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'collection.reschedule.branch');
    const idempotencyKey = requireIdempotencyKey(req);
    const { id } = await params;
    const body = Body.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/collections/installments/${id}/due-date`, body });
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, async tx => withIdempotency(
      { idempotencyKey, operation: 'collection.installment.reschedule', requestHash, companyId: auth.companyId, userId: auth.userId },
      async () => {
        const changed = await rescheduleInstallment(tx, auth.companyId, id, body.due_date, body.reason, auth.userId);
        return { status: 200, body: { installment_id: id, old_due_date: changed.oldDueDate, new_due_date: changed.newDueDate, cancelled_reminders: changed.cancelledReminders },
          resourceType: 'installment', resourceId: id };
      },
      tx,
    )));
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Give the new date (YYYY-MM-DD) and a reason', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
