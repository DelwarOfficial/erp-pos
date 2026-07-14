// tests/unit/comboGraph.test.ts
// Tests for cyclic combo detection per §16 validate_combo_graph.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { detectComboCycle, validateComboGraph } from '../../src/domain/invariants/comboGraph';
import { DomainError } from '../../src/lib/errors/codes';
import { hashPassword } from '../../src/lib/auth/password';

const db = new PrismaClient();

let companyId: string;
let categoryA: string, unitA: string;
let productA: string, productB: string, productC: string, productD: string;

beforeAll(async () => {
  await db.$connect();
  const company = await db.company.create({
    data: {
      code: 'TEST-COMBO-' + Date.now(),
      legalName: 'Combo Test Co',
      displayName: 'Combo Test',
      baseCurrencyCode: 'BDT',
      status: 'active',
    },
  });
  companyId = company.id;

  const cat = await db.category.create({
    data: { companyId, name: 'Test Cat', code: 'TC', isActive: true },
  });
  categoryA = cat.id;

  const unit = await db.unit.create({
    data: { companyId, name: 'Piece', code: 'PCS', conversionFactor: 1, allowFractional: false },
  });
  unitA = unit.id;

  // Create 4 standard products
  const a = await db.product.create({ data: { companyId, name: 'A', code: 'A', categoryId: categoryA, unitId: unitA, productType: 'standard' } });
  const b = await db.product.create({ data: { companyId, name: 'B', code: 'B', categoryId: categoryA, unitId: unitA, productType: 'standard' } });
  const c = await db.product.create({ data: { companyId, name: 'C', code: 'C', categoryId: categoryA, unitId: unitA, productType: 'standard' } });
  const d = await db.product.create({ data: { companyId, name: 'D', code: 'D', categoryId: categoryA, unitId: unitA, productType: 'standard' } });
  productA = a.id; productB = b.id; productC = c.id; productD = d.id;
});

afterAll(async () => {
  if (companyId) {
    await db.productComboItem.deleteMany({ where: { companyId } });
    await db.product.deleteMany({ where: { companyId } });
    await db.unit.deleteMany({ where: { companyId } });
    await db.category.deleteMany({ where: { companyId } });
    await db.company.deleteMany({ where: { id: companyId } });
  }
  await db.$disconnect();
});

describe('comboGraph', () => {
  it('returns null when no edges exist', async () => {
    const cycle = await db.$transaction(async (tx) => detectComboCycle(tx, companyId));
    expect(cycle).toBeNull();
  });

  it('rejects self-reference', async () => {
    await expect(
      db.$transaction(async (tx) =>
        validateComboGraph(tx, { companyId, comboProductId: productA, componentProductId: productA }),
      ),
    ).rejects.toThrow(/cannot reference itself/);
  });

  it('rejects non-combo parent', async () => {
    await expect(
      db.$transaction(async (tx) =>
        validateComboGraph(tx, { companyId, comboProductId: productA, componentProductId: productB }),
      ),
    ).rejects.toThrow(/not a combo product/);
  });

  it('accepts a clean combo (combo → standard components)', async () => {
    // Promote A to combo
    await db.product.update({ where: { id: productA }, data: { productType: 'combo' } });
    await db.$transaction(async (tx) =>
      validateComboGraph(tx, { companyId, comboProductId: productA, componentProductId: productB }),
    );
    await db.productComboItem.create({
      data: { companyId, comboProductId: productA, componentProductId: productB, componentQuantity: 1, componentUnitId: unitA },
    });
  });

  it('rejects nested combo (component is itself a combo)', async () => {
    // Make B a combo too — should not be allowed as a component
    await db.product.update({ where: { id: productB }, data: { productType: 'combo' } });
    await expect(
      db.$transaction(async (tx) =>
        validateComboGraph(tx, { companyId, comboProductId: productA, componentProductId: productB }),
      ),
    ).rejects.toThrow(/nested combos are not allowed/);
    // Revert B
    await db.product.update({ where: { id: productB }, data: { productType: 'standard' } });
  });
});
