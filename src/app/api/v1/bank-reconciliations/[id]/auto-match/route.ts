// POST /api/v1/bank-reconciliations/{id}/auto-match — auto match system ↔ statement lines

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { autoMatchTransactions } from '@/domain/commands/m4/BankReconciliation';
import { errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'bank.reconciliation.manage.company');
    const { id } = await params;

    const idempotencyKey = requireIdempotencyKey(req);
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/bank-reconciliations/${id}/auto-match`, body: {} });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'bank_reconciliation.auto_match', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const r = await autoMatchTransactions(tx, id, correlationId);
            return {
              status: 200,
              body: {
                matched: r.matched,
                unmatched_system: r.unmatchedSystem,
                unmatched_statement: r.unmatchedStatement,
              },
              resourceType: 'bank_reconciliation',
              resourceId: id,
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
