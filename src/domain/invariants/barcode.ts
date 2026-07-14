// src/domain/invariants/barcode.ts
// Barcode validation per §5.4 product_barcodes.
//
// Validates:
//   - Code is unique per company (UNIQUE(company_id, code))
//   - Symbology is one of CODE128/CODE39/EAN8/EAN13/UPCA/QR
//   - EAN8 must be 7 or 8 digits; EAN13 must be 12 or 13 digits; UPCA must be 11 or 12 digits
//   - QR content is a signed payload or configured product URL — never arbitrary executable URLs

import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';
import { hmacSha256 } from '@/lib/crypto';

export const VALID_SYMBOLOGIES = ['CODE128', 'CODE39', 'EAN8', 'EAN13', 'UPCA', 'QR'] as const;
export type Symbology = (typeof VALID_SYMBOLOGIES)[number];

export function validateBarcodeFormat(code: string, symbology: Symbology): void {
  switch (symbology) {
    case 'EAN8':
      if (!/^\d{7,8}$/.test(code)) {
        throw new DomainError('VALIDATION_FAILED', `EAN8 barcode must be 7 or 8 digits: ${code}`, {}, 400);
      }
      break;
    case 'EAN13':
      if (!/^\d{12,13}$/.test(code)) {
        throw new DomainError('VALIDATION_FAILED', `EAN13 barcode must be 12 or 13 digits: ${code}`, {}, 400);
      }
      break;
    case 'UPCA':
      if (!/^\d{11,12}$/.test(code)) {
        throw new DomainError('VALIDATION_FAILED', `UPC-A barcode must be 11 or 12 digits: ${code}`, {}, 400);
      }
      break;
    case 'CODE128':
    case 'CODE39':
      if (code.length < 1 || code.length > 100) {
        throw new DomainError('VALIDATION_FAILED', `${symbology} barcode must be 1-100 chars: ${code}`, {}, 400);
      }
      break;
    case 'QR':
      // QR content is generated server-side as a signed payload
      // (see generateSignedQrPayload). Client-supplied QR codes are rejected.
      throw new DomainError('VALIDATION_FAILED', 'QR codes must be generated server-side', {}, 400);
  }
}

/**
 * Generate a signed QR payload for a product. The payload encodes
 * {company_id, product_id, barcode_id, ts} and is signed with HMAC-SHA256
 * using the BARCODE_SIGNING_KEY env var. This prevents tampering and
 * arbitrary-URL injection.
 */
export function generateSignedQrPayload(params: {
  companyId: string;
  productId: string;
  barcodeId: string;
}): string {
  const ts = Date.now();
  const payload = JSON.stringify({
    c: params.companyId,
    p: params.productId,
    b: params.barcodeId,
    ts,
  });
  const key = process.env.BARCODE_SIGNING_KEY ?? 'sandbox-barcode-key-override-in-prod';
  const sig = hmacSha256(key, payload);
  // Base64url encode payload for URL safety
  const b64 = Buffer.from(payload).toString('base64url');
  return `erp-pos://p/${b64}/${sig}`;
}

/**
 * Verify a signed QR payload. Returns the decoded payload if valid.
 */
export function verifySignedQrPayload(signed: string): { companyId: string; productId: string; barcodeId: string; ts: number } {
  const m = signed.match(/^erp-pos:\/\/p\/([^/]+)\/([a-f0-9]+)$/);
  if (!m) {
    throw new DomainError('INVALID_SIGNATURE', 'Malformed QR payload', {}, 400);
  }
  const [, b64, sig] = m;
  const payload = Buffer.from(b64, 'base64url').toString('utf8');
  const key = process.env.BARCODE_SIGNING_KEY ?? 'sandbox-barcode-key-override-in-prod';
  const expected = hmacSha256(key, payload);
  if (sig !== expected) {
    throw new DomainError('INVALID_SIGNATURE', 'QR payload signature mismatch', {}, 401);
  }
  try {
    const parsed = JSON.parse(payload);
    return {
      companyId: parsed.c,
      productId: parsed.p,
      barcodeId: parsed.b,
      ts: parsed.ts,
    };
  } catch {
    throw new DomainError('INVALID_SIGNATURE', 'QR payload JSON parse failed', {}, 400);
  }
}

/**
 * Check barcode uniqueness within a company. Throws VALIDATION_FAILED on duplicate.
 */
export async function validateBarcodeUniqueness(
  tx: Prisma.TransactionClient,
  params: { companyId: string; code: string; excludeBarcodeId?: string },
): Promise<void> {
  const existing = await tx.productBarcode.findFirst({
    where: {
      companyId: params.companyId,
      code: params.code,
      ...(params.excludeBarcodeId ? { NOT: { id: params.excludeBarcodeId } } : {}),
    },
    select: { id: true, productId: true },
  });
  if (existing) {
    throw new DomainError(
      'VALIDATION_FAILED',
      `Barcode "${params.code}" is already assigned to another product`,
      { code: params.code, existing_product_id: existing.productId },
      409,
    );
  }
}
