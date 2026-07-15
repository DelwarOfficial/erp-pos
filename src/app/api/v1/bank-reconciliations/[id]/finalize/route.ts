// POST /api/v1/bank-reconciliations/{id}/finalize — finalize reconciliation + post variance JE

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postReconciliationVariance } from '@/domain/commands/m4/BankReconciliation';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'bank.reconciliation.manage.company');
    const { id } = await params;

    const idempotencyKey = requireIdempotencyKey(req);
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/bank-reconciliations/${id}/finalize`, body: {} });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'bank_reconciliation.finalize', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const r = await postReconciliationVariance(tx, id, auth.userId!, correlationId);
            return {
              status: 200,
              body: {
                reconciliation_id: r.reconciliationId,
                status: r.status,
                variance: r.variance,
                journal_entry_no: r.journalEntryNo,
              },
              resourceType: 'bank_reconciliation',
              resourceId: r.reconciliationId,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}
