// tests/unit/featureFlags.test.ts
// Tests for §20.D02 — feature flag system.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  FEATURE_FLAG_CATALOGUE,
  toggleFeatureFlag,
  listFeatureFlags,
  isFeatureEnabled,
  requireFeatureFlag,
  seedFeatureFlagsForCompany,
  IMPLEMENTED_MODULES,
} from '../../src/lib/featureFlags';
import { buildTenantContext, runInTenantContext } from '../../src/lib/db/transaction';
import { DomainError } from '../../src/lib/errors/codes';

const db = new PrismaClient();

let companyId: string;
let userId: string;

beforeAll(async () => {
  await db.$connect();
  const company = await db.company.create({
    data: {
      code: 'TEST-FF-' + Date.now(),
      legalName: 'FeatureFlag Test Co',
      displayName: 'FF Test',
      baseCurrencyCode: 'BDT',
      status: 'active',
    },
  });
  companyId = company.id;
  const user = await db.user.create({
    data: {
      companyId,
      name: 'FF Admin',
      email: 'ff-' + Date.now() + '@test.local',
      passwordHash: '$argon2id$dummy',
      accessScope: 'global',
    },
  });
  userId = user.id;
  await seedFeatureFlagsForCompany(companyId, userId);
});

afterAll(async () => {
  if (companyId) {
    await db.featureFlag.deleteMany({ where: { companyId } });
    await db.companyLanguage.deleteMany({ where: { companyId } });
    await db.securityEvent.deleteMany({ where: { companyId } });
    await db.auditLog.deleteMany({ where: { companyId } });
  }
  if (userId) await db.user.deleteMany({ where: { id: userId } });
  if (companyId) await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

const ctx = () => buildTenantContext({
  companyId, userId, branchIds: [], isGlobal: true,
});

describe('featureFlags', () => {
  it('seeds all flags from the catalogue with default values', async () => {
    const flags = await listFeatureFlags(companyId);
    expect(flags.length).toBe(FEATURE_FLAG_CATALOGUE.length);
    // Default-disabled flags (e.g. crm_enabled) should be off
    const crm = flags.find(f => f.flagKey === 'crm_enabled');
    expect(crm?.enabled).toBe(false);
    // Default-enabled flags (e.g. quotation_enabled) should be on
    const quote = flags.find(f => f.flagKey === 'quotation_enabled');
    expect(quote?.enabled).toBe(true);
  });

  it('isFeatureEnabled reads the flag value', async () => {
    await runInTenantContext(ctx(), async () => {
      const enabled = await isFeatureEnabled('crm_enabled');
      expect(enabled).toBe(false);
      const quoteEnabled = await isFeatureEnabled('quotation_enabled');
      expect(quoteEnabled).toBe(true);
    });
  });

  it('requireFeatureFlag throws 403 FEATURE_NOT_ENABLED when disabled', async () => {
    await runInTenantContext(ctx(), async () => {
      await expect(requireFeatureFlag('crm_enabled')).rejects.toThrow(/not enabled/);
    });
  });

  it('toggles a flag for an implemented module', async () => {
    // crm module is NOT implemented — should fail. Use 'sale' (quotation) which IS implemented.
    const result = await toggleFeatureFlag({
      companyId, flagKey: 'quotation_enabled', enabled: false, updatedBy: userId,
    });
    expect(result.wasEnabled).toBe(true);
    expect(result.enabled).toBe(false);

    await runInTenantContext(ctx(), async () => {
      const enabled = await isFeatureEnabled('quotation_enabled');
      expect(enabled).toBe(false);
    });

    // Re-enable
    await toggleFeatureFlag({ companyId, flagKey: 'quotation_enabled', enabled: true, updatedBy: userId });
  });

  it('rejects enabling a flag for an unimplemented module with 409 MODULE_NOT_IMPLEMENTED', async () => {
    // crm_enabled has module='crm' which is NOT in IMPLEMENTED_MODULES for M1
    await expect(
      toggleFeatureFlag({ companyId, flagKey: 'crm_enabled', enabled: true, updatedBy: userId }),
    ).rejects.toThrow(/not implemented/);

    // Verify a security event was recorded
    const events = await db.securityEvent.findMany({
      where: { companyId, eventType: 'feature_flag_enable_unimplemented_module' },
    });
    expect(events.length).toBeGreaterThan(0);
  });

  it('catalogue covers all 10 flags per §20.D02', () => {
    expect(FEATURE_FLAG_CATALOGUE.length).toBe(10);
    const keys = FEATURE_FLAG_CATALOGUE.map(f => f.key);
    expect(keys).toContain('crm_enabled');
    expect(keys).toContain('hr_payroll_enabled');
    expect(keys).toContain('delivery_courier_enabled');
    expect(keys).toContain('service_warranty_enabled');
    expect(keys).toContain('loyalty_enabled');
    expect(keys).toContain('multi_currency_enabled');
    expect(keys).toContain('import_csv_enabled');
    expect(keys).toContain('offline_pos_enabled');
    expect(keys).toContain('quotation_enabled');
    expect(keys).toContain('multilingual_ui_enabled');
  });
});
