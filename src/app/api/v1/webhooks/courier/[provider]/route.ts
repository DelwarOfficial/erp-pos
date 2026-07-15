import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { recordSecurityEvent } from '@/lib/audit';

// POST /api/v1/webhooks/courier/[provider]
// Receives courier status callbacks (Pathao, RedX) and updates the delivery_order.
// Per §5.10 deliveries + §9.3 courier provider interface.
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerCode } = await params;

  // Auth: courier providers use a shared secret in X-Courier-Token header
  const token = req.headers.get('x-courier-token');
  const expectedToken = process.env.COURIER_WEBHOOK_TOKEN;
  if (!expectedToken || token !== expectedToken) {
    // Webhooks are unauthenticated (no tenant context), so wrap in try/catch
    // — recordSecurityEvent requires a companyId which we don't have here.
    try {
      await recordSecurityEvent({
        eventType: 'courier_webhook_unauthorized',
        severity: 'high',
        metadata: { provider: providerCode },
        companyId: undefined as unknown as string, // platform-level event
      });
    } catch (e) {
      console.warn('[webhook/courier] Failed to record security event:', e instanceof Error ? e.message : e);
    }
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }

  const rawBody = await req.text();
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

  const delivery = await db.deliveryOrder.findFirst({
    where: { providerShipmentId },
    include: { company: { select: { id: true } } },
  });
  if (!delivery) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: `No delivery for ${providerShipmentId}` } }, { status: 404 });
  }

  const newStatus = mapCourierStatus(payload.status as string, providerCode);
  if (newStatus && newStatus !== delivery.status) {
    await db.deliveryOrder.update({
      where: { id: delivery.id },
      data: { status: newStatus, lastStatusAt: new Date() },
    });

    // Append to delivery tracking history
    await db.deliveryTracking.create({
      data: {
        companyId: delivery.company.id,
        deliveryOrderId: delivery.id,
        status: newStatus,
        location: (payload.location as string) ?? null,
        note: (payload.note as string) ?? null,
        occurredAt: (payload.timestamp as string) ? new Date(payload.timestamp as string) : new Date(),
      },
    }).catch(() => {/* deliveryTracking may not exist in sandbox schema */});
  }

  return NextResponse.json({ received: true, status: newStatus });
}

function mapCourierStatus(raw: string | undefined, provider: string): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  // Common statuses across Pathao/RedX
  if (s.includes('pending') || s.includes('picked_up')) return 'picked_up';
  if (s.includes('transit') || s.includes('on_rider')) return 'in_transit';
  if (s.includes('delivered') || s.includes('completed')) return 'delivered';
  if (s.includes('cancel') || s.includes('return')) return 'cancelled';
  if (s.includes('hold') || s.includes('exchange')) return 'on_hold';
  if (s.includes('failed') || s.includes('rejected')) return 'failed';
  return s;
}
