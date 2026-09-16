import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const state = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), finding: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: {
  reconciliationRun: { create: state.create, update: state.update },
  reconciliationFinding: { create: state.finding },
  $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
} }));
vi.mock('@/lib/db/transaction', () => ({
  buildTenantContext: (ctx: unknown) => ctx,
  runInTenantContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));
import { ALL_CHECKS, runReconciliation, checkGiftCardLiability,
  checkOutboxCompleteness, checkIdempotencyResource, checkTaxInputGl } from '@/lib/reconciliation/checks';
const original = [...ALL_CHECKS];

describe('mandatory reconciliation outcomes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    state.create.mockResolvedValue({ id: 'run-a' });
    state.update.mockResolvedValue({});
    state.finding.mockResolvedValue({});
  });
  afterEach(() => ALL_CHECKS.splice(0, ALL_CHECKS.length, ...original));
  for (const failures of [1, 2, 3]) {
    it(`fails when ${failures} of three mandatory checks throw`, async () => {
      ALL_CHECKS.splice(0, ALL_CHECKS.length, ...Array.from({ length: 3 }, (_, i) => ({
        code: `CHECK_${i}`, fn: async () => {
          if (i < failures) throw new Error('sensitive driver SQL must not escape');
          return [];
        },
      })));
      const result = await runReconciliation('tenant-a');
      expect(result.status).toBe('failed');
      expect(result.summary.check_errors).toBe(failures);
      expect(result.checks.filter(c => c.outcome === 'CHECK_ERROR')).toHaveLength(failures);
      expect(JSON.stringify(result)).not.toContain('sensitive driver');
      expect(JSON.parse(state.update.mock.calls[0][0].data.summary).check_errors).toBe(failures);
    });
  }
  it('preserves findings alongside failed checks', async () => {
    ALL_CHECKS.splice(0, ALL_CHECKS.length,
      { code: 'F', fn: async () => [{ check_code: 'F', severity: 'high' as const, details: {} }] },
      { code: 'E', fn: async () => { throw new Error('failure'); } });
    const result = await runReconciliation('tenant-a');
    expect(result.status).toBe('failed');
    expect(result.checks.map(c => c.outcome)).toEqual(['FINDING', 'CHECK_ERROR']);
    expect(result.findings).toHaveLength(2);
  });
  it('passes only clean executable checks', async () => {
    ALL_CHECKS.splice(0, ALL_CHECKS.length, { code: 'CLEAN', fn: async () => [] });
    expect(await runReconciliation('tenant-a')).toMatchObject({
      status: 'passed', summary: { check_errors: 0 }, checks: [{ code: 'CLEAN', outcome: 'PASS' }],
    });
  });
  it('records CHECK_ERROR in summary even if finding persistence fails', async () => {
    ALL_CHECKS.splice(0, ALL_CHECKS.length, { code: 'E', fn: async () => { throw new Error(); } });
    state.finding.mockRejectedValue(new Error('storage failure'));
    expect((await runReconciliation('tenant-a')).status).toBe('failed');
    expect(JSON.parse(state.update.mock.calls[0][0].data.summary).checks[0].outcome).toBe('CHECK_ERROR');
  });
  it('rejects if final status cannot be persisted', async () => {
    ALL_CHECKS.splice(0, ALL_CHECKS.length, { code: 'CLEAN', fn: async () => [] });
    state.update.mockRejectedValue(new Error('storage failure'));
    await expect(runReconciliation('tenant-a')).rejects.toThrow('storage failure');
  });
  it.each([checkOutboxCompleteness, checkIdempotencyResource, checkTaxInputGl])(
    'does not convert internal database errors into zero/pass', async check => {
      const fail = vi.fn().mockRejectedValue(new Error('unavailable'));
      const tx = { outboxEvent: { count: fail }, idempotencyRequest: { count: fail },
        accountingPolicy: { findUnique: async () => ({ grniAccountId: 'g' }) },
        purchaseItemTax: { aggregate: fail } } as unknown as Prisma.TransactionClient;
      await expect(check(tx, 'tenant-a')).rejects.toThrow('unavailable');
    });
});

describe('gift-card ledger to posted GL liability', () => {
  function fixture(expected: string, credit: string, debit: string) {
    return {
      accountingPolicy: { findUnique: vi.fn().mockResolvedValue({ giftCardLiabilityAccountId: 'liability-a' }) },
      chartOfAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'liability-a' }) },
      giftCardTransaction: { aggregate: vi.fn().mockResolvedValue({ _sum: { amountDelta: new Prisma.Decimal(expected) } }) },
      journalLine: { aggregate: vi.fn().mockResolvedValue({ _sum: {
        creditBase: new Prisma.Decimal(credit), debitBase: new Prisma.Decimal(debit),
      } }) },
    };
  }
  it('passes zero variance; uses ledger not card face value; scopes both authorities', async () => {
    const tx = fixture('0.3', '0.4', '0.1');
    expect(await checkGiftCardLiability(tx as never, 'tenant-a')).toEqual([]);
    expect(tx.giftCardTransaction.aggregate).toHaveBeenCalledWith({
      where: { companyId: 'tenant-a' }, _sum: { amountDelta: true },
    });
    expect(tx.journalLine.aggregate).toHaveBeenCalledWith({
      where: { companyId: 'tenant-a', chartOfAccountId: 'liability-a',
        journalEntry: { companyId: 'tenant-a', status: { in: ['posted', 'reversed'] } } },
      _sum: { creditBase: true, debitBase: true },
    });
  });
  it('reports exact non-zero Decimal variance without rounding to Number', async () => {
    const tx = fixture('9007199254740993.01', '9007199254740993.03', '0.01');
    expect(await checkGiftCardLiability(tx as never, 'tenant-a')).toMatchObject([{
      severity: 'high', expected_value: '9007199254740993.01',
      actual_value: '9007199254740993.02', variance: '0.01',
    }]);
  });
  it('fails controllably for missing or foreign-tenant mapping', async () => {
    const tx = fixture('1', '1', '0');
    tx.chartOfAccount.findFirst.mockResolvedValue(null);
    await expect(checkGiftCardLiability(tx as never, 'tenant-a'))
      .rejects.toMatchObject({ safeCode: 'MISSING_GIFT_CARD_LIABILITY_MAPPING' });
    expect(tx.giftCardTransaction.aggregate).not.toHaveBeenCalled();
  });
  it('preserves variance beyond default Decimal precision', async () => {
    const tx = fixture('123456789012345678901234567890.123456789',
      '123456789012345678901234567890.123456791', '0.000000001');
    expect(await checkGiftCardLiability(tx as never, 'tenant-a')).toMatchObject([{
      actual_value: '123456789012345678901234567890.12345679', variance: '0.000000001',
    }]);
  });
});
