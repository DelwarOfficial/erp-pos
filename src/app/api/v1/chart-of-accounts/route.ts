// GET  /api/v1/chart-of-accounts  — list CoA
// POST /api/v1/chart-of-accounts  — create account

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const CoaSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(150),
  account_class: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  account_subtype: z.string().min(1).max(40),
  parent_id: z.string().uuid().optional(),
  normal_balance: z.enum(['D', 'C']).default('D'),
  allow_manual_posting: z.boolean().default(false),
  is_control_account: z.boolean().default(false),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'journal.post');
  await requirePermission(auth, 'journal.read');
    const accounts = await db.chartOfAccount.findMany({
      where: { companyId: auth.companyId },
      orderBy: { code: 'asc' },
      include: { parent: { select: { id: true, code: true, name: true } } },
    });
    return NextResponse.json({
      items: accounts.map(a => ({
        id: a.id, code: a.code, name: a.name,
        account_class: a.accountClass, account_subtype: a.accountSubtype,
        normal_balance: a.normalBalance, allow_manual_posting: a.allowManualPosting,
        is_control_account: a.isControlAccount, is_active: a.isActive,
        parent: a.parent,
      })),
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const idempotencyKey = requireIdempotencyKey(req);
    const body = CoaSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/chart-of-accounts', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'coa.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const existing = await tx.chartOfAccount.findFirst({
              where: { companyId: auth.companyId, code: body.code },
            });
            if (existing) throw new DomainError('VALIDATION_FAILED', `Account code ${body.code} already exists`, {}, 409);

            const account = await tx.chartOfAccount.create({
              data: {
                companyId: auth.companyId,
                code: body.code, name: body.name,
                accountClass: body.account_class, accountSubtype: body.account_subtype,
                parentId: body.parent_id ?? null,
                normalBalance: body.normal_balance,
                allowManualPosting: body.allow_manual_posting,
                isControlAccount: body.is_control_account,
              },
            });
            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'coa.create', entityType: 'chart_of_account', entityId: account.id,
                afterValue: JSON.stringify({ code: account.code, name: account.name }) },
            });
            return { status: 201, body: { id: account.id, code: account.code }, resourceType: 'chart_of_account', resourceId: account.id };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid CoA payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
