// src/lib/import-export/templates.ts
// Versioned import templates per §9.5.
// Each template defines: required columns, optional columns, validation rules,
// duplicate strategy, and the entity type to create.
//
// This module has no server imports: the dashboard reads it too, so template
// downloads always carry exactly the columns the server validates.

export interface ImportTemplate {
  type: string;
  version: string;
  requiredColumns: string[];
  optionalColumns: string[];
  duplicateKey?: string; // column name used for duplicate detection
  allowedDuplicateStrategies: string[]; // skip/update/fail
  entityType: string; // product/customer/supplier/sale/transfer/purchase/stock_movement/category/unit/brand
  validatesSerial?: boolean; // serialized imports require one serial per row
  /**
   * Rows that share this column's value make one document (the lines of one
   * sale, purchase or transfer; the lines of one warehouse's opening stock).
   * Each document is written in one transaction: all of its lines or none.
   */
  groupKey?: string;
}

/** The most data rows one file may hold. Larger files fail validation with ROW_LIMIT_EXCEEDED. */
export const MAX_IMPORT_ROWS = 10_000;

/** The largest file accepted, checked before it is read (10,000 wide rows fit well inside it). */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export const IMPORT_TEMPLATES: Record<string, ImportTemplate> = {
  product: {
    type: 'product',
    version: '1.0',
    requiredColumns: ['code', 'name', 'category', 'unit', 'product_type'],
    optionalColumns: ['barcode', 'brand', 'is_serialized', 'track_batches', 'warranty_months', 'reference_cost', 'default_price', 'alert_quantity', 'description', 'is_active'],
    duplicateKey: 'code',
    allowedDuplicateStrategies: ['skip', 'update', 'fail'],
    entityType: 'product',
  },
  customer: {
    type: 'customer',
    version: '1.0',
    requiredColumns: ['name'],
    optionalColumns: ['phone', 'email', 'address', 'tax_identifier', 'credit_limit', 'customer_group', 'is_active'],
    duplicateKey: 'phone',
    allowedDuplicateStrategies: ['skip', 'update', 'fail'],
    entityType: 'customer',
  },
  supplier: {
    type: 'supplier',
    version: '1.0',
    requiredColumns: ['name'],
    optionalColumns: ['phone', 'email', 'address', 'tax_identifier', 'payment_terms_days', 'currency_code', 'is_active'],
    duplicateKey: 'name',
    allowedDuplicateStrategies: ['skip', 'update', 'fail'],
    entityType: 'supplier',
  },
  category: {
    type: 'category',
    version: '1.0',
    requiredColumns: ['code', 'name'],
    optionalColumns: ['parent_code', 'is_active'],
    duplicateKey: 'code',
    allowedDuplicateStrategies: ['skip', 'update', 'fail'],
    entityType: 'category',
  },
  unit: {
    type: 'unit',
    version: '1.0',
    requiredColumns: ['code', 'name'],
    optionalColumns: ['allow_fractional'],
    duplicateKey: 'code',
    allowedDuplicateStrategies: ['skip', 'update', 'fail'],
    entityType: 'unit',
  },
  brand: {
    type: 'brand',
    version: '1.0',
    requiredColumns: ['name'],
    optionalColumns: ['is_active'],
    duplicateKey: 'name',
    allowedDuplicateStrategies: ['skip', 'update', 'fail'],
    entityType: 'brand',
  },
  sale_draft: {
    type: 'sale_draft',
    version: '1.0',
    requiredColumns: ['reference_no', 'branch_code', 'product_code', 'qty', 'unit_price'],
    optionalColumns: ['customer_phone', 'discount_amount', 'serial_number', 'payment_method', 'payment_amount', 'business_date'],
    duplicateKey: 'reference_no',
    allowedDuplicateStrategies: ['skip', 'fail'],
    entityType: 'sale',
    validatesSerial: true,
    groupKey: 'reference_no',
  },
  transfer_draft: {
    type: 'transfer_draft',
    version: '1.0',
    requiredColumns: ['from_warehouse_code', 'to_warehouse_code', 'product_code', 'qty'],
    optionalColumns: ['serial_number', 'reference_no'],
    duplicateKey: 'reference_no',
    allowedDuplicateStrategies: ['skip', 'fail'],
    entityType: 'transfer',
    validatesSerial: true,
    groupKey: 'reference_no',
  },
  purchase: {
    type: 'purchase',
    version: '1.0',
    requiredColumns: ['supplier_name', 'branch_code', 'product_code', 'qty', 'unit_cost'],
    optionalColumns: ['reference_no', 'serial_number', 'expected_delivery_date', 'tax_code'],
    duplicateKey: 'reference_no',
    allowedDuplicateStrategies: ['skip', 'fail'],
    entityType: 'purchase',
    validatesSerial: true,
    groupKey: 'reference_no',
  },
  opening_stock: {
    type: 'opening_stock',
    version: '1.0',
    requiredColumns: ['warehouse_code', 'product_code', 'qty', 'unit_cost'],
    optionalColumns: ['serial_number', 'batch_number', 'expiry_date'],
    duplicateKey: undefined,
    allowedDuplicateStrategies: ['skip', 'fail'],
    entityType: 'stock_movement',
    validatesSerial: true,
    groupKey: 'warehouse_code',
  },
};

/** One example row per template, for the downloadable template file. Keys are template columns. */
const DEMO_ROWS: Record<string, Record<string, string>> = {
  product: { code: 'TV-43', name: 'Smart TV 43 inch', category: 'TV', unit: 'PCS', product_type: 'standard', barcode: '8901234567890', brand: 'Walton', is_serialized: 'true', track_batches: 'false', warranty_months: '12', reference_cost: '28000', default_price: '32000', alert_quantity: '2', description: '', is_active: 'true' },
  customer: { name: 'Rahim Uddin', phone: '01711000000', email: '', address: 'Mirpur 10, Dhaka', tax_identifier: '', credit_limit: '20000', customer_group: '', is_active: 'true' },
  supplier: { name: 'Dhaka Electronics Ltd', phone: '01811000000', email: '', address: 'Elephant Road, Dhaka', tax_identifier: '', payment_terms_days: '30', currency_code: 'BDT', is_active: 'true' },
  category: { code: 'TV', name: 'Televisions', parent_code: '', is_active: 'true' },
  unit: { code: 'PCS', name: 'Piece', allow_fractional: 'false' },
  brand: { name: 'Walton', is_active: 'true' },
  sale_draft: { reference_no: 'S-1001', branch_code: 'DHK', product_code: 'TV-43', qty: '1', unit_price: '32000', customer_phone: '01711000000', discount_amount: '0', serial_number: 'SN-0001', payment_method: 'cash', payment_amount: '32000', business_date: '2026-11-25' },
  transfer_draft: { from_warehouse_code: 'WH-DHK', to_warehouse_code: 'WH-CTG', product_code: 'TV-43', qty: '1', serial_number: 'SN-0002', reference_no: 'T-1001' },
  purchase: { supplier_name: 'Dhaka Electronics Ltd', branch_code: 'DHK', product_code: 'TV-43', qty: '5', unit_cost: '28000', reference_no: 'P-1001', serial_number: '', expected_delivery_date: '2026-12-01', tax_code: '' },
  opening_stock: { warehouse_code: 'WH-DHK', product_code: 'TV-43', qty: '1', unit_cost: '28000', serial_number: 'SN-0003', batch_number: '', expiry_date: '' },
};

export function getTemplate(type: string): ImportTemplate | undefined {
  return IMPORT_TEMPLATES[type];
}

export function getTemplateColumns(type: string): { required: string[]; optional: string[] } | undefined {
  const template = IMPORT_TEMPLATES[type];
  if (!template) return undefined;
  return { required: template.requiredColumns, optional: template.optionalColumns };
}

/** All columns of a template in file order: required first, then optional. */
export function getTemplateHeader(type: string): string[] | undefined {
  const columns = getTemplateColumns(type);
  return columns ? [...columns.required, ...columns.optional] : undefined;
}

/** The demo row for a template, in getTemplateHeader order. */
export function getTemplateDemoRow(type: string): string[] | undefined {
  const header = getTemplateHeader(type);
  if (!header) return undefined;
  const demo = DEMO_ROWS[type] ?? {};
  return header.map(column => demo[column] ?? '');
}
