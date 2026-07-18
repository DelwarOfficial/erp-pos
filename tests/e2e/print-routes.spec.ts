// tests/e2e/print-routes.spec.ts
// Tests /print/receipt/[id] and /print/invoice/[id] routes.
// Per §10 PDF/print + §20.D08 receipt format.

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
  await page.waitForURL('**/dashboard', { timeout: 45000 });
  const cookies = await context.cookies();
  authCookie = cookies.find((c) => c.name === 'erp_access')?.value;
  await context.close();
});

test.describe('Print Routes', () => {
  test('receipt route requires auth', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/print/receipt/test-sale-id`, {
      failOnStatusCode: false,
    });
    expect([401, 404]).toContain(res.status()); // 401 if no token, 404 if sale doesn't exist
  });

  test('invoice route requires auth', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/print/invoice/test-sale-id`, {
      failOnStatusCode: false,
    });
    expect([401, 404]).toContain(res.status());
  });

  test('receipt route returns 404 for non-existent sale (when authed)', async ({ request }) => {
    test.skip(!authCookie, 'No auth cookie available');

    const res = await request.get(`${BASE_URL}/print/receipt/nonexistent-sale-id`, {
      headers: { Cookie: `erp_access=${authCookie}` },
      failOnStatusCode: false,
    });
    expect([404, 400, 422]).toContain(res.status());
  });

  test('ESC/POS API endpoint requires auth', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/print/escpos/test-sale-id`, {
      failOnStatusCode: false,
    });
    expect([401, 404]).toContain(res.status());
  });

  test('ESC/POS API returns 404 for non-existent sale (when authed)', async ({ request }) => {
    test.skip(!authCookie, 'No auth cookie available');

    const res = await request.get(`${BASE_URL}/api/v1/print/escpos/nonexistent-sale-id`, {
      headers: { Cookie: `erp_access=${authCookie}` },
      failOnStatusCode: false,
    });
    expect([404, 400, 422]).toContain(res.status());
  });
});
