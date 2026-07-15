// scripts/add-permissions.ts
// Systematically adds requirePermission checks to all API route files.
// This script generates a mapping of route → permission code and patches each file.

import * as fs from 'fs';
import * as path from 'path';

interface RoutePermission {
  routePath: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  permission: string;
  skipAuth?: boolean; // for auth/health routes
}

// Route → permission mapping per §8.5
const ROUTE_PERMISSIONS: RoutePermission[] = [
  // Auth routes — no permission needed (just authentication)
  { routePath: 'auth/login', method: 'POST', permission: '', skipAuth: true },
  { routePath: 'auth/refresh', method: 'POST', permission: '', skipAuth: true },
  { routePath: 'auth/logout', method: 'POST', permission: '', skipAuth: true },
  { routePath: 'auth/mfa/verify', method: 'POST', permission: '', skipAuth: true },
  { routePath: 'health', method: 'GET', permission: '', skipAuth: true },
  { routePath: 'me', method: 'GET', permission: '' }, // any authenticated user
  { routePath: 'translations', method: 'GET', permission: '' }, // any authenticated user
  { routePath: 'notifications', method: 'GET', permission: '' }, // any authenticated user

  // WebAuthn — any authenticated user
  { routePath: 'webauthn/registration/begin', method: 'POST', permission: '' },
  { routePath: 'webauthn/registration/finish', method: 'POST', permission: '' },
  { routePath: 'webauthn/assertion/begin', method: 'POST', permission: '' },
  { routePath: 'webauthn/assertion/finish', method: 'POST', permission: '' },
  { routePath: 'webauthn/credentials', method: 'GET', permission: '' },
  { routePath: 'webauthn/credentials', method: 'DELETE', permission: '' },

  // Platform
  { routePath: 'onboarding', method: 'POST', permission: 'platform.onboarding.execute' },
  { routePath: 'onboarding/[id]/activate', method: 'POST', permission: 'platform.onboarding.execute' },

  // Products
  { routePath: 'products', method: 'GET', permission: 'product.read' },
  { routePath: 'products', method: 'POST', permission: 'product.create' },
  { routePath: 'products/[id]/activate', method: 'POST', permission: 'product.activate' },
  { routePath: 'products/[id]/barcodes', method: 'GET', permission: 'product.read' },
  { routePath: 'products/[id]/barcodes', method: 'POST', permission: 'product.update' },

  // Catalogue
  { routePath: 'categories', method: 'GET', permission: 'product.read' },
  { routePath: 'categories', method: 'POST', permission: 'category.manage' },
  { routePath: 'brands', method: 'GET', permission: 'product.read' },
  { routePath: 'brands', method: 'POST', permission: 'category.manage' },
  { routePath: 'units', method: 'GET', permission: 'product.read' },
  { routePath: 'units', method: 'POST', permission: 'category.manage' },
  { routePath: 'tax-codes', method: 'GET', permission: 'product.read' },
  { routePath: 'tax-codes', method: 'POST', permission: 'tax.manage' },
  { routePath: 'tax-components', method: 'GET', permission: 'product.read' },
  { routePath: 'tax-components', method: 'POST', permission: 'tax.manage' },

  // Feature flags
  { routePath: 'feature-flags', method: 'GET', permission: 'company.read' },
  { routePath: 'feature-flags/[key]', method: 'PATCH', permission: 'company.update' },

  // Inventory
  { routePath: 'inventory/stocks', method: 'GET', permission: 'inventory.read' },
  { routePath: 'inventory/movements', method: 'GET', permission: 'inventory.read' },
  { routePath: 'inventory/opening-stock', method: 'POST', permission: 'opening_stock.post' },
  { routePath: 'stock-adjustments', method: 'GET', permission: 'inventory.read' },
  { routePath: 'stock-adjustments', method: 'POST', permission: 'stock_adjustment.post' },

  // Purchases
  { routePath: 'purchases', method: 'GET', permission: 'inventory.read' },
  { routePath: 'purchases', method: 'POST', permission: 'purchase.create' },
  { routePath: 'purchases/[id]/receivings', method: 'GET', permission: 'inventory.read' },
  { routePath: 'purchases/[id]/receivings', method: 'POST', permission: 'purchase.receive' },
  { routePath: 'landed-costs', method: 'POST', permission: 'landed_cost.post' },

  // Transfers
  { routePath: 'transfers', method: 'GET', permission: 'inventory.read' },
  { routePath: 'transfers', method: 'POST', permission: 'transfer.dispatch' },
  { routePath: 'transfers/[id]/dispatch', method: 'POST', permission: 'transfer.dispatch' },
  { routePath: 'transfers/[id]/receive', method: 'POST', permission: 'transfer.receive' },
  { routePath: 'transfers/[id]/cancel', method: 'POST', permission: 'transfer.dispatch' },

  // Parties
  { routePath: 'customers', method: 'GET', permission: 'product.read' },
  { routePath: 'customers', method: 'POST', permission: 'user.create' },
  { routePath: 'suppliers', method: 'GET', permission: 'product.read' },
  { routePath: 'suppliers', method: 'POST', permission: 'user.create' },

  // Sales
  { routePath: 'sales', method: 'GET', permission: 'sale.read' },
  { routePath: 'sales', method: 'POST', permission: 'sale.post' },
  { routePath: 'sales/[id]/void', method: 'POST', permission: 'sale.void' },
  { routePath: 'sale-returns', method: 'GET', permission: 'sale.read' },
  { routePath: 'sale-returns', method: 'POST', permission: 'sale_return.post' },

  // Cashier shifts
  { routePath: 'cashier-shifts', method: 'GET', permission: 'shift.open' },
  { routePath: 'cashier-shifts/open', method: 'POST', permission: 'shift.open' },
  { routePath: 'cashier-shifts/[id]/close', method: 'POST', permission: 'shift.close' },

  // Accounting
  { routePath: 'chart-of-accounts', method: 'GET', permission: 'journal.read' },
  { routePath: 'chart-of-accounts', method: 'POST', permission: 'journal.post' },
  { routePath: 'financial-accounts', method: 'GET', permission: 'journal.read' },
  { routePath: 'financial-accounts', method: 'POST', permission: 'journal.post' },
  { routePath: 'fiscal-periods', method: 'GET', permission: 'journal.read' },
  { routePath: 'fiscal-periods', method: 'POST', permission: 'fiscal_period.lock' },
  { routePath: 'journal-entries', method: 'GET', permission: 'journal.read' },
  { routePath: 'journal-entries', method: 'POST', permission: 'journal.post' },
  { routePath: 'expenses', method: 'GET', permission: 'journal.read' },
  { routePath: 'expenses', method: 'POST', permission: 'expense.post' },
  { routePath: 'accounting-policies', method: 'GET', permission: 'journal.read' },
  { routePath: 'accounting-policies', method: 'PUT', permission: 'journal.post' },
  { routePath: 'reports/trial-balance', method: 'GET', permission: 'report.execute' },

  // Delivery
  { routePath: 'deliveries', method: 'GET', permission: 'inventory.read' },
  { routePath: 'deliveries', method: 'POST', permission: 'delivery.create' },
  { routePath: 'deliveries/[id]/transition', method: 'POST', permission: 'delivery.dispatch' },
  { routePath: 'courier-settlements', method: 'GET', permission: 'inventory.read' },
  { routePath: 'courier-settlements', method: 'POST', permission: 'courier_cod.settle' },

  // Service
  { routePath: 'service-requests', method: 'GET', permission: 'inventory.read' },
  { routePath: 'service-requests', method: 'POST', permission: 'service.intake' },
  { routePath: 'service-requests/[id]/parts', method: 'POST', permission: 'service.complete' },
  { routePath: 'warranty-claims', method: 'POST', permission: 'warranty.fulfill' },

  // CRM
  { routePath: 'leads', method: 'GET', permission: 'product.read' },
  { routePath: 'leads', method: 'POST', permission: 'product.read' },

  // HR
  { routePath: 'employees', method: 'GET', permission: 'user.read' },
  { routePath: 'employees', method: 'POST', permission: 'user.create' },
  { routePath: 'payroll-runs', method: 'GET', permission: 'journal.read' },
  { routePath: 'payroll-runs', method: 'POST', permission: 'payroll.post' },

  // Gift cards
  { routePath: 'gift-cards', method: 'GET', permission: 'product.read' },
  { routePath: 'gift-cards', method: 'POST', permission: 'gift_card.issue' },

  // Integrations
  { routePath: 'webhook-endpoints', method: 'GET', permission: 'company.read' },
  { routePath: 'webhook-endpoints', method: 'POST', permission: 'company.update' },
  { routePath: 'offline/bootstrap', method: 'POST', permission: 'device.read' },
  { routePath: 'offline/sync', method: 'POST', permission: 'device.read' },

  // Security/Audit (any authenticated user can view their own tenant's)
  { routePath: 'security-events', method: 'GET', permission: 'company.read' },
  { routePath: 'audit-logs', method: 'GET', permission: 'company.read' },
];

const API_BASE = path.join(process.cwd(), 'src/app/api/v1');

let patched = 0;
let skipped = 0;
let notFound = 0;

for (const rp of ROUTE_PERMISSIONS) {
  const filePath = path.join(API_BASE, rp.routePath, 'route.ts');
  if (!fs.existsSync(filePath)) {
    console.log(`  ✗ NOT FOUND: ${rp.routePath}`);
    notFound++;
    continue;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // Skip if already has requirePermission for this permission
  if (rp.permission && content.includes(`requirePermission(auth, '${rp.permission}'`)) {
    skipped++;
    continue;
  }

  // Skip if no auth and should skip
  if (rp.skipAuth) {
    skipped++;
    continue;
  }

  // Find the line after `const auth = await authenticateRequest();`
  const authPattern = /const auth = await authenticateRequest\(\);/;
  const match = content.match(authPattern);
  if (!match) {
    console.log(`  ⚠ NO AUTH CALL: ${rp.routePath}`);
    skipped++;
    continue;
  }

  // Find the method (GET/POST/PATCH/DELETE) that contains this auth call
  // We need to insert requirePermission AFTER the auth line but only in the right function
  // Strategy: find `const auth = await authenticateRequest();` and insert after it
  if (rp.permission) {
    // Check if requirePermission is already imported
    if (!content.includes('requirePermission')) {
      // Add to existing import from '@/lib/auth/middleware'
      content = content.replace(
        /import { authenticateRequest } from '@\/lib\/auth\/middleware';/,
        "import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';"
      );
    }

    // Insert requirePermission after the auth line
    const insertLine = `\n  await requirePermission(auth, '${rp.permission}');`;
    content = content.replace(
      /const auth = await authenticateRequest\(\);/,
      `const auth = await authenticateRequest();${insertLine}`
    );
  }

  fs.writeFileSync(filePath, content, 'utf8');
  patched++;
}

console.log(`\nDone: ${patched} patched, ${skipped} skipped, ${notFound} not found`);
