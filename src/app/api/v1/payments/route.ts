// GET  /api/v1/payments  — list payments
// POST /api/v1/payments  — record a standalone payment (advance, refund, etc.)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { nextDocumentNumber } from '@/lib/numbering';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { randomUUID } from 'node:crypto';

const PaymentMethodEnum = z.enum(['cash', 'card', 'cheque', 'bkash', 'nagad', 'rocket', 'bank_transfer', 'gift_card', 'store_credit', 'other']);

const CreatePaymentSchema = z.object({
  branch_id: z.string().uuid(),
  financial_account_id: z.string().uuid(),
  payment_type: z.enum(['sale_receipt', 'purchase_payment', 'customer_advance', 'sale_refund', 'expense_payment', 'other']),
  direction: z.enum(['incoming', 'outgoing']).default('incoming'),
  customer_id: z.string().uuid().optional(),
  supplier_id: z.string().uuid().optional(),
  sale_return_id: z.string().uuid().optional(),
  cashier_shift_id: z.string().uuid().optional(),
  currency_code: z.string().length(3).default('BDT'),
  exchange_rate: z.number().positive().default(1),
  amount: z.number().positive(),
  payment_method: PaymentMethodEnum,
  method_reference: z.string().max(120).optional(),
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
    const paymentType = url.searchParams.get('payment_type') ?? undefined;
    const method = url.searchParams.get('payment_method') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.paymentStatus = status;
    if (paymentType) where.paymentType = paymentType;
    if (method) where.paymentMethod = method;

    const [items, total] = await Promise.all([
      db.payment.findMany({
        where, take: limit, skip: offset, orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          financialAccount: { select: { id: true, name: true } },
        },
      }),
      db.payment.count({ where }),
    ]);

    return NextResponse.json({
      items: items.map(p => ({
        id: p.id, reference_no: p.referenceNo, payment_type: p.paymentType,
        direction: p.direction, payment_method: p.paymentMethod,
        payment_status: p.paymentStatus, cheque_status: p.chequeStatus,
        customer: p.customer, supplier: p.supplier,
        financial_account: p.financialAccount,
        currency_code: p.currencyCode, exchange_rate: p.exchangeRate.toString(),
        amount: p.amount.toString(), base_amount: p.baseAmount.toString(),
        business_date: p.businessDate, received_or_paid_at: p.receivedOrPaidAt,
        reversed_payment_id: p.reversedPaymentId,
      })),
      total, limit, offset,
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'payment.allocate');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = CreatePaymentSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/payments', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'payment.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const businessDate = body.business_date ? new Date(body.business_date) : new Date();
            const baseAmount = body.amount * body.exchange_rate;
            const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
              companyId: auth.companyId, branchId: body.branch_id,
              documentType: 'PAYMENT', fiscalYear: businessDate.getFullYear(), prefix: 'PMT-',
            });

            const fa = await tx.financialAccount.findFirst({
              where: { id: body.financial_account_id, companyId: auth.companyId, isActive: true },
              include: { chartOfAccount: true },
            });
            if (!fa) throw new DomainError('VALIDATION_FAILED', 'Financial account not found', {}, 404);

            const payment = await tx.payment.create({
              data: {
                companyId: auth.companyId, branchId: body.branch_id,
                referenceNo, clientTxnId: randomUUID(),
                paymentType: body.payment_type, direction: body.direction,
                customerId: body.customer_id ?? null,
                supplierId: body.supplier_id ?? null,
                saleReturnId: body.sale_return_id ?? null,
                financialAccountId: body.financial_account_id,
                cashierShiftId: body.cashier_shift_id ?? null,
                currencyCode: body.currency_code, exchangeRate: body.exchange_rate,
                amount: body.amount, baseAmount,
                paymentMethod: body.payment_method, methodReference: body.method_reference ?? null,
                chequeStatus: body.payment_method === 'cheque' ? 'pending_clearance' : 'not_applicable',
                paymentStatus: 'posted', businessDate,
                receivedOrPaidAt: new Date(), postedAt: new Date(),
                createdBy: auth.userId, notes: body.notes ?? null,
              },
            });

            // Journal entry: post the cash/bank leg against the counterparty
            // control account from accounting policies. Sale refunds go against
            // AR; purchase payments against AP; customer advances against the
            // customer-advance liability account.
            const policies = await tx.accountingPolicy.findUnique({ where: { companyId: auth.companyId } });
            if (policies) {
              let counterAccountId = policies.arAccountId;
              if (body.payment_type === 'purchase_payment') counterAccountId = policies.apAccountId;
              else if (body.payment_type === 'customer_advance') counterAccountId = policies.customerAdvanceAccountId;
              else if (body.payment_type === 'sale_refund') counterAccountId = policies.arAccountId;

              const cashDebit = body.direction === 'incoming' ? baseAmount : 0;
              const cashCredit = body.direction === 'outgoing' ? baseAmount : 0;
              await postJournalEntry(tx, {
                companyId: auth.companyId, entryDate: businessDate,
                postingKind: body.payment_type, sourceType: 'payment', sourceId: payment.id,
                description: `${body.payment_type} ${referenceNo}`,
                currencyCode: body.currency_code, exchangeRate: body.exchange_rate,
                createdBy: auth.userId,
                lines: [
                  { chartOfAccountId: fa.chartOfAccountId, debit: cashDebit, credit: cashCredit, memo: `${body.payment_type} ${referenceNo}` },
                  { chartOfAccountId: counterAccountId, debit: cashCredit, credit: cashDebit, memo: `Counterparty for ${referenceNo}` },
                ],
              }, correlationId);
            }

            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'payment.create', entityType: 'payment', entityId: payment.id,
                afterValue: JSON.stringify({ reference_no: referenceNo, amount: body.amount, type: body.payment_type }) },
            });

            return {
              status: 201,
              body: { id: payment.id, reference_no: referenceNo, payment_status: 'posted', amount: body.amount.toFixed(2) },
              resourceType: 'payment', resourceId: payment.id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid payment payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
