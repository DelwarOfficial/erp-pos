// GET  /api/v1/exchange-rates  — list exchange rates
// POST /api/v1/exchange-rates  — create / upsert an exchange rate

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const CreateSchema = z.object({
  currency_code: z.string().length(3),
  rate_date: z.string().datetime(),
  rate_to_base: z.number().positive(),
  source: z.string().min(1).max(60).default('manual'),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'report.execute');
    const url = req.nextUrl;
    const currencyCode = url.searchParams.get('currency_code') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (currencyCode) where.currencyCode = currencyCode;

    const [items, total] = await Promise.all([
      db.exchangeRate.findMany({
        where, take: limit, skip: offset, orderBy: { rateDate: 'desc' },
      }),
      db.exchangeRate.count({ where }),
    ]);

    return NextResponse.json({
      items: items.map(r => ({
        id: r.id, currency_code: r.currencyCode, rate_date: r.rateDate,
        rate_to_base: r.rateToBase.toString(), source: r.source,
        approved_by: r.approvedBy, created_at: r.createdAt,
      })),
      total, limit, offset,
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'tax.manage');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = CreateSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/exchange-rates', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'exchange_rate.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            // Upsert: if a rate exists for the same company+currency+date, update it.
            const rateDate = new Date(body.rate_date);
            const existing = await tx.exchangeRate.findUnique({
              where: {
                companyId_currencyCode_rateDate: {
                  companyId: auth.companyId, currencyCode: body.currency_code, rateDate,
                },
              },
            });

            let rate;
            if (existing) {
              rate = await tx.exchangeRate.update({
                where: { id: existing.id },
                data: { rateToBase: body.rate_to_base, source: body.source },
              });
            } else {
              rate = await tx.exchangeRate.create({
                data: {
                  companyId: auth.companyId,
                  currencyCode: body.currency_code,
                  rateDate,
                  rateToBase: body.rate_to_base,
                  source: body.source,
                  approvedBy: auth.userId,
                },
              });
            }

            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'exchange_rate.upsert', entityType: 'exchange_rate', entityId: rate.id,
                afterValue: JSON.stringify({ currency_code: body.currency_code, rate_to_base: body.rate_to_base, rate_date: rateDate }) },
            });

            return {
              status: 201,
              body: { id: rate.id, currency_code: body.currency_code, rate_to_base: body.rate_to_base.toString(), rate_date: rateDate },
              resourceType: 'exchange_rate', resourceId: rate.id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid exchange rate payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
