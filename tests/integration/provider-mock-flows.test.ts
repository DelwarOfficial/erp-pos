// tests/integration/provider-mock-flows.test.ts
// End-to-end integration tests for all 5 provider flows using mock implementations.
// Verifies the full provider pipeline works: dispatch → verify → record → callback.
//
// Enable with: PROVIDER_MODE=mock

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MockSmsProvider,
  MockEmailProvider,
  MockCourierProvider,
  MockPaymentProvider,
  MockRiskProvider,
  clearMockCallLog,
  getMockCalls,
} from '@/adapters/mocks';

describe('Provider Mock Integration: SMS Flow', () => {
  beforeEach(() => clearMockCallLog());

  it('sends SMS to a valid Bangladeshi phone and returns sent status', async () => {
    const provider = new MockSmsProvider();
    const result = await provider.sendSms({
      to: '+8801712345678',
      message: 'Your OTP is 123456',
      senderId: 'ERP POS',
    });
    expect(result.status).toBe('sent');
    expect(result.providerMessageId).toMatch(/^mock-sms-\d+/);

    const calls = getMockCalls({ provider: 'mock_sms', method: 'sendSms' });
    expect(calls.length).toBe(1);
  });

  it('rejects invalid phone format', async () => {
    const provider = new MockSmsProvider();
    const result = await provider.sendSms({
      to: 'invalid-phone',
      message: 'Test',
    });
    expect(result.status).toBe('failed');
    expect(result.providerMessageId).toBe('');
  });

  it('supports local 01XXXXXXXXX format', async () => {
    const provider = new MockSmsProvider();
    const result = await provider.sendSms({
      to: '01712345678',
      message: 'Test',
    });
    expect(result.status).toBe('sent');
  });

  it('checkStatus returns delivered for any providerMessageId', async () => {
    const provider = new MockSmsProvider();
    const status = await provider.checkStatus('mock-sms-123');
    expect(status).toBe('delivered');
  });
});

describe('Provider Mock Integration: Email Flow', () => {
  beforeEach(() => clearMockCallLog());

  it('sends email to valid address and returns sent status', async () => {
    const provider = new MockEmailProvider();
    const result = await provider.sendEmail({
      to: 'customer@example.com',
      subject: 'Your order has shipped',
      htmlBody: '<p>Track your order at...</p>',
      textBody: 'Your order has shipped.',
    });
    expect(result.status).toBe('sent');
    expect(result.providerMessageId).toMatch(/^mock-email-\d+/);
  });

  it('rejects invalid email format', async () => {
    const provider = new MockEmailProvider();
    const result = await provider.sendEmail({
      to: 'not-an-email',
      subject: 'X',
      htmlBody: '<p></p>',
    });
    expect(result.status).toBe('failed');
  });

  it('records call in mock log for inspection', async () => {
    const provider = new MockEmailProvider();
    await provider.sendEmail({
      to: 'test@example.com',
      subject: 'Inspection test',
      htmlBody: '<p>body</p>',
    });
    const calls = getMockCalls({ provider: 'mock_email' });
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe('sendEmail');
  });
});

describe('Provider Mock Integration: Courier Flow', () => {
  beforeEach(() => clearMockCallLog());

  it('quotes intra-Dhaka delivery as 2-day, base ৳60', async () => {
    const provider = new MockCourierProvider();
    const quote = await provider.quote({
      fromArea: 'Dhaka',
      toArea: 'Dhaka',
      weight: 0.5,
      codAmount: 1500,
    });
    expect(quote.charge).toBe(80); // 60 + 1*20
    expect(quote.estimatedDays).toBe(2);
  });

  it('quotes outside-Dhaka delivery as 4-day', async () => {
    const provider = new MockCourierProvider();
    const quote = await provider.quote({
      fromArea: 'Dhaka',
      toArea: 'Chittagong',
      weight: 1.0,
      codAmount: 2000,
    });
    expect(quote.estimatedDays).toBe(4);
    expect(quote.charge).toBe(100); // 60 + 2*20
  });

  it('creates shipment with tracking code and label URL', async () => {
    const provider = new MockCourierProvider();
    const result = await provider.createShipment({
      deliveryOrderId: 'do-123',
      recipientName: 'Rahim Ahmed',
      recipientPhone: '01712345678',
      address: 'House 12, Road 3, Banani, Dhaka',
      codAmount: 1500,
    });
    expect(result.providerShipmentId).toMatch(/^mock-shipping-\d+/);
    expect(result.trackingCode).toMatch(/^MOCK[A-Z0-9]+$/);
    expect(result.labelUrl).toContain('https://mock.example.com/label/');
  });

  it('cancels shipment successfully', async () => {
    const provider = new MockCourierProvider();
    const result = await provider.cancelShipment('mock-shipping-123');
    expect(result.cancelled).toBe(true);
  });

  it('tracks shipment — age determines status', async () => {
    const provider = new MockCourierProvider();
    // Recent ID → pending
    const recent = `mock-shipping-${Date.now()}`;
    const recentTrack = await provider.track(recent);
    expect(['pending', 'picked_up', 'in_transit', 'delivered']).toContain(recentTrack.status);

    // Old ID (3+ days) → delivered
    const old = `mock-shipping-${Date.now() - 1000 * 60 * 60 * 24 * 4}`;
    const oldTrack = await provider.track(old);
    expect(oldTrack.status).toBe('delivered');
  });
});

describe('Provider Mock Integration: Payment Flow', () => {
  beforeEach(() => clearMockCallLog());

  it('initiates payment and returns gateway URL + txn ID', async () => {
    const provider = new MockPaymentProvider();
    const result = await provider.initiatePayment({
      amount: 1500,
      currency: 'BDT',
      reference: 'INV-2026-001',
      returnUrl: 'https://app.com/payment/callback',
    });
    expect(result.gatewayUrl).toContain('gatewayTxnId=');
    expect(result.gatewayUrl).toContain('status=success');
    expect(result.gatewayTxnId).toMatch(/^mock-pay-\d+/);
  });

  it('verifies webhook for known payment and returns success', async () => {
    const provider = new MockPaymentProvider();
    // Initiate a payment first
    const init = await provider.initiatePayment({
      amount: 500, currency: 'BDT', reference: 'INV-1', returnUrl: 'https://app.com/cb',
    });
    // Simulate webhook callback
    const webhook = provider.simulateWebhook(init.gatewayTxnId, 'success');
    const result = await provider.verifyWebhook(webhook);
    expect(result.verified).toBe(true);
    expect(result.status).toBe('success');
    expect(result.paymentId).toBe(init.gatewayTxnId);
  });

  it('rejects webhook for unknown payment', async () => {
    const provider = new MockPaymentProvider();
    const result = await provider.verifyWebhook({
      rawBody: JSON.stringify({ paymentID: 'unknown-txn', status: 'success' }),
      signature: 'mock',
      timestamp: new Date().toISOString(),
    });
    expect(result.verified).toBe(false);
  });

  it('refunds payment and returns completed status', async () => {
    const provider = new MockPaymentProvider();
    const result = await provider.refund({
      gatewayTxnId: 'mock-pay-123',
      amount: 500,
    });
    expect(result.refundId).toMatch(/^mock-refund-\d+/);
    expect(result.status).toBe('completed');
  });

  it('returns empty settlements list', async () => {
    const provider = new MockPaymentProvider();
    const settlements = await provider.getSettlements({
      fromDate: new Date('2026-01-01'),
      toDate: new Date('2026-01-31'),
    });
    expect(settlements).toEqual([]);
  });
});

describe('Provider Mock Integration: Risk Flow', () => {
  beforeEach(() => clearMockCallLog());

  it('always allows in mock mode', async () => {
    const provider = new MockRiskProvider();
    const result = await provider.assessRisk({
      subjectType: 'customer',
      subjectId: 'cust-1',
      amount: 999_999_999,
    });
    expect(result.decision).toBe('allow');
    expect(result.score).toBe(0);
    expect(result.reasonCodes).toContain('MOCK_ALWAYS_ALLOW');
  });

  it('returns a unique providerReference per call', async () => {
    const provider = new MockRiskProvider();
    const r1 = await provider.assessRisk({ subjectType: 'lead', subjectId: 'lead-1' });
    const r2 = await provider.assessRisk({ subjectType: 'lead', subjectId: 'lead-1' });
    expect(r1.providerReference).not.toBe(r2.providerReference);
  });
});

describe('Provider Mock Integration: End-to-End Sale → Ship → Pay', () => {
  beforeEach(() => clearMockCallLog());

  it('exercises all providers in a realistic sale workflow', async () => {
    const sms = new MockSmsProvider();
    const email = new MockEmailProvider();
    const courier = new MockCourierProvider();
    const payment = new MockPaymentProvider();
    const risk = new MockRiskProvider();

    // 1. Assess risk on the customer
    const riskResult = await risk.assessRisk({
      subjectType: 'sale',
      subjectId: 'sale-001',
      amount: 15_000,
    });
    expect(riskResult.decision).toBe('allow');

    // 2. Initiate payment
    const payResult = await payment.initiatePayment({
      amount: 15_000,
      currency: 'BDT',
      reference: 'INV-2026-001',
      returnUrl: 'https://app.com/cb',
    });
    expect(payResult.gatewayTxnId).toBeTruthy();

    // 3. Simulate webhook callback
    const webhook = payment.simulateWebhook(payResult.gatewayTxnId, 'success');
    const verifyResult = await payment.verifyWebhook(webhook);
    expect(verifyResult.verified).toBe(true);

    // 4. Create courier shipment
    const shipResult = await courier.createShipment({
      deliveryOrderId: 'do-001',
      recipientName: 'Karim Uddin',
      recipientPhone: '01812345678',
      address: 'House 5, Road 10, Gulshan, Dhaka',
      codAmount: 0, // already paid online
    });
    expect(shipResult.trackingCode).toBeTruthy();

    // 5. Send order confirmation SMS
    const smsResult = await sms.sendSms({
      to: '01812345678',
      message: `Your order INV-2026-001 has shipped. Track: ${shipResult.trackingCode}`,
    });
    expect(smsResult.status).toBe('sent');

    // 6. Send email receipt
    const emailResult = await email.sendEmail({
      to: 'karim@example.com',
      subject: 'Order shipped — INV-2026-001',
      htmlBody: `<p>Track your order: ${shipResult.trackingCode}</p>`,
    });
    expect(emailResult.status).toBe('sent');

    // 7. Verify all 5 providers were called
    expect(getMockCalls({ provider: 'mock_risk' }).length).toBe(1);
    expect(getMockCalls({ provider: 'mock_payment' }).length).toBeGreaterThanOrEqual(2); // init + verify
    expect(getMockCalls({ provider: 'mock_courier' }).length).toBe(1);
    expect(getMockCalls({ provider: 'mock_sms' }).length).toBe(1);
    expect(getMockCalls({ provider: 'mock_email' }).length).toBe(1);
  });
});
