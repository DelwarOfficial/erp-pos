// POST /api/v1/payroll-runs/{id}/pay — pay a posted payroll run from a cash or bank account.
// Clears each employee's net pay from the payable account it was posted to;
// see src/domain/commands/m6/PayPayrollRun.ts. Paying salaries moves money out,
// so it needs payroll.approve and payment.pay.branch for the paying branch.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { requireFeatureFlag } from '@/lib/featureFlags';
import { getCorrelationId } from '@/lib/http';
import { payPayrollRun } from '@/domain/commands/m6/PayPayrollRun';

const PaySchema = z.object({ branch_id: z.string().uuid(), financial_account_id: z.string().uuid() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'payroll.approve');
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = PaySchema.parse(await req.json());
    await requirePermission(auth, 'payment.pay.branch', body.branch_id);
    await runInTenantContext(auth.ctx, async () => { await requireFeatureFlag('hr_payroll_enabled'); });
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/payroll-runs/${id}/pay`, body });
    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async tx =>
        withIdempotency(
          { idempotencyKey, operation: 'payroll_run.pay', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            const paid = await payPayrollRun(tx, { payrollRunId: id, companyId: auth.companyId, branchId: body.branch_id,
              financialAccountId: body.financial_account_id, paidBy: auth.userId }, correlationId);
            return { status: 200, body: { id: paid.payrollRunId, status: paid.status, payment_reference: paid.paymentRef }, resourceType: 'payroll_run', resourceId: id };
          },
          tx,
        )),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid payroll payment', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
