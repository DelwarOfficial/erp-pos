// src/lib/db/tenantClient.ts
// Prisma client extension that enforces RLS-equivalent tenant isolation.
// Every query is automatically scoped by the TenantContext from AsyncLocalStorage.
// This is the SQLite sandbox equivalent of PostgreSQL RLS policies.

import { Prisma, PrismaClient } from '@prisma/client';
import { db } from './index';
import { getTenantContext } from './transaction';

// Tables that have a `companyId` column and must be tenant-scoped.
const TENANT_SCOPED_MODELS = new Set([
  // M0
  'company',
  'branch',
  'warehouse',
  'exchangeRate',
  'companyDomain',
  'user',
  'role',
  'permission', // global, not tenant-scoped — skipped below
  'rolePermission',
  'userRole',
  'userBranchAccess',
  'device',
  'refreshToken',
  'securityEvent',
  'cashierDevicePin',
  'documentSequence',
  'documentNumberLease',
  'idempotencyRequest',
  'businessEvent',
  'documentExchangeRate',
  'auditLog',
  'approvalRequest',
  'statutoryDocument',
  'taxReturnPeriod',
  'reconciliationRun',
  'reconciliationFinding',
  'recoveryEpoch',
  'integrationCredential',
  // M1 — §5.4 Catalogue
  'category',
  'brand',
  'unit',
  'customerGroup',
  'product',
  'mediaAsset',
  'entityMediaLink',
  'productBarcode',
  'productUnitOption',
  'productComboItem',
  'discountPolicy',
  'productPrice',
  'taxCode',
  'taxComponent',
  'taxCodeComponent',
  'withholdingRule',
  // M1 — §5.14A Settings
  'configurationValue',
  'posProfile',
  'documentTemplate',
  'companyLanguage',
  'translationOverride',
  'featureFlag',
  'dashboardPreference',
  'salesTarget',
  'savedReportFilter',
  'reportExportJob',
  'supportTicket',
  'supportTicketMessage',
  'communicationTemplate',
]);

// Models that are NOT tenant-scoped (global reference data).
const GLOBAL_MODELS = new Set([
  'currency',
  'permission',
  'configurationDefinition',
  'supportedLanguage',
]);

/**
 * Apply tenant isolation to the Prisma client. Reads the TenantContext from
 * AsyncLocalStorage and injects `companyId` filter on every query against
 * tenant-scoped models.
 *
 * If no TenantContext is set (e.g., during system init, migration, or
// public auth endpoints), no filter is applied — matching the behavior of
 * a migration_role that bypasses RLS.
 */
export function applyTenantIsolation(prisma: PrismaClient): PrismaClient {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query, operation, model }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          // Skip tenant filter for system operations (no context)
          const ctx = getTenantContext();
          if (!ctx) {
            return query(args);
          }

          // For find*: inject where.companyId
          if (operation === 'findFirst' || operation === 'findMany' || operation === 'count' || operation === 'findUnique') {
            const where = (args as { where?: Record<string, unknown> }).where ?? {};
            // Skip if companyId is already explicitly set (e.g., system lookup)
            if (!('companyId' in where)) {
              (args as { where?: Record<string, unknown> }).where = {
                ...where,
                companyId: ctx.companyId,
              };
            }
          }

          // For create: inject data.companyId
          if (operation === 'create') {
            const data = (args as { data?: Record<string, unknown> }).data ?? {};
            if (!('companyId' in data)) {
              (args as { data?: Record<string, unknown> }).data = {
                ...data,
                companyId: ctx.companyId,
              };
            }
          }

          // For updateMany/deleteMany: inject where.companyId
          if (operation === 'updateMany' || operation === 'deleteMany') {
            const where = (args as { where?: Record<string, unknown> }).where ?? {};
            (args as { where?: Record<string, unknown> }).where = {
              ...where,
              companyId: ctx.companyId,
            };
          }

          return query(args);
        },
      },
    },
  });
}

export type TenantIsolatedClient = ReturnType<typeof applyTenantIsolation>;

// Singleton tenant-aware client (extension is applied at module load).
// Note: this is the client tenant-scoped code should use. For transactions,
// use `withTenant(ctx, tx => ...)` which yields a Prisma.TransactionClient that
// inherits the extension.
export const tenantDb = applyTenantIsolation(db);
