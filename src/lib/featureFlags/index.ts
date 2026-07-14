// src/lib/featureFlags/index.ts
// Feature flag system per §20.D02.
//
// Catalogue of feature flags + helpers to check them. Every domain command
// MUST call `requireFeatureFlag(flagKey)` before executing — disabled flags
// hide navigation and return 403 FEATURE_NOT_ENABLED.
//
// Optional modules (all default to disabled):
//   crm_enabled, hr_payroll_enabled, delivery_courier_enabled,
//   service_warranty_enabled, loyalty_enabled, multi_currency_enabled,
//   import_csv_enabled, offline_pos_enabled
//
// Core modules (always enabled — not in this list):
//   Dashboard, Identity, Organization, Product Catalogue, Inventory,
//   Purchasing, Sales/POS online, Payments, Accounting, Expenses, Reports,
//   Administration, Integration
//
// Default-enabled (still listed here so they appear in the UI toggle):
//   quotation_enabled (default true — B2B core)
//   multilingual_ui_enabled (default true — bn-BD + en-BD both available)

import { db } from '../db';
import { DomainError } from '../errors/codes';
import { getTenantContext } from '../db/transaction';

export type FeatureFlagKey =
  | 'crm_enabled'
  | 'hr_payroll_enabled'
  | 'delivery_courier_enabled'
  | 'service_warranty_enabled'
  | 'loyalty_enabled'
  | 'multi_currency_enabled'
  | 'import_csv_enabled'
  | 'offline_pos_enabled'
  | 'quotation_enabled'
  | 'multilingual_ui_enabled';

export interface FeatureFlagSpec {
  key: FeatureFlagKey;
  module: string;
  description: string;
  defaultValue: boolean;
}

export const FEATURE_FLAG_CATALOGUE: FeatureFlagSpec[] = [
  { key: 'crm_enabled', module: 'crm', description: 'CRM leads/pipeline/conversion', defaultValue: false },
  { key: 'hr_payroll_enabled', module: 'hr', description: 'HR/payroll with BEFTN bank file', defaultValue: false },
  { key: 'delivery_courier_enabled', module: 'delivery', description: 'Delivery orders + courier COD settlement', defaultValue: false },
  { key: 'service_warranty_enabled', module: 'service', description: 'Service requests + warranty claims', defaultValue: false },
  { key: 'loyalty_enabled', module: 'loyalty', description: 'Gift cards + reward points', defaultValue: false },
  { key: 'multi_currency_enabled', module: 'accounting', description: 'Multi-currency (non-BDT) — BDT-only by default', defaultValue: false },
  { key: 'import_csv_enabled', module: 'integration', description: 'CSV/Excel import jobs', defaultValue: false },
  { key: 'offline_pos_enabled', module: 'offline', description: 'Offline-capable POS PWA (pilot only)', defaultValue: false },
  { key: 'quotation_enabled', module: 'sale', description: 'Quotation creation/management — B2B core', defaultValue: true },
  { key: 'multilingual_ui_enabled', module: 'i18n', description: 'bn-BD + en-BD locales both available', defaultValue: true },
];

// Module implementation registry — when a flag is enabled, the system must
// verify the module is actually implemented (not just schema-present).
// In M1, only the core + i18n + quotation modules are "implemented".
export const IMPLEMENTED_MODULES = new Set<string>([
  'core', 'identity', 'organization', 'catalogue', 'inventory', 'purchasing',
  'pos_online', 'payments', 'accounting', 'expenses', 'reports',
  'administration', 'integration', 'i18n', 'sale', // sale = quotation
]);

/**
 * Check whether a feature flag is enabled for the current tenant.
 * Reads TenantContext from AsyncLocalStorage.
 *
 * If no flag row exists for the company, returns the catalogue default.
 */
export async function isFeatureEnabled(flagKey: FeatureFlagKey): Promise<boolean> {
  const ctx = getTenantContext();
  if (!ctx) {
    throw new Error('isFeatureEnabled requires tenant context');
  }
  const flag = await db.featureFlag.findUnique({
    where: {
      companyId_flagKey: { companyId: ctx.companyId, flagKey },
    },
  });
  if (flag) return flag.enabled;
  const spec = FEATURE_FLAG_CATALOGUE.find(s => s.key === flagKey);
  return spec?.defaultValue ?? false;
}

/**
 * Require a feature flag to be enabled. Throws 403 FEATURE_NOT_ENABLED if not.
 *
 * Every domain command in an optional module MUST call this at the top of
 * its execute() method.
 */
export async function requireFeatureFlag(flagKey: FeatureFlagKey): Promise<void> {
  const enabled = await isFeatureEnabled(flagKey);
  if (!enabled) {
    throw new DomainError(
      'FEATURE_NOT_ENABLED',
      `Feature flag "${flagKey}" is not enabled for this tenant`,
      { flag_key: flagKey },
      403,
    );
  }
}

/**
 * Toggle a feature flag. Validates the flag key is in the catalogue and
 * that the underlying module is implemented before enabling.
 *
 * Per §20.D02: enabling a flag for an unimplemented module returns
 * 409 MODULE_NOT_IMPLEMENTED + security event.
 */
export async function toggleFeatureFlag(params: {
  companyId: string;
  flagKey: FeatureFlagKey;
  enabled: boolean;
  updatedBy: string;
  reason?: string;
}): Promise<{ flagKey: string; enabled: boolean; wasEnabled: boolean }> {
  const spec = FEATURE_FLAG_CATALOGUE.find(s => s.key === params.flagKey);
  if (!spec) {
    throw new DomainError('VALIDATION_FAILED', `Unknown feature flag: ${params.flagKey}`, {}, 404);
  }

  // If enabling, verify module is implemented
  if (params.enabled && !IMPLEMENTED_MODULES.has(spec.module)) {
    await db.securityEvent.create({
      data: {
        companyId: params.companyId,
        userId: params.updatedBy,
        eventType: 'feature_flag_enable_unimplemented_module',
        severity: 'warning',
        metadata: JSON.stringify({ flag_key: params.flagKey, module: spec.module }),
      },
    });
    throw new DomainError(
      'MODULE_NOT_IMPLEMENTED',
      `Module "${spec.module}" is not implemented; cannot enable flag "${params.flagKey}"`,
      { flag_key: params.flagKey, module: spec.module },
      409,
    );
  }

  const existing = await db.featureFlag.findUnique({
    where: { companyId_flagKey: { companyId: params.companyId, flagKey: params.flagKey } },
  });

  if (existing) {
    await db.featureFlag.update({
      where: { id: existing.id },
      data: {
        enabled: params.enabled,
        updatedBy: params.updatedBy,
        updatedAt: new Date(),
        rolloutRules: existing.rolloutRules,
      },
    });
    return { flagKey: params.flagKey, enabled: params.enabled, wasEnabled: existing.enabled };
  }

  await db.featureFlag.create({
    data: {
      companyId: params.companyId,
      flagKey: params.flagKey,
      enabled: params.enabled,
      rolloutRules: JSON.stringify({ reason: params.reason ?? 'manual_toggle' }),
      updatedBy: params.updatedBy,
    },
  });
  return { flagKey: params.flagKey, enabled: params.enabled, wasEnabled: spec.defaultValue };
}

/**
 * Seed default feature flags for a new company during onboarding.
 */
export async function seedFeatureFlagsForCompany(companyId: string, userId: string): Promise<void> {
  for (const spec of FEATURE_FLAG_CATALOGUE) {
    await db.featureFlag.upsert({
      where: { companyId_flagKey: { companyId, flagKey: spec.key } },
      create: {
        companyId,
        flagKey: spec.key,
        enabled: spec.defaultValue,
        rolloutRules: JSON.stringify({ reason: 'onboarding_seed' }),
        updatedBy: userId,
      },
      update: {},
    });
  }
}

/**
 * List all feature flags for a company, including catalogue defaults for
 * flags that don't yet have a row.
 */
export async function listFeatureFlags(companyId: string): Promise<Array<{
  flagKey: string;
  module: string;
  description: string;
  enabled: boolean;
  defaultValue: boolean;
  updatedAt: Date;
}>> {
  const rows = await db.featureFlag.findMany({ where: { companyId } });
  const rowMap = new Map(rows.map(r => [r.flagKey, r]));

  return FEATURE_FLAG_CATALOGUE.map(spec => {
    const row = rowMap.get(spec.key);
    return {
      flagKey: spec.key,
      module: spec.module,
      description: spec.description,
      enabled: row?.enabled ?? spec.defaultValue,
      defaultValue: spec.defaultValue,
      updatedAt: row?.updatedAt ?? new Date(0),
    };
  });
}
