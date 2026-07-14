#!/usr/bin/env bun
// scripts/smoke-test-providers.ts
// Smoke-tests the provider pipeline using mock implementations.
// Useful to verify the integration plumbing works without real credentials.
//
// Usage: PROVIDER_MODE=mock bun run scripts/smoke-test-providers.ts

import {
  MockSmsProvider,
  MockEmailProvider,
  MockCourierProvider,
  MockPaymentProvider,
  MockRiskProvider,
  clearMockCallLog,
  getMockCalls,
} from '../src/adapters/mocks';

console.log('═══════════════════════════════════════════════════════════');
console.log('  Provider Smoke Test (mock mode)');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

clearMockCallLog();

const sms = new MockSmsProvider();
const email = new MockEmailProvider();
const courier = new MockCourierProvider();
const payment = new MockPaymentProvider();
const risk = new MockRiskProvider();

let passed = 0, failed = 0;

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}:`, e instanceof Error ? e.message : e);
    failed++;
  }
}

// ── SMS ──
console.log('SMS:');
await step('sends to valid Bangladeshi phone', async () => {
  const r = await sms.sendSms({ to: '+8801712345678', message: 'Test OTP' });
  if (r.status !== 'sent') throw new Error(`Expected sent, got ${r.status}`);
});

await step('rejects invalid phone', async () => {
  const r = await sms.sendSms({ to: 'invalid', message: 'Test' });
  if (r.status !== 'failed') throw new Error(`Expected failed, got ${r.status}`);
});

// ── Email ──
console.log('Email:');
await step('sends to valid email', async () => {
  const r = await email.sendEmail({ to: 'user@example.com', subject: 'Test', htmlBody: '<p></p>' });
  if (r.status !== 'sent') throw new Error(`Expected sent, got ${r.status}`);
});

// ── Courier ──
console.log('Courier:');
await step('quotes intra-Dhaka delivery', async () => {
  const q = await courier.quote({ fromArea: 'Dhaka', toArea: 'Dhaka', weight: 0.5, codAmount: 1000 });
  if (q.estimatedDays !== 2) throw new Error(`Expected 2 days, got ${q.estimatedDays}`);
});

await step('creates shipment with tracking code', async () => {
  const r = await courier.createShipment({
    deliveryOrderId: 'do-1', recipientName: 'Test', recipientPhone: '01712345678',
    address: 'Dhaka', codAmount: 1500,
  });
  if (!r.trackingCode) throw new Error('Missing tracking code');
});

// ── Payment ──
console.log('Payment:');
await step('initiates payment and verifies webhook', async () => {
  const init = await payment.initiatePayment({
    amount: 1500, currency: 'BDT', reference: 'INV-1', returnUrl: 'https://app.com/cb',
  });
  if (!init.gatewayTxnId) throw new Error('Missing gatewayTxnId');

  const webhook = payment.simulateWebhook(init.gatewayTxnId, 'success');
  const verify = await payment.verifyWebhook(webhook);
  if (!verify.verified) throw new Error('Webhook not verified');
});

await step('refunds payment', async () => {
  const r = await payment.refund({ gatewayTxnId: 'mock-pay-1', amount: 500 });
  if (r.status !== 'completed') throw new Error(`Expected completed, got ${r.status}`);
});

// ── Risk ──
console.log('Risk:');
await step('assesses risk and returns allow', async () => {
  const r = await risk.assessRisk({ subjectType: 'sale', subjectId: 'sale-1', amount: 5000 });
  if (r.decision !== 'allow') throw new Error(`Expected allow, got ${r.decision}`);
});

// ── Summary ──
console.log('');
console.log('───────────────────────────────────────────────────────────');
console.log(`Total calls logged: ${getMockCalls().length}`);
console.log(`  SMS: ${getMockCalls({ provider: 'mock_sms' }).length}`);
console.log(`  Email: ${getMockCalls({ provider: 'mock_email' }).length}`);
console.log(`  Courier: ${getMockCalls({ provider: 'mock_courier' }).length}`);
console.log(`  Payment: ${getMockCalls({ provider: 'mock_payment' }).length}`);
console.log(`  Risk: ${getMockCalls({ provider: 'mock_risk' }).length}`);
console.log('');
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
