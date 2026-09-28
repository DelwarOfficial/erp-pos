// GET /api/v1/communications/sms-account — whether the company's MiMSMS account is set, and its Sender ID.
// PUT /api/v1/communications/sms-account — set or replace it.
//
// Each company uses its own MiMSMS account (src/lib/sms/credentials.ts). The
// API key and login are write-only: stored encrypted, never returned, never
// logged, never put in the audit trail -- the audit records only that the
// account changed and its Sender ID.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { db } from '@/lib/db';
import { describeSmsAccount, saveSmsCredentials, validateMimSmsCredentials } from '@/lib/sms/credentials';

const AccountSchema = z.object({
  user_name: z.string().max(200),
  api_key: z.string().max(200),
  sender_name: z.string().max(20),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'communication.sms_provider.manage.company');
    const account = await runInTenantContext(auth.ctx, () => describeSmsAccount(db as never, auth.companyId));
    return NextResponse.json(account);
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function PUT(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'communication.sms_provider.manage.company');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = AccountSchema.parse(await req.json());
    // The stored request hash covers the key too; it is a one-way SHA-256, never the key.
    const requestHash = computeRequestHash({ method: 'PUT', path: '/api/v1/communications/sms-account', body });
    const credentials = validateMimSmsCredentials({ userName: body.user_name, apiKey: body.api_key, senderName: body.sender_name });
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, async tx => withIdempotency(
      { idempotencyKey, operation: 'sms_account.update', requestHash, companyId: auth.companyId, userId: auth.userId },
      async () => {
      await saveSmsCredentials(tx, auth.companyId, auth.userId, credentials);
      await tx.auditLog.create({ data: { companyId: auth.companyId, userId: auth.userId, correlationId,
        action: 'sms_account.update', entityType: 'integration_credential', entityId: 'mimsms',
        afterValue: JSON.stringify({ provider: 'mimsms', sender_name: credentials.senderName }) } });
      return { status: 200, body: await describeSmsAccount(tx, auth.companyId), resourceType: 'integration_credential', resourceId: 'mimsms' };
      },
      tx,
    )));
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid SMS account', { issues: e.issues.map(i => ({ path: i.path, message: i.message })) }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
