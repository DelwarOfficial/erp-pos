import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';

// Lightweight authenticated navigation contract. Business mutations remain in focused UAT suites.
const db = new PrismaClient({ log: [] });
let token = '';
const modules: Array<[string, string]> = [
  ['Overview', '/dashboard'], ['POS', '/dashboard/pos'], ['Sales', '/dashboard/sales'], ['Cashier Shifts', '/dashboard/cashier'],
  ['Payments', '/dashboard/payments'], ['Products', '/dashboard/products'], ['Catalogue', '/dashboard/catalogue'], ['Inventory', '/dashboard/inventory'],
  ['Purchases', '/dashboard/purchases'], ['Customers/Suppliers', '/dashboard/parties'], ['Accounting', '/dashboard/accounting'], ['Fixed Assets', '/dashboard/assets'],
  ['Bank Reconciliation', '/dashboard/bank-reconciliation'], ['Deliveries', '/dashboard/deliveries'], ['Service', '/dashboard/service'], ['CRM', '/dashboard/crm'],
  ['HR', '/dashboard/hr'], ['Gift Cards', '/dashboard/gift-cards'], ['Integrations', '/dashboard/integrations'], ['Import/Export', '/dashboard/imports'],
  ['Feature Flags', '/dashboard/feature-flags'], ['Security Events', '/dashboard/security'], ['Risk Tuning', '/dashboard/risk-tuning'], ['Audit Log', '/dashboard/audit'],
  ['Tenant Onboarding', '/dashboard/onboarding'], ['System Health', '/dashboard/system'], ['Settings', '/dashboard/settings'], ['Expenses', '/dashboard/expenses'],
  ['Communications', '/dashboard/communications'], ['Reports', '/dashboard/reports'], ['Support', '/dashboard/support'], ['Access Control', '/dashboard/access/users'],
];

test.beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
  if (process.env.UI_HEALTH_LOCAL_VERIFICATION !== '1' || url.hostname !== '127.0.0.1' || url.port !== '43318') throw new Error('Disposable local environment required');
  const currency = await db.currency.upsert({ where: { code: 'BDT' }, create: { code: 'BDT', name: 'Taka' }, update: {} });
  const company = await db.company.create({ data: { code: `SM${randomUUID().slice(0, 10)}`.toUpperCase(), legalName: 'Smoke tenant', displayName: 'Smoke tenant', baseCurrencyCode: currency.code } });
  const branch = await db.branch.create({ data: { companyId: company.id, code: 'MAIN', name: 'Main branch' } });
  const user = await db.user.create({ data: { companyId: company.id, name: 'Browser smoke', email: `${randomUUID()}@example.invalid`, passwordHash: 'synthetic' } });
  await db.userBranchAccess.create({ data: { userId: user.id, branchId: branch.id } });
  const familyId = randomUUID(); const sessionId = randomUUID();
  await db.refreshToken.create({ data: { companyId: company.id, userId: user.id, familyId, sessionId, mfaVerified: true, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
  token = await new SignJWT({ company_id: company.id, scope: 'single_branch', is_global: false, branch_ids: [branch.id], session_id: sessionId, family_id: familyId, mfa_verified: true })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('erp-pos').setAudience('erp-pos-clients').setSubject(user.id).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
});
test.afterAll(async () => { await db.$disconnect(); });

for (const [name, path] of modules) {
  test(`${name} authenticated smoke`, async ({ page }) => {
    await page.context().addCookies([{ name: 'erp_access', value: token, url: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:43300', httpOnly: true, sameSite: 'Strict' }]);
    const statuses: number[] = [];
    page.on('response', response => { if (response.url().includes('/api/')) statuses.push(response.status()); });
    const response = await page.goto(path);
    expect(response?.status() ?? 0).toBeLessThan(500);
    await expect(page.locator('body')).not.toContainText(/Internal Server Error|MODULE_NOT_FOUND|PrismaClientInitializationError|Unhandled Runtime Error/);
    expect(statuses.filter(status => status === 401)).toEqual([]);
    expect(statuses.filter(status => status >= 500)).toEqual([]);
  });
}
