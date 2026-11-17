// POST /api/v1/payments/{id}/refund — refund a payment via the payment provider
//
// §22 REDTEAM refactor: external gateway call moved OUT of the DB transaction.
// Pattern (post-commit outbox):
//   1. BEGIN tx → validate payment + reserve a 'pending' refund row + audit intent → COMMIT
//   2. Fetch payment row (for field reads) + call provider.refund() OUTSIDE tx
//   3. Settle the pending row to the gateway outcome + journal + audit (new short tx)
//   4. Gateway threw or the outcome could not be recorded: the row stays
//      'pending' and the audit log says why. The original payment is never
//      marked 'reversed' by a refund.
//
// This prevents long-held DB locks during network calls and keeps the
// transaction boundary tight (per §2 Design Principles: external network
// calls never occur inside a database transaction).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getApprovalThresholds } from '@/lib/approval/thresholds';
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
            // Gateway credentials may cover multiple tenants. Authorizing the
            // local payment must also authorize the external refund target.
            if (payment.paymentMethod !== body.provider_code || payment.methodReference !== body.gateway_txn_id) {
              throw new DomainError('VALIDATION_FAILED', 'Refund provider and transaction must match the payment', {}, 400);
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

            // Refunds above the configured threshold need a second authority.
            // The threshold was loaded from configuration and never consulted.
            const refundBase = refundAmount.mul(payment.exchangeRate).toDecimalPlaces(2);
            const thresholds = await getApprovalThresholds(auth.companyId);
            if (refundBase.gt(thresholds.refund_approval_threshold)) {
              try {
                await requirePermission(auth, 'approval.resolve');
              } catch {
                throw new DomainError('APPROVAL_REQUIRED',
                  `Refunds above ${thresholds.refund_approval_threshold} require an approver`,
                  { amount_base: refundBase.toFixed(2), threshold: thresholds.refund_approval_threshold }, 403);
              }
            }

            // Validate provider exists (cheap registry lookup, no network call)
            registerProviders();
            const provider = providerRegistry.getPayment(body.provider_code);
            if (!provider) {
              throw new DomainError('VALIDATION_FAILED', `Payment provider '${body.provider_code}' not registered`, {}, 400);
            }

            // Reserve the refund as a pending outgoing row before the gateway
            // is called. The original payment is left untouched: marking it
            // 'reversed' here survived a failed or pending gateway outcome,
            // dropped the whole receipt from receivables on a partial refund,
            // and blocked every later partial refund. The pending row counts
            // against the refundable balance above, and its unique reference
            // number makes two concurrent refunds of one payment collide.
            const priorCount = await tx.payment.count({
              where: { companyId: auth.companyId, reversedPaymentId: payment.id },
            });
            let pendingRefund: { id: string };
            try {
              pendingRefund = await tx.payment.create({
                data: {
                  companyId: auth.companyId, branchId: payment.branchId,
                  referenceNo: priorCount === 0 ? `REFUND-${payment.referenceNo}` : `REFUND-${payment.referenceNo}-${priorCount + 1}`,
                  clientTxnId: randomUUID(),
                  paymentType: 'sale_refund', direction: 'outgoing',
                  customerId: payment.customerId ?? null,
                  saleReturnId: payment.saleReturnId ?? null,
                  financialAccountId: payment.financialAccountId,
                  cashierShiftId: payment.cashierShiftId ?? null,
                  currencyCode: payment.currencyCode, exchangeRate: payment.exchangeRate,
                  amount: refundAmount, baseAmount: refundBase,
                  paymentMethod: body.provider_code, methodReference: body.gateway_txn_id,
                  chequeStatus: 'not_applicable',
                  paymentStatus: 'pending',
                  businessDate: new Date(), receivedOrPaidAt: new Date(),
                  reversedPaymentId: payment.id,
                  createdBy: auth.userId!, notes: `Refund: ${body.reason ?? 'customer request'}`,
                },
                select: { id: true },
              });
            } catch (e) {
              if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                throw new DomainError('CONCURRENT_MODIFICATION', 'Another refund of this payment is in progress', {}, 409);
              }
              throw e;
            }

            // Record audit log for refund intent
            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'payment.refund.requested', entityType: 'payment', entityId: payment.id,
                afterValue: JSON.stringify({
                  amount: body.amount, gateway_txn_id: body.gateway_txn_id,
                  reason: body.reason, status: 'pending_gateway',
                  reversal_payment_id: pendingRefund.id,
                }) },
              });

            // Until the gateway outcome is recorded, a replay of this key must
            // say "pending", never a bare success.
            return {
              status: 202,
              body: { payment_id: payment.id, refund_status: 'pending', reversal_payment_id: pendingRefund.id, amount: body.amount },
              resourceType: 'payment_refund', resourceId: pendingRefund.id,
            };
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

    const reversalPaymentId = (reservation.body as { reversal_payment_id: string }).reversal_payment_id;
    let refundResult: Awaited<ReturnType<typeof provider.refund>>;
    try {
      refundResult = await provider.refund({
        gatewayTxnId: body.gateway_txn_id,
        // The provider interface takes a number; the decimal string is the
        // authoritative value and is what gets stored and posted.
        amount: Number(body.amount),
      });
    } catch (gatewayError) {
      // A thrown gateway call has an unknown outcome (a timeout may still have
      // paid out), so the pending row stays and keeps holding the refundable
      // balance until it is resolved against the provider.
      const errorMsg = gatewayError instanceof Error ? gatewayError.message : 'Unknown gateway error';
      await runInTenantContext(auth.ctx, async () => {
        return db.auditLog.create({
          data: { companyId: auth.companyId, userId: auth.userId, correlationId,
            action: 'payment.refund.unknown', entityType: 'payment', entityId: payment.id,
            afterValue: JSON.stringify({
              provider: body.provider_code, error: errorMsg, reversal_payment_id: reversalPaymentId,
              amount: body.amount, gateway_txn_id: body.gateway_txn_id,
            }) },
        });
      }).catch(() => {});

      throw new DomainError('EXTERNAL_PROVIDER_ERROR', `Refund gateway error: ${errorMsg}`, { provider: body.provider_code }, 502);
    }

    // ── Phase 3: Record the gateway outcome in a new short transaction ──
    // Settle the pending row, post the journal and store the replay response
    // together (gateway I/O above stays outside any DB transaction by design).
    try {
      return await withTenant(auth.ctx, async (tx) => {
        const refundBase = new Prisma.Decimal(body.amount).mul(payment.exchangeRate).toDecimalPlaces(2);
        const settled = await tx.payment.updateMany({
          where: { id: reversalPaymentId, companyId: auth.companyId, paymentStatus: 'pending' },
          data: {
            paymentStatus: refundResult.status === 'completed' ? 'posted' : refundResult.status,
            methodReference: refundResult.refundId,
            receivedOrPaidAt: new Date(),
          },
        });
        if (settled.count !== 1) {
          throw new DomainError('CONCURRENT_MODIFICATION', 'Refund was settled concurrently', {}, 409);
        }
        const reversalPayment = { id: reversalPaymentId };

        // The refund leaves the bank: credit cash, debit the counterparty
        // control account. Without this the payments subledger showed the
        // outflow and the GL did not, so bank reconciliation could not balance.
        // Pending/failed provider outcomes have no confirmed cash outflow.
        if (refundResult.status === 'completed') {
          const financialAccount = await tx.financialAccount.findFirst({
            where: { id: payment.financialAccountId, companyId: auth.companyId },
            select: { chartOfAccountId: true },
          });
          const policies = await tx.accountingPolicy.findUnique({ where: { companyId: auth.companyId } });
          if (!financialAccount || !policies) {
            throw new DomainError('VALIDATION_FAILED',
              'A financial account and accounting policies are required to post a refund', {}, 409);
          }
          await postJournalEntry(tx, {
            companyId: auth.companyId,
            entryDate: payment.businessDate,
            postingKind: 'sale_refund',
            sourceType: 'payment', sourceId: reversalPayment.id,
            description: `Gateway refund of ${payment.referenceNo}`,
            currencyCode: payment.currencyCode,
            exchangeRate: payment.exchangeRate,
            createdBy: auth.userId!,
            lines: [
              // Tagged with the customer so their ledger shows the refund too.
              { chartOfAccountId: policies.arAccountId, customerId: payment.customerId ?? undefined, debit: refundBase, credit: 0,
                branchId: payment.branchId, memo: `Refund ${refundResult.refundId}` },
              { chartOfAccountId: financialAccount.chartOfAccountId, debit: 0, credit: refundBase,
                branchId: payment.branchId, memo: `Cash out for refund ${refundResult.refundId}` },
            ],
          }, correlationId);
        }

        await tx.auditLog.create({
          data: { companyId: auth.companyId, userId: auth.userId, correlationId,
            action: `payment.refund.${refundResult.status}`, entityType: 'payment', entityId: payment.id,
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

        // Phase 1 stored a "pending" response so the key was reserved before
        // the gateway call. Replace it with the real outcome so a retry replays
        // the refund details.
        await tx.idempotencyRequest.updateMany({
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
    } catch (recordError) {
      // The gateway answered but the outcome could not be recorded (locked
      // period, lost connection). The pending row from phase 1 is the durable
      // trace; the audit log carries the gateway's refund id so it can be
      // settled by hand rather than refunded again.
      const errorMsg = recordError instanceof Error ? recordError.message : 'Unknown error';
      await runInTenantContext(auth.ctx, async () => {
        return db.auditLog.create({
          data: { companyId: auth.companyId, userId: auth.userId, correlationId,
            action: 'payment.refund.unrecorded', entityType: 'payment', entityId: payment.id,
            afterValue: JSON.stringify({
              provider: body.provider_code, error: errorMsg, reversal_payment_id: reversalPaymentId,
              refund_id: refundResult.refundId, refund_status: refundResult.status,
              amount: body.amount, gateway_txn_id: body.gateway_txn_id,
            }) },
        });
      }).catch(() => {});

      throw new DomainError('EXTERNAL_PROVIDER_ERROR',
        `Refund ${refundResult.refundId} was ${refundResult.status} at the gateway but could not be recorded: ${errorMsg}`,
        { provider: body.provider_code, refund_id: refundResult.refundId, reversal_payment_id: reversalPaymentId }, 502);
    }
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid refund payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
