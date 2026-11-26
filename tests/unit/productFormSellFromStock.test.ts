// Product form: inline category/brand create and the renamed price labels.
// Stock page: the "Sell" entry point into POS.
//
// These are entry points into existing flows, so the checks pin what must NOT
// move (endpoints, payload keys, CSV columns, permissions) as much as what is new.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import enUi from '../../public/locales/en-BD/ui.json';
import bnUi from '../../public/locales/bn-BD/ui.json';
import { IMPORT_TEMPLATES } from '../../src/lib/import-export/templates';

const read = (path: string) => readFileSync(path, 'utf8');
const quick = read('src/components/products/QuickCreateCatalogueItem.tsx');
const newProduct = read('src/app/(erp)/dashboard/products/new/page.tsx');
const productDetail = read('src/app/(erp)/dashboard/products/[id]/page.tsx');
const inventory = read('src/app/(erp)/dashboard/inventory/page.tsx');
const pos = read('src/app/(erp)/dashboard/pos/page.tsx');
const en = enUi as Record<string, string>;
const bn = bnUi as Record<string, string>;

describe('inline category and brand create', () => {
  it('posts to the existing catalogue endpoints with an idempotency key', () => {
    expect(quick).toContain("'/api/v1/categories'");
    expect(quick).toContain("'/api/v1/brands'");
    expect(quick).toContain("'Idempotency-Key'");
  });

  it('uses the same length limits as the server schemas', () => {
    const categories = read('src/app/api/v1/categories/route.ts');
    const brands = read('src/app/api/v1/brands/route.ts');
    expect(categories).toMatch(/name: z\.string\(\)\.min\(1\)\.max\(120\)/);
    expect(categories).toMatch(/code: z\.string\(\)\.min\(1\)\.max\(40\)/);
    expect(brands).toMatch(/name: z\.string\(\)\.min\(1\)\.max\(120\)/);
    expect(quick).toContain('const NAME_MAX = 120;');
    expect(quick).toContain('const CODE_MAX = 40;');
  });

  it('shows duplicate and permission errors inside the dialog', () => {
    expect(quick).toContain('res.status === 409');
    expect(quick).toContain('res.status === 403');
    expect(quick).toMatch(/role="alert"/);
  });

  it('is offered only with the permission the server checks', () => {
    expect(read('src/app/api/v1/categories/route.ts')).toContain('requirePermission(auth, "category.manage")');
    expect(read('src/app/api/v1/brands/route.ts')).toContain('requirePermission(auth, "category.manage")');
    expect(newProduct).toContain("permissions.includes('category.manage')");
    expect(newProduct).toMatch(/\{canManageCatalogue && \(/);
  });

  it('selects the new item without resetting the rest of the form', () => {
    expect(newProduct).toContain('setForm(prev => ({ ...prev, category_id: item.id }))');
    expect(newProduct).toContain('setForm(prev => ({ ...prev, brand_id: item.id }))');
    // Radix Select reports '' while the just-added option registers; that must
    // not clear the value that was just chosen.
    expect(newProduct).toContain('onValueChange={v => { if (v) setForm(prev => ({ ...prev, category_id: v })); }}');
    expect(newProduct).toContain('onValueChange={v => { if (v) setForm(prev => ({ ...prev, brand_id: v })); }}');
  });
});

describe('renamed product labels', () => {
  it('reads the labels from both catalogs', () => {
    for (const key of ['products.selling_price', 'products.purchase_price', 'products.quantity']) {
      expect(en[key], key).toBeTruthy();
      expect(bn[key], key).toBeTruthy();
    }
    expect(en['products.selling_price']).toMatch(/^Selling price/);
    expect(en['products.purchase_price']).toMatch(/^Purchase price/);
    expect(en['products.quantity']).toBe('Quantity');
    for (const old of ['Default Price', 'Reference Cost', 'Alert Quantity', 'Alert Qty']) {
      expect(newProduct).not.toContain(old);
      expect(productDetail).not.toContain(old);
    }
  });

  it('keeps the payload keys and CSV columns', () => {
    for (const field of ['default_price: Number(form.default_price)', 'reference_cost: Number(form.reference_cost)', 'alert_quantity: Number(form.alert_quantity)']) {
      expect(newProduct).toContain(field);
    }
    const product = IMPORT_TEMPLATES.product;
    expect(product.optionalColumns).toEqual(expect.arrayContaining(['default_price', 'reference_cost', 'alert_quantity']));
  });
});

describe('Sell from the Stock page', () => {
  it('opens POS with the product and warehouse of the row', () => {
    expect(inventory).toContain('/dashboard/pos?add=${encodeURIComponent(s.product.id)}&warehouse=${encodeURIComponent(s.warehouse.id)}');
  });

  it('is disabled, with a reason, without permission, stock or an open shift', () => {
    expect(inventory).toContain("permissions.includes('sale.post')");
    expect(inventory).toContain("t('sell_no_permission')");
    expect(inventory).toContain("Number(s.qty_available) <= 0 ? t('sell_none')");
    expect(inventory).toContain("hasOpenShift === false ? t('sell_no_shift')");
    expect(inventory).toContain('href="/dashboard/cashier"');
  });

  it('adds the item through the normal cart path and refuses inactive products', () => {
    expect(pos).toContain("params.get('add')");
    expect(pos).toContain('if (!p.is_active)');
    expect(pos).toMatch(/addToCart\(\{ id: p\.id, name: p\.name, code: p\.code, default_price: p\.default_price, is_serialized: p\.is_serialized, unit: p\.unit \}\)/);
    // The URL is cleaned so a reload does not add the item again.
    expect(pos).toContain('window.history.replaceState');
  });

  it('has its copy in both catalogs', () => {
    for (const key of ['inventory.sell', 'inventory.sell_named', 'inventory.sell_none', 'inventory.sell_no_permission', 'inventory.sell_no_shift', 'inventory.sell_open_shift', 'pos.from_stock_added', 'pos.from_stock_inactive', 'pos.from_stock_failed']) {
      expect(en[key], key).toBeTruthy();
      expect(bn[key], key).toBeTruthy();
    }
  });
});
