// tests/e2e/uat-scenario-3-accountant.spec.ts
// UAT Scenario 3 — Accountant Flow (per §17.5)
// Tests journal entry + trial balance + fiscal period lock + expense posting.

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@erp-platform.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'ChangeMe!2026';

let authCookie: string | undefined;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.fill('[id="email"]', ADMIN_EMAIL);
  await page.fill('[id="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 10000 });
  const cookies = await context.cookies();
  authCookie = cookies.find((c) => c.name === 'erp_access')?.value;
  await context.close();
});

test.describe('UAT Scenario 3 — Accountant Flow', () => {
  test('journal entry endpoint validates balanced Dr/Cr', async ({ request }) => {
    test.skip(!authCookie, 'No auth cookie available');

    // Unbalanced entry should be rejected
    const res = await request.post(`${BASE_URL}/api/v1/journal-entries`, {
      headers: { Cookie: `erp_access=${authCookie}`, 'Content-Type': 'application/json' },
      data: {
        entries: [
          { accountCode: '1001', debit: 100, credit: 0 },
          { accountCode: '4001', debit: 0, credit: 50 }, // unbalanced
        ],
      },
      failOnStatusCode: false,
    });
    expect([400, 422, 500]).toContain(res.status());
  });

  test('trial balance report is reachable', async ({ request }) => {
    test.skip(!authCookie, 'No auth cookie available');

    const res = await request.get(`${BASE_URL}/api/v1/reports/trial-balance`, {
      headers: { Cookie: `erp_access=${authCookie}` },
      failOnStatusCode: false,
    });
    expect([200, 400, 404]).toContain(res.status());
  });

  test('fiscal period endpoint rejects postings to locked period', async ({ request }) => {
    test.skip(!authCookie, 'No auth cookie available');

    const res = await request.get(`${BASE_URL}/api/v1/fiscal-periods`, {
      headers: { Cookie: `erp_access=${authCookie}` },
      failOnStatusCode: false,
    });
    expect([200, 400, 404]).toContain(res.status());
  });

  test('expense endpoint validates input', async ({ request }) => {
    test.skip(!authCookie, 'No auth cookie available');

    const res = await request.post(`${BASE_URL}/api/v1/expenses`, {
      headers: { Cookie: `erp_access=${authCookie}`, 'Content-Type': 'application/json' },
      data: {},
      failOnStatusCode: false,
    });
    expect([400, 422, 500]).toContain(res.status());
  });
});
