// GET /api/v1/customers/{id}/sms-preferences — the customer's current SMS choices: due reminders (transactional)
//     and marketing, from their latest communication_consents rows.
// PUT /api/v1/customers/{id}/sms-preferences — record a change. Consent rows are appended, never edited, so the
//     history of what the customer agreed to, when and through whom is kept.
//
// Semantics: marketing SMS needs an explicit 'granted'. Due reminders are sent unless the customer has
// withdrawn them ('withdrawn' stops automatic, manual and bulk reminders alike).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { latestSmsConsent } from '@/domain/communication/campaigns';

const Body = z.object({
  reminders: z.enum(['allowed', 'withdrawn']).optional(),
  marketing: z.enum(['granted', 'withdrawn']).optional(),
  source: z.string().max(60).default('staff'),
});

async function current(tx: Prisma.TransactionClient, companyId: string, customerId: string) {
  const [reminders, marketing] = await Promise.all([
    latestSmsConsent(tx, companyId, [customerId], 'transactional'),
    latestSmsConsent(tx, companyId, [customerId], 'marketing'),
  ]);
  return {
    reminders: reminders.get(customerId) === 'withdrawn' ? 'withdrawn' : 'allowed',
    marketing: marketing.get(customerId) === 'granted' ? 'granted' : marketing.get(customerId) === 'withdrawn' ? 'withdrawn' : 'not_asked',
  };
}

async function requireCustomer(tx: Prisma.TransactionClient, companyId: string, id: string) {
  const customer = await tx.customer.findFirst({ where: { id, companyId }, select: { id: true } });
  if (!customer) throw new DomainError('RESOURCE_NOT_FOUND', 'Customer not found', {}, 404);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'customer.read');
    const { id } = await params;
    const prefs = await runInTenantContext(auth.ctx, async () => {
      const tx = db as unknown as Prisma.TransactionClient;
      await requireCustomer(tx, auth.companyId, id);
      return current(tx, auth.companyId, id);
    });
    return NextResponse.json(prefs);
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'customer.update');
    const idempotencyKey = requireIdempotencyKey(req);
    const { id } = await params;
    const body = Body.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'PUT', path: `/api/v1/customers/${id}/sms-preferences`, body });
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, async tx => withIdempotency(
      { idempotencyKey, operation: 'customer.sms_preferences', requestHash, companyId: auth.companyId, userId: auth.userId },
      async () => {
        await requireCustomer(tx, auth.companyId, id);
        const before = await current(tx, auth.companyId, id);
        const rows: Array<{ purpose: string; consentStatus: string }> = [];
        if (body.reminders && body.reminders !== before.reminders) rows.push({ purpose: 'transactional', consentStatus: body.reminders === 'allowed' ? 'granted' : 'withdrawn' });
        if (body.marketing && body.marketing !== before.marketing) rows.push({ purpose: 'marketing', consentStatus: body.marketing });
        for (const row of rows) {
          await tx.communicationConsent.create({ data: { companyId: auth.companyId, customerId: id, channel: 'sms', ...row, source: body.source, capturedBy: auth.userId } });
        }
        const after = await current(tx, auth.companyId, id);
        if (rows.length) {
          await tx.auditLog.create({ data: { companyId: auth.companyId, userId: auth.userId, correlationId, action: 'customer.sms_preferences',
            entityType: 'customer', entityId: id, beforeValue: JSON.stringify(before), afterValue: JSON.stringify({ ...after, source: body.source }) } });
        }
        return { status: 200, body: after, resourceType: 'customer', resourceId: id };
      },
      tx,
    )));
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid preferences', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
