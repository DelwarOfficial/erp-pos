// src/lib/inventory/reservationExpiry.ts
// Releases stale cart/hold reservations older than the configured TTL.
// Per §5.6 stock_reservations + §20.D11 hold rules.

import { db } from '@/lib/db';
import { withTenant, buildTenantContext } from '@/lib/db/transaction';
import { postStockMovement } from '@/domain/inventory/stockMovement';

const RESERVATION_TTL_MINUTES = parseInt(process.env.RESERVATION_TTL_MINUTES ?? '30', 10);

export async function expireStaleReservations(): Promise<{ expired: number }> {
  const cutoff = new Date(Date.now() - RESERVATION_TTL_MINUTES * 60 * 1000);

  const stale = await db.stockReservation.findMany({
    where: {
      status: 'active',
      expiresAt: { lt: cutoff },
    },
    include: { warehouse: { select: { companyId: true } } },
    take: 200,
  });

  let expired = 0;
  for (const r of stale) {
    const companyId = r.warehouse.companyId;
    await withTenant(
      buildTenantContext({ companyId, userId: 'system:reservation-expiry', branchIds: [], isGlobal: true }),
      async (tx) => {
        await tx.stockReservation.update({
          where: { id: r.id },
          data: { status: 'expired', expiresAt: new Date() },
        });

        // Reverse the original reservation movement (qty_delta = +qty to restore available stock)
        await postStockMovement(tx, {
          companyId,
          eventId: `reservation-expiry-${r.id}`,
          eventLineNo: 1,
          warehouseId: r.warehouseId,
          productId: r.productId,
          movementType: 'adjustment_in',
          qtyDelta: Number(r.qty),
          unitCost: 0,
          referenceType: 'reservation',
          referenceId: r.id,
          effectiveAt: new Date(),
          createdBy: 'system:reservation-expiry',
        });
        expired++;
      },
    );
  }

  return { expired };
}
