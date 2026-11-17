import { NextRequest, NextResponse } from 'next/server';
import { systemDb as db } from '@/lib/db';
import { recordSecurityEvent } from '@/lib/audit';
import { errorMeta, logger } from '@/lib/logging';
import { verifyCourierWebhook } from '@/lib/webhooks/courierAuth';

// POST /api/v1/webhooks/courier/[provider]
// Receives courier status callbacks (Pathao, RedX) and updates the delivery_order.
// Per §5.10 deliveries + §9.3 courier provider interface.
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerCode } = await params;

  const rawBody = await req.text();

  // Auth, per courier (src/lib/webhooks/courierAuth.ts): a signed body when
  // the courier has a signing secret, else that courier's own token. One
  // shared token for every courier let any of them -- or a leak -- mark any
  // tenant's delivery as delivered.
  const auth = verifyCourierWebhook(providerCode, rawBody, {
    token: req.headers.get('x-courier-token'),
    timestamp: req.headers.get('x-courier-timestamp'),
    signature: req.headers.get('x-courier-signature'),
  });
  if (!auth.ok) {
    // Webhooks are unauthenticated (no tenant context), so wrap in try/catch
    // — recordSecurityEvent requires a companyId which we don't have here.
    try {
      await recordSecurityEvent({
        eventType: 'courier_webhook_unauthorized',
        severity: 'high',
        metadata: { provider: providerCode, reason: auth.reason },
        companyId: undefined as unknown as string, // platform-level event
      });
    } catch (e) {
      logger.warn('[webhook/courier] failed to record security event', errorMeta(e));
    }
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody); } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON' } }, { status: 400 });
  }

  const providerShipmentId =
    (payload.consignment_id as string) ??
    (payload.parcel_id as string) ??
    (payload.tracking_id as string) ??
    (payload.order_id as string);

  if (!providerShipmentId) {
    return NextResponse.json({ error: { code: 'NO_SHIPMENT_ID' } }, { status: 400 });
  }

  // The token is shared by every tenant and the shipment id comes from the
  // caller, so the lookup is bound to this provider's shipments and refuses
  // an id that is not unique. An unscoped findFirst let one courier's
  // callback (or a guessed id) flip another tenant's delivery.
  const shipments = await db.courierShipment.findMany({
    where: {
      OR: [
        { providerShipmentId },
        { trackingCode: providerShipmentId },
      ],
      deliveryOrder: { deliveryMethod: 'courier', courierCode: providerCode },
    },
    include: { deliveryOrder: { select: { id: true, status: true } } },
    take: 2,
  });
  if (shipments.length === 0) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: `No delivery for ${providerShipmentId}` } }, { status: 404 });
  }
  if (shipments.length > 1) {
    logger.warn('[webhook/courier] ambiguous shipment id ignored', { provider: providerCode });
    return NextResponse.json({ error: { code: 'AMBIGUOUS_SHIPMENT' } }, { status: 409 });
  }
  const shipment = shipments[0];

  const delivery = shipment.deliveryOrder;
  const newStatus = mapCourierStatus(payload.status as string);
  // A finished delivery is not reopened by a late or replayed callback:
  // 'delivered' is what makes an order eligible for COD settlement.
  const isFinal = FINAL_DELIVERY_STATUSES.has(delivery.status);
  if (newStatus && newStatus !== delivery.status && !isFinal) {
    await db.deliveryOrder.update({
      where: { id: delivery.id },
      data: { status: newStatus },
    });

    // Update courier shipment with latest provider status
    await db.courierShipment.update({
      where: { id: shipment.id },
      data: {
        lastProviderStatus: String(payload.status).slice(0, 100),
        lastSyncedAt: new Date(),
      },
    }).catch(() => {/* best-effort update */});
  }

  return NextResponse.json({ received: true, status: isFinal ? delivery.status : newStatus });
}

const FINAL_DELIVERY_STATUSES = new Set(['delivered', 'returned', 'cancelled']);

// Maps a provider status onto the delivery_orders status set. Anything
// unrecognised is ignored: the raw provider string was previously written
// straight into the status column.
function mapCourierStatus(raw: string | undefined): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  const s = raw.toLowerCase();
  // Common statuses across Pathao/RedX
  if (s.includes('picked_up')) return 'dispatched';
  if (s.includes('transit') || s.includes('on_rider')) return 'in_transit';
  if (s.includes('delivered') || s.includes('completed')) return 'delivered';
  if (s.includes('return')) return 'returned';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('failed') || s.includes('rejected')) return 'failed';
  return null;
}
