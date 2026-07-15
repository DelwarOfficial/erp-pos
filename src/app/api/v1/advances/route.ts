// GET  /api/v1/advances  — list customer advance ledger entries
// POST /api/v1/advances  — receive a customer advance (creates payment + ledger entry)

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

const ReceiveAdvanceSchema = z.object({
  branch_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  financial_account_id: z.string().uuid(),
  amount: z.number().positive(),
  currency_code: z.string().length(3).default('BDT'),
  exchange_rate: z.number().positive().default(1),
  payment_method: z.enum(['cash', 'card', 'cheque', 'bkash', 'nagad', 'rocket', 'bank_transfer', 'other']),
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
    const customerId = url.searchParams.get('customer_id') ?? undefined;
    const entryType = url.searchParams.get('entry_type') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (customerId) where.customerId = customerId;
    if (entryType) where.entryType = entryType;

    const [items, total] = await Promise.all([
      db.customerAdvanceLedger.findMany({
        where, take: limit, skip: offset, orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          payment: { select: { id: true, referenceNo: true } },
        },
      }),
      db.customerAdvanceLedger.count({ where }),
    ]);

    // Aggregate current advance balance per customer (running total)
    return NextResponse.json({
      items: items.map(l => ({
        id: l.id, customer: l.customer, payment: l.payment,
        entry_type: l.entryType,
        amount_delta: l.amountDelta.toString(),
        base_amount_delta: l.baseAmountDelta.toString(),
        sale_return_id: l.saleReturnId,
        created_at: l.createdAt,
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
    const body = ReceiveAdvanceSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/advances', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'customer_advance.receive', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const businessDate = body.business_date ? new Date(body.business_date) : new Date();
            const baseAmount = body.amount * body.exchange_rate;
            const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
              companyId: auth.companyId, branchId: body.branch_id,
              documentType: 'CUSTOMER_ADVANCE', fiscalYear: businessDate.getFullYear(), prefix: 'ADV-',
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
                paymentType: 'customer_advance', direction: 'incoming',
                customerId: body.customer_id,
                financialAccountId: body.financial_account_id,
                currencyCode: body.currency_code, exchangeRate: body.exchange_rate,
                amount: body.amount, baseAmount,
                paymentMethod: body.payment_method, methodReference: body.method_reference ?? null,
                chequeStatus: body.payment_method === 'cheque' ? 'pending_clearance' : 'not_applicable',
                paymentStatus: 'posted', businessDate,
                receivedOrPaidAt: new Date(), postedAt: new Date(),
                createdBy: auth.userId, notes: body.notes ?? null,
              },
            });

            // Post Dr Cash, Cr Customer Advance Liability
            const policies = await tx.accountingPolicy.findUnique({ where: { companyId: auth.companyId } });
            if (!policies) throw new DomainError('VALIDATION_FAILED', 'Accounting policies not configured', {}, 400);

            const eventId = randomUUID();
            await tx.businessEvent.create({
              data: { id: eventId, companyId: auth.companyId, eventType: 'customer_advance.received',
                sourceType: 'payment', sourceId: payment.id, correlationId, occurredAt: new Date() },
            });

            await postJournalEntry(tx, {
              companyId: auth.companyId, entryDate: businessDate,
              postingKind: 'customer_advance_received', sourceType: 'payment', sourceId: payment.id,
              description: `Customer advance ${referenceNo}`,
              currencyCode: body.currency_code, exchangeRate: body.exchange_rate,
              createdBy: auth.userId,
              lines: [
                { chartOfAccountId: fa.chartOfAccountId, debit: baseAmount, credit: 0, memo: `Advance received ${referenceNo}` },
                { chartOfAccountId: policies.customerAdvanceAccountId, debit: 0, credit: baseAmount, memo: `Advance liability ${referenceNo}` },
              ],
            }, correlationId);

            await tx.customerAdvanceLedger.create({
              data: {
                companyId: auth.companyId, customerId: body.customer_id, paymentId: payment.id,
                entryType: 'received', amountDelta: body.amount, baseAmountDelta: baseAmount,
                eventId, eventLineNo: 1, createdBy: auth.userId,
              },
            });

            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'customer_advance.receive', entityType: 'payment', entityId: payment.id,
                afterValue: JSON.stringify({ reference_no: referenceNo, customer_id: body.customer_id, amount: body.amount }) },
            });

            return {
              status: 201,
              body: {
                payment_id: payment.id, reference_no: referenceNo,
                customer_id: body.customer_id, amount: body.amount.toFixed(2),
                entry_type: 'received',
              },
              resourceType: 'payment', resourceId: payment.id,
            };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid advance payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
