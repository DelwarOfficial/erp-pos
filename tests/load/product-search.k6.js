// tests/load/product-search.k6.js
// k6 load test for product search — target p95 ≤ 800ms.

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.K6_BASE_URL || 'http://localhost:3000';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '2m', target: 20 },
    { duration: '30s', target: 100 },
    { duration: '2m', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<800'],  // 95% < 800ms
    http_req_failed: ['rate<0.01'],
  },
};

const SEARCH_TERMS = ['samsung', 'iphone', 'charger', 'case', 'earphone', 'power', 'cable', 'screen'];

export default function () {
  const loginRes = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({
    email: 'admin@erp-platform.local',
    password: 'ChangeMe!2026',
  }), { headers: { 'Content-Type': 'application/json' } });

  const cookies = loginRes.cookies;
  const term = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];

  const res = http.get(`${BASE}/api/v1/products?search=${term}&limit=10`, {
    headers: { Cookie: `erp_access=${cookies.erp_access?.[0]?.value || ''}` },
  });

  check(res, {
    'search ok': (r) => r.status === 200,
    'has items': (r) => r.json('items') !== undefined,
  });

  sleep(0.2);
}
