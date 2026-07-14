// GET  /api/v1/payroll-runs  — list payroll runs
// POST /api/v1/payroll-runs  — post a payroll run

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postPayrollRun } from '@/domain/commands/m6/PostPayrollRun';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { requireFeatureFlag } from '@/lib/featureFlags';

const PayrollItemSchema = z.object({
  employee_id: z.string().uuid(),
  base_salary: z.number().min(0),
  allowance_total: z.number().min(0).default(0),
  overtime_total: z.number().min(0).default(0),
  deduction_total: z.number().min(0).default(0),
  withholding_total: z.number().min(0).default(0),
});

const PayrollRunSchema = z.object({
  branch_id: z.string().uuid().optional(),
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
  items: z.array(PayrollItemSchema).min(1),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'payroll.post');
    await requireFeatureFlag('hr_payroll_enabled');
  await requirePermission(auth, 'journal.read');
    const runs = await db.payrollRun.findMany({
      where: { companyId: auth.companyId },
      take: 50, orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({
      items: runs.map(r => ({
        id: r.id, reference_no: r.referenceNo, status: r.status,
        period_start: r.periodStart, period_end: r.periodEnd,
        gross_total: r.grossTotal.toString(),
        deduction_total: r.deductionTotal.toString(),
        net_total: r.netTotal.toString(),
        posted_at: r.postedAt,
      })),
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const idempotencyKey = requireIdempotencyKey(req);
    const body = PayrollRunSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/payroll-runs', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'payroll_run.post', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const result = await postPayrollRun(tx, {
              companyId: auth.companyId,
              branchId: body.branch_id,
              periodStart: new Date(body.period_start),
              periodEnd: new Date(body.period_end),
              createdBy: auth.userId,
              items: body.items.map(i => ({
                employeeId: i.employee_id,
                baseSalary: i.base_salary,
                allowanceTotal: i.allowance_total,
                overtimeTotal: i.overtime_total,
                deductionTotal: i.deduction_total,
                withholdingTotal: i.withholding_total,
              })),
            }, correlationId);
            return { status: 201, body: result, resourceType: 'payroll_run', resourceId: result.payrollRunId };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid payroll payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
