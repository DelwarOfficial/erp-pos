// src/domain/invariants/productActivation.ts
// Product activation validation per §5.4 + §16 validate_typed_configuration.
//
// A product cannot be activated unless:
//   1. It has a valid category (not deleted)
//   2. It has a valid unit (not deleted)
//   3. If is_serialized=true, the unit must NOT allow_fractional
//   4. If product_type=combo, it must have at least one combo item, and the
//      combo graph must be acyclic (validateComboGraph)
//   5. If product_type=service or digital, is_serialized must be false and
//      track_batches must be false
//   6. If default_tax_code_id is set, the tax code must be active and
//      effective on the current date
//   7. At least one barcode is marked is_primary (if barcodes exist)
//   8. At least one product_unit_options row with is_default_sale=true
//      (for standard/combo products)

import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';
import { detectComboCycle } from './comboGraph';

export interface ProductActivationParams {
  productId: string;
  companyId: string;
}

export async function validateProductActivation(
  tx: Prisma.TransactionClient,
  params: ProductActivationParams,
): Promise<void> {
  const product = await tx.product.findFirst({
    where: { id: params.productId, companyId: params.companyId, deletedAt: null },
    include: {
      category: true,
      unit: true,
      barcodes: true,
      unitOptions: true,
      comboAsParent: true,
      defaultTaxCode: true,
    },
  });
  if (!product) {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Product not found', {}, 404);
  }

  const errors: string[] = [];

  // 1. Category must exist and not be deleted
  if (!product.category || product.category.deletedAt || !product.category.isActive) {
    errors.push('Product must have an active, non-deleted category');
  }

  // 2. Unit must exist
  if (!product.unit) {
    errors.push('Product must have a unit');
  }

  // 3. Serialized products require non-fractional units
  if (product.isSerialized && product.unit?.allowFractional) {
    errors.push('Serialized products require a non-fractional unit (integer quantities only)');
  }

  // 4. Combo products must have at least one component + acyclic graph
  if (product.productType === 'combo') {
    if (product.comboAsParent.length === 0) {
      errors.push('Combo product must have at least one component');
    } else {
      const cycle = await detectComboCycle(tx, params.companyId, product.id);
      if (cycle) {
        errors.push(`Combo graph has a cycle: ${cycle.join(' → ')}`);
      }
    }
  }

  // 5. Service/digital products: no serialization, no batches
  if ((product.productType === 'service' || product.productType === 'digital')) {
    if (product.isSerialized) {
      errors.push(`${product.productType} products cannot be serialized`);
    }
    if (product.trackBatches) {
      errors.push(`${product.productType} products cannot track batches`);
    }
  }

  // 6. Tax code (if set) must be active + effective
  if (product.defaultTaxCodeId && product.defaultTaxCode) {
    const now = new Date();
    if (!product.defaultTaxCode.isActive) {
      errors.push('Default tax code is not active');
    }
    if (product.defaultTaxCode.effectiveFrom > now) {
      errors.push('Default tax code is not yet effective');
    }
    if (product.defaultTaxCode.effectiveTo && product.defaultTaxCode.effectiveTo < now) {
      errors.push('Default tax code has expired');
    }
  }

  // 7. At most one primary barcode (enforced by partial unique in Postgres;
  //    in SQLite we check here)
  const primaryBarcodes = product.barcodes.filter(b => b.isPrimary);
  if (product.barcodes.length > 0 && primaryBarcodes.length === 0) {
    errors.push('At least one barcode must be marked primary');
  }
  if (primaryBarcodes.length > 1) {
    errors.push('Only one barcode can be marked primary');
  }

  // 8. Standard/combo products need a default sale unit
  if (product.productType === 'standard' || product.productType === 'combo') {
    const defaultSale = product.unitOptions.find(o => o.isDefaultSale);
    if (!defaultSale) {
      errors.push('Standard/combo products must have a default sale unit option');
    }
    const defaultPurchase = product.unitOptions.find(o => o.isDefaultPurchase);
    if (!defaultPurchase) {
      errors.push('Standard/combo products must have a default purchase unit option');
    }
  }

  if (errors.length > 0) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'Product activation validation failed',
      { errors },
      400,
    );
  }
}

/**
 * Validate a unit conversion: derived unit must belong to the same company
 * as its base unit, conversion_factor > 0, and base_unit_id must not form
 * a cycle.
 */
export async function validateUnitConversion(
  tx: Prisma.TransactionClient,
  params: { companyId: string; unitId: string; baseUnitId?: string | null; conversionFactor: number | string },
): Promise<void> {
  const factor = typeof params.conversionFactor === 'string'
    ? parseFloat(params.conversionFactor)
    : params.conversionFactor;
  if (!(factor > 0)) {
    throw new DomainError('VALIDATION_FAILED', 'Conversion factor must be > 0', {}, 400);
  }

  if (!params.baseUnitId) return; // root unit, no conversion

  // Cycle detection in unit tree
  const visited = new Set<string>();
  let current: string | null = params.baseUnitId;
  while (current) {
    if (current === params.unitId) {
      throw new DomainError('VALIDATION_FAILED', 'Unit conversion cycle detected', {}, 400);
    }
    if (visited.has(current)) break; // already-validated chain
    visited.add(current);
    const u = await tx.unit.findUnique({
      where: { id: current },
      select: { baseUnitId: true, companyId: true },
    });
    if (!u) break;
    if (u.companyId !== params.companyId) {
      throw new DomainError('VALIDATION_FAILED', 'Base unit must belong to the same company', {}, 400);
    }
    current = u.baseUnitId;
  }
}
