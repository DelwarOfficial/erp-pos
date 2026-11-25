// src/lib/import-export/masterExport.client.ts
// The master-data export types, without server imports, for the dashboard.

export const MASTER_EXPORT_TYPES = ['product', 'customer', 'supplier', 'category', 'unit', 'brand'] as const;
export type MasterExportType = (typeof MASTER_EXPORT_TYPES)[number];
