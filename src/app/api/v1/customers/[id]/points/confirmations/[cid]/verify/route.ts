// POST /api/v1/customers/{id}/points/confirmations/{cid}/verify  { code }
// Checks the code the customer read out (sale.post, loyalty on). Returns
// { verified, attempts_left }. Five wrong codes lock the confirmation. Wrong
// attempts are committed here, in their own transaction.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { requireFeatureFlag } from '@/lib/featureFlags';
import { getCorrelationId } from '@/lib/http';
import { requireIdempotencyKey } from '@/lib/idempotency';
import { verifyPointsConfirmation } from '@/domain/loyalty/confirmations';

const VerifySchema = z.object({ code: z.string().trim().min(1).max(12) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; cid: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'sale.post');
    await runInTenantContext(auth.ctx, () => requireFeatureFlag('loyalty_enabled'));
    // Required on every POST. Not replayed: each attempt must count.
    requireIdempotencyKey(req);
    const { id, cid } = await params;
    const body = VerifySchema.parse(await req.json());
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, tx =>
      verifyPointsConfirmation(tx, { companyId: auth.companyId, customerId: id, confirmationId: cid, code: body.code, userId: auth.userId!, correlationId })));
    return NextResponse.json({ verified: result.verified, attempts_left: result.attemptsLeft }, { status: result.verified ? 200 : 422 });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Enter the code', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
