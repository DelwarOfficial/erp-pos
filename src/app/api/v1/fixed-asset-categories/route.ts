// GET  /api/v1/fixed-asset-categories — list asset categories
// POST /api/v1/fixed-asset-categories — create an asset category

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const CategorySchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(40),
  default_life_months: z.number().int().min(1).max(6000),
  default_method: z.enum(['straight_line', 'declining_balance', 'units_of_production']).default('straight_line'),
  asset_account_id: z.string().uuid(),
  accum_dep_account_id: z.string().uuid(),
  dep_expense_account_id: z.string().uuid(),
  is_active: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'asset.view.branch');
    const items = await db.fixedAssetCategory.findMany({
      where: { companyId: auth.companyId },
      orderBy: { code: 'asc' },
    });
    return NextResponse.json({
      items: items.map(c => ({
        id: c.id,
        name: c.name,
        code: c.code,
        default_life_months: c.defaultLifeMonths,
        default_method: c.defaultMethod,
        asset_account_id: c.assetAccountId,
        accum_dep_account_id: c.accumDepAccountId,
        dep_expense_account_id: c.depExpenseAccountId,
        is_active: c.isActive,
      })),
    });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'asset.manage.branch');

    const idempotencyKey = requireIdempotencyKey(req);
    const body = CategorySchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/fixed-asset-categories', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'fixed_asset_category.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const existing = await tx.fixedAssetCategory.findFirst({
              where: { companyId: auth.companyId, code: body.code },
            });
            if (existing) throw new DomainError('VALIDATION_FAILED', `Category code ${body.code} already exists`, {}, 409);

            // Validate GL accounts belong to this company
            for (const accId of [body.asset_account_id, body.accum_dep_account_id, body.dep_expense_account_id]) {
              const coa = await tx.chartOfAccount.findFirst({
                where: { id: accId, companyId: auth.companyId, isActive: true },
              });
              if (!coa) throw new DomainError('VALIDATION_FAILED', `Chart of account ${accId} not found`, {}, 400);
            }

            const cat = await tx.fixedAssetCategory.create({
              data: {
                companyId: auth.companyId,
                name: body.name,
                code: body.code,
                defaultLifeMonths: body.default_life_months,
                defaultMethod: body.default_method,
                assetAccountId: body.asset_account_id,
                accumDepAccountId: body.accum_dep_account_id,
                depExpenseAccountId: body.dep_expense_account_id,
                isActive: body.is_active,
              },
            });
            await tx.auditLog.create({
              data: {
                companyId: auth.companyId,
                userId: auth.userId,
                correlationId,
                action: 'fixed_asset_category.create',
                entityType: 'fixed_asset_category',
                entityId: cat.id,
                afterValue: JSON.stringify({ code: cat.code, name: cat.name }),
              },
            });
            return {
              status: 201,
              body: { id: cat.id, code: cat.code, name: cat.name },
              resourceType: 'fixed_asset_category',
              resourceId: cat.id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid category payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
