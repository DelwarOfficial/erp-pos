// GET /api/v1/payments/{id} — fetch a single payment with allocations

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'sale.read');
    const { id } = await params;

    const p = await db.payment.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        customer: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        financialAccount: { select: { id: true, name: true, accountType: true } },
        cashierShift: { select: { id: true, status: true } },
        allocations: { include: { sale: { select: { id: true, referenceNo: true } } } },
        refundAllocations: true,
        reversedPayment: { select: { id: true, referenceNo: true } },
        reversingPayment: { select: { id: true, referenceNo: true } },
      },
    });
    if (!p) throw new DomainError('RESOURCE_NOT_FOUND', 'Payment not found', {}, 404);

    return NextResponse.json({
      item: {
        id: p.id, reference_no: p.referenceNo, client_txn_id: p.clientTxnId,
        payment_type: p.paymentType, direction: p.direction,
        payment_method: p.paymentMethod, method_reference: p.methodReference,
        cheque_status: p.chequeStatus, payment_status: p.paymentStatus,
        customer: p.customer, supplier: p.supplier,
        financial_account: p.financialAccount, cashier_shift: p.cashierShift,
        currency_code: p.currencyCode, exchange_rate: p.exchangeRate.toString(),
        amount: p.amount.toString(), base_amount: p.baseAmount.toString(),
        business_date: p.businessDate, received_or_paid_at: p.receivedOrPaidAt,
        notes: p.notes,
        reversed_payment: p.reversedPayment,
        reversing_payment: p.reversingPayment[0] ?? null,
        allocations: p.allocations.map(a => ({
          id: a.id, sale: a.sale,
          allocation_source: a.allocationSource,
          allocated_amount: a.allocatedAmount.toString(),
          allocated_base_amount: a.allocatedBaseAmount.toString(),
          allocated_at: a.allocatedAt,
        })),
        created_by: p.createdBy, posted_at: p.postedAt, created_at: p.createdAt,
      },
    });
  } catch (e) { return errorResponse(e, correlationId); }
}
