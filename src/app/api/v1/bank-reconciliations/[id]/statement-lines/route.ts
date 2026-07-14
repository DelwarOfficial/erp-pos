// POST /api/v1/bank-reconciliations/{id}/statement-lines — add a single statement line

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { addStatementLine, addStatementLinesBulk, StatementLineInput } from '@/domain/commands/m4/BankReconciliation';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const StatementLineSchema = z.object({
  transaction_date: z.string(),
  description: z.string().min(1).max(300),
  amount: z.number(),
  reference_no: z.string().max(120).optional(),
});

const BulkSchema = z.object({
  lines: z.array(StatementLineSchema).min(1).max(1000),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'bank.reconciliation.manage.company');
    const { id } = await params;

    const idempotencyKey = requireIdempotencyKey(req);
    const body = BulkSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/bank-reconciliations/${id}/statement-lines`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'bank_reconciliation.statement_lines_add', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const lines: StatementLineInput[] = body.lines.map(l => ({
              transactionDate: new Date(l.transaction_date),
              description: l.description,
              amount: l.amount,
              referenceNo: l.reference_no,
            }));
            const r = await addStatementLinesBulk(tx, {
              reconciliationId: id,
              companyId: auth.companyId,
              lines,
              userId: auth.userId!,
            }, correlationId);
            return {
              status: 201,
              body: { added: r.added },
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
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid statement-line payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
