// tests/load/pos-sale.k6.js
// k6 load test for POS sale completion — target p95 ≤ 2s.
//
// Run: k6 run tests/load/pos-sale.k6.js
//
// Prerequisites:
//   - Server running on localhost:3000
//   - A valid company + warehouse + financial account + product with stock
//   - Set env: K6_BASE_URL, K6_WAREHOUSE_ID, K6_FINANCIAL_ACCOUNT_ID, K2_BRANCH_ID

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.K6_BASE_URL || 'http://localhost:3000';
const WAREHOUSE_ID = __ENV.K6_WAREHOUSE_ID || '00000000-0000-0000-0000-000000000001';
const FA_ID = __ENV.K6_FINANCIAL_ACCOUNT_ID || '00000000-0000-0000-0000-000000000002';
const BRANCH_ID = __ENV.K6_BRANCH_ID || '00000000-0000-0000-0000-000000000003';

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // ramp up to 10 VUs
    { duration: '1m', target: 10 },    // stay at 10 VUs
    { duration: '30s', target: 50 },   // ramp up to 50 VUs
    { duration: '2m', target: 50 },    // stay at 50 VUs (peak)
    { duration: '30s', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],  // 95% of requests must complete < 2s
    http_req_failed: ['rate<0.01'],     // < 1% errors
  },
};

export default function () {
  // Login first (cached per VU)
  const loginRes = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({
    email: 'admin@erp-platform.local',
    password: 'ChangeMe!2026',
  }), { headers: { 'Content-Type': 'application/json' } });

  const cookies = loginRes.cookies;

  // Post a sale
  const salePayload = JSON.stringify({
    branch_id: BRANCH_ID,
    warehouse_id: WAREHOUSE_ID,
    currency_code: 'BDT',
    exchange_rate: 1,
    items: [{
      product_id: '00000000-0000-0000-0000-000000000010',
      qty: 1,
      unit_price: 100,
    }],
    payments: [{
      payment_method: 'cash',
      amount: 100,
      financial_account_id: FA_ID,
    }],
  });

  const saleRes = http.post(`${BASE}/api/v1/sales`, salePayload, {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `k6-sale-${__VU}-${__ITER}-${Date.now()}`,
      Cookie: `erp_access=${cookies.erp_access?.[0]?.value || ''}`,
    },
  });

  check(saleRes, {
    'sale posted': (r) => r.status === 201,
    'has reference_no': (r) => r.json('referenceNo') !== undefined,
  });

  sleep(0.5); // think time between sales
}
