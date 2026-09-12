import { test, expect, type Page, type Locator } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { authenticator } from '@otplib/preset-default';
import { hashPassword } from '../../src/lib/auth/password';
import { setupMfa } from '../../src/lib/auth/mfa';
import { ADMIN_GRANTS } from '../../src/lib/access/policy';

const raw = new PrismaClient({ log: [] });
const password = `Local-${randomUUID()}-123!`;
type Persona = { email: string; code: string; secret?: string; id: string };
let platform: Persona, tenant: Persona, staff: Persona;
let companyId: string, branchA: string, branchB: string, staffRoleId: string;
let createdUserId: string;
test.beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? 'invalid:');
  if (process.env.UI_HEALTH_LOCAL_VERIFICATION !== '1' || target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') throw new Error('Guarded disposable database required');
  const grants = [...ADMIN_GRANTS, 'user.create', 'role.create', 'user.reset_password', 'branch.read', 'company.read', 'product.read'];
  const permissions = new Map<string, string>();
  for (const code of grants) permissions.set(code, (await raw.permission.upsert({ where: { code }, update: {}, create: { code, module: 'access_test', description: code } })).id);
  const root = await raw.company.upsert({ where: { code: 'PLATFORM' }, update: {}, create: { code: 'PLATFORM', displayName: 'Platform', legalName: 'Platform', baseCurrencyCode: 'BDT' } });
  const company = await raw.company.create({ data: { code: `AC${randomUUID().slice(0, 12)}`.toUpperCase(), displayName: 'A Access E2E tenant', legalName: 'Synthetic only', baseCurrencyCode: 'BDT' } });
  companyId = company.id;
  branchA = (await raw.branch.create({ data: { companyId, code: 'A', name: 'Access branch A' } })).id;
  branchB = (await raw.branch.create({ data: { companyId, code: 'B', name: 'Access branch B' } })).id;
  const role = await raw.role.create({ data: { companyId, name: 'Browser administrator', permissions: { create: grants.map(code => ({ permissionId: permissions.get(code)! })) } } });
  staffRoleId = (await raw.role.create({ data: { companyId, name: 'Browser staff', permissions: { create: [{ permissionId: permissions.get('product.read')! }] } } })).id;
  const hashed = await hashPassword(password);
  async function persona(tenantId: string, code: string, privileged: boolean, roleId?: string): Promise<Persona> {
    const email = `${randomUUID()}@example.invalid`;
    const mfa = privileged ? setupMfa({ userEmail: email }) : undefined;
    const user = await raw.user.create({ data: { companyId: tenantId, name: privileged ? 'Browser admin' : 'Browser restricted staff', email, passwordHash: hashed,
      accessScope: privileged ? 'global' : 'single_branch', mfaEnabled: privileged, mfaSecretCiphertext: mfa?.ciphertext,
      ...(roleId ? { roles: { create: [{ roleId }] } } : {}), ...(tenantId === companyId ? { branchAccess: { create: [{ branchId: branchA }] } } : {}) } });
    return { email, code, id: user.id, secret: mfa?.secret };
  }
  platform = await persona(root.id, 'PLATFORM', true);
  tenant = await persona(companyId, company.code, true, role.id);
  staff = await persona(companyId, company.code, false, staffRoleId);
});
test.afterAll(async () => { await raw.$disconnect(); });
async function privateFill(locator: Locator, value: string) {
  try { await locator.fill(value); } catch { throw new Error('Credential field interaction failed'); }
}
async function login(page: Page, persona: Persona) {
  await page.goto('/login'); await page.getByLabel('Email', { exact: true }).fill(persona.email);
  await privateFill(page.getByLabel('Password', { exact: true }), password);
  await page.getByLabel('Company Code (optional)', { exact: true }).fill(persona.code);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  if (persona.secret) {
    await page.waitForURL('**/mfa');
    await privateFill(page.locator('input').first(), authenticator.generate(persona.secret));
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
  }
  await page.waitForURL('**/dashboard');
}
async function confirmSave(page: Page, label: string) {
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: label, exact: true }).click();
}

test('platform admin logs in with MFA and manages tenant user lifecycle through UI', async ({ page }) => {
  await login(page, platform); await page.goto('/dashboard/access/users');
  await page.getByLabel('Company', { exact: true }).selectOption(companyId);
  await page.getByRole('link', { name: 'Add User', exact: true }).click();
  await page.getByLabel('Full name', { exact: true }).fill('Created from browser');
  await page.getByLabel('Email', { exact: true }).fill(`${randomUUID()}@example.invalid`);
  await privateFill(page.getByLabel('Initial password', { exact: true }), password);
  await page.getByLabel('Access branch A', { exact: true }).check();
  await page.getByLabel('Browser staff', { exact: true }).check();
  await confirmSave(page, 'Save User');
  await page.waitForURL(url => /\/dashboard\/access\/users\/[a-f0-9-]{36}$/.test(url.pathname));
  createdUserId = new URL(page.url()).pathname.split('/').pop()!;
  await page.getByLabel('Full name', { exact: true }).fill('Edited from browser');
  await page.getByLabel('Branch access scope', { exact: true }).selectOption('multi_branch');
  await page.getByLabel('Access branch B', { exact: true }).check();
  await confirmSave(page, 'Save User');
  await expect(page.getByRole('status').filter({ hasText: 'User updated' })).toBeVisible();
  await page.getByLabel('Active account (uncheck to suspend)', { exact: true }).uncheck();
  await confirmSave(page, 'Save User');
  await expect.poll(async () => (await raw.user.findUniqueOrThrow({ where: { id: createdUserId }, select: { isActive: true } })).isActive).toBe(false);
  await page.getByLabel('Active account (uncheck to suspend)', { exact: true }).check();
  await confirmSave(page, 'Save User');
  await expect.poll(async () => (await raw.user.findUniqueOrThrow({ where: { id: createdUserId }, select: { isActive: true } })).isActive).toBe(true);
  expect(await raw.userBranchAccess.count({ where: { userId: createdUserId } })).toBe(2);
});

test('tenant admin creates a custom role, assigns permission and user, but cannot escape tenant', async ({ page }) => {
  await login(page, tenant); await page.goto('/dashboard/access/roles');
  await expect(page.getByLabel('Company', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Create Role', exact: true }).click();
  await page.getByLabel('Role name', { exact: true }).fill('Browser custom role');
  await page.getByRole('checkbox', { name: /\(product\.read\)/ }).check();
  await confirmSave(page, 'Save Role');
  await page.waitForURL(url => /\/dashboard\/access\/roles\/[a-f0-9-]{36}$/.test(url.pathname));
  await page.goto(`/dashboard/access/users/${createdUserId}?company_id=${companyId}`);
  await page.getByLabel('Browser custom role', { exact: true }).check();
  await confirmSave(page, 'Save User');
  await expect(page.getByRole('status').filter({ hasText: 'User updated' })).toBeVisible();
  const response = await page.request.get(`/api/v1/admin/users/${platform.id}?company_id=${companyId}`);
  expect(response.status()).toBe(404);
  const root = await raw.company.findUniqueOrThrow({ where: { code: 'PLATFORM' }, select: { id: true } });
  expect((await page.request.get(`/api/v1/admin/users?company_id=${root.id}`)).status()).toBe(403);
  const catalogue = await (await page.request.get('/api/v1/admin/permissions')).json();
  expect(catalogue.data.some((item: { code: string }) => item.code.startsWith('platform.'))).toBe(false);
});

test('last tenant administrator cannot suspend own usable access', async ({ page }) => {
  await login(page, tenant); await page.goto(`/dashboard/access/users/${tenant.id}?company_id=${companyId}`);
  await page.getByLabel('Active account (uncheck to suspend)', { exact: true }).uncheck();
  await confirmSave(page, 'Save User');
  await expect(page.locator('main').getByRole('alert')).toContainText('no usable administrator');
  expect((await page.request.get('/api/v1/me')).status()).toBe(200);
});

test('restricted staff has no Access Control navigation and direct APIs deny access', async ({ page }) => {
  await login(page, staff);
  await expect(page.getByRole('link', { name: /^Access Control/ })).toHaveCount(0);
  for (const path of ['users', 'roles', 'permissions']) expect((await page.request.get(`/api/v1/admin/${path}`)).status()).toBe(403);
  await page.goto('/dashboard/access/users');
  await expect(page.locator('main').getByRole('alert')).toContainText('access denied');
});
