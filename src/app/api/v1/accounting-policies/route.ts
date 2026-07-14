// GET /api/v1/accounting-policies  — list the company's accounting policies
// PUT /api/v1/accounting-policies  — update accounting policies

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const POLICY_FIELDS = [
  'inventoryAccountId', 'cogsAccountId', 'salesRevenueAccountId',
  'arAccountId', 'apAccountId', 'customerAdvanceAccountId',
  'supplierAdvanceAccountId', 'purchaseVarianceAccountId',
  'giftCardLiabilityAccountId', 'rewardExpenseAccountId',
  'branchClearingAccountId', 'inventoryDamageAccountId',
  'inventoryWriteOffAccountId', 'exchangeGainLossAccountId',
  'courierClearingAccountId', 'serviceCogsAccountId',
  'repairWipAccountId', 'chequeClearingAccountId',
  'roundingAccountId', 'grniAccountId',
  'openingBalanceEquityAccountId', 'impairmentAllowanceAccountId',
  'chequeBounceFeeAccountId',
] as const;

const UpdatePolicySchema = z.object({
  inventory_account_id: z.string().uuid().optional(),
  cogs_account_id: z.string().uuid().optional(),
  sales_revenue_account_id: z.string().uuid().optional(),
  ar_account_id: z.string().uuid().optional(),
  ap_account_id: z.string().uuid().optional(),
  customer_advance_account_id: z.string().uuid().optional(),
  supplier_advance_account_id: z.string().uuid().optional(),
  purchase_variance_account_id: z.string().uuid().optional(),
  gift_card_liability_account_id: z.string().uuid().optional(),
  courier_clearing_account_id: z.string().uuid().optional(),
  service_cogs_account_id: z.string().uuid().optional(),
  repair_wip_account_id: z.string().uuid().optional(),
  cheque_clearing_account_id: z.string().uuid().optional(),
  rounding_account_id: z.string().uuid().optional(),
  grni_account_id: z.string().uuid().optional(),
  opening_balance_equity_account_id: z.string().uuid().optional(),
  impairment_allowance_account_id: z.string().uuid().optional(),
  cheque_bounce_fee_account_id: z.string().uuid().optional(),
});

const FIELD_MAP: Record<string, string> = {
  inventory_account_id: 'inventoryAccountId',
  cogs_account_id: 'cogsAccountId',
  sales_revenue_account_id: 'salesRevenueAccountId',
  ar_account_id: 'arAccountId',
  ap_account_id: 'apAccountId',
  customer_advance_account_id: 'customerAdvanceAccountId',
  supplier_advance_account_id: 'supplierAdvanceAccountId',
  purchase_variance_account_id: 'purchaseVarianceAccountId',
  gift_card_liability_account_id: 'giftCardLiabilityAccountId',
  courier_clearing_account_id: 'courierClearingAccountId',
  service_cogs_account_id: 'serviceCogsAccountId',
  repair_wip_account_id: 'repairWipAccountId',
  cheque_clearing_account_id: 'chequeClearingAccountId',
  rounding_account_id: 'roundingAccountId',
  grni_account_id: 'grniAccountId',
  opening_balance_equity_account_id: 'openingBalanceEquityAccountId',
  impairment_allowance_account_id: 'impairmentAllowanceAccountId',
  cheque_bounce_fee_account_id: 'chequeBounceFeeAccountId',
};

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'journal.post');
  await requirePermission(auth, 'journal.read');
    const policy = await db.accountingPolicy.findUnique({
      where: { companyId: auth.companyId },
    });
    if (!policy) {
      return NextResponse.json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Accounting policies not configured — run onboarding or seed default CoA' } }, { status: 404 });
    }

    // Resolve account names
    const accountIds = POLICY_FIELDS.map(f => policy[f]).filter(Boolean) as string[];
    const accounts = await db.chartOfAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, code: true, name: true, accountClass: true },
    });
    const accountMap = new Map(accounts.map(a => [a.id, a]));

    const result: Record<string, unknown> = { company_id: policy.companyId };
    for (const field of POLICY_FIELDS) {
      const id = policy[field] as string | null;
      result[field] = id ? accountMap.get(id) ?? { id } : null;
    }

    return NextResponse.json({ policy: result });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function PUT(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const idempotencyKey = requireIdempotencyKey(req);
    const body = UpdatePolicySchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'PUT', path: '/api/v1/accounting-policies', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'accounting_policies.update', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const existing = await tx.accountingPolicy.findUnique({ where: { companyId: auth.companyId } });
            if (!existing) throw new DomainError('RESOURCE_NOT_FOUND', 'Accounting policies not found — run onboarding first', {}, 404);

            // Build update data — only fields that were provided
            const updateData: Record<string, string> = {};
            for (const [snakeCase, camelCase] of Object.entries(FIELD_MAP)) {
              const value = (body as Record<string, string | undefined>)[snakeCase];
              if (value) {
                // Validate the account exists in this company
                const coa = await tx.chartOfAccount.findFirst({ where: { id: value, companyId: auth.companyId } });
                if (!coa) throw new DomainError('VALIDATION_FAILED', `Account ${value} not found`, { field: snakeCase }, 400);
                updateData[camelCase] = value;
              }
            }

            if (Object.keys(updateData).length === 0) {
              return { status: 200, body: { updated: false, message: 'No fields to update' }, resourceType: 'accounting_policy', resourceId: auth.companyId };
            }

            await tx.accountingPolicy.update({
              where: { companyId: auth.companyId },
              data: updateData,
            });

            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'accounting_policies.update', entityType: 'accounting_policy', entityId: auth.companyId,
                afterValue: JSON.stringify(updateData) },
            });

            return { status: 200, body: { updated: true, fields_changed: Object.keys(updateData).length }, resourceType: 'accounting_policy', resourceId: auth.companyId };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid policy payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
