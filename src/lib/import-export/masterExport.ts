// src/lib/import-export/masterExport.ts
// Exports master data in exactly its import template's format: the same
// columns in the same order, codes and names instead of ids, booleans as
// 'true'/'false'. An exported file can be edited and imported back with
// duplicate_strategy=update.
//
// Rows are read a page at a time (never the whole table at once), and every
// read is scoped to the company.

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getTemplateHeader } from './templates';
import { MASTER_EXPORT_TYPES, type MasterExportType } from './masterExport.client';

export { MASTER_EXPORT_TYPES, type MasterExportType };

export const isMasterExportType = (type: string): type is MasterExportType =>
  (MASTER_EXPORT_TYPES as readonly string[]).includes(type);

/**
 * Columns left empty unless the caller may export sensitive fields (cost and
 * personal or tax details). An empty cell imports as "keep the stored value",
 * so a file exported without them still imports back safely.
 */
export const SENSITIVE_COLUMNS: Record<MasterExportType, string[]> = {
  product: ['reference_cost'],
  customer: ['phone', 'email', 'address', 'tax_identifier'],
  supplier: ['phone', 'email', 'address', 'tax_identifier'],
  category: [],
  unit: [],
  brand: [],
};

export const MASTER_EXPORT_PAGE_SIZE = 500;

export function masterExportHeader(type: MasterExportType): string[] {
  return getTemplateHeader(type)!;
}

const text = (value: string | null | undefined) => value ?? '';
const decimal = (value: Prisma.Decimal | number | null | undefined) => (value === null || value === undefined ? '' : new Prisma.Decimal(value).toString());

/** One page of rows after `cursor` (an id), as records keyed by template column. */
async function page(type: MasterExportType, companyId: string, cursor: string | undefined): Promise<Array<{ id: string; row: Record<string, string> }>> {
  const args = { take: MASTER_EXPORT_PAGE_SIZE, orderBy: { id: 'asc' as const }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) };
  switch (type) {
    case 'product': {
      const rows = await db.product.findMany({
        ...args,
        where: { companyId, deletedAt: null },
        include: {
          category: { select: { code: true } },
          unit: { select: { code: true } },
          brand: { select: { name: true } },
          barcodes: { select: { code: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1 },
        },
      });
      return rows.map(p => ({ id: p.id, row: {
        code: p.code, name: p.name, category: p.category.code, unit: p.unit.code, product_type: p.productType,
        barcode: text(p.barcodes[0]?.code), brand: text(p.brand?.name), is_serialized: String(p.isSerialized),
        track_batches: String(p.trackBatches), warranty_months: p.warrantyPeriodMonths === null ? '' : String(p.warrantyPeriodMonths),
        reference_cost: decimal(p.referenceCost), default_price: decimal(p.defaultPrice), alert_quantity: decimal(p.alertQuantity),
        description: text(p.description), is_active: String(p.isActive),
      } }));
    }
    case 'customer': {
      const rows = await db.customer.findMany({ ...args, where: { companyId, deletedAt: null }, include: { customerGroup: { select: { name: true } } } });
      return rows.map(c => ({ id: c.id, row: {
        name: c.name, phone: text(c.phone), email: text(c.email), address: text(c.address), tax_identifier: text(c.taxIdentifier),
        credit_limit: decimal(c.creditLimit), customer_group: text(c.customerGroup?.name), is_active: String(c.isActive),
      } }));
    }
    case 'supplier': {
      const rows = await db.supplier.findMany({ ...args, where: { companyId, deletedAt: null } });
      return rows.map(s => ({ id: s.id, row: {
        name: s.name, phone: text(s.phone), email: text(s.email), address: text(s.address), tax_identifier: text(s.taxIdentifier),
        payment_terms_days: String(s.paymentTermsDays), currency_code: s.currencyCode, is_active: String(s.isActive),
      } }));
    }
    case 'category': {
      const rows = await db.category.findMany({ ...args, where: { companyId, deletedAt: null } });
      const parentIds = [...new Set(rows.map(c => c.parentId).filter((id): id is string => !!id))];
      const parents = parentIds.length ? await db.category.findMany({ where: { companyId, id: { in: parentIds } }, select: { id: true, code: true } }) : [];
      const parentCode = new Map(parents.map(p => [p.id, p.code]));
      return rows.map(c => ({ id: c.id, row: {
        code: c.code, name: c.name, parent_code: c.parentId ? text(parentCode.get(c.parentId)) : '', is_active: String(c.isActive),
      } }));
    }
    case 'unit': {
      const rows = await db.unit.findMany({ ...args, where: { companyId } });
      return rows.map(u => ({ id: u.id, row: { code: u.code, name: u.name, allow_fractional: String(u.allowFractional) } }));
    }
    case 'brand': {
      const rows = await db.brand.findMany({ ...args, where: { companyId, deletedAt: null } });
      return rows.map(b => ({ id: b.id, row: { name: b.name, is_active: String(b.isActive) } }));
    }
  }
}

/**
 * Yields the export a page at a time, as rows in masterExportHeader order.
 * `scope` runs each read (callers pass runInTenantContext, since a streamed
 * response reads after the handler has returned).
 */
export async function* masterExportPages(
  type: MasterExportType,
  companyId: string,
  includeSensitive: boolean,
  scope: <T>(work: () => Promise<T>) => Promise<T>,
): AsyncGenerator<string[][]> {
  const header = masterExportHeader(type);
  const hidden = new Set(includeSensitive ? [] : SENSITIVE_COLUMNS[type]);
  let cursor: string | undefined;
  for (;;) {
    const rows = await scope(() => page(type, companyId, cursor));
    if (rows.length === 0) return;
    yield rows.map(({ row }) => header.map(column => (hidden.has(column) ? '' : row[column] ?? '')));
    if (rows.length < MASTER_EXPORT_PAGE_SIZE) return;
    cursor = rows[rows.length - 1].id;
  }
}
