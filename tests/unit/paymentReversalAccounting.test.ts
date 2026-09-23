// F-04 / F-06 / F-07 / F-08 / F-09 regression: every payment reversal path must
// reach the general ledger, must not be able to refund more than was taken, and
// must not act on another tenant's payment.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  permission: vi.fn(),
  scope: vi.fn(),
  tenant: vi.fn(),
  idempotency: vi.fn(),
  postJournalEntry: vi.fn(),
  paymentFindFirst: vi.fn(),
  paymentAggregate: vi.fn(),
  paymentUpdateMany: vi.fn(),
  paymentCreate: vi.fn(),
  paymentFindMany: vi.fn(),
  financialAccountFindFirst: vi.fn(),
  policyFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  idempotencyUpdateMany: vi.fn(),
  refund: vi.fn(),
  getPayment: vi.fn(),
  registerProviders: vi.fn(),
  recordSecurityEvent: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: mocks.auth,
  requirePermission: mocks.permission,
}));
vi.mock('@/lib/db/transaction', () => ({
  runInTenantContext: mocks.scope,
  withTenant: mocks.tenant,
}));
vi.mock('@/domain/commands/m4/PostJournalEntry', () => ({ postJournalEntry: mocks.postJournalEntry }));
vi.mock('@/lib/idempotency', () => ({
  withIdempotency: mocks.idempotency,
  computeRequestHash: () => 'hash',
  requireIdempotencyKey: () => 'k'.repeat(16),
}));
vi.mock('@/adapters', () => ({ providerRegistry: { getPayment: mocks.getPayment } }));
vi.mock('@/adapters/providers', () => ({ registerProviders: mocks.registerProviders }));
vi.mock('@/lib/audit', () => ({ recordSecurityEvent: mocks.recordSecurityEvent }));
vi.mock('@/lib/db', () => {
  const client = {
    payment: {
      findFirst: mocks.paymentFindFirst, findMany: mocks.paymentFindMany,
      create: mocks.paymentCreate, aggregate: mocks.paymentAggregate,
      updateMany: mocks.paymentUpdateMany,
    },
    financialAccount: { findFirst: mocks.financialAccountFindFirst },
    accountingPolicy: { findUnique: mocks.policyFindUnique },
    auditLog: { create: mocks.auditCreate },
    idempotencyRequest: { updateMany: mocks.idempotencyUpdateMany },
    $transaction: mocks.transaction,
  };
  return { db: client, systemDb: client };
});

import { POST as refundRoute } from '@/app/api/v1/payments/[id]/refund/route';
import { POST as webhookRoute } from '@/app/api/v1/webhooks/payment/[provider]/route';

const AUTH = {
  companyId: 'company-a', userId: 'user-a', isGlobal: false,
  branchIds: ['branch-a'], ctx: { companyId: 'company-a' },
};

const PAYMENT = {
  id: 'pay-1', companyId: 'company-a', branchId: 'branch-a',
  referenceNo: 'PMT-000001', amount: new Prisma.Decimal('1000.00'),
  baseAmount: new Prisma.Decimal('1000.00'), exchangeRate: new Prisma.Decimal(1),
  currencyCode: 'BDT', paymentStatus: 'posted', financialAccountId: 'fa-1',
  paymentType: 'sale_receipt', direction: 'incoming',
  customerId: 'cust-1', saleReturnId: null, cashierShiftId: null,
  businessDate: new Date('2026-09-01T00:00:00.000Z'),
};

function refundRequest(amount: string) {
  return new NextRequest('http://localhost/api/v1/payments/pay-1/refund', {
    method: 'POST',
    headers: { 'idempotency-key': 'k'.repeat(16), 'content-type': 'application/json' },
    body: JSON.stringify({ amount, provider_code: 'bkash', gateway_txn_id: 'TXN-1' }),
  });
}

describe('gateway refund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(AUTH);
    mocks.permission.mockResolvedValue(undefined);
    mocks.scope.mockImplementation(async (_ctx: unknown, work: () => Promise<unknown>) => work());
    mocks.idempotency.mockImplementation(async (_p: unknown, work: () => Promise<{ status: number; body: unknown }>) => {
      const result = await work();
      return { ...result, isReplay: false };
    });
    mocks.tenant.mockImplementation(async (_ctx: unknown, work: (tx: unknown) => Promise<unknown>) => work({
      payment: {
        findFirst: mocks.paymentFindFirst, aggregate: mocks.paymentAggregate,
        updateMany: mocks.paymentUpdateMany,
      },
      auditLog: { create: mocks.auditCreate },
    }));
    mocks.paymentFindFirst.mockResolvedValue(PAYMENT);
    mocks.paymentAggregate.mockResolvedValue({ _sum: { amount: null } });
    mocks.paymentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.paymentCreate.mockResolvedValue({ id: 'reversal-1' });
    mocks.financialAccountFindFirst.mockResolvedValue({ chartOfAccountId: 'coa-cash' });
    mocks.policyFindUnique.mockResolvedValue({ arAccountId: 'coa-ar', apAccountId: 'coa-ap', customerAdvanceAccountId: 'coa-adv' });
    mocks.auditCreate.mockResolvedValue({});
    mocks.idempotencyUpdateMany.mockResolvedValue({ count: 1 });
    mocks.postJournalEntry.mockResolvedValue({ journalEntryId: 'je-1', entryNo: 'JE-000001' });
    mocks.refund.mockResolvedValue({ refundId: 'RFND-1', status: 'completed' });
    mocks.getPayment.mockReturnValue({ refund: mocks.refund });
  });

  it('F-04: posts the refund to the general ledger', async () => {
    const response = await refundRoute(refundRequest('500.00'), { params: Promise.resolve({ id: 'pay-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.postJournalEntry).toHaveBeenCalledTimes(1);
    const entry = mocks.postJournalEntry.mock.calls[0][1];
    expect(entry.sourceId).toBe('reversal-1');
    // Cash out, receivable back on: the subledger and the GL now agree.
    const cash = entry.lines.find((l: { chartOfAccountId: string }) => l.chartOfAccountId === 'coa-cash');
    const ar = entry.lines.find((l: { chartOfAccountId: string }) => l.chartOfAccountId === 'coa-ar');
    expect(cash.credit.toFixed(2)).toBe('500.00');
    expect(ar.debit.toFixed(2)).toBe('500.00');
  });

  it('F-06: marks the original payment reversed before calling the gateway', async () => {
    await refundRoute(refundRequest('500.00'), { params: Promise.resolve({ id: 'pay-1' }) });

    expect(mocks.paymentUpdateMany).toHaveBeenCalledTimes(1);
    const claim = mocks.paymentUpdateMany.mock.calls[0][0];
    expect(claim.data.paymentStatus).toBe('reversed');
    // Conditional on the current status, so a concurrent refund loses the race.
    expect(claim.where.paymentStatus).toEqual({ not: 'reversed' });
  });

  it('F-06: refuses when the payment was reversed concurrently', async () => {
    mocks.paymentUpdateMany.mockResolvedValue({ count: 0 });
    const response = await refundRoute(refundRequest('500.00'), { params: Promise.resolve({ id: 'pay-1' }) });
    expect(response.status).toBe(409);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('F-07: caps against the cumulative total already refunded', async () => {
    // 600 of the 1000 payment is already refunded; a second 600 must fail.
    mocks.paymentAggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal('600.00') } });

    const response = await refundRoute(refundRequest('600.00'), { params: Promise.resolve({ id: 'pay-1' }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { message: expect.stringContaining('400.00') },
    });
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('F-07: rejects an amount with more than two decimal places', async () => {
    const response = await refundRoute(refundRequest('10.005'), { params: Promise.resolve({ id: 'pay-1' }) });
    expect(response.status).toBe(400);
    expect(mocks.refund).not.toHaveBeenCalled();
  });
});

describe('provider webhook', () => {
  const verified = { verified: true, paymentId: 'TXN-1', status: 'success' as const };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.registerProviders.mockReturnValue(undefined);
    mocks.getPayment.mockReturnValue({ verifyWebhook: vi.fn().mockResolvedValue(verified) });
    mocks.recordSecurityEvent.mockResolvedValue(undefined);
    mocks.scope.mockImplementation(async (_ctx: unknown, work: () => Promise<unknown>) => work());
    mocks.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work({
      payment: { updateMany: mocks.paymentUpdateMany },
      financialAccount: { findFirst: mocks.financialAccountFindFirst },
      accountingPolicy: { findUnique: mocks.policyFindUnique },
      auditLog: { create: mocks.auditCreate },
    }));
    mocks.paymentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.financialAccountFindFirst.mockResolvedValue({ chartOfAccountId: 'coa-cash' });
    mocks.policyFindUnique.mockResolvedValue({ arAccountId: 'coa-ar', apAccountId: 'coa-ap', customerAdvanceAccountId: 'coa-adv' });
    mocks.auditCreate.mockResolvedValue({});
    mocks.postJournalEntry.mockResolvedValue({ journalEntryId: 'je-2', entryNo: 'JE-000002' });
  });

  function webhookRequest() {
    return new NextRequest('http://localhost/api/v1/webhooks/payment/bkash', {
      method: 'POST',
      headers: { 'x-provider-signature': 'sig', 'x-provider-timestamp': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ merchantInvoiceNumber: 'TXN-1' }),
    });
  }

  it('F-08: refuses to act when the reference matches more than one tenant', async () => {
    mocks.paymentFindMany.mockResolvedValue([
      { ...PAYMENT, id: 'pay-a', companyId: 'company-a' },
      { ...PAYMENT, id: 'pay-b', companyId: 'company-b' },
    ]);

    const response = await webhookRoute(webhookRequest(), { params: Promise.resolve({ provider: 'bkash' }) });

    expect(response.status).toBe(409);
    // The decisive assertion: no tenant's payment is touched on an ambiguous match.
    expect(mocks.paymentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'payment_webhook_ambiguous_reference' }));
  });

  it('F-08: scopes the lookup by the signing provider', async () => {
    mocks.paymentFindMany.mockResolvedValue([PAYMENT]);
    await webhookRoute(webhookRequest(), { params: Promise.resolve({ provider: 'bkash' }) });
    expect(mocks.paymentFindMany.mock.calls[0][0].where).toMatchObject({
      methodReference: 'TXN-1', paymentMethod: 'bkash',
    });
  });

  it('F-09: posts the receipt and writes an audit row when a payment completes', async () => {
    mocks.paymentFindMany.mockResolvedValue([PAYMENT]);

    const response = await webhookRoute(webhookRequest(), { params: Promise.resolve({ provider: 'bkash' }) });

    expect(response.status).toBe(200);
    expect(mocks.postJournalEntry).toHaveBeenCalledTimes(1);
    const entry = mocks.postJournalEntry.mock.calls[0][1];
    const cash = entry.lines.find((l: { chartOfAccountId: string }) => l.chartOfAccountId === 'coa-cash');
    expect(cash.debit.toFixed(2)).toBe('1000.00');
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
    expect(mocks.auditCreate.mock.calls[0][0].data.action).toBe('payment.webhook.status_changed');
  });

  it('F-09: a redelivered webhook does not post twice', async () => {
    mocks.paymentFindMany.mockResolvedValue([PAYMENT]);
    mocks.paymentUpdateMany.mockResolvedValue({ count: 0 }); // already applied

    await webhookRoute(webhookRequest(), { params: Promise.resolve({ provider: 'bkash' }) });

    expect(mocks.postJournalEntry).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
