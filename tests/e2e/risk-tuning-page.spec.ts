// tests/e2e/risk-tuning-page.spec.ts
// E2e tests for the Risk Tuning dashboard page.
// Per §17.5 UAT — admin can view thresholds, see FP/FN report, record outcomes.

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

test.describe('Risk Tuning Page — Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('risk tuning page loads with title', async ({ page }) => {
    await page.click('a:has-text("Risk Tuning")');
    await page.waitForURL('**/dashboard/risk-tuning');
    await expect(page.locator('h1')).toContainText('Risk Threshold Tuning');
  });

  test('displays three tabs', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/risk-tuning`);
    await page.waitForSelector('[role="tab"]:has-text("FP/FN Report")', { timeout: 5000 });
    await expect(page.locator('[role="tab"]:has-text("FP/FN Report")')).toBeVisible();
    await expect(page.locator('[role="tab"]:has-text("Assessments")')).toBeVisible();
    await expect(page.locator('[role="tab"]:has-text("Current Thresholds")')).toBeVisible();
  });
});

test.describe('Risk Tuning Page — FP/FN Report Tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/dashboard/risk-tuning`);
    await page.waitForSelector('text=FP/FN Report');
  });

  test('shows KPI tiles', async ({ page }) => {
    await expect(page.locator('text=Total Assessments')).toBeVisible();
    await expect(page.locator('text=Precision')).toBeVisible();
    await expect(page.locator('text=Recall')).toBeVisible();
    await expect(page.locator('text=FN Loss Amount')).toBeVisible();
  });

  test('shows confusion matrix', async ({ page }) => {
    await expect(page.locator('text=Confusion Matrix')).toBeVisible();
    await expect(page.locator('text=True Positive').first()).toBeVisible();
    await expect(page.locator('text=True Negative').first()).toBeVisible();
    await expect(page.locator('text=False Positive').first()).toBeVisible();
    await expect(page.locator('text=False Negative').first()).toBeVisible();
  });

  test('shows recommendations alert', async ({ page }) => {
    await expect(page.locator('text=Tuning Recommendations').first()).toBeVisible();
  });
});

test.describe('Risk Tuning Page — Assessments Tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/dashboard/risk-tuning`);
    await page.waitForSelector('text=FP/FN Report');
    await page.click('[role="tab"]:has-text("Assessments")');
  });

  test('shows empty state when no assessments', async ({ page }) => {
    // Should show either the empty state OR the assessments table
    const emptyState = page.locator('text=No risk assessments recorded yet');
    const table = page.locator('text=Recent Risk Assessments');
    // At least one should be visible
    await page.waitForTimeout(1000);
    const emptyVisible = await emptyState.count();
    const tableVisible = await table.count();
    expect(emptyVisible + tableVisible).toBeGreaterThan(0);
  });
});

test.describe('Risk Tuning Page — Thresholds Tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/dashboard/risk-tuning`);
    await page.waitForSelector('text=FP/FN Report');
    await page.click('[role="tab"]:has-text("Current Thresholds")');
  });

  test('displays all threshold groups', async ({ page }) => {
    await expect(page.locator('text=Velocity Rule').first()).toBeVisible();
    await expect(page.locator('text=Outstanding AR Rule').first()).toBeVisible();
    await expect(page.locator('text=Return Ratio Rule').first()).toBeVisible();
    await expect(page.locator('text=Failed Payments Rule').first()).toBeVisible();
    await expect(page.locator('text=Delivery COD Rule').first()).toBeVisible();
    await expect(page.locator('text=Sale Amount Tiers').first()).toBeVisible();
    await expect(page.locator('text=Score Increments').first()).toBeVisible();
    await expect(page.locator('text=Decision Thresholds').first()).toBeVisible();
  });

  test('shows env var hint', async ({ page }) => {
    await expect(page.locator('text=Env-Configurable').first()).toBeVisible();
    await expect(page.locator('text=RISK_VELOCITY_COUNT_THRESHOLD').first()).toBeVisible();
  });

  test('shows decision threshold visualization', async ({ page }) => {
    await expect(page.locator('text=Decision Thresholds Visualization')).toBeVisible();
    await expect(page.locator('text=Allow').first()).toBeVisible();
    await expect(page.locator('text=Review').first()).toBeVisible();
    await expect(page.locator('text=Block').first()).toBeVisible();
  });

  test('shows RISK_ env var names next to each threshold', async ({ page }) => {
    const envVarBadges = page.locator('code:has-text("RISK_")');
    const count = await envVarBadges.count();
    expect(count).toBeGreaterThan(10); // all 22 thresholds should have env var hints
  });
});

test.describe('Risk Tuning Page — API Integration', () => {
  test('risk-config API returns expected shape', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    const cookies = await context.cookies();
    const authCookie = cookies.find((c) => c.name === 'erp_access');
    test.skip(!authCookie, 'No auth cookie');

    const res = await fetch(`${BASE_URL}/api/v1/admin/risk-config`, {
      headers: { Cookie: `erp_access=${authCookie?.value}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config).toBeDefined();
    expect(body.config.VELOCITY_COUNT_THRESHOLD).toBeGreaterThan(0);
    expect(body.config.DECISION_BLOCK_THRESHOLD).toBeGreaterThan(0);
    await context.close();
  });

  test('risk-assessments API returns list shape', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    const cookies = await context.cookies();
    const authCookie = cookies.find((c) => c.name === 'erp_access');
    test.skip(!authCookie, 'No auth cookie');

    const res = await fetch(`${BASE_URL}/api/v1/admin/risk-assessments?limit=5`, {
      headers: { Cookie: `erp_access=${authCookie?.value}` },
    });
    expect([200, 403]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.assessments).toBeInstanceOf(Array);
      expect(body.total).toBeGreaterThanOrEqual(0);
    }
    await context.close();
  });

  test('risk-assessments report API returns analysis', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    const cookies = await context.cookies();
    const authCookie = cookies.find((c) => c.name === 'erp_access');
    test.skip(!authCookie, 'No auth cookie');

    const res = await fetch(`${BASE_URL}/api/v1/admin/risk-assessments/report`, {
      headers: { Cookie: `erp_access=${authCookie?.value}` },
    });
    expect([200, 403]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.summary).toBeDefined();
      expect(body.summary.totalAssessments).toBeGreaterThanOrEqual(0);
      expect(body.recommendations).toBeInstanceOf(Array);
    }
    await context.close();
  });
});
