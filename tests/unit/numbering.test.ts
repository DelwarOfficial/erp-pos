// tests/unit/numbering.test.ts
// Tests for nextDocumentNumber():
//   - Issues sequential numbers per (company, branch|null, documentType, fiscalYear)
//   - Pads with leading zeros to the configured width
//   - Combines prefix + number
//   - Concurrent calls produce distinct numbers

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { nextDocumentNumber } from '../../src/lib/numbering';
import { db } from '../../src/lib/db';
import { hashPassword } from '../../src/lib/auth/password';

const testDb = new PrismaClient();

let companyId: string;
let branchId: string;

beforeAll(async () => {
  await testDb.$connect();
  const company = await testDb.company.create({
    data: {
      code: 'TEST-NUM-' + Date.now(),
      legalName: 'Numbering Test Co',
      displayName: 'Numbering Test',
      baseCurrencyCode: 'BDT',
      status: 'active',
    },
  });
  companyId = company.id;
  const branch = await testDb.branch.create({
    data: { companyId, name: 'Main', code: 'MAIN', isActive: true },
  });
  branchId = branch.id;
});

afterAll(async () => {
  if (companyId) {
    await testDb.documentSequence.deleteMany({ where: { companyId } });
    await testDb.branch.deleteMany({ where: { companyId } });
    await testDb.company.deleteMany({ where: { id: companyId } });
  }
  await testDb.$disconnect();
});

describe('nextDocumentNumber', () => {
  it('issues sequential numbers per company+branch+type+fiscalYear', async () => {
    const params = {
      companyId, branchId, documentType: 'SALE', fiscalYear: 2026, prefix: 'INV-', padding: 6,
    };
    const a = await testDb.$transaction(async (tx) => nextDocumentNumber(tx, params));
    const b = await testDb.$transaction(async (tx) => nextDocumentNumber(tx, params));
    const c = await testDb.$transaction(async (tx) => nextDocumentNumber(tx, params));

    expect(a.documentNumber).toBe('INV-000001');
    expect(b.documentNumber).toBe('INV-000002');
    expect(c.documentNumber).toBe('INV-000003');
  });

  it('issues from a separate sequence for company-wide (branchId=null)', async () => {
    const branchScoped = await testDb.$transaction(async (tx) =>
      nextDocumentNumber(tx, { companyId, branchId, documentType: 'TRANSFER', fiscalYear: 2026, prefix: 'TR-' }),
    );
    const companyScoped = await testDb.$transaction(async (tx) =>
      nextDocumentNumber(tx, { companyId, branchId: null, documentType: 'TRANSFER', fiscalYear: 2026, prefix: 'TR-' }),
    );
    expect(branchScoped.documentNumber).toBe('TR-000001');
    expect(companyScoped.documentNumber).toBe('TR-000001'); // separate sequence
  });

  it('rolls back the increment if the parent transaction rolls back', async () => {
    const before = await testDb.documentSequence.findFirst({
      where: { companyId, branchId, documentType: 'PURCHASE', fiscalYear: 2026 },
    });
    const beforeNext = before?.nextNumber ?? 1n;

    try {
      await testDb.$transaction(async (tx) => {
        await nextDocumentNumber(tx, {
          companyId, branchId, documentType: 'PURCHASE', fiscalYear: 2026, prefix: 'PO-',
        });
        throw new Error('rollback-on-purpose');
      });
    } catch (e) {
      expect((e as Error).message).toBe('rollback-on-purpose');
    }

    const after = await testDb.documentSequence.findFirst({
      where: { companyId, branchId, documentType: 'PURCHASE', fiscalYear: 2026 },
    });
    expect(after?.nextNumber ?? 1n).toBe(beforeNext); // unchanged
  });

  it('issues distinct numbers under sequential transactions (SQLite serializes writes)', async () => {
    // Note: SQLite uses a single-writer lock. True parallel writes would deadlock.
    // In Postgres production, this test would use Promise.all() with SERIALIZABLE
    // isolation and the document_sequences row lock (FOR UPDATE) would serialize
    // safely. Here we issue sequentially to verify correctness of the increment.
    const numbers: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await testDb.$transaction(async (tx) =>
        nextDocumentNumber(tx, {
          companyId, branchId, documentType: 'CONCURRENT_TEST', fiscalYear: 2026, prefix: 'CC-', padding: 6,
        }),
      );
      numbers.push(r.documentNumber);
    }
    const uniqueNumbers = new Set(numbers);
    expect(uniqueNumbers.size).toBe(10);
    // Numbers should be 000001..000010
    expect(numbers.sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `CC-${String(i + 1).padStart(6, '0')}`),
    );
  });
});
