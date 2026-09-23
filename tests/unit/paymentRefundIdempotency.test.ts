// F-03 regression: a replayed Idempotency-Key must not refund the customer a
// second time.
//
// Before the fix the handler awaited withIdempotency and discarded its result,
// so a retry fell through to the gateway call. The provider refunded again —
// real money out — and the second reversal row then collided on
// @@unique([companyId, referenceNo]), so the duplicate was never recorded and
// the client got a 500.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  permission: vi.fn(),
  scope: vi.fn(),
  tenant: vi.fn(),
  idempotency: vi.fn(),
  refund: vi.fn(),
  getPayment: vi.fn(),
  paymentFindFirst: vi.fn(),
  paymentCreate: vi.fn(),
  auditCreate: vi.fn(),
  idempotencyUpdateMany: vi.fn(),
  registerProviders: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: mocks.auth,
  requirePermission: mocks.permission,
}));
vi.mock('@/lib/db/transaction', () => ({
  runInTenantContext: mocks.scope,
  withTenant: mocks.tenant,
}));
vi.mock('@/lib/db', () => ({
  db: {
    payment: { findFirst: mocks.paymentFindFirst, create: mocks.paymentCreate },
    auditLog: { create: mocks.auditCreate },
    idempotencyRequest: { updateMany: mocks.idempotencyUpdateMany },
  },
}));
vi.mock('@/lib/idempotency', () => ({
  withIdempotency: mocks.idempotency,
  computeRequestHash: () => 'hash',
  requireIdempotencyKey: () => 'k'.repeat(16),
}));
vi.mock('@/adapters', () => ({ providerRegistry: { getPayment: mocks.getPayment } }));
vi.mock('@/adapters/providers', () => ({ registerProviders: mocks.registerProviders }));

import { POST as refundRoute } from '@/app/api/v1/payments/[id]/refund/route';

const AUTH = {
  companyId: 'company-a',
  userId: 'user-a',
  isGlobal: false,
  branchIds: ['branch-a'],
  ctx: { companyId: 'company-a' },
};

function request() {
  return new NextRequest('http://localhost/api/v1/payments/pay-1/refund', {
    method: 'POST',
    headers: { 'idempotency-key': 'k'.repeat(16), 'content-type': 'application/json' },
    body: JSON.stringify({ amount: 500, provider_code: 'bkash', gateway_txn_id: 'TXN-1' }),
  });
}

describe('payment refund idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(AUTH);
    mocks.permission.mockResolvedValue(undefined);
    mocks.scope.mockImplementation(async (_ctx: unknown, work: () => Promise<unknown>) => work());
    mocks.tenant.mockImplementation(async (_ctx: unknown, work: (tx: unknown) => Promise<unknown>) =>
      work({
        payment: { findFirst: mocks.paymentFindFirst },
        auditLog: { create: mocks.auditCreate },
      }));
    mocks.paymentFindFirst.mockResolvedValue({
      id: 'pay-1', companyId: 'company-a', branchId: 'branch-a',
      referenceNo: 'PMT-000001', amount: '1000.00', exchangeRate: 1,
      currencyCode: 'BDT', paymentStatus: 'posted', financialAccountId: 'fa-1',
      customerId: 'cust-1', saleReturnId: null, cashierShiftId: null,
    });
    mocks.paymentCreate.mockResolvedValue({ id: 'reversal-1' });
    mocks.auditCreate.mockResolvedValue({});
    mocks.idempotencyUpdateMany.mockResolvedValue({ count: 1 });
    mocks.refund.mockResolvedValue({ refundId: 'RFND-1', status: 'completed' });
    mocks.getPayment.mockReturnValue({ refund: mocks.refund });
  });

  it('replays the stored response without calling the gateway again', async () => {
    // withIdempotency reports the key was already used and hands back the
    // response recorded by the first, successful attempt.
    mocks.idempotency.mockResolvedValue({
      status: 200,
      body: { payment_id: 'pay-1', refund_id: 'RFND-1', reversal_payment_id: 'reversal-1', amount: 500 },
      isReplay: true,
    });

    const response = await refundRoute(request(), { params: Promise.resolve({ id: 'pay-1' }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ refund_id: 'RFND-1', reversal_payment_id: 'reversal-1' });
    // The decisive assertions: no second refund, no second reversal row.
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.paymentCreate).not.toHaveBeenCalled();
  });

  it('performs the refund exactly once on a first attempt', async () => {
    mocks.idempotency.mockImplementation(async (_params: unknown, work: () => Promise<{ status: number; body: unknown }>) => {
      const result = await work();
      return { ...result, isReplay: false };
    });

    const response = await refundRoute(request(), { params: Promise.resolve({ id: 'pay-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.paymentCreate).toHaveBeenCalledTimes(1);
    // The real outcome replaces the Phase 1 placeholder, so a later replay
    // returns the refund details rather than `{ ok: true }`.
    expect(mocks.idempotencyUpdateMany).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(mocks.idempotencyUpdateMany.mock.calls[0][0].data.responseBody);
    expect(stored).toMatchObject({ refund_id: 'RFND-1', reversal_payment_id: 'reversal-1' });
  });
});
