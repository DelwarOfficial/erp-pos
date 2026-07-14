// tests/unit/barcode.test.ts
// Tests for barcode validation per §5.4 product_barcodes.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  validateBarcodeFormat,
  validateBarcodeUniqueness,
  generateSignedQrPayload,
  verifySignedQrPayload,
  VALID_SYMBOLOGIES,
} from '../../src/domain/invariants/barcode';
import { DomainError } from '../../src/lib/errors/codes';

const db = new PrismaClient();

let companyId: string;
let productId: string;

beforeAll(async () => {
  await db.$connect();
  const company = await db.company.create({
    data: {
      code: 'TEST-BC-' + Date.now(),
      legalName: 'Barcode Test Co',
      displayName: 'Barcode Test',
      baseCurrencyCode: 'BDT',
      status: 'active',
    },
  });
  companyId = company.id;
  const cat = await db.category.create({
    data: { companyId, name: 'Cat', code: 'C', isActive: true },
  });
  const unit = await db.unit.create({
    data: { companyId, name: 'Pc', code: 'PC', conversionFactor: 1, allowFractional: false },
  });
  const p = await db.product.create({
    data: { companyId, name: 'P', code: 'P', categoryId: cat.id, unitId: unit.id, productType: 'standard' },
  });
  productId = p.id;
});

afterAll(async () => {
  if (companyId) {
    await db.productBarcode.deleteMany({ where: { companyId } });
    await db.product.deleteMany({ where: { companyId } });
    await db.unit.deleteMany({ where: { companyId } });
    await db.category.deleteMany({ where: { companyId } });
    await db.company.deleteMany({ where: { id: companyId } });
  }
  await db.$disconnect();
});

describe('barcode format validation', () => {
  it('accepts valid CODE128', () => {
    expect(() => validateBarcodeFormat('ABC123', 'CODE128')).not.toThrow();
  });

  it('accepts valid EAN13', () => {
    expect(() => validateBarcodeFormat('123456789012', 'EAN13')).not.toThrow();
    expect(() => validateBarcodeFormat('1234567890123', 'EAN13')).not.toThrow();
  });

  it('rejects malformed EAN13', () => {
    expect(() => validateBarcodeFormat('123', 'EAN13')).toThrow(/EAN13 barcode must be/);
    expect(() => validateBarcodeFormat('ABCDEFGHIJKL', 'EAN13')).toThrow();
  });

  it('accepts valid EAN8', () => {
    expect(() => validateBarcodeFormat('1234567', 'EAN8')).not.toThrow();
  });

  it('accepts valid UPCA', () => {
    expect(() => validateBarcodeFormat('12345678901', 'UPCA')).not.toThrow();
  });

  it('rejects client-supplied QR codes', () => {
    expect(() => validateBarcodeFormat('whatever', 'QR')).toThrow(/server-side/);
  });
});

describe('signed QR payload', () => {
  it('generates and verifies a signed payload', () => {
    const signed = generateSignedQrPayload({
      companyId: '11111111-1111-1111-1111-111111111111',
      productId: '22222222-2222-2222-2222-222222222222',
      barcodeId: '33333333-3333-3333-3333-333333333333',
    });
    expect(signed).toMatch(/^erp-pos:\/\/p\//);
    const decoded = verifySignedQrPayload(signed);
    expect(decoded.companyId).toBe('11111111-1111-1111-1111-111111111111');
    expect(decoded.productId).toBe('22222222-2222-2222-2222-222222222222');
    expect(decoded.barcodeId).toBe('33333333-3333-3333-3333-333333333333');
  });

  it('rejects tampered signature', () => {
    const signed = generateSignedQrPayload({
      companyId: 'c', productId: 'p', barcodeId: 'b',
    });
    // Tamper the signature
    const tampered = signed.slice(0, -10) + '0123456789';
    expect(() => verifySignedQrPayload(tampered)).toThrow(/signature mismatch/);
  });

  it('rejects malformed payload', () => {
    expect(() => verifySignedQrPayload('not-a-qr-payload')).toThrow(/Malformed/);
  });
});

describe('barcode uniqueness', () => {
  it('rejects duplicate barcode within the same company', async () => {
    // First insert
    await db.productBarcode.create({
      data: {
        companyId, productId, code: 'UNIQ-001', symbology: 'CODE128', packageQuantity: 1, isPrimary: false,
      },
    });

    // Try to validate a duplicate
    await expect(
      db.$transaction(async (tx) =>
        validateBarcodeUniqueness(tx, { companyId, code: 'UNIQ-001' }),
      ),
    ).rejects.toThrow(/already assigned/);
  });

  it('accepts a unique barcode', async () => {
    await db.$transaction(async (tx) =>
      validateBarcodeUniqueness(tx, { companyId, code: 'UNIQUE-NEW-002' }),
    );
  });
});
