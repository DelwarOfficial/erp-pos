import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Every API response is synthetic. No login, database, sale, SMS or provider call.
const ADD = 'Add Customer';
const existing = { id: 'customer-existing', name: 'Fixture Customer', phone: '01812345678', is_active: true };
type SaleBody = { customer_id?: string; items: { product_id: string; qty: number; unit_price: number; discount_amount?: number; serials?: string[] }[]; payments: { amount: number }[]; payment_arrangement?: { installments?: { due_date: string; amount: string }[] } };

async function fixture(page: Page, options: { create?: boolean; read?: boolean; locale?: string; mobile?: boolean } = {}) {
  const state = {
    createMode: 'ok' as 'ok' | 'deny' | 'drop',
    searchFails: false,
    searchDelay: 0,
    posts: [] as { key: string; body: { name: string; phone?: string; credit_limit?: number } }[],
    records: [] as { id: string; name: string }[],
    quotes: [] as SaleBody[],
    salePosts: 0,
    unexpected: [] as string[],
    pageErrors: [] as string[],
  };
  const replay = new Map<string, { id: string; name: string }>();
  const permissions = ['sale.post', 'sale.read', 'shift.read', ...(options.read === false ? [] : ['customer.read']), ...(options.create === false ? [] : ['customer.create'])];
  if (options.mobile) await page.setViewportSize({ width: 375, height: 812 });
  await page.context().addCookies([{ name: 'erp-locale', value: options.locale ?? 'en-BD', url: 'http://localhost:3000' }]);
  page.on('pageerror', error => state.pageErrors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/v1/me') return json({ user: { id: 'cashier-fixture', name: 'Fixture Cashier', email: 'cashier@example.invalid', company_id: 'company-fixture', company_code: 'FIXTURE', company_name: 'Fixture shop', access_scope: 'branch', is_global: false, mfa_enabled: false, mfa_verified: false, branch_ids: ['branch-fixture'], roles: [], permissions } });
    if (url.pathname === '/api/v1/warehouses') return json({ items: [{ id: 'warehouse-fixture', name: 'Fixture warehouse', code: 'WH', branch: { id: 'branch-fixture', name: 'Fixture branch', code: 'BR' } }] });
    if (url.pathname === '/api/v1/financial-accounts') return json({ items: [{ id: 'account-fixture', name: 'Fixture cash', account_type: 'cash', is_active: true }] });
    if (url.pathname === '/api/v1/cashier-shifts') return json({ items: [{ id: 'shift-fixture', status: 'open', cashier: { id: 'cashier-fixture', name: 'Fixture Cashier' }, branch: { id: 'branch-fixture', name: 'Fixture branch', code: 'BR' }, warehouse: { id: 'warehouse-fixture', name: 'Fixture warehouse', code: 'WH' }, opened_at: '2026-11-17T02:00:00Z' }] });
    if (url.pathname === '/api/v1/products') return json({ items: [{ id: 'product-fixture', name: 'Fixture TV', code: 'TV-1', default_price: '1200.00', is_serialized: true, unit: { code: 'PCS', name: 'Piece' } }] });
    if (url.pathname === '/api/v1/customers' && request.method() === 'GET') {
      if (options.read === false) return json({ error: { message: 'Missing customer.read' } }, 403);
      if (state.searchDelay) await new Promise(resolve => setTimeout(resolve, state.searchDelay));
      if (state.searchFails) return json({ error: { message: 'Search temporarily unavailable' } }, 503);
      const search = (url.searchParams.get('search') ?? '').toLowerCase();
      return json({ items: !search || existing.name.toLowerCase().includes(search) || existing.phone.includes(search) ? [existing] : [] });
    }
    if (url.pathname === '/api/v1/customers' && request.method() === 'POST') {
      const body = request.postDataJSON();
      const key = request.headers()['idempotency-key'];
      state.posts.push({ key, body });
      if (state.createMode === 'deny') return json({ error: { code: 'FORBIDDEN_SCOPE', message: 'Missing customer.create' } }, 403);
      if (!replay.has(key)) {
        const result = { id: `created-${state.records.length + 1}`, name: body.name };
        replay.set(key, result); state.records.push(result);
      }
      await new Promise(resolve => setTimeout(resolve, 150));
      if (state.createMode === 'drop') return route.abort('connectionreset');
      return json(replay.get(key), 201);
    }
    if (url.pathname === '/api/v1/sales/pricing') {
      const body = request.postDataJSON() as SaleBody;
      const lines = body.items.map(item => ({ product_id: item.product_id, gross_amount: (item.qty * item.unit_price).toFixed(2), discount_amount: (item.discount_amount ?? 0).toFixed(2), tax_amount: '0.00', line_total: (item.qty * item.unit_price - (item.discount_amount ?? 0)).toFixed(2) }));
      return json({ subtotal: lines.reduce((sum, item) => sum + Number(item.gross_amount), 0).toFixed(2), discount_total: lines.reduce((sum, item) => sum + Number(item.discount_amount), 0).toFixed(2), tax_total: '0.00', grand_total: lines.reduce((sum, item) => sum + Number(item.line_total), 0).toFixed(2), lines });
    }
    if (url.pathname === '/api/v1/sales/quote') {
      const body = request.postDataJSON() as SaleBody; state.quotes.push(body);
      if (body.customer_id?.startsWith('created-')) return json({ error: { message: 'Fixture credit limit exceeded: new customer has zero credit.' } }, 409);
      const total = body.items.reduce((sum, item) => sum + item.qty * item.unit_price - (item.discount_amount ?? 0), 0);
      const paid = body.payments.reduce((sum, payment) => sum + payment.amount, 0);
      return json({ grand_total: total.toFixed(2), paid_now: paid.toFixed(2), unpaid: (total - paid).toFixed(2), schedule: (body.payment_arrangement?.installments ?? []).map((item, index) => ({ installment_no: index + 1, ...item })) });
    }
    if (url.pathname === '/api/v1/sales' && request.method() === 'POST') { state.salePosts++; return json({ error: { message: 'Checkout must not be submitted in this test' } }, 409); }
    // Unexpected API calls never reach a server, including automatic PWA calls.
    state.unexpected.push(`${request.method()} ${url.pathname}`);
    return json({ error: { message: 'No fixture for this API' } }, 404);
  });
  await page.goto('/dashboard/pos');
  await expect(page.getByRole('heading', { name: options.locale === 'bn-BD' ? 'নতুন বিক্রি' : 'New Sale', exact: true })).toBeVisible();
  return state;
}

async function openCreate(page: Page) {
  await page.getByRole('button', { name: ADD, exact: true }).click();
  return page.getByRole('dialog');
}
async function search(page: Page, text: string) {
  await page.getByRole('combobox', { name: /^Customer/ }).click();
  await page.getByRole('textbox', { name: 'Search customers by name or mobile' }).fill(text);
}

test('existing-customer mobile search supports keyboard selection without creation permission', async ({ page }) => {
  const state = await fixture(page, { create: false });
  await expect(page.getByRole('button', { name: ADD })).toHaveCount(0);
  await search(page, existing.phone);
  await expect(page.getByRole('option', { name: /Fixture Customer/ })).toContainText(existing.phone);
  await page.getByRole('textbox', { name: 'Search customers by name or mobile' }).press('ArrowDown');
  await expect(page.getByRole('option', { name: /Fixture Customer/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: /^Customer/ })).toContainText(existing.name);
  expect(state.posts).toHaveLength(0); expect(state.salePosts).toBe(0);
});

test('no-results creation prefills name, requires it, selects the saved response and restores focus', async ({ page }) => {
  const state = await fixture(page);
  await search(page, 'New Fixture');
  await expect(page.getByText('No customers match this name or mobile.')).toBeVisible();
  await page.getByRole('button', { name: ADD, exact: true }).last().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Customer name')).toHaveValue('New Fixture');
  await dialog.getByLabel('Customer name').fill('   ');
  await dialog.getByRole('button', { name: 'Save and select' }).click();
  await expect(dialog.getByText('Enter the customer’s name.')).toBeVisible();
  expect(state.posts).toHaveLength(0);
  await dialog.getByLabel('Customer name').fill('New Fixture');
  // The create API accepts optional non-mobile phone values; do not impose SMS rules.
  await dialog.getByLabel('Phone or mobile (optional)').fill('02-1234567');
  await expect(dialog.getByRole('button', { name: 'Save and select' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Save and select' }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('combobox', { name: /^Customer/ })).toContainText('New Fixture');
  await expect(page.getByRole('combobox', { name: /^Customer/ })).toBeFocused();
  expect(state.posts).toHaveLength(1); expect(state.posts[0].body).toEqual({ name: 'New Fixture', phone: '02-1234567' });
  expect(state.records).toHaveLength(1); expect(state.pageErrors).toEqual([]);
});

test('same-mobile matches can be selected; matching names are not silently merged', async ({ page }) => {
  const state = await fixture(page);
  await search(page, existing.phone);
  await page.locator('[data-slot="popover-content"]').getByRole('button', { name: ADD, exact: true }).first().click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Phone or mobile (optional)')).toHaveValue(existing.phone);
  await dialog.getByLabel('Customer name').fill(existing.name);
  await expect(dialog.getByText('same mobile')).toBeVisible();
  await dialog.getByRole('button', { name: 'Use', exact: true }).click();
  await expect(dialog).toBeHidden(); expect(state.posts).toHaveLength(0);
  dialog = await openCreate(page);
  await dialog.getByLabel('Customer name').fill(existing.name);
  await expect(dialog.getByRole('button', { name: 'Save a separate customer' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Save a separate customer' }).click();
  await expect(dialog).toBeHidden();
  expect(state.records[0].id).not.toBe(existing.id); expect(state.posts).toHaveLength(1);
});

test('a failed or pending match search blocks creation and supports retry', async ({ page }) => {
  const state = await fixture(page); state.searchFails = true;
  const dialog = await openCreate(page);
  await dialog.getByLabel('Customer name').fill('Search Retry');
  await expect(dialog.getByRole('alert')).toContainText('Retry the search before saving');
  await expect(dialog.getByRole('button', { name: 'Save and select' })).toBeDisabled();
  state.searchFails = false; state.searchDelay = 600;
  await dialog.getByRole('button', { name: 'Retry customer search' }).click();
  await expect(dialog.getByRole('button', { name: 'Save and select' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Save and select' })).toBeEnabled();
  expect(state.posts).toHaveLength(0);
});

test('permission denial and a lost save response keep data and reuse the supported idempotency key', async ({ page }) => {
  const state = await fixture(page); state.createMode = 'deny';
  let dialog = await openCreate(page);
  await dialog.getByLabel('Customer name').fill('Retry Fixture');
  await dialog.getByLabel('Phone or mobile (optional)').fill('01712345678');
  await expect(dialog.getByRole('button', { name: 'Save and select' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Save and select' }).click();
  await expect(dialog.getByRole('alert')).toContainText('You do not have permission');
  await expect(dialog.getByLabel('Customer name')).toHaveValue('Retry Fixture');
  state.createMode = 'drop';
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog.getByRole('alert')).toContainText('we don’t know if the customer was saved');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  dialog = await openCreate(page);
  await expect(dialog.getByLabel('Customer name')).toHaveValue('Retry Fixture');
  await expect(dialog.getByLabel('Phone or mobile (optional)')).toHaveValue('01712345678');
  state.createMode = 'ok';
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog).toBeHidden();
  expect(state.posts).toHaveLength(3);
  expect(new Set(state.posts.map(post => post.key)).size).toBe(1);
  expect(state.records).toHaveLength(1); expect(state.salePosts).toBe(0);
});

test('customer selection preserves serials, discount, payments and installment draft and rechecks credit', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('textbox', { name: 'Search products' }).fill('Fixture');
  await page.getByRole('group', { name: 'Product search results' }).getByRole('button', { name: /Fixture TV/ }).click();
  await page.getByLabel('Serial numbers for Fixture TV').fill('SERIAL-A, SERIAL-B');
  await page.getByLabel('Line discount (৳)', { exact: true }).fill('35');
  await page.locator('#fin-account-id').click();
  await page.getByRole('option', { name: /Fixture cash/ }).click();
  await page.locator('#cash-received').fill('3000');
  await page.getByRole('radio', { name: 'Pay part now', exact: true }).click();
  await page.locator('#primary-payment-amount').fill('100');
  await page.getByRole('button', { name: 'Add split payment' }).click();
  await page.getByRole('combobox', { name: 'Account for payment 1' }).click();
  await page.getByRole('option', { name: /Fixture cash/ }).click();
  await page.locator('[id^="tender-amount-"]').fill('75');
  await page.getByRole('radio', { name: 'Custom', exact: true }).click();
  await page.getByLabel('Installment 1 amount (৳)').fill('1100');
  await page.getByLabel('Installment 2 amount (৳)').fill('1090');
  await search(page, existing.phone);
  await page.getByRole('option', { name: /Fixture Customer/ }).click();
  await expect.poll(() => state.quotes.length).toBeGreaterThan(0);
  const before = state.quotes.at(-1)!;
  const dialog = await openCreate(page);
  await dialog.getByLabel('Customer name').fill('New Credit Fixture');
  await expect(dialog.getByLabel(/Credit limit/)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Save and select' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Save and select' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => state.quotes.at(-1)?.customer_id).toBe('created-1');
  const { customer_id: oldCustomer, ...oldDraft } = before;
  const { customer_id: newCustomer, ...newDraft } = state.quotes.at(-1)!;
  expect(oldCustomer).toBe(existing.id); expect(newCustomer).toBe('created-1'); expect(newDraft).toEqual(oldDraft);
  await expect(page.getByText(/Fixture credit limit exceeded/)).toBeVisible();
  await expect(page.getByLabel('Serial numbers for Fixture TV')).toHaveValue('SERIAL-A, SERIAL-B');
  await expect(page.getByLabel('Line discount (৳)', { exact: true })).toHaveValue('35');
  await expect(page.locator('#primary-payment-amount')).toHaveValue('100');
  await expect(page.locator('[id^="tender-amount-"]')).toHaveValue('75');
  await expect(page.getByLabel('Installment 1 amount (৳)')).toHaveValue('1100');
  await expect(page.getByRole('button', { name: 'Sell to a walk-in customer instead' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Pay in full', exact: true }).click();
  await expect(page.locator('#cash-received')).toHaveValue('3000');
  await page.getByRole('button', { name: 'Sell to a walk-in customer instead' }).click();
  await expect(page.getByText(/^Walk-in customer\./)).toBeVisible();
  expect(state.posts[0].body).toEqual({ name: 'New Credit Fixture' }); expect(state.salePosts).toBe(0);
});

test('Bengali mobile dialog fits, traps focus, and Escape restores the trigger', async ({ page }) => {
  await fixture(page, { locale: 'bn-BD', mobile: true });
  const trigger = page.getByRole('button', { name: 'নতুন কাস্টমার যোগ করুন', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('কাস্টমারের নাম')).toBeFocused();
  await dialog.getByLabel('কাস্টমারের নাম').fill('নমুনা কাস্টমার');
  await expect(dialog.getByRole('button', { name: 'সেভ করে বেছে নিন' })).toBeEnabled();
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const scan = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(scan.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? '')).map(item => item.id)).toEqual([]);
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
});

test('customer-read denial cannot be bypassed by the inline create form', async ({ page }) => {
  const state = await fixture(page, { read: false });
  const dialog = await openCreate(page);
  await dialog.getByLabel('Customer name').fill('Cannot search fixture');
  await expect(dialog.getByRole('alert')).toContainText('Ask a manager');
  await expect(dialog.getByRole('button', { name: 'Save and select' })).toBeDisabled();
  expect(state.posts).toHaveLength(0);
});

test('desktop dark dialog remains accessible and keyboard navigation stays in the modal', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await fixture(page);
  const dialog = await openCreate(page);
  await dialog.getByLabel('Customer name').fill('Dark fixture');
  await expect(dialog.getByRole('button', { name: 'Save and select' })).toBeEnabled();
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  const scan = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(scan.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? '')).map(item => item.id)).toEqual([]);
  await dialog.screenshot({ path: testInfo.outputPath('dialog-dark.png') });
});
