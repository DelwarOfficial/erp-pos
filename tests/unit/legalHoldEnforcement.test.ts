// F-51 / F-52 regression: legal holds must actually block deletion, and the
// retention job must run per tenant.
//
// Before the fix legal_holds was a write-only table -- created, listed,
// released, and read by nothing -- so a held customer was anonymized and the
// related security events hard-deleted on the next nightly run while the UI
// still showed the hold as active. The job also ran once across every company
// with one process-wide cutoff.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  companyFindMany: vi.fn(),
  legalHoldFindMany: vi.fn(),
  legalHoldFindFirst: vi.fn(),
  configFindMany: vi.fn(),
  auditDeleteMany: vi.fn(),
  securityDeleteMany: vi.fn(),
  customerFindMany: vi.fn(),
  customerUpdate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  systemDb: {
    company: { findMany: mocks.companyFindMany },
    legalHold: { findMany: mocks.legalHoldFindMany, findFirst: mocks.legalHoldFindFirst },
    configurationValue: { findMany: mocks.configFindMany },
    auditLog: { deleteMany: mocks.auditDeleteMany },
    securityEvent: { deleteMany: mocks.securityDeleteMany },
    customer: { findMany: mocks.customerFindMany, update: mocks.customerUpdate },
    $transaction: mocks.transaction,
  },
  db: {},
}));

import { runRetentionJob } from '@/lib/retention/job';
import { isUnderLegalHold } from '@/lib/retention/legalHold';

describe('retention respects legal holds and tenant boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Two tenants, so cross-tenant leakage is visible.
    mocks.companyFindMany.mockResolvedValue([{ id: 'company-a' }, { id: 'company-b' }]);
    mocks.legalHoldFindMany.mockResolvedValue([]);
    mocks.configFindMany.mockResolvedValue([]);
    mocks.auditDeleteMany.mockResolvedValue({ count: 0 });
    mocks.securityDeleteMany.mockResolvedValue({ count: 3 });
    mocks.customerFindMany.mockResolvedValue([]);
    mocks.customerUpdate.mockImplementation((args: unknown) => args);
    mocks.transaction.mockResolvedValue([]);
    process.env.DATABASE_URL = 'mysql://127.0.0.1:43318/x';
  });

  it('scopes every delete to one company at a time', async () => {
    await runRetentionJob('audit_only');

    expect(mocks.securityDeleteMany).toHaveBeenCalledTimes(2);
    const scopes = mocks.securityDeleteMany.mock.calls.map(call => call[0].where.companyId);
    expect(scopes.sort()).toEqual(['company-a', 'company-b']);
    // The decisive assertion: no unscoped sweep across every tenant.
    for (const call of mocks.securityDeleteMany.mock.calls) {
      expect(call[0].where.companyId).toBeDefined();
    }
  });

  it('does not purge security events for a company under a blanket hold', async () => {
    mocks.legalHoldFindMany.mockImplementation(async ({ where }: { where: { companyId: string } }) =>
      where.companyId === 'company-a'
        ? [{ id: 'hold-1', entityType: 'company', entityId: 'company-a' }]
        : []);

    const result = await runRetentionJob('audit_only');

    const scopes = mocks.securityDeleteMany.mock.calls.map(call => call[0].where.companyId);
    expect(scopes).toEqual(['company-b']);
    expect(result.companies.find(c => c.companyId === 'company-a')!.securityEventsDeleted).toBe(0);
  });

  it('does not anonymize a customer named by an active hold', async () => {
    mocks.legalHoldFindMany.mockImplementation(async ({ where }: { where: { companyId: string } }) =>
      where.companyId === 'company-a'
        ? [{ id: 'hold-2', entityType: 'customer', entityId: 'held-customer' }]
        : []);
    mocks.customerFindMany.mockImplementation(async ({ where }: { where: { companyId: string } }) =>
      where.companyId === 'company-a'
        ? [{ id: 'held-customer' }, { id: 'ordinary-customer' }]
        : []);

    const result = await runRetentionJob('pii_only');

    expect(mocks.customerUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.customerUpdate.mock.calls[0][0].where.id).toBe('ordinary-customer');
    const companyA = result.companies.find(c => c.companyId === 'company-a')!;
    expect(companyA.customersAnonymized).toBe(1);
    expect(companyA.heldBack).toBe(1);
  });

  it('anonymizes the batch in one transaction', async () => {
    mocks.customerFindMany.mockImplementation(async ({ where }: { where: { companyId: string } }) =>
      where.companyId === 'company-a' ? [{ id: 'c1' }, { id: 'c2' }] : []);

    await runRetentionJob('pii_only');

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it('uses the tenant retention period when configured', async () => {
    mocks.configFindMany.mockImplementation(async ({ where }: { where: { companyId: string } }) =>
      where.companyId === 'company-a'
        ? [{ definitionKey: 'retention.audit_days', value: '2555' }]
        : []);

    await runRetentionJob('audit_only');

    const cutoffs = mocks.securityDeleteMany.mock.calls.map(call => ({
      companyId: call[0].where.companyId,
      cutoff: call[0].where.occurredAt.lt as Date,
    }));
    const a = cutoffs.find(c => c.companyId === 'company-a')!;
    const b = cutoffs.find(c => c.companyId === 'company-b')!;
    // A seven-year tenant policy must not be overridden by the 90-day default.
    expect(a.cutoff.getTime()).toBeLessThan(b.cutoff.getTime());
  });
});

describe('isUnderLegalHold', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is true for a hold naming the entity', async () => {
    mocks.legalHoldFindFirst.mockResolvedValue({ id: 'hold-1' });
    expect(await isUnderLegalHold('company-a', 'customer', 'cust-1')).toBe(true);
  });

  it('is false when no active hold matches', async () => {
    mocks.legalHoldFindFirst.mockResolvedValue(null);
    expect(await isUnderLegalHold('company-a', 'customer', 'cust-1')).toBe(false);
    const where = mocks.legalHoldFindFirst.mock.calls[0][0].where;
    // Released holds must not block, and a company-wide hold must also match.
    expect(where.releasedAt).toBeNull();
    expect(where.OR).toContainEqual({ entityType: 'company', entityId: 'company-a' });
  });
});
