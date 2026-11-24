// GET  /api/v1/payments  — list payments
// POST /api/v1/payments  — record a standalone payment (advance, refund, etc.)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { nextDocumentNumber } from '@/lib/numbering';
import { receiptDebitAccount } from '@/domain/commands/m3/Payments';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { enforceLargeRefundGate, type RefundGateResult } from '@/lib/approval/refundGate';
import { enforceManualPaymentApproval } from '@/lib/approval/manualPaymentGate';
import { requireOwnOpenShift } from '@/lib/shifts/requireOwnOpenShift';
import { saleRefundState, paymentToReverse } from '@/domain/refunds/saleRefunds';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

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
  // Required for sale_refund once the sale's refunds reach the approval
  // threshold (src/lib/approval/refundGate.ts), and for an outgoing payment
  // with no customer or supplier (src/lib/approval/manualPaymentGate.ts).
  approval_request_id: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'payment.read');
    const url = req.nextUrl;
    const status = url.searchParams.get('status') ?? undefined;
    const paymentType = url.searchParams.get('payment_type') ?? undefined;
    const method = url.searchParams.get('payment_method') ?? undefined;
    // ?cheque_status=pending_clearance lists cheques waiting on the bank (workstream 8).
    const chequeStatus = url.searchParams.get('cheque_status') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (status) where.paymentStatus = status;
    if (paymentType) where.paymentType = paymentType;
    if (method) where.paymentMethod = method;
    if (chequeStatus) where.chequeStatus = chequeStatus;

    const [items, total] = await runInTenantContext(auth.ctx, async () => {
      return Promise.all([
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
    });

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
    await requirePermission(auth, 'payment.pay.branch');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = CreatePaymentSchema.parse(await req.json());
    await requirePermission(auth, 'payment.pay.branch', body.branch_id);
    if (body.payment_type === 'sale_refund') await requirePermission(auth, 'sale.refund.branch', body.branch_id);
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/payments', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async (tx) =>
        withIdempotency(
          { idempotencyKey, operation: 'payment.create', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            let refundReturn: { id: string; totalCredit: Prisma.Decimal } | null = null;
            let refundedBefore = new Prisma.Decimal(0);
            let refundGate: RefundGateResult | null = null;
            let reversedPaymentId: string | null = null;
            if (body.payment_type === 'sale_refund') {
              if (!body.sale_return_id || body.direction !== 'outgoing') throw new DomainError('VALIDATION_FAILED', 'A refund requires a posted sale return and outgoing payment', {}, 400);
              const returned = await tx.saleReturn.findFirst({ where: { id: body.sale_return_id, companyId: auth.companyId, branchId: body.branch_id, status: 'posted' },
                include: { sale: { include: { payments: { include: { payment: true } }, returns: { include: { refundPayments: true } } } }, refundPayments: true } });
              if (!returned) throw new DomainError('RESOURCE_NOT_FOUND', 'Posted return not found in this branch', {}, 404);
              if (returned.sale.currencyCode !== body.currency_code || !returned.sale.exchangeRate.equals(body.exchange_rate)) throw new DomainError('VALIDATION_FAILED', 'Refund currency and exchange rate must match the sale', {}, 400);
              if ((body.customer_id ?? null) !== returned.sale.customerId) throw new DomainError('VALIDATION_FAILED', 'Refund customer must match the sale', {}, 400);
              refundedBefore = returned.refundPayments.filter(payment => payment.paymentStatus === 'posted').reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
              // Gateway refunds of this sale's payments count too (workstream 6):
              // the two paths used to be blind to each other.
              const state = await saleRefundState(tx, auth.companyId, returned.sale.id);
              const paid = state.paid;
              const allRefunded = state.refunded;
              if (new Prisma.Decimal(body.amount).gt(returned.totalCredit.minus(refundedBefore)) || new Prisma.Decimal(body.amount).gt(paid.minus(allRefunded))) throw new DomainError('VALIDATION_FAILED', 'Refund exceeds remaining return credit or collected payment', { collected: paid.toFixed(2), already_refunded: allRefunded.toFixed(2) }, 409);
              reversedPaymentId = paymentToReverse(state, new Prisma.Decimal(body.amount), body.payment_method);
              refundReturn = returned;
              refundGate = await enforceLargeRefundGate(tx, req, {
                companyId: auth.companyId, userId: auth.userId!, saleId: returned.sale.id,
                totalBase: allRefunded.plus(body.amount).mul(returned.sale.exchangeRate),
                approvalRequestId: body.approval_request_id,
              });
            }
            // A named shift must be the caller's own open shift in this branch,
            // so a cash-out cannot hide in someone else's drawer count.
            const cashierShiftId = body.cashier_shift_id
              ? await requireOwnOpenShift(tx, { companyId: auth.companyId, branchId: body.branch_id, userId: auth.userId!, shiftId: body.cashier_shift_id }, 403)
              : null;
            // Money going out must name who received it, or carry a
            // second person's approval. Refunds are anchored by their return.
            let manualApproval: Awaited<ReturnType<typeof enforceManualPaymentApproval>> | null = null;
            if (body.direction === 'outgoing' && body.payment_type !== 'sale_refund') {
              const [customer, supplier] = await Promise.all([
                body.customer_id ? tx.customer.findFirst({ where: { id: body.customer_id, companyId: auth.companyId }, select: { id: true } }) : null,
                body.supplier_id ? tx.supplier.findFirst({ where: { id: body.supplier_id, companyId: auth.companyId }, select: { id: true } }) : null,
              ]);
              if ((body.customer_id && !customer) || (body.supplier_id && !supplier)) throw new DomainError('RESOURCE_NOT_FOUND', 'Customer or supplier not found', {}, 404);
              if (!customer && !supplier) {
                manualApproval = await enforceManualPaymentApproval(tx, {
                  companyId: auth.companyId, branchId: body.branch_id, userId: auth.userId!, paymentType: body.payment_type,
                  amountBase: new Prisma.Decimal(body.amount).mul(body.exchange_rate).toDecimalPlaces(2),
                  approvalRequestId: body.approval_request_id,
                });
              }
            }
            const businessDate = body.business_date ? new Date(body.business_date) : new Date();
            const baseAmount = new Prisma.Decimal(body.amount).mul(body.exchange_rate);
            const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
              companyId: auth.companyId, branchId: body.branch_id,
              documentType: 'PAYMENT', fiscalYear: businessDate.getFullYear(), prefix: 'PMT-',
            });

            const fa = await tx.financialAccount.findFirst({
              where: { id: body.financial_account_id, companyId: auth.companyId, isActive: true },
              include: { chartOfAccount: true },
            });
            if (!fa) throw new DomainError('VALIDATION_FAILED', 'Financial account not found', {}, 404);
            if (fa.branchId && fa.branchId !== body.branch_id) throw new DomainError('VALIDATION_FAILED', 'Financial account belongs to another branch', {}, 400);
            if (fa.currencyCode !== body.currency_code) throw new DomainError('VALIDATION_FAILED', 'Financial account currency must match payment', {}, 400);

            const payment = await tx.payment.create({
              data: {
                companyId: auth.companyId, branchId: body.branch_id,
                // An approved payment takes the approval's reference as its
                // unique client_txn_id: one approval, one payment.
                referenceNo, clientTxnId: manualApproval?.clientTxnId ?? randomUUID(),
                paymentType: body.payment_type, direction: body.direction,
                customerId: body.customer_id ?? null,
                supplierId: body.supplier_id ?? null,
                saleReturnId: body.sale_return_id ?? null,
                // Links the refund to the payment it gives back, so a gateway
                // refund of that payment sees it.
                reversedPaymentId,
                financialAccountId: body.financial_account_id,
                cashierShiftId,
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
            if (refundReturn && !policies) throw new DomainError('VALIDATION_FAILED', 'Accounting policies are required before refunding', {}, 409);
            if (policies) {
              let counterAccountId = policies.arAccountId;
              if (body.payment_type === 'purchase_payment') counterAccountId = policies.apAccountId;
              else if (body.payment_type === 'customer_advance') counterAccountId = policies.customerAdvanceAccountId;
              else if (body.payment_type === 'sale_refund') counterAccountId = policies.arAccountId;

              const cashDebit = body.direction === 'incoming' ? baseAmount : 0;
              // A cheque received is held on cheque clearing until it clears (workstream 8).
              const cashSide = body.direction === 'incoming'
                ? await receiptDebitAccount(tx, auth.companyId, body.payment_method, fa)
                : { chartOfAccountId: fa.chartOfAccountId };
              const cashCredit = body.direction === 'outgoing' ? baseAmount : 0;
              await postJournalEntry(tx, {
                companyId: auth.companyId, entryDate: businessDate,
                postingKind: body.payment_type, sourceType: 'payment', sourceId: payment.id,
                description: `${body.payment_type} ${referenceNo}`,
                currencyCode: body.currency_code, exchangeRate: body.exchange_rate,
                createdBy: auth.userId,
                lines: [
                  { chartOfAccountId: cashSide.chartOfAccountId, debit: cashDebit, credit: cashCredit, memo: `${body.payment_type} ${referenceNo}` },
                  { chartOfAccountId: counterAccountId, debit: cashCredit, credit: cashDebit, memo: `Counterparty for ${referenceNo}` },
                ],
              }, correlationId);
            }
            if (refundReturn) await tx.saleReturn.update({ where: { id: refundReturn.id }, data: { refundStatus: refundedBefore.plus(body.amount).gte(refundReturn.totalCredit) ? 'refunded' : 'partial' } });

            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'payment.create', entityType: 'payment', entityId: payment.id,
                afterValue: JSON.stringify({ reference_no: referenceNo, amount: body.amount, type: body.payment_type,
                  cashier_shift_id: cashierShiftId,
                  ...(manualApproval && { approval_request_id: manualApproval.approvalRequestId, approved_by: manualApproval.approvedBy }),
                  ...(body.direction === 'outgoing' && !manualApproval && { customer_id: body.customer_id ?? null, supplier_id: body.supplier_id ?? null }),
                  ...(refundGate && {
                    sale_return_id: body.sale_return_id, refund_total_base: refundGate.totalBase, threshold: refundGate.threshold,
                    approval_request_id: refundGate.approvalRequestId ?? null, approved_by: refundGate.approvedBy ?? null,
                  }) }) },
            });

            return {
              status: 201,
              body: { id: payment.id, reference_no: referenceNo, payment_status: 'posted', amount: body.amount.toFixed(2) },
              resourceType: 'payment', resourceId: payment.id,
            };
          },
          tx,
        )),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid payment payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
