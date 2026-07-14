// src/lib/import-export/templates.ts
// Versioned import templates per §9.5.
// Each template defines: required columns, optional columns, validation rules,
// duplicate strategy, and the entity type to create.

export interface ImportTemplate {
  type: string;
  version: string;
  requiredColumns: string[];
  optionalColumns: string[];
  duplicateKey?: string; // column name used for duplicate detection
  allowedDuplicateStrategies: string[]; // skip/update/fail
  entityType: string; // product/customer/supplier/sale/transfer
  validatesSerial?: boolean; // serialized imports require one serial per row
}

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
  sale_draft: {
    type: 'sale_draft',
    version: '1.0',
    requiredColumns: ['reference_no', 'branch_code', 'product_code', 'qty', 'unit_price'],
    optionalColumns: ['customer_phone', 'discount_amount', 'serial_number', 'payment_method', 'payment_amount', 'business_date'],
    duplicateKey: 'reference_no',
    allowedDuplicateStrategies: ['skip', 'fail'],
    entityType: 'sale',
    validatesSerial: true,
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
  },
};

export function getTemplate(type: string): ImportTemplate | undefined {
  return IMPORT_TEMPLATES[type];
}

export function getTemplateColumns(type: string): { required: string[]; optional: string[] } | undefined {
  const template = IMPORT_TEMPLATES[type];
  if (!template) return undefined;
  return { required: template.requiredColumns, optional: template.optionalColumns };
}
