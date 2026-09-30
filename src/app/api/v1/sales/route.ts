// GET  /api/v1/sales        — list sales
// POST /api/v1/sales        — post a new sale (the POS checkout endpoint)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postSale } from '@/domain/commands/m3/PostSale';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { providerRegistry } from '@/adapters';
import { PostSaleSchema, postSaleInput } from '@/lib/sales/saleRequest';
import { readListPage, listPageArgs, listPageResult } from '@/lib/api/listPage';
import { errorMeta, logger } from '@/lib/logging';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'sale.read');
    const url = req.nextUrl;
    const status = url.searchParams.get('status') ?? undefined;
    const page = readListPage(url);
    // Default to last 30 days if no date filters supplied — keeps the list bounded.
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    const applyDateFilter = url.searchParams.get('all_dates') !== 'true';
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const from = fromParam ? new Date(fromParam) : (applyDateFilter ? thirtyDaysAgo : undefined);
    const to = toParam ? new Date(toParam) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from > to)) throw new DomainError('VALIDATION_FAILED', 'Enter a valid date range', {}, 400);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    const search = url.searchParams.get('search')?.trim();
    if (search) where.OR = [{ referenceNo: { contains: search } }, { customer: { name: { contains: search } } }];
    if (status) where.saleStatus = status;
    if (from || to) {
      where.businessDate = {};
      if (from) (where.businessDate as Record<string, unknown>).gte = from;
      if (to) (where.businessDate as Record<string, unknown>).lte = to;
    }

    // Use `select` to limit payload (no full row dump). _count avoids per-sale item queries.
    const rows = await runInTenantContext(auth.ctx, async () => {
      return db.sale.findMany({
        where,
        ...listPageArgs(page),
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
        id: true,
        referenceNo: true,
        saleStatus: true,
        currencyCode: true,
        grandTotal: true,
        baseGrandTotal: true,
        businessDate: true,
        postedAt: true,
        voidedAt: true,
        customer: { select: { id: true, name: true } },
        biller: { select: { id: true, name: true, email: true } },
        _count: { select: { items: true, payments: true } },
        },
      });
    });

    const { items: sales, has_more, next_cursor } = listPageResult(rows, page);
    return NextResponse.json({
      has_more, next_cursor,
      items: sales.map(s => ({
        id: s.id,
        reference_no: s.referenceNo,
        sale_status: s.saleStatus,
        customer: s.customer,
        biller: s.biller,
        currency_code: s.currencyCode,
        grand_total: s.grandTotal.toString(),
        base_grand_total: s.baseGrandTotal.toString(),
        item_count: s._count.items,
        payment_count: s._count.payments,
        business_date: s.businessDate,
        posted_at: s.postedAt,
        voided_at: s.voidedAt,
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
    await requirePermission(auth, 'sale.post');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = PostSaleSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/sales', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async (tx) =>
        withIdempotency(
          { idempotencyKey, operation: 'sale.post', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            const result = await postSale(tx, postSaleInput(body, auth), correlationId);

            return {
              status: 201,
              body: result,
              resourceType: 'sale',
              resourceId: result.saleId,
            };
          },
          tx,
        )),
    );

    // ── Fire-and-forget: risk assessment ──
    // Per §20.D15 — every sale is risk-assessed. Runs async AFTER the sale commits
    // so sale performance isn't impacted. Failures are logged but never block the sale.
    // The assessment is persisted to risk_assessments table by InternalRiskProvider.
    void (async () => {
      try {
        // Lazy-load + register on first call (avoids cold-start delay for the sale)
        const { registerProviders } = await import('@/adapters/providers');
        registerProviders();
        const riskProvider = providerRegistry.getRisk('internal_v2');
        if (!riskProvider) {
          logger.warn('[risk] InternalRiskProvider not registered; assessment skipped');
          return;
        }
        const saleResult = result.body as { saleId: string; grandTotal: string; eventId: string; referenceNo: string };
        await runInTenantContext(auth.ctx, async () => riskProvider.assessRisk({
          subjectType: 'sale',
          subjectId: saleResult.saleId,
          amount: parseFloat(saleResult.grandTotal),
          companyId: auth.companyId,
          requestEventId: saleResult.eventId,
        }));
        logger.info('[risk] assessment recorded', { sale_reference: saleResult.referenceNo });
      } catch (e) {
        logger.error('[risk] assessment failed (the sale still succeeded)', errorMeta(e));
      }
    })();

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid sale payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
