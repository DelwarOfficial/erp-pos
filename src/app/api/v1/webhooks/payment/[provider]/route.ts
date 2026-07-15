import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { providerRegistry } from '@/adapters';
import { recordSecurityEvent } from '@/lib/audit';
import { registerProviders } from '@/adapters/providers';

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

  const localPayment = await db.payment.findFirst({
    where: { providerReference },
    include: { sale: { select: { companyId: true, id: true, grandTotal: true } } },
  });

  if (!localPayment) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: `No local payment for ${providerReference}` } }, { status: 404 });
  }

  // Update payment status — idempotent
  const newStatus = status === 'success' ? 'completed' : status === 'failed' ? 'failed' : localPayment.status;
  if (newStatus !== localPayment.status) {
    await db.payment.update({
      where: { id: localPayment.id },
      data: {
        status: newStatus,
        providerTxnId: paymentId ?? localPayment.providerTxnId,
        paidAt: newStatus === 'completed' ? new Date() : localPayment.paidAt,
        metadata: { ...(localPayment.metadata as object ?? {}), webhookReceivedAt: new Date().toISOString() },
      },
    });

    // If payment completed and sale was partially_paid, mark as paid
    if (newStatus === 'completed' && localPayment.sale) {
      const allPayments = await db.payment.findMany({
        where: { saleId: localPayment.sale.id, status: 'completed' },
        select: { amount: true },
      });
      const totalPaid = allPayments.reduce((s, p) => s + parseFloat(String(p.amount)), 0);
      const grandTotal = parseFloat(String(localPayment.sale.grandTotal));
      await db.sale.update({
        where: { id: localPayment.sale.id },
        data: { status: totalPaid >= grandTotal ? 'paid' : 'partially_paid' },
      });
    }
  }

  return NextResponse.json({ received: true, status: newStatus });
}
