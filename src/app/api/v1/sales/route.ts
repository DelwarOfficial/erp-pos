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

const SaleItemSchema = z.object({
  product_id: z.string().uuid(),
  qty: z.number().positive(),
  unit_price: z.number().min(0),
  discount_amount: z.number().min(0).optional(),
  serials: z.array(z.string()).optional(),
});

const PaymentSchema = z.object({
  payment_method: z.enum(['cash', 'card', 'cheque', 'bkash', 'nagad', 'rocket', 'bank_transfer', 'gift_card', 'store_credit', 'other']),
  amount: z.number().positive(),
  financial_account_id: z.string().uuid(),
  method_reference: z.string().max(120).optional(),
});

const PostSaleSchema = z.object({
  branch_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  cashier_shift_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  currency_code: z.string().length(3).default('BDT'),
  exchange_rate: z.number().positive().default(1),
  sale_note: z.string().optional(),
  items: z.array(SaleItemSchema).min(1),
  payments: z.array(PaymentSchema).min(1),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'sale.post');
  await requirePermission(auth, 'sale.read');
    const url = req.nextUrl;
    const status = url.searchParams.get('status') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    // Default to last 30 days if no date filters supplied — keeps the list bounded.
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    const applyDateFilter = url.searchParams.get('all_dates') !== 'true';
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const from = fromParam ? new Date(fromParam) : (applyDateFilter ? thirtyDaysAgo : undefined);
    const to = toParam ? new Date(toParam) : undefined;

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.saleStatus = status;
    if (from || to) {
      where.businessDate = {};
      if (from) (where.businessDate as Record<string, unknown>).gte = from;
      if (to) (where.businessDate as Record<string, unknown>).lte = to;
    }

    // Use `select` to limit payload (no full row dump). _count avoids per-sale item queries.
    const sales = await db.sale.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
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

    return NextResponse.json({
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
    const idempotencyKey = requireIdempotencyKey(req);
    const body = PostSaleSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/sales', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'sale.post', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const result = await postSale(tx, {
              companyId: auth.companyId,
              branchId: body.branch_id,
              warehouseId: body.warehouse_id,
              cashierId: auth.userId,
              cashierShiftId: body.cashier_shift_id,
              customerId: body.customer_id,
              currencyCode: body.currency_code,
              exchangeRate: body.exchange_rate,
              businessDate: new Date(),
              saleNote: body.sale_note,
              items: body.items.map(i => ({
                productId: i.product_id,
                qty: i.qty,
                unitPrice: i.unit_price,
                discountAmount: i.discount_amount,
                serials: i.serials,
              })),
              payments: body.payments.map(p => ({
                paymentMethod: p.payment_method,
                amount: p.amount,
                financialAccountId: p.financial_account_id,
                methodReference: p.method_reference,
              })),
            }, correlationId);

            return {
              status: 201,
              body: result,
              resourceType: 'sale',
              resourceId: result.saleId,
            };
          });
        },
      ),
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
          console.warn('[risk] InternalRiskProvider not registered — skipping assessment');
          return;
        }
        await riskProvider.assessRisk({
          subjectType: 'sale',
          subjectId: result.body.saleId,
          amount: parseFloat(result.body.grandTotal),
          companyId: auth.companyId,
          requestEventId: result.body.eventId,
        });
        console.log(`[risk] Assessment recorded for sale ${result.body.referenceNo}`);
      } catch (e) {
        console.error('[risk] Assessment failed (sale still succeeded):', e instanceof Error ? `${e.message}\n${e.stack}` : JSON.stringify(e));
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
