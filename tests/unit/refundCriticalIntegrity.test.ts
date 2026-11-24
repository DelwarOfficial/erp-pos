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
  paymentAllocation: { findMany: async () => [] }, payment: { findFirst: m.find, create: m.create, aggregate: m.aggregate, updateMany: m.claim },
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
  paymentAllocation: { findMany: async () => [] }, payment: { findFirst: m.find, create: vi.fn(), aggregate: m.aggregate, updateMany: m.claim, count: vi.fn() },
  financialAccount: { findFirst: m.account }, accountingPolicy: { findUnique: m.policy },
  auditLog: { create: m.audit }, idempotencyRequest: { updateMany: m.replay },
};
let committed: string[];
let staged: string[];
function request(amount = '50.00') {
  return new NextRequest('http://localhost/api/v1/payments/pay-1/refund', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'refund-test-key' },
    body: JSON.stringify({ amount, provider_code: 'bkash', gateway_txn_id: 'TXN-1' }),
  });
}
const run = (amount?: string) => POST(request(amount), { params: Promise.resolve({ id: 'pay-1' }) });

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
    tx.payment.count.mockResolvedValue(0);
    m.account.mockResolvedValue({ chartOfAccountId: 'cash-coa' });
    m.policy.mockResolvedValue({ arAccountId: 'ar-coa' });
    m.journal.mockImplementation(async client => { (client === tx ? staged : committed).push('journal'); });
    m.audit.mockResolvedValue({});
    m.replay.mockResolvedValue({ count: 1 });
    m.refund.mockResolvedValue({ refundId: 'gateway-refund-1', status: 'completed' });
  });

  // 'payment' in `committed` is the pending row reserved in phase 1. It must
  // survive a phase-3 failure: the gateway has already answered, so the row
  // is the only durable trace of money that may have left.
  it('keeps the pending row and posts no journal when journal posting rejects a locked period', async () => {
    m.journal.mockRejectedValue(new DomainError('FISCAL_PERIOD_LOCKED', 'Period locked', {}, 409));
    const response = await run().catch(() => null);
    expect(m.refund).toHaveBeenCalledTimes(1);
    expect(committed).toEqual(['payment']);
    expect(response?.status).toBe(502);
    expect(m.audit.mock.calls.at(-1)?.[0].data.action).toBe('payment.refund.unrecorded');
  });

  it('rolls back the journal if storing the final replay response fails', async () => {
    m.replay.mockRejectedValue(new Error('connection lost'));
    const response = await run().catch(() => null);
    expect(committed).toEqual(['payment']);
    expect(response?.status).toBe(502);
  });

  it('never marks the original payment reversed, whatever the gateway outcome', async () => {
    for (const status of ['completed', 'pending', 'failed']) {
      m.refund.mockResolvedValue({ refundId: 'gateway-refund-1', status });
      expect((await run()).status).toBe(200);
    }
    m.refund.mockRejectedValue(new Error('timeout'));
    expect((await run()).status).toBe(502);
    for (const [args] of m.claim.mock.calls) {
      expect(args.where.id).toBe('refund-1');
      expect(args.data.paymentStatus).not.toBe('reversed');
    }
  });

  it('reserves the refund as pending before the gateway is called', async () => {
    m.refund.mockImplementation(async () => {
      expect(tx.payment.create.mock.calls[0][0].data.paymentStatus).toBe('pending');
      expect(committed).toEqual(['payment']);
      return { refundId: 'gateway-refund-1', status: 'completed' };
    });
    expect((await run()).status).toBe(200);
    expect(m.claim.mock.calls[0][0].data.paymentStatus).toBe('posted');
  });

  it('leaves the refund pending when the gateway call throws', async () => {
    m.refund.mockRejectedValue(new Error('timeout'));
    expect((await run()).status).toBe(502);
    expect(m.claim).not.toHaveBeenCalled();
    expect(m.journal).not.toHaveBeenCalled();
    expect(committed).toEqual(['payment']);
  });

  it('gives a later partial refund its own reference number', async () => {
    tx.payment.count.mockResolvedValue(1);
    m.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal(50) } });
    expect((await run()).status).toBe(200);
    expect(tx.payment.create.mock.calls[0][0].data.referenceNo).toBe('REFUND-PMT-1-2');
  });

  it('requires an approver above the refund approval threshold', async () => {
    m.find.mockResolvedValue({ ...payment, amount: new Prisma.Decimal(10000) });
    m.permission.mockImplementation(async (_auth, code) => {
      if (code === 'approval.resolve') throw new DomainError('FORBIDDEN_SCOPE', 'Permission denied', {}, 403);
    });
    const response = await run('6000.00');
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('APPROVAL_REQUIRED');
    expect(m.refund).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('lets an approver refund above the threshold', async () => {
    m.find.mockResolvedValue({ ...payment, amount: new Prisma.Decimal(10000) });
    expect((await run('6000.00')).status).toBe(200);
    expect(m.permission).toHaveBeenCalledWith(expect.anything(), 'approval.resolve');
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
    expect(m.claim.mock.calls[0][0].data.paymentStatus).toBe(status);
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

  it('does not refund after a concurrent reservation loses', async () => {
    tx.payment.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }));
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
