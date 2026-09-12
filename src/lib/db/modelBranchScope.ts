import { Prisma } from '@prisma/client';

// Explicit domain ownership, not a guess based on every incidental FK. Identity,
// configuration and company-wide reference records are intentionally not here.
export const BRANCH_PARENTS: Record<string, string[]> = {
  WarehouseStock: ['warehouse'], StockMovement: ['warehouse'], StockReservation: ['warehouse'], ProductBatch: ['warehouse'],
  ProductSerial: ['currentWarehouse'], SerialEvent: ['fromWarehouse', 'toWarehouse'],
  StockCountItem: ['stockCount'], StockAdjustmentItem: ['stockAdjustment'], PurchaseItem: ['purchase'],
  PurchaseReceivingItem: ['purchaseReceiving'], LandedCostDocument: ['purchase'], PurchaseReturnItem: ['purchaseReturn'],
  Transfer: ['fromWarehouse', 'toWarehouse'], TransferItem: ['transfer'], QuotationItem: ['quotation'],
  SaleItem: ['sale'], SaleReturnItem: ['saleReturn'], CashDrawerCount: ['cashierShift'],
  PaymentAllocation: ['payment', 'sale', 'purchase'], ReturnRefundAllocation: ['payment', 'saleReturn'], Installment: ['sale'],
  ExpenseItem: ['expense'], ExpenseAttachment: ['expense'], DeliveryItem: ['deliveryOrder'], DeliveryEvent: ['deliveryOrder'],
  CourierShipment: ['deliveryOrder'], CourierCodSettlementItem: ['settlement', 'deliveryOrder'],
  ServiceRequestPart: ['serviceRequest'], ServiceEvent: ['serviceRequest'], WarrantyClaim: ['serviceRequest'], LeadActivity: ['lead'],
  CustomerAdvanceLedger: ['payment', 'saleReturn'], SupplierAdvanceLedger: ['payment', 'purchaseReturn'],
  WithholdingTransaction: ['payment'], CouponRedemption: ['sale'], RewardPointTransaction: ['sale'],
  LeaveRequest: ['employee'], AttendanceRecord: ['employee'], PayrollItem: ['payrollRun', 'employee'],
  FixedAssetDepreciation: ['fixedAsset'], BankReconciliation: ['financialAccount'],
  StockAdjustmentItemSerial: ['stockAdjustmentItem'], PurchaseReceivingItemSerial: ['purchaseReceivingItem'],
  PurchaseReturnItemSerial: ['purchaseReturnItem'], TransferItemSerial: ['transferItem'], SaleItemSerial: ['saleItem'],
  SaleReturnItemSerial: ['saleReturnItem'], LandedCostAllocation: ['landedCostDocument'],
};

export const modelByName = new Map(Prisma.dmmf.datamodel.models.map(model => [model.name, model]));

export function branchScopeFor(model: string, branchIds: string[]): Record<string, unknown> | null {
  if (model === 'Branch') return { id: { in: branchIds } };
  const definition = modelByName.get(model);
  const branch = definition?.fields.find(field => field.name === 'branchId');
  const scopes: Record<string, unknown>[] = [];
  if (branch) scopes.push(branch.isRequired ? { branchId: { in: branchIds } }
    : { OR: [{ branchId: null }, { branchId: { in: branchIds } }] });
  for (const name of BRANCH_PARENTS[model] ?? []) {
    const relation = definition?.fields.find(field => field.name === name && field.kind === 'object');
    if (!relation) throw new Error(`BRANCH_SCOPE_RELATION_MISSING:${model}.${name}`);
    const parent = branchScopeFor(relation.type, branchIds);
    if (!parent) throw new Error(`BRANCH_SCOPE_PARENT_MISSING:${model}.${name}`);
    scopes.push(relation.isRequired ? { [name]: parent } : { OR: [{ [name]: null }, { [name]: parent }] });
  }
  // A journal is indivisible: do not expose partial totals or lines from a denied
  // branch via an unfiltered nested include. Every line must be in scope.
  if (model === 'JournalEntry') scopes.push({ lines: { every: branchScopeFor('JournalLine', branchIds) } });
  if (model === 'ProductSerial') {
    const soldScope = { saleItem: branchScopeFor('SaleItem', branchIds) };
    scopes.push({ OR: [
      { currentWarehouse: { branchId: { in: branchIds } } },
      { currentWarehouseId: null, saleItemSerials: { some: soldScope, every: soldScope } },
    ] });
  }
  return scopes.length ? { AND: scopes } : null;
}
