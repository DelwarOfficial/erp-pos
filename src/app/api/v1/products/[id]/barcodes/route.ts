// src/app/api/v1/products/[id]/barcodes/route.ts
// GET  /api/v1/products/{id}/barcodes
// POST /api/v1/products/{id}/barcodes  — add a barcode (or generate QR)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import {
  validateBarcodeFormat,
  validateBarcodeUniqueness,
  generateSignedQrPayload,
  VALID_SYMBOLOGIES,
  Symbology,
} from '@/domain/invariants/barcode';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

const BarcodeCreateSchema = z.object({
  code: z.string().min(1).max(100).optional(), // omitted when symbology=QR (server generates)
  symbology: z.enum(VALID_SYMBOLOGIES),
  unit_id: z.string().uuid().optional(),
  package_quantity: z.number().positive().default(1),
  is_primary: z.boolean().default(false),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'product.update');
  await requirePermission(auth, 'product.read');
    const { id } = await params;
    const barcodes = await db.productBarcode.findMany({
      where: { productId: id, companyId: auth.companyId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return NextResponse.json({ items: barcodes });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    const { id } = await params;
    const idempotencyKey = requireIdempotencyKey(req);
    const body = BarcodeCreateSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: `/api/v1/products/${id}/barcodes`, body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'product.barcode.add', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const product = await tx.product.findFirst({
              where: { id, companyId: auth.companyId, deletedAt: null },
            });
            if (!product) throw new DomainError('RESOURCE_NOT_FOUND', 'Product not found', {}, 404);

            let code = body.code;
            if (body.symbology === 'QR') {
              if (code) {
                throw new DomainError('VALIDATION_FAILED', 'QR codes are server-generated; do not supply a code', {}, 400);
              }
              // Generate a temporary barcode row first to get an ID, then sign
              const temp = await tx.productBarcode.create({
                data: {
                  companyId: auth.companyId,
                  productId: id,
                  code: `qr-pending-${Date.now()}`,
                  symbology: 'QR',
                  unitId: body.unit_id ?? null,
                  packageQuantity: body.package_quantity,
                  isPrimary: body.is_primary,
                },
              });
              code = generateSignedQrPayload({
                companyId: auth.companyId,
                productId: id,
                barcodeId: temp.id,
              });
              const updated = await tx.productBarcode.update({
                where: { id: temp.id },
                data: { code },
              });
              await tx.auditLog.create({
                data: {
                  companyId: auth.companyId,
                  userId: auth.userId,
                  correlationId,
                  action: 'product.barcode.create_qr',
                  entityType: 'product_barcode',
                  entityId: updated.id,
                  afterValue: JSON.stringify({ product_id: id, symbology: 'QR' }),
                },
              });
              return {
                status: 201,
                body: { id: updated.id, code: updated.code, symbology: 'QR', is_primary: updated.isPrimary },
                resourceType: 'product_barcode',
                resourceId: updated.id,
              };
            }

            // Non-QR: validate format + uniqueness
            if (!code) {
              throw new DomainError('VALIDATION_FAILED', `Code is required for symbology ${body.symbology}`, {}, 400);
            }
            validateBarcodeFormat(code, body.symbology as Symbology);
            await validateBarcodeUniqueness(tx, { companyId: auth.companyId, code });

            // If is_primary, demote any existing primary
            if (body.is_primary) {
              await tx.productBarcode.updateMany({
                where: { productId: id, isPrimary: true },
                data: { isPrimary: false },
              });
            }

            const barcode = await tx.productBarcode.create({
              data: {
                companyId: auth.companyId,
                productId: id,
                code,
                symbology: body.symbology,
                unitId: body.unit_id ?? null,
                packageQuantity: body.package_quantity,
                isPrimary: body.is_primary,
              },
            });

            await tx.auditLog.create({
              data: {
                companyId: auth.companyId,
                userId: auth.userId,
                correlationId,
                action: 'product.barcode.create',
                entityType: 'product_barcode',
                entityId: barcode.id,
                afterValue: JSON.stringify({ product_id: id, code, symbology: body.symbology }),
              },
            });

            return {
              status: 201,
              body: { id: barcode.id, code: barcode.code, symbology: barcode.symbology, is_primary: barcode.isPrimary },
              resourceType: 'product_barcode',
              resourceId: barcode.id,
            };
          });
        },
      ),
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid barcode payload', { issues: e.issues }, 400), correlationId);
    }
    return errorResponse(e, correlationId);
  }
}
