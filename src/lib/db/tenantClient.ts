// Prisma extension enforcing fail-closed tenant isolation for MariaDB/SQLite.

import { Prisma, PrismaClient } from '@prisma/client';
import { getTenantContext } from './transactionContext';

const GLOBAL_MODELS = new Set([
  'Currency',
  'Permission',
  'ConfigurationDefinition',
  'SupportedLanguage',
]);

const DIRECT_TENANT_MODELS = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === 'companyId'))
    .map((model) => model.name),
);

const INDIRECT_SCOPES: Record<string, (companyId: string) => Record<string, unknown>> = {
  RolePermission: (companyId) => ({ role: { companyId } }),
  UserRole: (companyId) => ({ user: { companyId } }),
  UserBranchAccess: (companyId) => ({ user: { companyId } }),
  TaxCodeComponent: (companyId) => ({ taxCode: { companyId } }),
  StockAdjustmentItemSerial: (companyId) => ({ stockAdjustmentItem: { companyId } }),
  PurchaseReceivingItemSerial: (companyId) => ({ purchaseReceivingItem: { companyId } }),
  LandedCostAllocation: (companyId) => ({ landedCostDocument: { companyId } }),
  PurchaseReturnItemSerial: (companyId) => ({ purchaseReturnItem: { companyId } }),
  TransferItemSerial: (companyId) => ({ transferItem: { companyId } }),
  SaleItemSerial: (companyId) => ({ saleItem: { companyId } }),
  SaleReturnItemSerial: (companyId) => ({ saleReturnItem: { companyId } }),
  CourierCodSettlementItem: (companyId) => ({ settlement: { companyId } }),
  UserNotification: (companyId) => ({ notification: { companyId } }),
};

const INDIRECT_CREATE_PARENTS: Record<string, Array<{ field: string; delegate: string }>> = {
  RolePermission: [{ field: 'roleId', delegate: 'role' }],
  UserRole: [{ field: 'userId', delegate: 'user' }, { field: 'roleId', delegate: 'role' }],
  UserBranchAccess: [{ field: 'userId', delegate: 'user' }, { field: 'branchId', delegate: 'branch' }],
  TaxCodeComponent: [{ field: 'taxCodeId', delegate: 'taxCode' }, { field: 'taxComponentId', delegate: 'taxComponent' }],
  StockAdjustmentItemSerial: [{ field: 'stockAdjustmentItemId', delegate: 'stockAdjustmentItem' }, { field: 'serialId', delegate: 'productSerial' }],
  PurchaseReceivingItemSerial: [{ field: 'purchaseReceivingItemId', delegate: 'purchaseReceivingItem' }, { field: 'serialId', delegate: 'productSerial' }],
  LandedCostAllocation: [{ field: 'landedCostDocumentId', delegate: 'landedCostDocument' }, { field: 'purchaseItemId', delegate: 'purchaseItem' }],
  PurchaseReturnItemSerial: [{ field: 'purchaseReturnItemId', delegate: 'purchaseReturnItem' }, { field: 'serialId', delegate: 'productSerial' }],
  TransferItemSerial: [{ field: 'transferItemId', delegate: 'transferItem' }, { field: 'serialId', delegate: 'productSerial' }],
  SaleItemSerial: [{ field: 'saleItemId', delegate: 'saleItem' }, { field: 'serialId', delegate: 'productSerial' }],
  SaleReturnItemSerial: [{ field: 'saleReturnItemId', delegate: 'saleReturnItem' }, { field: 'serialId', delegate: 'productSerial' }],
  CourierCodSettlementItem: [{ field: 'settlementId', delegate: 'courierCodSettlement' }, { field: 'deliveryOrderId', delegate: 'deliveryOrder' }],
  UserNotification: [{ field: 'notificationId', delegate: 'notification' }, { field: 'userId', delegate: 'user' }],
};

const FILTERED_OPERATIONS = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'updateManyAndReturn',
  'delete', 'deleteMany',
]);

function isScopedModel(model: string): boolean {
  return model === 'Company' || DIRECT_TENANT_MODELS.has(model) || model in INDIRECT_SCOPES;
}

function scopeFor(model: string, companyId: string): Record<string, unknown> {
  if (model === 'Company') return { id: companyId };
  if (DIRECT_TENANT_MODELS.has(model)) return { companyId };
  return INDIRECT_SCOPES[model](companyId);
}

function addScope(args: Record<string, any>, scope: Record<string, unknown>) {
  const where = args.where ?? {};
  args.where = { ...where, AND: [scope] };
}

function enforceCompanyId(data: Record<string, any>, companyId: string) {
  if ('companyId' in data && data.companyId !== companyId) throw new Error('TENANT_VIOLATION');
  data.companyId = companyId;
}

async function validateIndirectCreate(
  prisma: PrismaClient,
  model: string,
  data: Record<string, any>,
  companyId: string,
) {
  for (const parent of INDIRECT_CREATE_PARENTS[model] ?? []) {
    const id = data[parent.field];
    if (typeof id !== 'string') throw new Error(`TENANT_PARENT_REQUIRED:${model}.${parent.field}`);
    const found = await (prisma as any)[parent.delegate].findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!found) throw new Error('TENANT_VIOLATION');
  }
}

export function applyTenantIsolation(prisma: PrismaClient) {
  return prisma.$extends({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ args, query, operation, model }) {
          if (!model || GLOBAL_MODELS.has(model) || !isScopedModel(model)) return query(args);

          const ctx = getTenantContext();
          if (!ctx) throw new Error(`TENANT_CONTEXT_REQUIRED:${model}`);
          if (ctx.isGlobal) return query(args);

          const mutableArgs = args as Record<string, any>;
          const scope = scopeFor(model, ctx.companyId);

          if (FILTERED_OPERATIONS.has(operation)) addScope(mutableArgs, scope);

          if (operation === 'create') {
            if (model === 'Company') throw new Error('SYSTEM_DB_REQUIRED:Company.create');
            if (DIRECT_TENANT_MODELS.has(model)) enforceCompanyId(mutableArgs.data, ctx.companyId);
            else await validateIndirectCreate(prisma, model, mutableArgs.data, ctx.companyId);
          }

          if (operation === 'createMany' || operation === 'createManyAndReturn') {
            if (model === 'Company') throw new Error(`SYSTEM_DB_REQUIRED:Company.${operation}`);
            const rows = Array.isArray(mutableArgs.data) ? mutableArgs.data : [mutableArgs.data];
            for (const row of rows) {
              if (DIRECT_TENANT_MODELS.has(model)) enforceCompanyId(row, ctx.companyId);
              else await validateIndirectCreate(prisma, model, row, ctx.companyId);
            }
          }

          if (operation === 'upsert') {
            addScope(mutableArgs, scope);
            if (model === 'Company') throw new Error('SYSTEM_DB_REQUIRED:Company.upsert');
            if (DIRECT_TENANT_MODELS.has(model)) {
              enforceCompanyId(mutableArgs.create, ctx.companyId);
              if (mutableArgs.update?.companyId && mutableArgs.update.companyId !== ctx.companyId) throw new Error('TENANT_VIOLATION');
            } else {
              await validateIndirectCreate(prisma, model, mutableArgs.create, ctx.companyId);
            }
          }

          if ((operation === 'update' || operation === 'updateMany' || operation === 'updateManyAndReturn')
            && mutableArgs.data?.companyId && mutableArgs.data.companyId !== ctx.companyId) {
            throw new Error('TENANT_VIOLATION');
          }

          return query(args);
        },
      },
    },
  });
}

export type TenantIsolatedClient = ReturnType<typeof applyTenantIsolation>;
