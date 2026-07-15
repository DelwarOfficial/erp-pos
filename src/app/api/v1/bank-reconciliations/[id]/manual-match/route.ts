// POST /api/v1/bank-reconciliations/{id}/manual-match — pair two lines manually

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { manualMatch } from '@/domain/commands/m4/BankReconciliation';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const ManualMatchSchema = z.object({
  system_line_id: z.string().uuid(),
  statement_line_id: z.string().uuid(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'bank.reconciliation.manage.company');
    const { id } = await params;

    const idempotencyKey = requireIdempotencyKey(req);
    const body = ManualMatchSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/bank-reconciliations/${id}/manual-match`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'bank_reconciliation.manual_match', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            await manualMatch(tx, {
              reconciliationId: id,
              companyId: auth.companyId,
              systemLineId: body.system_line_id,
              statementLineId: body.statement_line_id,
              userId: auth.userId!,
            }, correlationId);
            return {
              status: 200,
              body: { matched: true },
              resourceType: 'bank_reconciliation',
              resourceId: id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid manual-match payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
