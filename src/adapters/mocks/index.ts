// src/adapters/mocks/index.ts
// Mock provider implementations for development + integration testing.
// These behave like real providers (same interface, deterministic responses)
// but route calls through an in-memory event log instead of hitting real APIs.
//
// Enable by setting env: PROVIDER_MODE=mock
// All mocks log to console + record calls in `mockCallLog` for test assertions.

import type {
  SmsProvider,
  EmailProvider,
  CourierProvider,
  RiskProvider,
  PaymentProvider,
} from '../index';

// ── In-memory call log (inspected by tests) ──
export interface MockCall {
  provider: string;
  method: string;
  args: unknown;
  result: unknown;
  timestamp: number;
}
export const mockCallLog: MockCall[] = [];

function logCall(provider: string, method: string, args: unknown, result: unknown): void {
  const entry: MockCall = {
    provider, method, args, result, timestamp: Date.now(),
  };
  mockCallLog.push(entry);
  if (process.env.MOCK_VERBOSE === 'true') {
    console.log(`[mock:${provider}] ${method}`, args, '→', result);
  }
}

export function clearMockCallLog(): void {
  mockCallLog.length = 0;
}

export function getMockCalls(filter?: { provider?: string; method?: string }): MockCall[] {
  if (!filter) return [...mockCallLog];
  return mockCallLog.filter(
    (c) =>
      (!filter.provider || c.provider === filter.provider) &&
      (!filter.method || c.method === filter.method),
  );
}

// ── SMS Mock ──
export class MockSmsProvider implements SmsProvider {
  code = 'mock_sms';
  // Configurable failure rate for testing retry logic
  failureRate = parseFloat(process.env.MOCK_SMS_FAILURE_RATE ?? '0');

  async sendSms(params: { to: string; message: string; senderId?: string }) {
    // Simulate failure
    if (Math.random() < this.failureRate) {
      const result = { providerMessageId: '', status: 'failed' as const };
      logCall(this.code, 'sendSms', params, result);
      return result;
    }
    // Validate Bangladeshi phone format
    const phone = params.to.replace(/[+\s]/g, '');
    if (!/^880\d{10}$/.test(phone) && !/^01\d{9}$/.test(phone)) {
      const result = { providerMessageId: '', status: 'failed' as const };
      logCall(this.code, 'sendSms', params, result);
      return result;
    }
    const result = {
      providerMessageId: `mock-sms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'sent' as const,
    };
    logCall(this.code, 'sendSms', params, result);
    return result;
  }

  async checkStatus(providerMessageId: string): Promise<'delivered'> {
    // Always returns delivered for mocks
    return 'delivered';
  }
}

// ── Email Mock ──
export class MockEmailProvider implements EmailProvider {
  code = 'mock_email';

  async sendEmail(params: { to: string; subject: string; htmlBody: string; textBody?: string }) {
    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(params.to)) {
      const result = { providerMessageId: '', status: 'failed' as const };
      logCall(this.code, 'sendEmail', params, result);
      return result;
    }
    const result = {
      providerMessageId: `mock-email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'sent' as const,
    };
    logCall(this.code, 'sendEmail', params, result);
    return result;
  }
}

// ── Courier Mock ──
export class MockCourierProvider implements CourierProvider {
  code = 'mock_courier';

  async quote(params: { fromArea: string; toArea: string; weight?: number; codAmount?: number }) {
    // Simplified: ৳60 base + ৳20 per 0.5kg, 2 days in Dhaka, 4 days outside
    const weight = params.weight ?? 0.5;
    const isWithinDhaka = params.fromArea.toLowerCase().includes('dhaka') && params.toArea.toLowerCase().includes('dhaka');
    const result = {
      charge: 60 + Math.ceil(weight / 0.5) * 20,
      estimatedDays: isWithinDhaka ? 2 : 4,
    };
    logCall(this.code, 'quote', params, result);
    return result;
  }

  async createShipment(params: {
    deliveryOrderId: string;
    recipientName: string;
    recipientPhone: string;
    address: string;
    codAmount: number;
  }) {
    const result = {
      providerShipmentId: `mock-shipping-${Date.now()}`,
      trackingCode: `MOCK${Date.now().toString(36).toUpperCase()}`,
      labelUrl: `https://mock.example.com/label/${Date.now()}`,
    };
    logCall(this.code, 'createShipment', params, result);
    return result;
  }

  async cancelShipment(providerShipmentId: string) {
    const result = { cancelled: true };
    logCall(this.code, 'cancelShipment', { providerShipmentId }, result);
    return result;
  }

  async track(providerShipmentId: string) {
    // Cycle through statuses based on age of shipment ID
    const age = Date.now() - parseInt(providerShipmentId.replace(/\D/g, ''), 10);
    let status = 'pending';
    if (age > 1000 * 60 * 60 * 24 * 3) status = 'delivered';
    else if (age > 1000 * 60 * 60 * 24 * 1) status = 'in_transit';
    else if (age > 1000 * 60 * 60 * 6) status = 'picked_up';

    const result = {
      status,
      location: status === 'delivered' ? 'Destination' : 'Dhaka Hub',
      timestamp: new Date(),
    };
    logCall(this.code, 'track', { providerShipmentId }, result);
    return result;
  }
}

// ── Payment Mock ──
export class MockPaymentProvider implements PaymentProvider {
  code = 'mock_payment';
  // In-memory store of initiated payments for webhook simulation
  private payments = new Map<string, { amount: number; reference: string; status: 'pending' | 'success' | 'failed' }>();

  async initiatePayment(params: { amount: number; currency: string; reference: string; returnUrl: string }) {
    const gatewayTxnId = `mock-pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.payments.set(gatewayTxnId, {
      amount: params.amount,
      reference: params.reference,
      status: 'pending',
    });
    const result = {
      gatewayUrl: `${params.returnUrl}?gatewayTxnId=${gatewayTxnId}&status=success`,
      gatewayTxnId,
    };
    logCall(this.code, 'initiatePayment', params, result);
    return result;
  }

  async verifyWebhook(params: { rawBody: string; signature: string; timestamp: string }) {
    // Mock: parse the body and look up the payment
    try {
      const body = JSON.parse(params.rawBody);
      const gatewayTxnId = body.paymentID ?? body.gatewayTxnId ?? '';
      const payment = this.payments.get(gatewayTxnId);
      if (payment) {
        payment.status = body.status ?? 'success';
        const result = {
          verified: true,
          paymentId: gatewayTxnId,
          status: payment.status === 'success' ? 'success' as const : 'failed' as const,
        };
        logCall(this.code, 'verifyWebhook', params, result);
        return result;
      }
    } catch { /* fall through to unverified */ }
    const result = { verified: false as const };
    logCall(this.code, 'verifyWebhook', params, result);
    return result;
  }

  async refund(params: { gatewayTxnId: string; amount: number }) {
    const result = {
      refundId: `mock-refund-${Date.now()}`,
      status: 'completed' as const,
    };
    logCall(this.code, 'refund', params, result);
    return result;
  }

  async getSettlements(params: { fromDate: Date; toDate: Date }) {
    // Return empty array — mock provider doesn't track settlements
    return [];
  }

  // Helper for tests: simulate webhook callback for a given payment
  simulateWebhook(gatewayTxnId: string, status: 'success' | 'failed'): { rawBody: string; signature: string; timestamp: string } {
    return {
      rawBody: JSON.stringify({ paymentID: gatewayTxnId, status }),
      signature: 'mock-signature',
      timestamp: new Date().toISOString(),
    };
  }
}

// ── Risk Mock (always allows — for tests that need clean state) ──
export class MockRiskProvider implements RiskProvider {
  code = 'mock_risk';

  async assessRisk(params: { subjectType: 'customer' | 'lead' | 'sale' | 'delivery'; subjectId: string; amount?: number }) {
    const result = {
      score: 0,
      decision: 'allow' as const,
      reasonCodes: ['MOCK_ALWAYS_ALLOW'],
      providerReference: `mock-risk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
    logCall(this.code, 'assessRisk', params, result);
    return result;
  }
}

// ── Registration helper ──
// Call this instead of registerProviders() when PROVIDER_MODE=mock
import { providerRegistry } from '../index';
import { MockNotificationProvider } from '../slackProvider';

export function registerMockProviders(): void {
  providerRegistry.registerSms(new MockSmsProvider());
  providerRegistry.registerEmail(new MockEmailProvider());
  providerRegistry.registerCourier(new MockCourierProvider());
  providerRegistry.registerPayment(new MockPaymentProvider());
  providerRegistry.registerRisk(new MockRiskProvider());
  providerRegistry.registerNotification(new MockNotificationProvider());
  console.log('[providers] Mock providers registered (PROVIDER_MODE=mock)');
}
