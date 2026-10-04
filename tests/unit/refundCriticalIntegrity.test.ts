import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({
  auth: vi.fn(), permission: vi.fn(), tenant: vi.fn(), scope: vi.fn(),
  idempotency: vi.fn(), refund: vi.fn(), journal: vi.fn(), find: vi.fn(),
  aggregate: vi.fn(), claim: vi.fn(), create: vi.fn(), account: vi.fn(),
  policy: vi.fn(), audit: vi.fn(), replay: vi.fn(),
}));
vi.mock('@/lib/auth/middleware', () => ({ authenticateRequest: m.auth, requirePermission: m.permission }));
vi.mock('@/lib/db/transaction', () => ({ withTenant: m.tenant, runInTenantContext: m.scope }));
vi.mock('@/lib/idempotency', () => ({
  withIdempotency: m.idempotency, computeRequestHash: () => 'hash', requireIdempotencyKey: () => 'refund-test-key',
}));
vi.mock('@/adapters', () => ({ providerRegistry: { getPayment: () => ({ refund: m.refund }) } }));
vi.mock('@/adapters/providers', () => ({ registerProviders: vi.fn() }));
vi.mock('@/domain/commands/m4/PostJournalEntry', () => ({ postJournalEntry: m.journal }));
vi.mock('@/lib/db', () => ({ db: {
  payment: { findFirst: m.find, create: m.create, aggregate: m.aggregate, updateMany: m.claim },
  financialAccount: { findFirst: m.account }, accountingPolicy: { findUnique: m.policy },
  auditLog: { create: m.audit }, idempotencyRequest: { updateMany: m.replay },
} }));

import { POST } from '@/app/api/v1/payments/[id]/refund/route';
import { DomainError } from '@/lib/errors/codes';

const ctx = { companyId: 'company-a', branchIds: ['branch-a'] };
const payment = {
  id: 'pay-1', companyId: 'company-a', branchId: 'branch-a', referenceNo: 'PMT-1',
  amount: new Prisma.Decimal(1000), baseAmount: new Prisma.Decimal(1000),
  exchangeRate: new Prisma.Decimal(1), currencyCode: 'BDT', paymentStatus: 'posted',
  paymentMethod: 'bkash', methodReference: 'TXN-1',
  businessDate: new Date('2026-09-01'), financialAccountId: 'cash-1', customerId: 'customer-1',
};
const tx = {
  payment: { findFirst: m.find, create: vi.fn(), aggregate: m.aggregate, updateMany: m.claim },
  financialAccount: { findFirst: m.account }, accountingPolicy: { findUnique: m.policy },
  auditLog: { create: m.audit }, idempotencyRequest: { updateMany: m.replay },
};
let committed: string[];
let staged: string[];
function request() {
  return new NextRequest('http://localhost/api/v1/payments/pay-1/refund', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'refund-test-key' },
    body: JSON.stringify({ amount: '50.00', provider_code: 'bkash', gateway_txn_id: 'TXN-1' }),
  });
}
const run = () => POST(request(), { params: Promise.resolve({ id: 'pay-1' }) });

describe('critical refund posting integrity', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    committed = []; staged = [];
    m.auth.mockResolvedValue({ companyId: 'company-a', userId: 'user-a', ctx });
    m.permission.mockResolvedValue(undefined);
    m.scope.mockImplementation(async (_ctx, work) => work());
    // Model transaction rollback and distinguish root-client autocommits.
    m.tenant.mockImplementation(async (_ctx, work) => {
      staged = [];
      try { const result = await work(tx); committed.push(...staged); return result; }
      finally { staged = []; }
    });
    m.idempotency.mockImplementation(async (_params, work) => ({ ...await work(), isReplay: false }));
    m.find.mockResolvedValue(payment);
    m.aggregate.mockResolvedValue({ _sum: { amount: null } });
    m.claim.mockResolvedValue({ count: 1 });
    m.create.mockImplementation(async () => { committed.push('payment'); return { id: 'refund-1' }; });
    tx.payment.create.mockImplementation(async () => { staged.push('payment'); return { id: 'refund-1' }; });
    m.account.mockResolvedValue({ chartOfAccountId: 'cash-coa' });
    m.policy.mockResolvedValue({ arAccountId: 'ar-coa' });
    m.journal.mockImplementation(async client => { (client === tx ? staged : committed).push('journal'); });
    m.audit.mockResolvedValue({});
    m.replay.mockResolvedValue({ count: 1 });
    m.refund.mockResolvedValue({ refundId: 'gateway-refund-1', status: 'completed' });
  });

  it('rolls back the reversal when journal posting rejects a locked period', async () => {
    m.journal.mockRejectedValue(new DomainError('FISCAL_PERIOD_LOCKED', 'Period locked', {}, 409));
    const response = await run().catch(() => null);
    expect(m.refund).toHaveBeenCalledTimes(1);
    expect(committed).toEqual([]);
    expect(response?.status).toBe(502);
  });

  it('rolls back payment and journal if storing the final replay response fails', async () => {
    m.replay.mockRejectedValue(new Error('connection lost'));
    const response = await run().catch(() => null);
    expect(committed).toEqual([]);
    expect(response?.status).toBe(502);
  });

  it('commits payment and journal through the same transaction client', async () => {
    expect((await run()).status).toBe(200);
    expect(m.journal.mock.calls[0][0]).toBe(tx);
    expect(m.create).not.toHaveBeenCalled();
    expect(committed).toEqual(['payment', 'journal']);
    expect(m.tenant).toHaveBeenNthCalledWith(2, ctx, expect.any(Function));
  });

  it.each(['failed', 'pending'])('does not post cash out for a %s gateway result', async status => {
    m.refund.mockResolvedValue({ refundId: 'gateway-refund-1', status });
    expect((await run()).status).toBe(200);
    expect(m.journal).not.toHaveBeenCalled();
    const data = (tx.payment.create.mock.calls[0] ?? m.create.mock.calls[0])[0].data;
    expect(data.paymentStatus).toBe(status);
  });

  it('converts refund to base currency exactly once with Decimal', async () => {
    m.find.mockResolvedValue({ ...payment, currencyCode: 'USD', exchangeRate: new Prisma.Decimal('123.456789') });
    expect((await run()).status).toBe(200);
    const data = (tx.payment.create.mock.calls[0] ?? m.create.mock.calls[0])[0].data;
    expect(data.amount.toFixed(2)).toBe('50.00');
    expect(data.baseAmount.toFixed(2)).toBe('6172.84');
    const entry = m.journal.mock.calls[0][1];
    expect(new Prisma.Decimal(entry.exchangeRate).toString()).toBe('123.456789');
    expect(entry.lines[0].debit.toFixed(2)).toBe('6172.84');
    expect(entry.lines[1].credit.eq(entry.lines[0].debit)).toBe(true);
  });

  it('denies an out-of-scope payment before gateway effects', async () => {
    m.find.mockResolvedValue(null); // Scoped delegate hides foreign tenant/branch rows.
    expect((await run()).status).toBe(404);
    expect(m.find.mock.calls[0][0].where).toEqual({ id: 'pay-1', companyId: 'company-a' });
    expect(m.refund).not.toHaveBeenCalled();
  });

  it.each([
    { methodReference: 'OTHER-TENANT-TXN' },
    { paymentMethod: 'nagad' },
  ])('binds the gateway target to the authorized payment: %j', async mismatch => {
    m.find.mockResolvedValue({ ...payment, ...mismatch });
    expect((await run()).status).toBe(400);
    expect(m.refund).not.toHaveBeenCalled();
    expect(m.claim).not.toHaveBeenCalled();
  });

  it('denies missing permission before gateway effects', async () => {
    m.permission.mockRejectedValue(new DomainError('FORBIDDEN_SCOPE', 'Permission denied', {}, 403));
    expect((await run()).status).toBe(403);
    expect(m.refund).not.toHaveBeenCalled();
  });

  it('does not refund after a concurrent claim loses', async () => {
    m.claim.mockResolvedValue({ count: 0 });
    expect((await run()).status).toBe(409);
    expect(m.refund).not.toHaveBeenCalled();
  });

  it('replays without another gateway call or posting', async () => {
    m.idempotency.mockResolvedValue({ status: 200, body: { refund_id: 'gateway-refund-1' }, isReplay: true });
    expect((await run()).status).toBe(200);
    expect(m.refund).not.toHaveBeenCalled();
    expect(committed).toEqual([]);
  });
});
