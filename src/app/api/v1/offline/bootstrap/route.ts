// POST /api/v1/offline/bootstrap
// Device bootstrap — returns signed catalogue/prices/tax snapshot + leases.
// Per §20.D07: signed snapshot for offline POS pilot.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { hmacSha256 } from '@/lib/crypto';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const BootstrapSchema = z.object({
  device_id: z.string().uuid(),
  branch_id: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'device.read');
    const body = BootstrapSchema.parse(await req.json());

    // Validate device belongs to this company + branch + is active
    const device = await db.device.findFirst({
      where: { id: body.device_id, companyId: auth.companyId, branchId: body.branch_id, status: 'active' },
    });
    if (!device) {
      throw new DomainError('VALIDATION_FAILED', 'Device not found or not active', {}, 404);
    }

    // Build snapshot: active products with prices + tax codes
    const products = await db.product.findMany({
      where: { companyId: auth.companyId, isActive: true, deletedAt: null, productType: { in: ['standard', 'combo'] } },
      select: {
        id: true, name: true, code: true,
        defaultPrice: true, isSerialized: true,
        unit: { select: { code: true } },
        barcodes: { where: { isPrimary: true }, select: { code: true, symbology: true } },
      },
      take: 200, // offline.stock_budget_max_products default
    });

    const snapshot = {
      schema_version: '1.0',
      company_id: auth.companyId,
      branch_id: body.branch_id,
      device_id: body.device_id,
      generated_at: new Date().toISOString(),
      recovery_epoch: device.lastRecoveryEpoch,
      products: products.map(p => ({
        id: p.id, name: p.name, code: p.code,
        price: parseFloat(p.defaultPrice.toString()),
        is_serialized: p.isSerialized,
        unit_code: p.unit.code,
        primary_barcode: p.barcodes[0]?.code ?? null,
      })),
    };

    // Sign the snapshot
    const snapshotJson = JSON.stringify(snapshot);
    const signingKey = process.env.BARCODE_SIGNING_KEY ?? 'sandbox-signing-key-override';
    const signature = hmacSha256(signingKey, snapshotJson);

    // Update device last_bootstrap_at
    await db.device.update({
      where: { id: device.id },
      data: { lastBootstrapAt: new Date(), lastSeenAt: new Date(), schemaVersion: '1.0' },
    });

    await db.auditLog.create({
      data: {
        companyId: auth.companyId, userId: auth.userId, correlationId,
        action: 'offline.bootstrap', entityType: 'device', entityId: device.id,
        afterValue: JSON.stringify({ product_count: products.length, schema_version: '1.0' }),
      },
    });

    return NextResponse.json({
      snapshot,
      signature,
      expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), // 8h lease
    });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid bootstrap payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}
