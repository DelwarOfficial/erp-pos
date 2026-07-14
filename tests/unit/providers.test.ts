// tests/unit/providers.test.ts
// Tests concrete provider adapters — SSL Wireless SMS, SendGrid email,
// bKash payment, internal risk scoring. Uses fetch mocking to avoid
// network calls.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

// Mock db for risk provider
vi.mock('@/lib/db', () => ({
  db: {
    sale: {
      findUnique: vi.fn(),
      aggregate: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    saleReturn: { count: vi.fn() },
    payment: { count: vi.fn() },
    customer: { findUnique: vi.fn() },
  },
}));

import { db } from '@/lib/db';

describe('SslSmsProvider', () => {
  beforeEach(() => { fetchMock.mockReset(); });

  it('sends SMS and returns sent on OK response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('OK|12345'),
    });
    const { SslSmsProvider } = await import('@/adapters/providers');
    const provider = new SslSmsProvider();
    const result = await provider.sendSms({ to: '+8801712345678', message: 'Test' });
    expect(result.status).toBe('sent');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe('POST');
  });

  it('returns failed on non-OK response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, text: () => Promise.resolve('ERROR') });
    const { SslSmsProvider } = await import('@/adapters/providers');
    const provider = new SslSmsProvider();
    const result = await provider.sendSms({ to: '8801712345678', message: 'Test' });
    expect(result.status).toBe('failed');
  });
});

describe('SendGridEmailProvider', () => {
  beforeEach(() => { fetchMock.mockReset(); });

  it('sends email and returns sent on 202 response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: (k: string) => k === 'x-message-id' ? 'msg-123' : null },
    });
    const { SendGridEmailProvider } = await import('@/adapters/providers');
    const provider = new SendGridEmailProvider();
    const result = await provider.sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      htmlBody: '<p>Test</p>',
    });
    expect(result.status).toBe('sent');
    expect(result.providerMessageId).toBe('msg-123');
  });

  it('returns failed on error response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      headers: { get: () => null },
    });
    const { SendGridEmailProvider } = await import('@/adapters/providers');
    const provider = new SendGridEmailProvider();
    const result = await provider.sendEmail({
      to: 'user@example.com', subject: 'X', htmlBody: '<p></p>',
    });
    expect(result.status).toBe('failed');
  });
});

describe('BkashPaymentProvider', () => {
  beforeEach(() => { fetchMock.mockReset(); });

  it('initiates payment by fetching token and calling create', async () => {
    // Token call
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id_token: 'tok-123' }),
    });
    // Create payment call
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ bkashURL: 'https://bkash.com/pay/abc', paymentID: 'pay-456' }),
    });
    const { BkashPaymentProvider } = await import('@/adapters/providers');
    const provider = new BkashPaymentProvider();
    const result = await provider.initiatePayment({
      amount: 500, currency: 'BDT', reference: 'INV-1', returnUrl: 'https://app.com/return',
    });
    expect(result.gatewayUrl).toBe('https://bkash.com/pay/abc');
    expect(result.gatewayTxnId).toBe('pay-456');
  });
});

describe('InternalRiskProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns allow for new lead subject', async () => {
    const { InternalRiskProvider } = await import('@/adapters/riskProvider');
    const provider = new InternalRiskProvider();
    const result = await provider.assessRisk({
      subjectType: 'lead',
      subjectId: 'lead-1',
      amount: 1000,
    });
    expect(['allow', 'review']).toContain(result.decision);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.providerReference).toMatch(/^risk-/);
  });

  it('blocks inactive customer', async () => {
    vi.mocked(db.sale).findUnique.mockResolvedValueOnce({ customerId: 'cust-1' } as any);
    vi.mocked(db.sale).aggregate.mockResolvedValueOnce({ _sum: { grandTotal: '0' } } as any);
    vi.mocked(db.sale).findMany.mockResolvedValueOnce([] as any);
    vi.mocked(db.sale).count.mockResolvedValueOnce(0);
    vi.mocked(db.saleReturn).count.mockResolvedValueOnce(0);
    vi.mocked(db.payment).count.mockResolvedValueOnce(0);
    vi.mocked(db.customer).findUnique.mockResolvedValueOnce({ isActive: false, creditLimit: '0' } as any);

    const { InternalRiskProvider } = await import('@/adapters/riskProvider');
    const provider = new InternalRiskProvider();
    const result = await provider.assessRisk({
      subjectType: 'customer',
      subjectId: 'cust-1',
      amount: 1000,
    });
    expect(result.decision).toBe('block');
    expect(result.reasonCodes).toContain('INACTIVE_CUSTOMER');
  });

  it('flags high-velocity customer for review', async () => {
    vi.mocked(db.sale).findUnique.mockResolvedValueOnce({ customerId: 'cust-2' } as any);
    vi.mocked(db.sale).aggregate.mockResolvedValueOnce({ _sum: { grandTotal: '0' } } as any);
    // 25 sales in 24h > threshold of 20, plus total > 200000 to also trip amount rule
    vi.mocked(db.sale).findMany.mockResolvedValueOnce(
      Array(25).fill({ grandTotal: '10000' })
    );
    vi.mocked(db.sale).count.mockResolvedValueOnce(50);
    vi.mocked(db.saleReturn).count.mockResolvedValueOnce(2);
    vi.mocked(db.payment).count.mockResolvedValueOnce(0);
    vi.mocked(db.customer).findUnique.mockResolvedValueOnce({ isActive: true, creditLimit: '0' } as any);

    const { InternalRiskProvider } = await import('@/adapters/riskProvider');
    const provider = new InternalRiskProvider();
    const result = await provider.assessRisk({
      subjectType: 'sale',
      subjectId: 'sale-1',
      amount: 5000,
    });
    expect(result.decision).toBe('review');
    expect(result.reasonCodes).toContain('HIGH_ORDER_VELOCITY');
    expect(result.reasonCodes).toContain('HIGH_AMOUNT_VELOCITY');
  });

  it('exposes RISK_CONFIG with env-configurable thresholds', async () => {
    const { RISK_CONFIG } = await import('@/adapters/riskProvider');
    expect(RISK_CONFIG.VELOCITY_COUNT_THRESHOLD).toBe(20);
    expect(RISK_CONFIG.CUSTOMER_DEBT_THRESHOLD).toBe(100_000);
    expect(RISK_CONFIG.DECISION_BLOCK_THRESHOLD).toBe(70);
    expect(RISK_CONFIG.RETURN_RATIO_HIGH).toBe(0.4);
  });
});
