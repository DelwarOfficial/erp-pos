import { NextRequest, NextResponse } from 'next/server';
import { systemDb as db } from '@/lib/db';
import { providerRegistry } from '@/adapters';
import { recordSecurityEvent } from '@/lib/audit';
import { registerProviders } from '@/adapters/providers';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { runInTenantContext } from '@/lib/db/transaction';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';

// POST /api/v1/webhooks/payment/[provider]
// Receives payment provider webhooks (bKash, Nagad) and records the payment event.
// Per §5.14 payments + §9.3 payment provider interface.
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerCode } = await params;
  // Ensure providers are registered (webhooks may be the first request after restart)
  registerProviders();
  const provider = providerRegistry.getPayment(providerCode);
  if (!provider) {
    return NextResponse.json({ error: { code: 'UNKNOWN_PROVIDER', message: `Provider '${providerCode}' not registered` } }, { status: 404 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-provider-signature') ?? '';
  const timestamp = req.headers.get('x-provider-timestamp') ?? '';

  let verified: boolean;
  let paymentId: string | undefined;
  let status: 'success' | 'failed' | undefined;
  try {
    const result = await provider.verifyWebhook({ rawBody, signature, timestamp });
    verified = result.verified;
    paymentId = result.paymentId;
    status = result.status;
  } catch (e) {
    await recordSecurityEvent({
      eventType: 'payment_webhook_verify_failed',
      severity: 'high',
      metadata: { provider: providerCode, error: e instanceof Error ? e.message : 'Unknown' },
    });
    return NextResponse.json({ error: { code: 'VERIFY_FAILED' } }, { status: 401 });
  }

  if (!verified) {
    await recordSecurityEvent({
      eventType: 'payment_webhook_unverified',
      severity: 'high',
      metadata: { provider: providerCode },
    });
    return NextResponse.json({ error: { code: 'UNVERIFIED' } }, { status: 401 });
  }

  // Parse provider-specific payload to find the local payment record
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(rawBody); } catch { parsed = {}; }

  // Look up the local payment by providerReference (merchantInvoiceNumber for bKash, etc.)
  const providerReference =
    (parsed.merchantInvoiceNumber as string) ??
    (parsed.order_id as string) ??
    (parsed.paymentID as string) ??
    paymentId;

  if (!providerReference) {
    return NextResponse.json({ error: { code: 'NO_REFERENCE', message: 'Could not identify local payment from webhook payload' } }, { status: 400 });
  }

  // The provider reference is scoped to the provider that signed this webhook.
  // Resolving on methodReference alone searched every tenant's payments with no
  // companyId filter, no unique constraint and no ordering, so a reference
  // collision -- or a value an attacker could influence -- let a webhook for
  // one tenant flip a payment belonging to another, nondeterministically.
  const matches = await db.payment.findMany({
    where: { methodReference: providerReference, paymentMethod: providerCode },
    select: {
      id: true, companyId: true, branchId: true, paymentStatus: true, paymentType: true,
      direction: true, baseAmount: true, currencyCode: true, exchangeRate: true,
      businessDate: true, referenceNo: true, financialAccountId: true,
    },
  });

  if (matches.length === 0) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: `No local payment for ${providerReference}` } }, { status: 404 });
  }
  if (matches.length > 1) {
    // Ambiguous: acting on any one of them would be a guess.
    await recordSecurityEvent({
      eventType: 'payment_webhook_ambiguous_reference',
      severity: 'high',
      metadata: { provider: providerCode, reference: providerReference, match_count: matches.length },
    });
    return NextResponse.json({ error: { code: 'AMBIGUOUS_REFERENCE' } }, { status: 409 });
  }
  const localPayment = matches[0];
  const deliveryRequestId = randomUUID();

  // Only a payment still waiting on the provider ('pending') is settled here.
  // A payment the till already posted (its sale journal holds the cash) used
  // to flip to 'completed' -- a status nothing else counts -- and get a second
  // cash journal; a late 'failed' could also flip a posted payment with no
  // reversal. Those are now recorded and left alone. Success becomes 'posted',
  // the status shift close, reconciliation and refunds count.
  const settled = status === 'success' ? 'posted' : status === 'failed' ? 'failed' : null;
  if (settled && localPayment.paymentStatus !== 'pending') {
    if (settled !== localPayment.paymentStatus) {
      await recordSecurityEvent({
        eventType: 'payment_webhook_conflicting_status',
        severity: settled === 'failed' ? 'high' : 'warning',
        companyId: localPayment.companyId,
        metadata: { provider: providerCode, reference: providerReference, local_status: localPayment.paymentStatus, provider_status: settled },
      });
    }
    return NextResponse.json({ received: true, status: localPayment.paymentStatus });
  }
  const newStatus = settled ?? localPayment.paymentStatus;
  if (newStatus !== localPayment.paymentStatus) {
    // Status change, audit trail and GL posting commit together. Previously
    // the row was flipped to 'completed' on its own: nothing recorded who or
    // what changed it, and the cash never reached the general ledger.
    await runInTenantContext(
      {
        companyId: localPayment.companyId, branchIds: [], allBranches: true, isGlobal: false,
        correlationId: providerReference, requestId: deliveryRequestId,
      },
      () => db.$transaction(async tx => {
        const claimed = await tx.payment.updateMany({
          where: { id: localPayment.id, companyId: localPayment.companyId, paymentStatus: localPayment.paymentStatus },
          data: {
            paymentStatus: newStatus,
            receivedOrPaidAt: newStatus === 'posted' ? new Date() : undefined,
            postedAt: newStatus === 'posted' ? new Date() : undefined,
          },
        });
        // Another delivery of the same webhook already applied it.
        if (claimed.count !== 1) return;

        // Never a second cash journal for the same payment.
        const alreadyJournaled = await tx.journalEntry.findFirst({
          where: { companyId: localPayment.companyId, sourceType: 'payment', sourceId: localPayment.id }, select: { id: true },
        });
        if (newStatus === 'posted' && !alreadyJournaled) {
          const financialAccount = await tx.financialAccount.findFirst({
            where: { id: localPayment.financialAccountId, companyId: localPayment.companyId },
            select: { chartOfAccountId: true },
          });
          const policies = await tx.accountingPolicy.findUnique({ where: { companyId: localPayment.companyId } });
          if (financialAccount && policies) {
            let counterAccountId = policies.arAccountId;
            if (localPayment.paymentType === 'purchase_payment') counterAccountId = policies.apAccountId;
            else if (localPayment.paymentType === 'customer_advance') counterAccountId = policies.customerAdvanceAccountId;

            const cashDebit = localPayment.direction === 'incoming' ? localPayment.baseAmount : new Prisma.Decimal(0);
            const cashCredit = localPayment.direction === 'outgoing' ? localPayment.baseAmount : new Prisma.Decimal(0);

            await postJournalEntry(tx, {
              companyId: localPayment.companyId,
              entryDate: localPayment.businessDate,
              postingKind: localPayment.paymentType,
              sourceType: 'payment', sourceId: localPayment.id,
              description: `${providerCode} settlement of ${localPayment.referenceNo}`,
              currencyCode: localPayment.currencyCode,
              exchangeRate: parseFloat(localPayment.exchangeRate.toString()),
              createdBy: localPayment.id,
              lines: [
                { chartOfAccountId: financialAccount.chartOfAccountId, debit: cashDebit, credit: cashCredit,
                  branchId: localPayment.branchId, memo: `${providerCode} settlement ${localPayment.referenceNo}` },
                { chartOfAccountId: counterAccountId, debit: cashCredit, credit: cashDebit,
                  branchId: localPayment.branchId, memo: `Counterparty for ${localPayment.referenceNo}` },
              ],
            }, providerReference);
          }
        }

        await tx.auditLog.create({
          data: {
            companyId: localPayment.companyId, userId: null, correlationId: providerReference,
            action: 'payment.webhook.status_changed', entityType: 'payment', entityId: localPayment.id,
            beforeValue: JSON.stringify({ payment_status: localPayment.paymentStatus }),
            afterValue: JSON.stringify({ payment_status: newStatus, provider: providerCode, reference: providerReference }),
          },
        });
      }),
    );
  }

  return NextResponse.json({ received: true, status: newStatus });
}
