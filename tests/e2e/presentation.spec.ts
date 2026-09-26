import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Presentation fixtures only. No database, credentials or real business mutations.
const user = {
  id: 'presentation-user', name: 'Workspace operator', email: 'operator@example.invalid',
  company_id: 'presentation-company', company_name: 'Dhaka Electronics — ঢাকা ইলেকট্রনিক্স', company_code: 'DHAKA',
  access_scope: 'single_branch', is_global: false, mfa_enabled: true, mfa_verified: true,
  branch_ids: ['branch-a'], branches: [{ id: 'branch-a', name: 'Dhaka branch', code: 'DHK' },
    { id: 'branch-denied', name: 'Unassigned branch', code: 'DENIED' }], roles: [], permissions: ['product.read'],
};

async function fixtures(page: Page, overrides: Partial<typeof user> = {}) {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/me') return route.fulfill({ json: { user: { ...user, ...overrides } } });
    return route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'Access denied for this workspace.' } } });
  });
}

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test('unknown page provides a readable recovery link', async ({ page }) => {
  await fixtures(page);
  await page.setViewportSize({ width: 320, height: 812 });
  const response = await page.goto('/missing-presentation-page');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/dashboard');
  await fits(page);
});

test('touch navigation actions provide 44-pixel targets without overflow', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 320, height: 812 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  try {
    const page = await context.newPage(); await fixtures(page, { is_global: true });
    await page.goto('/dashboard');
    for (const name of ['Open navigation menu', 'Choose appearance', 'Sign out']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      const bounds = await button.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44); expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    await fits(page);
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await fits(page);
  } finally { await context.close(); }
});

test('catalogue creation keeps named fields and does not offer unsupported edits', async ({ page }) => {
  await fixtures(page, { is_global: true });
  let posts = 0;
  await page.route('**/api/v1/categories', route => {
    if (route.request().method() === 'POST') {
      posts++; expect(route.request().postDataJSON()).toEqual({ name: 'Accessories', code: 'ACC' });
      return route.fulfill({ json: { id: 'created-category' } });
    }
    return route.fulfill({ json: { items: [{ id: 'existing', name: 'Phones', code: 'PHONE' }] } });
  });
  await page.goto('/dashboard/catalogue');
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add Category', exact: true }) });
  await form.getByLabel('Name', { exact: true }).fill('Accessories');
  await form.getByLabel('Code', { exact: true }).fill('ACC');
  await form.getByRole('button', { name: 'Add Category', exact: true }).click();
  await expect(form.getByLabel('Name', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: /^(Edit|Delete)$/ })).toHaveCount(0);
  await expect(page.getByText('Editing and deletion are not available here.')).toHaveCount(4);
  expect(posts).toBe(1);
});

test('retrying product options preserves form values without submitting stock', async ({ page }) => {
  await fixtures(page, { is_global: true });
  let recovered = false; let posts = 0;
  await page.route('**/api/v1/products?*', route => route.fulfill(recovered
    ? { json: { items: [] } } : { status: 503, json: {} }));
  await page.route('**/api/v1/inventory/opening-stock', route => {
    posts++; return route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/dashboard/inventory/opening-stock');
  await page.getByLabel('Warehouse *', { exact: true }).fill('presentation-warehouse');
  await page.getByLabel('Quantity', { exact: true }).fill('2');
  await page.getByLabel('Unit Cost (BDT)', { exact: true }).fill('125.50');
  recovered = true; await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('No products are available for selection.')).toBeVisible();
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('2');
  expect(posts).toBe(0);
});

test('webhook failure stays distinct from empty data and one-time secret remains complete', async ({ page }) => {
  await fixtures(page, { is_global: true });
  const secret = 'presentation-only-signing-secret-with-a-complete-tail';
  let loaded = false; let posts = 0;
  await page.route('**/api/v1/webhook-endpoints', route => {
    if (route.request().method() === 'POST') {
      posts++; return route.fulfill({ json: { secret_shown_once: secret } });
    }
    return route.fulfill(loaded ? { json: { items: [] } } : { status: 403, json: { error: { message: 'Denied' } } });
  });
  await page.setViewportSize({ width: 320, height: 812 });
  await page.goto('/dashboard/integrations');
  await expect(page.locator('main').getByRole('alert')).toContainText('Webhook endpoints could not be loaded');
  await expect(page.getByText('No webhook endpoints yet.')).toHaveCount(0);
  loaded = true; await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('No webhook endpoints yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('HTTPS URL').fill('https://example.invalid/events');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const field = page.getByLabel('Signing secret', { exact: true });
  await expect(field).toHaveValue(secret); await expect(field).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show secret', exact: true }).click();
  await expect(field).toHaveAttribute('type', 'text');
  await expect(field).toHaveValue(secret);
  await fits(page);
  await page.getByRole('button', { name: 'I have saved it' }).click();
  await expect(field).toHaveCount(0); expect(posts).toBe(1);
  const accessibility = await new AxeBuilder({ page }).include('main').analyze();
  expect(accessibility.violations).toEqual([]);
});

for (const [route, button] of [
  ['accounting/journal', 'New Entry'], ['assets', 'Acquire Asset'], ['payments', 'New Payment'],
  ['expenses', 'New Expense'], ['purchases', 'New Purchase'], ['service', 'New Intake'],
  ['inventory/opening-stock', ''], ['products/new', ''],
]) {
  test(`expanded form remains usable and named: ${route}`, async ({ page }) => {
    await fixtures(page, { is_global: true });
    await page.setViewportSize({ width: 320, height: 812 });
    await page.goto(`/dashboard/${route}`);
    if (button) await page.getByRole('button', { name: button, exact: true }).click();
    await fits(page);
    const region = await page.getByRole('dialog').count() ? '[role="dialog"]' : 'main';
    const accessibility = await new AxeBuilder({ page }).include(region).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(accessibility.violations.map(v => ({ rule: v.id, elements: v.nodes.map(n => n.target) }))).toEqual([]);
    for (const field of await page.locator(`${region} input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([aria-hidden="true"]), ${region} textarea, ${region} [role="combobox"]`).all()) {
      const bounds = await field.boundingBox();
      if (bounds) expect(bounds.width).toBeGreaterThanOrEqual(70);
    }
  });
}

test('restricted navigation, exact active route, branch context and keyboard skip link', async ({ page }) => {
  await fixtures(page); await page.goto('/dashboard');
  await expect(page.locator('main')).toContainText('Dhaka branch');
  await expect(page.locator('main')).not.toContainText('Unassigned branch');
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Sales', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'System Health', exact: true })).toHaveCount(0);
  await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('main')).toBeFocused();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Products', exact: true }).click();
  await page.waitForURL('**/dashboard/products', { timeout: 90_000 });
  await expect(page.getByRole('navigation', { name: 'Primary' }).locator('[aria-current="page"]')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Primary' }).locator('[aria-current="page"]')).toHaveText('Products');
});

test('platform context and navigation fit all target widths in both themes', async ({ page }) => {
  await fixtures(page, { is_global: true }); await page.goto('/dashboard');
  await expect(page.locator('main')).toContainText('Platform operations');
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: 'Choose appearance' }).click();
    await page.getByRole('menuitem', { name: theme, exact: true }).click();
    await expect(page.locator('html')).toHaveClass(theme.toLowerCase());
    for (const width of [320, 375, 430, 768, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
      await expect(page.locator('header').first().getByText('Platform / Global', { exact: true })).toBeVisible();
      await fits(page);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: `.local/ui-platform-${theme.toLowerCase()}.png`, fullPage: true });
  }
  await page.reload(); await expect(page.locator('html')).toHaveClass('dark');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(375);
  const opener = page.getByRole('button', { name: 'Open navigation menu' });
  await opener.click(); await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('overview meets automated accessibility checks in both themes', async ({ page }) => {
  await fixtures(page, { is_global: true }); await page.goto('/dashboard');
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: 'Choose appearance' }).click();
    await page.getByRole('menuitem', { name: theme, exact: true }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  }
});

test('session failure has retry and login actions', async ({ page }) => {
  await fixtures(page);
  await page.route('**/api/v1/me', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/dashboard');
  await expect(page.getByRole('alert').filter({ hasText: 'Session error' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go to login' })).toBeVisible();
});

test('sign-in keeps validation and shows server error inline and in Sonner', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { error: { message: 'Invalid sign-in details.' } } }));
  await page.setViewportSize({ width: 320, height: 740 }); await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('operator@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Invalid sign-in details.' })).toBeVisible();
  await expect(page.locator('[data-sonner-toast]')).toContainText('Invalid sign-in details.');
  await fits(page);
  expect(await page.locator('meta[name="viewport"]').getAttribute('content')).not.toMatch(/user-scalable=no|maximum-scale=1/);
});

test('POS retry repeats failed search without changing the query', async ({ page }) => {
  await fixtures(page, { permissions: ['sale.post'] });
  let attempts = 0;
  await page.route('**/api/v1/products?*', route => {
    attempts++;
    return route.fulfill(attempts === 1 ? { status: 503, json: { error: { message: 'Search unavailable.' } } }
      : { json: { items: [{ id: 'p1', name: 'Keyboard', code: 'KB1', default_price: '500.00', is_serialized: false, unit: { code: 'PCS', name: 'Piece' } }] } });
  });
  await page.goto('/dashboard/pos');
  await page.getByRole('textbox', { name: 'Search products' }).fill('Keyboard');
  await expect(page.getByText('Search unavailable.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Product search results' }).getByRole('button')).toHaveCount(1);
  expect(attempts).toBe(2);
});

for (const status of [403, 503, 200]) {
  test(`trial balance does not report financial state for failed or malformed response: ${status}`, async ({ page }) => {
    await fixtures(page, { permissions: ['journal.read'] });
    await page.route('**/api/v1/reports/trial-balance', route => route.fulfill({ status, json: {} }));
    await page.goto('/dashboard/accounting/trial-balance');
    await expect(page.locator('main').getByRole('alert')).toBeVisible();
    await expect(page.locator('main')).not.toContainText('Out of Balance');
    await expect(page.locator('main')).not.toContainText('Total Debit');
    await expect(page.locator('main').getByRole('button', { name: 'Retry' })).toBeVisible();
  });
}

test('trial balance preserves populated amounts and recovers through retry', async ({ page }) => {
  await fixtures(page, { permissions: ['journal.read'] });
  let attempts = 0;
  await page.route('**/api/v1/reports/trial-balance', route => {
    attempts++;
    return route.fulfill(attempts === 1 ? { status: 503, json: {} } : { json: {
      accounts: [{ account_id: 'a1', code: '1001', name: 'Cash account', account_class: 'asset', normal_balance: 'D',
        total_debit: '123456789012.25', total_credit: '0.00', balance: '123456789012.25', balance_type: 'Debit' }],
      summary: { total_accounts: 1, total_debit: '123456789012.25', total_credit: '123456789012.25', is_balanced: true },
    } });
  });
  await page.goto('/dashboard/accounting/trial-balance');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Dr 123456789012.25', exact: true })).toBeAttached();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 812 }); await fits(page);
  }
  expect(attempts).toBe(2);
});

test('product details show recoverable errors rather than an endless spinner', async ({ page }) => {
  await fixtures(page, { permissions: ['product.read'] });
  await page.goto('/dashboard/products/presentation-id');
  await expect(page.locator('main').getByRole('alert')).toContainText('Product details are unavailable.');
  await expect(page.locator('main')).not.toContainText('Loading product');
});

test('inventory preserves wide financial columns within local scrolling', async ({ page }) => {
  await fixtures(page, { permissions: ['inventory.read'] });
  await page.route('**/api/v1/inventory/stocks?*', route => route.fulfill({ json: { items: [{ id: 'stock-a',
    product: { name: 'Long product name — বাংলা পণ্য', code: 'SKU-A', unit: { code: 'PCS' } },
    warehouse: { name: 'Dhaka warehouse' }, qty_on_hand: '1000000.0000', qty_reserved: '125.0000',
    qty_available: '999875.0000', moving_average_cost: '123456.123456', inventory_value: '123456123456.00', is_low_stock: false }] } }));
  await page.setViewportSize({ width: 320, height: 800 }); await page.goto('/dashboard/inventory');
  await expect(page.getByRole('columnheader', { name: 'Value', exact: true })).toBeAttached();
  await expect(page.getByRole('cell', { name: '৳ 123456.123456', exact: true })).toBeAttached();
  await fits(page);
});

for (const feature of ['accounting', 'assets', 'audit', 'bank-reconciliation', 'cashier', 'catalogue', 'communications',
  'crm', 'deliveries', 'expenses', 'feature-flags', 'gift-cards', 'hr', 'imports', 'integrations', 'inventory', 'onboarding',
  'parties', 'payments', 'pos', 'products', 'purchases', 'reports', 'risk-tuning', 'sales', 'security', 'service', 'settings',
  'support', 'system', 'access/users', 'access/roles', 'access/permissions', 'accounting/journal', 'accounting/trial-balance',
  'inventory/opening-stock', 'products/new', 'products/presentation-id', 'access/users/presentation-id', 'access/roles/presentation-id']) {
  test(`module presentation handles denied API: ${feature}`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await fixtures(page, { is_global: true });
    await page.setViewportSize({ width: 375, height: 812 });
    const response = await page.goto(`/dashboard/${feature}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('main')).not.toBeEmpty();
    for (const theme of ['Light', 'Dark']) {
      await page.getByRole('button', { name: 'Choose appearance' }).click();
      await page.getByRole('menuitem', { name: theme, exact: true }).click();
      await expect(page.getByRole('menu')).toHaveCount(0);
      for (const width of [320, 375, 430, 768, 1024, 1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 812 });
        await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
        await fits(page);
      }
      await page.setViewportSize({ width: 375, height: 812 });
      const accessibility = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(accessibility.violations.map(v => ({ rule: v.id, elements: v.nodes.map(n => n.target) }))).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
}

for (const path of ['/mfa', '/mfa/setup', '/reset-password']) {
  test(`authentication presentation: ${path}`, async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({ status: 403, json: { error: { message: 'Authentication required.' } } }));
    await page.setViewportSize({ width: 320, height: 812 });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    expect((await page.goto(path))?.status()).toBe(200);
    await fits(page); expect(errors).toEqual([]);
  });
}

test('MFA enrollment QR and manual-key controls fit phones without changing activation', async ({ page }) => {
  const key = 'JBSWY3DPEHPK3PXP'; // Public synthetic fixture, not a real credential.
  await page.route('**/api/**', route => route.fulfill({ status: 403, json: { error: { message: 'Authentication required.' } } }));
  await page.route('**/api/v1/auth/mfa/setup', route => route.fulfill({ json: {
    otpauth_url: `otpauth://totp/Example:fixture?secret=${key}&issuer=Example`, manual_key: key,
  } }));
  await page.setViewportSize({ width: 320, height: 812 }); await page.goto('/mfa/setup');
  await expect(page.getByRole('img', { name: /Scan this QR code/ })).toBeVisible();
  await expect(page.getByLabel('Manual setup key')).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show setup key' }).click();
  await expect(page.getByLabel('Manual setup key')).toHaveValue(key);
  await page.getByRole('button', { name: 'Hide setup key' }).click();
  await expect(page.getByLabel('Manual setup key')).toHaveAttribute('type', 'password');
  await fits(page);
});

test('POS populated cart keeps quantity actions visible on phones', async ({ page }) => {
  await fixtures(page, { permissions: ['sale.post'] });
  await page.route('**/api/v1/products?*', route => route.fulfill({ json: { items: [{ id: 'phone-product',
    name: 'Long product name — বাংলা পণ্য', code: 'PHONE-ITEM', default_price: '123456.25', is_serialized: false,
    unit: { code: 'PCS', name: 'Piece' } }] } }));
  await page.setViewportSize({ width: 320, height: 812 }); await page.goto('/dashboard/pos');
  await page.getByRole('textbox', { name: 'Search products' }).fill('Phone');
  await page.getByRole('group', { name: 'Product search results' }).getByRole('button').click();
  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await expect(page.getByRole('button', { name: 'Decrease quantity' })).toBeVisible();
  // Enter on a focused action must activate that action, not global checkout.
  await page.getByRole('button', { name: 'Remove item' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Scan or search a product to start.', { exact: true })).toBeVisible();
  await fits(page);
});
