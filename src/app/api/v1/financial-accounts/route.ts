// GET  /api/v1/financial-accounts  — list financial accounts
// POST /api/v1/financial-accounts  — create financial account

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const FaSchema = z.object({
  chart_of_account_id: z.string().uuid(),
  branch_id: z.string().uuid().optional(),
  name: z.string().min(1).max(150),
  account_type: z.enum(['cash', 'bank', 'mobile_wallet', 'clearing']).default('cash'),
  currency_code: z.string().length(3).default('BDT'),
  account_number_masked: z.string().max(80).optional(),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'journal.post');
  await requirePermission(auth, 'journal.read');
    const accounts = await db.financialAccount.findMany({
      where: { companyId: auth.companyId },
      orderBy: { name: 'asc' },
      include: {
        chartOfAccount: { select: { id: true, code: true, name: true, accountClass: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
    });
    return NextResponse.json({
      items: accounts.map(a => ({
        id: a.id, name: a.name, account_type: a.accountType,
        currency_code: a.currencyCode, is_active: a.isActive,
        account_number_masked: a.accountNumberMasked,
        chart_of_account: a.chartOfAccount, branch: a.branch,
      })),
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const idempotencyKey = requireIdempotencyKey(req);
    const body = FaSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/financial-accounts', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'financial_account.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // Validate chart_of_account belongs to this company
            const coa = await tx.chartOfAccount.findFirst({
              where: { id: body.chart_of_account_id, companyId: auth.companyId },
            });
            if (!coa) throw new DomainError('VALIDATION_FAILED', 'Chart of account not found', {}, 404);

            // Check 1:1 unique (company_id, chart_of_account_id)
            const existing = await tx.financialAccount.findFirst({
              where: { companyId: auth.companyId, chartOfAccountId: body.chart_of_account_id },
            });
            if (existing) throw new DomainError('VALIDATION_FAILED', 'Financial account already exists for this GL account', {}, 409);

            const fa = await tx.financialAccount.create({
              data: {
                companyId: auth.companyId,
                branchId: body.branch_id ?? null,
                chartOfAccountId: body.chart_of_account_id,
                name: body.name,
                accountType: body.account_type,
                currencyCode: body.currency_code,
                accountNumberMasked: body.account_number_masked ?? null,
              },
            });
            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'financial_account.create', entityType: 'financial_account', entityId: fa.id,
                afterValue: JSON.stringify({ name: fa.name, type: fa.accountType, coa_code: coa.code }) },
            });
            return { status: 201, body: { id: fa.id, name: fa.name }, resourceType: 'financial_account', resourceId: fa.id };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid financial account payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
