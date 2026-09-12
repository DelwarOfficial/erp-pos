import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';

const db = new PrismaClient({ log: [] });
let adminToken: string;
let viewerToken: string;
let otherToken: string;
let branchA: string;
const healthy = { status: 'ok', service: 'erp-pos', checks: { database: 'ok', redis: 'ok', storage: 'skipped', worker: 'skipped' },
  details: { database: { response_ms: 1 }, redis: { response_ms: 2 } }, response_ms: 3, timestamp: '2026-09-12T00:00:00.000Z', version: '0.2.0' };

test.beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
  if (process.env.UI_HEALTH_LOCAL_VERIFICATION !== '1' || url.hostname !== '127.0.0.1' || url.port !== '43318'
    || url.pathname !== '/readiness_20260912_disposable') throw new Error('Verified disposable local environment required');
  await db.currency.upsert({ where: { code: 'BDT' }, create: { code: 'BDT', name: 'Taka' }, update: {} });
  const grant = await db.permission.upsert({ where: { code: 'system.config.view' },
    create: { code: 'system.config.view', module: 'system', description: 'View system health' }, update: {} });
  async function persona(companyName: string, privileged: boolean, branchName: string) {
    const company = await db.company.create({ data: { code: randomUUID(), legalName: companyName, displayName: companyName, baseCurrencyCode: 'BDT', status: 'active' } });
    const branch = await db.branch.create({ data: { companyId: company.id, code: 'ALLOWED', name: branchName } });
    await db.branch.create({ data: { companyId: company.id, code: 'DENIED', name: 'Denied branch must not appear' } });
    const user = await db.user.create({ data: { companyId: company.id, name: 'Synthetic browser persona', email: `${randomUUID()}@example.invalid`,
      passwordHash: 'unused-synthetic-fixture', accessScope: 'single_branch' } });
    await db.userBranchAccess.create({ data: { userId: user.id, branchId: branch.id } });
    if (privileged) {
      const role = await db.role.create({ data: { companyId: company.id, name: 'Health administrator' } });
      await db.rolePermission.create({ data: { roleId: role.id, permissionId: grant.id } });
      await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
    }
    const familyId = randomUUID(); const sessionId = randomUUID();
    await db.refreshToken.create({ data: { companyId: company.id, userId: user.id, familyId, sessionId, mfaVerified: true,
      tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
    const token = await new SignJWT({ company_id: company.id, scope: 'single_branch', is_global: false,
      branch_ids: [branch.id], session_id: sessionId, family_id: familyId, mfa_verified: true })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer('erp-pos').setAudience('erp-pos-clients')
      .setSubject(user.id).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
    return { token, branchId: branch.id };
  }
  const admin = await persona('Company A operational workspace', true, 'Branch A only');
  adminToken = admin.token; branchA = admin.branchId;
  viewerToken = (await persona('Restricted workspace', false, 'Viewer branch')).token;
  otherToken = (await persona('Company B operational workspace', false, 'Branch B only')).token;
});
test.afterAll(async () => { await db.$disconnect(); });

async function signIn(page: Page, token = adminToken) {
  await page.context().addCookies([{ name: 'erp_access', value: token, url: 'http://127.0.0.1:43300', httpOnly: true, sameSite: 'Strict' }]);
}
function noEngineering(page: Page) {
  return expect(page.locator('main')).not.toContainText(/Phased Development Plan|Architecture Controls|§18A\.1|§20\.0|M0|M8|SECURITY DEFINER|set_config|Argon2|JWT/);
}

test('Overview shows authoritative company/branch context, no invented KPIs', async ({ page }) => {
  await signIn(page); await page.goto('/dashboard');
  await expect(page.locator('main')).toContainText('Company A operational workspace');
  await expect(page.locator('main')).toContainText('Branch A only');
  await expect(page.locator('main')).not.toContainText('Denied branch must not appear');
  await expect(page.locator('main')).not.toContainText('Company B operational workspace');
  await expect(page.locator('main')).toContainText('No operational shortcuts available');
  await noEngineering(page);
  const me = await (await page.request.get('/api/v1/me')).json();
  expect(me.user.branch_ids).toEqual([branchA]);
});
test('Company B has its own workspace, never company A data', async ({ page }) => {
  await signIn(page, otherToken); await page.goto('/dashboard');
  await expect(page.locator('main')).toContainText('Company B operational workspace');
  await expect(page.locator('main')).not.toContainText('Company A operational workspace');
  await expect(page.locator('main')).not.toContainText('Branch A only');
});
test('session API failure shows an error, not zero business metrics', async ({ page }) => {
  await signIn(page); await page.route('**/api/v1/me', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/dashboard'); await expect(page.getByText('Session error', { exact: true })).toBeVisible();
  await expect(page.getByText('0 / 37')).toHaveCount(0);
});
test('unauthorized persona is denied detailed health in UI and direct API', async ({ page }) => {
  await signIn(page, viewerToken); await page.goto('/dashboard/system');
  await expect(page.locator('main').getByRole('alert')).toContainText('access denied');
  expect((await page.request.get('/api/v1/admin/health')).status()).toBe(403);
  expect((await page.request.get('/api/v1/reports/dashboard_summary')).status()).toBe(403);
});
test('anonymous detailed health denied; public probe is minimal', async ({ request }) => {
  expect((await request.get('/api/v1/admin/health')).status()).toBe(401);
  const response = await request.get('/api/v1/health');
  expect(Object.keys(await response.json()).sort()).toEqual(['service', 'status']);
});
test('authorized real health response matches contract and contains no diagnostics', async ({ page }) => {
  await signIn(page);
  const response = await page.request.get('/api/v1/admin/health');
  expect([200, 503]).toContain(response.status());
  const body = await response.json();
  expect(body.checks.database).toBe('ok');
  expect(body.checks.redis).toBe('fail'); // No disposable Redis is configured: never fake Healthy.
  expect(body.status).toBe('unavailable');
  expect(JSON.stringify(body)).not.toMatch(/phase|DATABASE_URL|redis:\/\/|mysql:\/\/|password|stack|SELECT|127\.0\.0\.1/);
  await page.goto('/dashboard/system');
  await expect(page.locator('[data-slot="card"]').filter({ has: page.getByText('Database', { exact: true }) })).toContainText('Healthy');
  await expect(page.locator('[data-slot="card"]').filter({ has: page.getByText('Redis', { exact: true }) })).toContainText('Unavailable');
  await expect(page.locator('[data-slot="card"]').filter({ has: page.getByText('Queue workers', { exact: true }) })).toContainText('Not monitored');
  await noEngineering(page);
});
for (const [dependency, state, label] of [
  ['database', 'ok', 'Healthy'], ['database', 'fail', 'Unavailable'], ['redis', 'ok', 'Healthy'],
  ['redis', 'degraded', 'Degraded'], ['redis', 'fail', 'Unavailable'], ['storage', 'skipped', 'Not monitored'],
] as const) {
  test(`System Health renders ${dependency} ${state} correctly`, async ({ page }) => {
    await signIn(page);
    await page.route('**/api/v1/admin/health', route => route.fulfill({ json: { ...healthy, checks: { ...healthy.checks, [dependency]: state } } }));
    await page.goto('/dashboard/system');
    const title = { database: 'Database', redis: 'Redis', storage: 'Storage' }[dependency];
    const card = page.locator('[data-slot="card"]').filter({ has: page.getByText(title, { exact: true }) });
    await expect(card).toContainText(label); await noEngineering(page);
  });
}
test('health fetch failure does not claim a database outage', async ({ page }) => {
  await signIn(page); await page.route('**/api/v1/admin/health', route => route.abort());
  await page.goto('/dashboard/system'); await expect(page.locator('main').getByRole('alert')).toContainText('Health API unavailable');
  await expect(page.locator('main')).not.toContainText('Database Unreachable');
});
test('malformed health response renders Unknown, never a false database outage', async ({ page }) => {
  await signIn(page); await page.route('**/api/v1/admin/health', route => route.fulfill({ json: { status: 'ok' } }));
  await page.goto('/dashboard/system'); await expect(page.locator('main').getByRole('alert')).toContainText('Unknown or malformed');
  await expect(page.locator('main')).not.toContainText('Unreachable');
});
test('minimal-data Overview fits mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await signIn(page); await page.goto('/dashboard');
  await expect(page.locator('main')).toContainText('Current company');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test.describe('normal browser service-worker policy', () => {
  test.use({ serviceWorkers: 'allow' });
  test('administrator navigates Overview to real System Health without response interception', async ({ page }) => {
    await signIn(page); await page.goto('/dashboard');
    await expect(page.locator('main')).toContainText('Company A operational workspace');
    await page.getByRole('link', { name: 'System Health', exact: true }).click();
    await expect(page.locator('[data-slot="card"]').filter({ has: page.getByText('Database', { exact: true }) })).toContainText('Healthy');
    await expect(page.locator('[data-slot="card"]').filter({ has: page.getByText('Redis', { exact: true }) })).toContainText('Unavailable');
    await noEngineering(page);
  });
});
