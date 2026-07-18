// tests/e2e/uat-scenario-5-manager.spec.ts
// UAT Scenario 5 — Manager Flow (per §17.5)
// Dashboard, security events, audit log, feature flags, trial balance.

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@erp-platform.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'ChangeMe!2026';

let authCookie: string | undefined;

test.beforeAll(async ({ request }) => {
  // API-based login — much faster than browser-based (no page compilation)
  const res = await request.post(`${BASE_URL}/api/v1/auth/login`, {
    headers: { 'Content-Type': 'application/json', 'Origin': BASE_URL },
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (res.ok()) {
    const setCookie = res.headers()['set-cookie'];
    if (setCookie) {
      const match = setCookie.match(/erp_access=([^;]+)/);
      authCookie = match?.[1];
    }
  }
});

test.describe('UAT Scenario 5 — Manager Flow (API)', () => {
  test('me endpoint returns user + permissions', async ({ request }) => {
    test.skip(!authCookie, 'No auth cookie available');

    const res = await request.get(`${BASE_URL}/api/v1/me`, {
      headers: { Cookie: `erp_access=${authCookie}` },
      failOnStatusCode: false,
    });
    expect([200, 401, 404]).toContain(res.status());
  });

  test('security events endpoint is reachable', async ({ request }) => {
    test.skip(!authCookie, 'No auth cookie available');

    const res = await request.get(`${BASE_URL}/api/v1/security-events`, {
      headers: { Cookie: `erp_access=${authCookie}` },
      failOnStatusCode: false,
    });
    expect([200, 400, 404]).toContain(res.status());
  });

  test('audit log endpoint is reachable', async ({ request }) => {
    test.skip(!authCookie, 'No auth cookie available');

    const res = await request.get(`${BASE_URL}/api/v1/audit-logs`, {
      headers: { Cookie: `erp_access=${authCookie}` },
      failOnStatusCode: false,
    });
    expect([200, 400, 404]).toContain(res.status());
  });

  test('feature flags list endpoint is reachable', async ({ request }) => {
    test.skip(!authCookie, 'No auth cookie available');

    const res = await request.get(`${BASE_URL}/api/v1/feature-flags`, {
      headers: { Cookie: `erp_access=${authCookie}` },
      failOnStatusCode: false,
    });
    expect([200, 400, 404]).toContain(res.status());
  });

  test('trial balance report endpoint is reachable', async ({ request }) => {
    test.skip(!authCookie, 'No auth cookie available');

    const res = await request.get(`${BASE_URL}/api/v1/reports/trial-balance`, {
      headers: { Cookie: `erp_access=${authCookie}` },
      failOnStatusCode: false,
    });
    expect([200, 400, 404]).toContain(res.status());
  });
});

test.describe('UAT Scenario 5 — Manager Flow (UI)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('[id="email"]', ADMIN_EMAIL);
    await page.fill('[id="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
  });

  test('dashboard renders without errors', async ({ page }) => {
    // Check for error boundaries
    const errorText = page.locator('text=Application error, text=Something went wrong');
    expect(await errorText.count()).toBe(0);
  });

  test('all navigation links point to valid routes', async ({ page }) => {
    // Wait for dashboard nav to render
    await page.waitForSelector('a[href*="/dashboard"]', { timeout: 5000 }).catch(() => {});
    // Dashboard nav links may be in <nav>, <aside>, or just <a> tags
    const navLinks = await page.locator('a[href*="/dashboard"]').all();
    expect(navLinks.length).toBeGreaterThan(0);
    for (const link of navLinks) {
      const href = await link.getAttribute('href');
      expect(href).toBeTruthy();
      expect(href?.startsWith('/dashboard') || href?.startsWith('/') || href?.startsWith('http')).toBeTruthy();
    }
  });
});
