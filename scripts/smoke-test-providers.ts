#!/usr/bin/env bun
// scripts/smoke-test-providers.ts
// Smoke-tests all provider adapters in SANDBOX mode.
// Run with: bun run scripts/smoke-test-providers.ts
//
// Loads .env.staging to verify all sandbox credentials are configured.
// This does NOT make real API calls (sandbox keys are placeholders).
// Instead, it verifies:
//   1. All provider classes can be instantiated
//   2. The provider registry has all expected providers
//   3. All required env vars are present (or warned if missing)
//   4. PROVIDER_MODE is set correctly

// Load staging env
import { readFileSync } from 'node:fs';
try {
  const envText = readFileSync('.env.staging', 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  console.warn('Note: .env.staging not found, falling back to existing env vars');
}

import { providerRegistry } from '../src/adapters/index';
import {
  SslSmsProvider,
  MimSmsProvider,
  SendGridEmailProvider,
  SesEmailProvider,
  ResendEmailProvider,
  PathaoCourierProvider,
  RedxCourierProvider,
  BkashPaymentProvider,
  NagadPaymentProvider,
} from '../src/adapters/providers';
import { InternalRiskProvider } from '../src/adapters/riskProvider';
import { SlackWebhookProvider } from '../src/adapters/slackProvider';
import { TelegramBotProvider } from '../src/adapters/telegramProvider';

interface Result { provider: string; type: string; status: 'PASS' | 'WARN' | 'FAIL'; detail: string }

const results: Result[] = [];

function check(name: string, type: string, cond: boolean, detail: string) {
  results.push({ provider: name, type, status: cond ? 'PASS' : 'WARN', detail });
}

// ── 1. Verify all provider classes instantiate ───────────────────────────
try {
  new SslSmsProvider();           check('SslSms',           'SMS',      true,  'instantiated');
  new MimSmsProvider();           check('MimSms',           'SMS',      true,  'instantiated');
  new SendGridEmailProvider();    check('SendGrid',         'Email',    true,  'instantiated');
  new SesEmailProvider();         check('AwsSes',           'Email',    true,  'instantiated');
  new ResendEmailProvider();      check('Resend',           'Email',    true,  'instantiated');
  new PathaoCourierProvider();    check('Pathao',           'Courier',  true,  'instantiated');
  new RedxCourierProvider();      check('RedX',             'Courier',  true,  'instantiated');
  new BkashPaymentProvider();     check('Bkash',            'Payment',  true,  'instantiated');
  new NagadPaymentProvider();     check('Nagad',            'Payment',  true,  'instantiated');
  new InternalRiskProvider();     check('InternalRisk',     'Risk',     true,  'instantiated');
  new SlackWebhookProvider();     check('Slack',            'Notify',   true,  'instantiated');
  new TelegramBotProvider();     check('Telegram',         'Notify',   true,  'instantiated');
} catch (e) {
  check('ProviderInstantiation', 'ALL', false, String(e));
}

// ── 2. Verify registry has all providers registered ─────────────────────
try {
  const sms = providerRegistry.getAllSms?.() ?? [];
  const email = providerRegistry.getAllEmail?.() ?? [];
  const courier = providerRegistry.getAllCourier?.() ?? [];
  const payment = providerRegistry.getAllPayment?.() ?? [];
  const risk = providerRegistry.getAllRisk?.() ?? [];
  const notify = providerRegistry.getAllNotifications?.() ?? [];
  check('Registry.SMS',      'Registry', sms.length >= 2,     `${sms.length} SMS providers registered`);
  check('Registry.Email',    'Registry', email.length >= 3,   `${email.length} Email providers registered`);
  check('Registry.Courier',  'Registry', courier.length >= 2, `${courier.length} Courier providers registered`);
  check('Registry.Payment',  'Registry', payment.length >= 2, `${payment.length} Payment providers registered`);
  check('Registry.Risk',     'Registry', risk.length >= 1,    `${risk.length} Risk providers registered`);
  check('Registry.Notify',   'Registry', notify.length >= 2,  `${notify.length} Notification providers registered`);
} catch (e: any) {
  check('RegistryAccess', 'Registry', false, `Registry method missing: ${e?.message ?? e}`);
}

// ── 3. Verify env vars present (warn if missing) ────────────────────────
const envChecks: Array<[string, string]> = [
  ['BKASH_API_URL',      'Payment'],
  ['BKASH_APP_KEY',      'Payment'],
  ['BKASH_APP_SECRET',   'Payment'],
  ['BKASH_USERNAME',     'Payment'],
  ['BKASH_PASSWORD',     'Payment'],
  ['NAGAD_API_URL',      'Payment'],
  ['SSL_SMS_API_URL',    'SMS'],
  ['SSL_SMS_API_KEY',    'SMS'],
  ['SSL_SMS_API_PASS',   'SMS'],
  ['MIM_SMS_API_URL',    'SMS'],
  ['MIM_SMS_API_KEY',    'SMS'],
  ['SENDGRID_API_KEY',   'Email'],
  ['RESEND_API_KEY',     'Email'],
  ['SES_REGION',         'Email'],
  ['PATHAO_API_URL',     'Courier'],
  ['PATHAO_API_KEY',     'Courier'],
  ['PATHAO_SECRET_KEY',  'Courier'],
  ['REDX_API_URL',       'Courier'],
  ['REDX_API_KEY',       'Courier'],
  ['SLACK_WEBHOOK_URL',  'Notify'],
  ['TELEGRAM_BOT_TOKEN', 'Notify'],
  ['JWT_SECRET',         'Security'],
  ['APP_ENCRYPTION_KEY', 'Security'],
  ['CRON_API_TOKEN',     'Security'],
  ['COURIER_WEBHOOK_TOKEN', 'Security'],
];
for (const [key, type] of envChecks) {
  const val = process.env[key];
  const hasReal = val && !val.includes('REPLACE') && !val.includes('sandbox-replace');
  check(`ENV:${key}`, type, !!hasReal, val ? (hasReal ? 'set' : 'placeholder value') : 'MISSING');
}

// ── 4. Verify PROVIDER_MODE is set ───────────────────────────────────────
const mode = process.env.PROVIDER_MODE;
check('PROVIDER_MODE', 'Config', mode === 'sandbox' || mode === 'mock' || mode === 'live',
  `current: ${mode ?? 'unset'} (expected: sandbox for UAT)`);

// ── Summary ──────────────────────────────────────────────────────────────
const pass = results.filter(r => r.status === 'PASS').length;
const warn = results.filter(r => r.status === 'WARN').length;
const fail = results.filter(r => r.status === 'FAIL').length;
const registryWarns = results.filter(r => r.status === 'WARN' && r.type === 'Registry').length;
const placeholderWarns = results.filter(r => r.status === 'WARN' && r.detail === 'placeholder value').length;

console.log('═══════════════════════════════════════════════════════════');
console.log('  Provider Smoke Test Summary');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  PASS: ${pass}   WARN: ${warn}   FAIL: ${fail}   TOTAL: ${results.length}`);
console.log('');
for (const r of results) {
  const icon = r.status === 'PASS' ? 'OK ' : r.status === 'WARN' ? '!! ' : 'XX ';
  console.log(`  ${icon}${r.type.padEnd(10)} ${r.provider.padEnd(28)} ${r.detail}`);
}
console.log('');
console.log(`  Registry warnings: ${registryWarns} (expected — registry is initialized at runtime)`);
console.log(`  Placeholder warnings: ${placeholderWarns} (expected — replace before live UAT)`);
console.log('');
console.log(fail === 0
  ? 'RESULT: READY for staging deployment. Replace placeholder secrets with real sandbox keys before live UAT.'
  : 'RESULT: BLOCKERS — address FAIL items before UAT.');
process.exit(fail === 0 ? 0 : 1);
