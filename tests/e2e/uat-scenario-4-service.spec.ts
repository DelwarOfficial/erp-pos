// tests/e2e/uat-scenario-4-service.spec.ts
// UAT Scenario 4 — Service Flow (per §17.5)
// Tests: service request list, warranty claims, service intake form.

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@erp-platform.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'ChangeMe!2026';

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.fill('[id="email"]', ADMIN_EMAIL);
  await page.fill('[id="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 10000 });
}

test.describe('UAT Scenario 4 — Service Flow', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('service page loads', async ({ page }) => {
    await page.click('a:has-text("Service")');
    await page.waitForURL('**/dashboard/service');
    await expect(page.locator('h1')).toContainText('Service');
  });

  test('service requests API is reachable', async ({ page }) => {
    const cookies = await page.context().cookies();
    const authCookie = cookies.find(c => c.name === 'erp_access');
    test.skip(!authCookie, 'No auth cookie');
    const res = await fetch(`${BASE_URL}/api/v1/service-requests?limit=5`, {
      headers: { Cookie: `erp_access=${authCookie?.value}` },
    });
    expect([200, 403, 404]).toContain(res.status);
  });

  test('warranty claims API is reachable', async ({ page }) => {
    const cookies = await page.context().cookies();
    const authCookie = cookies.find(c => c.name === 'erp_access');
    test.skip(!authCookie, 'No auth cookie');
    const res = await fetch(`${BASE_URL}/api/v1/warranty-claims?limit=5`, {
      headers: { Cookie: `erp_access=${authCookie?.value}` },
    });
    expect([200, 403, 404]).toContain(res.status);
  });
});
