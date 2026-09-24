// POST /api/v1/payments/{id}/refund — refund a payment via the payment provider
//
// §22 REDTEAM refactor: external gateway call moved OUT of the DB transaction.
// Pattern (post-commit outbox):
//   1. BEGIN tx → validate payment + record audit intent → COMMIT
//   2. Fetch payment row (unscoped, for field reads) + call provider.refund() OUTSIDE tx
//   3. On success: create reversal payment record + audit (new short tx)
//   4. On failure: record audit with error
//
// This prevents long-held DB locks during network calls and keeps the
// transaction boundary tight (per §2 Design Principles: external network
// calls never occur inside a database transaction).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { Prisma } from '@prisma/client';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { providerRegistry } from '@/adapters';
import { registerProviders } from '@/adapters/providers';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { randomUUID } from 'node:crypto';

const RefundSchema = z.object({
  // A decimal string, not a float: `10.005` used to be accepted and stored,
  // and money compared with parseFloat cannot be capped exactly.
  amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Amount must be a decimal string with at most 2 decimal places'),
  provider_code: z.string().min(1),
  gateway_txn_id: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  const { id } = await params;
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, 'payment.refund.branch');
    const idempotencyKey = requireIdempotencyKey(req);
    const body = RefundSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/payments/${id}/refund`, body });

    // ── Phase 1: Validate + record refund intent INSIDE a transaction ──
    // No external calls — just DB validation + audit log that commits atomically.
    const reservation = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async (tx) =>
        withIdempotency(
          { idempotencyKey, operation: 'payment.refund', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            const payment = await tx.payment.findFirst({
              where: { id, companyId: auth.companyId },
            });
            if (!payment) throw new DomainError('RESOURCE_NOT_FOUND', 'Payment not found', {}, 404);
            if (payment.paymentStatus === 'reversed') {
              throw new DomainError('VALIDATION_FAILED', 'Cannot refund a reversed payment', {}, 409);
            }

            // Cap against the payment less everything already refunded. The
            // previous check compared this one refund against the full payment
            // amount, so two partial refunds of 60 against a 100 payment both
            // passed and returned 120 in total.
            const priorRefunds = await tx.payment.aggregate({
              where: { companyId: auth.companyId, reversedPaymentId: payment.id, paymentStatus: { not: 'failed' } },
              _sum: { amount: true },
            });
            const alreadyRefunded = new Prisma.Decimal(priorRefunds._sum.amount ?? 0);
            const refundAmount = new Prisma.Decimal(body.amount);
            const refundable = new Prisma.Decimal(payment.amount.toString()).minus(alreadyRefunded);
            if (refundAmount.gt(refundable)) {
              throw new DomainError('VALIDATION_FAILED',
                `Refund amount exceeds the refundable balance of ${refundable.toFixed(2)}`,
                { payment_amount: payment.amount.toString(), already_refunded: alreadyRefunded.toFixed(2) }, 400);
            }

            // Claim the payment before the gateway is called. The guard above
            // was unreachable because nothing ever set this status, so only the
            // referenceNo unique constraint stopped a second refund -- after
            // the money had already left.
            const claimed = await tx.payment.updateMany({
              where: { id: payment.id, companyId: auth.companyId, paymentStatus: { not: 'reversed' } },
              data: { paymentStatus: 'reversed' },
            });
            if (claimed.count !== 1) {
              throw new DomainError('CONCURRENT_MODIFICATION', 'Payment was reversed concurrently', {}, 409);
            }

            // Validate provider exists (cheap registry lookup, no network call)
            registerProviders();
            const provider = providerRegistry.getPayment(body.provider_code);
            if (!provider) {
              throw new DomainError('VALIDATION_FAILED', `Payment provider '${body.provider_code}' not registered`, {}, 400);
            }

            // Record audit log for refund intent
            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'payment.refund.requested', entityType: 'payment', entityId: payment.id,
                afterValue: JSON.stringify({
                  amount: body.amount, gateway_txn_id: body.gateway_txn_id,
                  reason: body.reason, status: 'pending_gateway',
                }) },
              });

            return { status: 200, body: { ok: true }, resourceType: 'payment_refund', resourceId: payment.id };
          },
          tx,
        )),
    );

    // A replayed key means this refund was already carried out. The gateway
    // call below is NOT idempotent on the provider side, and the reversal row
    // collides on @@unique([companyId, referenceNo]) — so continuing would
    // refund the customer a second time and then fail to record it. Return the
    // stored response instead, before any network call.
    if (reservation.isReplay) {
      return NextResponse.json(reservation.body, { status: reservation.status });
    }

    // ── Phase 2: Fetch payment + call gateway OUTSIDE the transaction ──
    // Network call does not hold any DB locks.
    registerProviders();
    const provider = providerRegistry.getPayment(body.provider_code);
    if (!provider) {
      throw new DomainError('VALIDATION_FAILED', `Payment provider '${body.provider_code}' not registered`, {}, 400);
    }

    // Fetch the payment row (for field reads in phase 3). Tenant-scoped read
    // inside explicit context — ownership was validated in phase 1 and the
    // idempotency key prevents replays.
    const payment = await runInTenantContext(auth.ctx, async () => {
      return db.payment.findFirst({ where: { id, companyId: auth.companyId } });
    });
    if (!payment) throw new DomainError('RESOURCE_NOT_FOUND', 'Payment not found', {}, 404);

    try {
      const refundResult = await provider.refund({
        gatewayTxnId: body.gateway_txn_id,
        // The provider interface takes a number; the decimal string is the
        // authoritative value and is what gets stored and posted.
        amount: Number(body.amount),
      });

      // ── Phase 3: Record refund result in a new short transaction ──
      // Create a reversal payment record + audit log (explicit tenant context;
      // gateway I/O above stays outside any DB transaction by design).
      return runInTenantContext(auth.ctx, async () => {
        const reversalPayment = await db.payment.create({
          data: {
            companyId: auth.companyId, branchId: payment.branchId,
            referenceNo: `REFUND-${payment.referenceNo}`, clientTxnId: randomUUID(),
            paymentType: 'sale_refund', direction: 'outgoing',
            customerId: payment.customerId ?? null,
            saleReturnId: payment.saleReturnId ?? null,
            financialAccountId: payment.financialAccountId,
            cashierShiftId: payment.cashierShiftId ?? null,
            currencyCode: payment.currencyCode, exchangeRate: payment.exchangeRate,
            amount: new Prisma.Decimal(body.amount), baseAmount: new Prisma.Decimal(body.amount),
            paymentMethod: body.provider_code, methodReference: refundResult.refundId,
            chequeStatus: 'not_applicable',
            paymentStatus: refundResult.status === 'completed' ? 'posted' : 'failed',
            businessDate: new Date(), receivedOrPaidAt: new Date(),
            reversedPaymentId: payment.id,
            createdBy: auth.userId!, notes: `Refund: ${body.reason ?? 'customer request'}`,
          },
        });

        // The refund leaves the bank: credit cash, debit the counterparty
        // control account. Without this the payments subledger showed the
        // outflow and the GL did not, so bank reconciliation could not balance.
        const financialAccount = await db.financialAccount.findFirst({
          where: { id: payment.financialAccountId, companyId: auth.companyId },
          select: { chartOfAccountId: true },
        });
        const policies = await db.accountingPolicy.findUnique({ where: { companyId: auth.companyId } });
        if (!financialAccount || !policies) {
          throw new DomainError('VALIDATION_FAILED',
            'A financial account and accounting policies are required to post a refund', {}, 409);
        }
        const refundBase = new Prisma.Decimal(body.amount);
        await postJournalEntry(db as unknown as Prisma.TransactionClient, {
          companyId: auth.companyId,
          entryDate: payment.businessDate,
          postingKind: 'sale_refund',
          sourceType: 'payment', sourceId: reversalPayment.id,
          description: `Gateway refund of ${payment.referenceNo}`,
          currencyCode: payment.currencyCode,
          exchangeRate: parseFloat(payment.exchangeRate.toString()),
          createdBy: auth.userId!,
          lines: [
            { chartOfAccountId: policies.arAccountId, debit: refundBase, credit: 0,
              branchId: payment.branchId, memo: `Refund ${refundResult.refundId}` },
            { chartOfAccountId: financialAccount.chartOfAccountId, debit: 0, credit: refundBase,
              branchId: payment.branchId, memo: `Cash out for refund ${refundResult.refundId}` },
          ],
        }, correlationId);

        await db.auditLog.create({
          data: { companyId: auth.companyId, userId: auth.userId, correlationId,
            action: 'payment.refund.completed', entityType: 'payment', entityId: payment.id,
            afterValue: JSON.stringify({
              refund_id: refundResult.refundId, refund_status: refundResult.status,
              reversal_payment_id: reversalPayment.id,
              amount: body.amount, gateway_txn_id: body.gateway_txn_id,
              reason: body.reason,
            }) },
        });

        const responseBody = {
          payment_id: payment.id,
          refund_id: refundResult.refundId,
          refund_status: refundResult.status,
          reversal_payment_id: reversalPayment.id,
          amount: body.amount,
        };

        // Phase 1 stored a placeholder so the key was reserved before the
        // gateway call. Replace it with the real outcome so a retry replays
        // the refund details rather than the placeholder.
        await db.idempotencyRequest.updateMany({
          where: { companyId: auth.companyId, idempotencyKey },
          data: {
            responseStatus: 200,
            responseBody: JSON.stringify(responseBody),
            resourceType: 'payment_refund',
            resourceId: reversalPayment.id,
          },
        });

        return NextResponse.json(responseBody, { status: 200 });
      });
    } catch (gatewayError) {
      // Gateway call failed — record audit with error
      const errorMsg = gatewayError instanceof Error ? gatewayError.message : 'Unknown gateway error';
      await runInTenantContext(auth.ctx, async () => {
        return db.auditLog.create({
          data: { companyId: auth.companyId, userId: auth.userId, correlationId,
            action: 'payment.refund.failed', entityType: 'payment', entityId: payment.id,
            afterValue: JSON.stringify({
              provider: body.provider_code, error: errorMsg,
              amount: body.amount, gateway_txn_id: body.gateway_txn_id,
            }) },
        });
      }).catch(() => {});

      throw new DomainError('EXTERNAL_PROVIDER_ERROR', `Refund gateway error: ${errorMsg}`, { provider: body.provider_code }, 502);
    }
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid refund payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
