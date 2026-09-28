// PUT    /api/v1/communications/templates/{code} — save the company's text for a due reminder (code due_reminder.<kind>.<bn|en>).
//        Only the listed {{placeholders}} are accepted. Versioned and audited.
// DELETE /api/v1/communications/templates/{code} — go back to the built-in text (the saved one is kept, inactive).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { resetReminderTemplate, saveReminderTemplate, TEMPLATE_MAX_CHARS } from '@/domain/receivables/templateSettings';

const Body = z.object({ text: z.string().min(1).max(TEMPLATE_MAX_CHARS) });

export async function PUT(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'communication.template.manage.company');
    const idempotencyKey = requireIdempotencyKey(req);
    const { code } = await params;
    const body = Body.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'PUT', path: `/api/v1/communications/templates/${code}`, body });
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, async tx => withIdempotency(
      { idempotencyKey, operation: 'communication_template.update', requestHash, companyId: auth.companyId, userId: auth.userId },
      async () => {
        const saved = await saveReminderTemplate(tx, auth.companyId, code, body.text, auth.userId);
        return { status: 200, body: saved, resourceType: 'communication_template', resourceId: code };
      },
      tx,
    )));
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', `Text of 1-${TEMPLATE_MAX_CHARS} characters`, { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'communication.template.manage.company');
    const { code } = await params;
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, tx => resetReminderTemplate(tx, auth.companyId, code, auth.userId)));
    return NextResponse.json(result);
  } catch (e) { return errorResponse(e, correlationId); }
}
