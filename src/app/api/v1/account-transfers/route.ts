// GET  /api/v1/account-transfers  — list account transfers
// POST /api/v1/account-transfers  — create + post an account transfer

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { postAccountTransfer } from '@/domain/commands/m3/Payments';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { randomUUID } from 'node:crypto';

const CreateTransferSchema = z.object({
  branch_id: z.string().uuid(),
  from_financial_account_id: z.string().uuid(),
  to_financial_account_id: z.string().uuid(),
  from_amount: z.number().positive(),
  to_amount: z.number().positive(),
  exchange_rate: z.number().positive().default(1),
  transfer_fee: z.number().min(0).default(0),
  business_date: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'sale.read');
    const url = req.nextUrl;
    const status = url.searchParams.get('status') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      db.accountTransfer.findMany({
        where, take: limit, skip: offset, orderBy: { businessDate: 'desc' },
        include: {
          fromFinancialAccount: { select: { id: true, name: true, currencyCode: true } },
          toFinancialAccount: { select: { id: true, name: true, currencyCode: true } },
        },
      }),
      db.accountTransfer.count({ where }),
    ]);

    return NextResponse.json({
      items: items.map(t => ({
        id: t.id, reference_no: t.referenceNo, status: t.status,
        from_financial_account: t.fromFinancialAccount,
        to_financial_account: t.toFinancialAccount,
        from_currency_code: t.fromCurrencyCode,
        to_currency_code: t.toCurrencyCode,
        from_amount: t.fromAmount.toString(),
        to_amount: t.toAmount.toString(),
        exchange_rate: t.exchangeRate.toString(),
        transfer_fee: t.transferFee.toString(),
        business_date: t.businessDate,
        notes: t.notes,
        journal_entry_id: t.journalEntryId,
        posted_at: t.postedAt,
      })),
      total, limit, offset,
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'account_transfer.post');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = CreateTransferSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/account-transfers', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'account_transfer.post', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const businessDate = body.business_date ? new Date(body.business_date) : new Date();

            const jeResult = await postAccountTransfer(tx, {
              companyId: auth.companyId, branchId: body.branch_id,
              fromFaId: body.from_financial_account_id,
              toFaId: body.to_financial_account_id,
              fromAmount: body.from_amount, toAmount: body.to_amount,
              exchangeRate: body.exchange_rate, fee: body.transfer_fee,
              businessDate, postedBy: auth.userId, notes: body.notes,
            }, correlationId);

            // Persist the AccountTransfer record (the domain command only posts the JE)
            const fromFa = await tx.financialAccount.findFirst({
              where: { id: body.from_financial_account_id, companyId: auth.companyId },
            });
            const toFa = await tx.financialAccount.findFirst({
              where: { id: body.to_financial_account_id, companyId: auth.companyId },
            });
            if (!fromFa || !toFa) throw new DomainError('VALIDATION_FAILED', 'Financial account not found', {}, 404);

            const transfer = await tx.accountTransfer.create({
              data: {
                companyId: auth.companyId, branchId: body.branch_id,
                referenceNo: jeResult.transferId, clientTxnId: randomUUID(),
                fromFinancialAccountId: body.from_financial_account_id,
                toFinancialAccountId: body.to_financial_account_id,
                fromCurrencyCode: fromFa.currencyCode,
                toCurrencyCode: toFa.currencyCode,
                fromAmount: body.from_amount, toAmount: body.to_amount,
                exchangeRate: body.exchange_rate, transferFee: body.transfer_fee,
                status: 'posted', businessDate,
                journalEntryId: null, // link after creation
                notes: body.notes ?? null, createdBy: auth.userId,
                postedAt: new Date(),
              },
            });

            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'account_transfer.post', entityType: 'account_transfer', entityId: transfer.id,
                afterValue: JSON.stringify({
                  reference_no: jeResult.transferId, journal_entry_no: jeResult.journalEntryNo,
                  from_amount: body.from_amount, to_amount: body.to_amount,
                }) },
            });

            return {
              status: 201,
              body: {
                id: transfer.id, reference_no: jeResult.transferId,
                journal_entry_no: jeResult.journalEntryNo,
                status: 'posted', from_amount: body.from_amount.toFixed(2), to_amount: body.to_amount.toFixed(2),
              },
              resourceType: 'account_transfer', resourceId: transfer.id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid account transfer payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
