// src/lib/permissions/catalogue.ts
// Permission catalogue per §8.5. Each permission has a `resource.action.scope` code.
// Seeds the permissions table on first run.

import { db } from '../db';

export interface PermissionSpec {
  code: string;
  module: string;
  description: string;
}

export const PERMISSIONS: PermissionSpec[] = [
  // Platform / global
  { code: 'platform.onboarding.execute', module: 'platform', description: 'Onboard a new company tenant' },
  { code: 'platform.tenants.read', module: 'platform', description: 'List/view all tenants' },
  { code: 'platform.tenants.suspend', module: 'platform', description: 'Suspend a tenant' },
  { code: 'platform.recovery_epoch.declare', module: 'platform', description: 'Declare a recovery epoch (DR)' },
  { code: 'platform.backup.restore', module: 'platform', description: 'Restore from backup (MFA-gated)' },

  // Company / organization
  { code: 'company.read', module: 'company', description: 'View company profile' },
  { code: 'company.update', module: 'company', description: 'Update company profile' },
  { code: 'branch.create', module: 'branch', description: 'Create a branch' },
  { code: 'branch.update', module: 'branch', description: 'Update a branch' },
  { code: 'branch.read', module: 'branch', description: 'View branches' },
  { code: 'warehouse.create', module: 'warehouse', description: 'Create a warehouse' },
  { code: 'warehouse.update', module: 'warehouse', description: 'Update a warehouse' },
  { code: 'warehouse.read', module: 'warehouse', description: 'View warehouses' },

  // Identity / RBAC
  { code: 'user.create', module: 'user', description: 'Create a user' },
  { code: 'user.update', module: 'user', description: 'Update a user' },
  { code: 'user.read', module: 'user', description: 'View users' },
  { code: 'user.deactivate', module: 'user', description: 'Deactivate a user' },
  { code: 'user.reset_password', module: 'user', description: 'Reset a user password' },
  { code: 'role.create', module: 'role', description: 'Create a role' },
  { code: 'role.update', module: 'role', description: 'Update a role' },
  { code: 'role.read', module: 'role', description: 'View roles' },
  { code: 'role.assign', module: 'role', description: 'Assign role to user' },
  { code: 'device.register', module: 'device', description: 'Register a POS device' },
  { code: 'device.revoke', module: 'device', description: 'Revoke a POS device' },
  { code: 'device.read', module: 'device', description: 'View devices' },

  // Catalogue (M1 — placeholders)
  { code: 'product.create', module: 'product', description: 'Create a product' },
  { code: 'product.update', module: 'product', description: 'Update a product' },
  { code: 'product.read', module: 'product', description: 'View products' },
  { code: 'product.activate', module: 'product', description: 'Activate/deactivate a product' },
  { code: 'category.manage', module: 'category', description: 'Manage categories/brands/units' },
  { code: 'tax.manage', module: 'tax', description: 'Manage tax codes' },

  // Inventory (M2)
  { code: 'inventory.read', module: 'inventory', description: 'View stock' },
  { code: 'stock_count.post', module: 'inventory', description: 'Post a stock count' },
  { code: 'stock_adjustment.post', module: 'inventory', description: 'Post a stock adjustment' },
  { code: 'purchase.create', module: 'purchase', description: 'Create a purchase order' },
  { code: 'purchase.receive', module: 'purchase', description: 'Receive a purchase' },
  { code: 'purchase_return.post', module: 'purchase', description: 'Post a purchase return' },
  { code: 'transfer.dispatch', module: 'transfer', description: 'Dispatch a transfer' },
  { code: 'transfer.receive', module: 'transfer', description: 'Receive a transfer' },
  { code: 'landed_cost.post', module: 'purchase', description: 'Post a landed cost document' },
  { code: 'opening_stock.post', module: 'inventory', description: 'Post opening stock' },

  // POS / Sales (M3)
  { code: 'sale.post', module: 'sale', description: 'Post a sale' },
  { code: 'sale.void', module: 'sale', description: 'Void a sale' },
  { code: 'sale.read', module: 'sale', description: 'View sales' },
  { code: 'sale_return.post', module: 'sale', description: 'Post a sale return' },
  { code: 'shift.open', module: 'shift', description: 'Open a cashier shift' },
  { code: 'shift.close', module: 'shift', description: 'Close a cashier shift' },
  { code: 'shift.variance_approve', module: 'shift', description: 'Approve cashier variance (MFA)' },
  { code: 'discount.override', module: 'sale', description: 'Override discount above threshold (approval)' },
  { code: 'credit_sale.execute', module: 'sale', description: 'Post a credit sale (limit/overdue checked)' },
  { code: 'payment.allocate', module: 'payment', description: 'Allocate payments to invoices' },
  { code: 'account_transfer.post', module: 'payment', description: 'Post an account transfer' },
  { code: 'cheque.clear', module: 'payment', description: 'Clear a cheque' },
  { code: 'cheque.bounce', module: 'payment', description: 'Bounce a cheque' },
  { code: 'gift_card.issue', module: 'gift_card', description: 'Issue a gift card' },
  { code: 'gift_card.redeem', module: 'gift_card', description: 'Redeem a gift card' },

  // Accounting (M4)
  { code: 'journal.post', module: 'accounting', description: 'Post a journal entry' },
  { code: 'journal.reverse', module: 'accounting', description: 'Reverse a journal entry (MFA)' },
  { code: 'journal.read', module: 'accounting', description: 'View journal entries' },
  { code: 'expense.post', module: 'expense', description: 'Post an expense' },
  { code: 'expense.approve', module: 'expense', description: 'Approve an expense' },
  { code: 'fiscal_period.lock', module: 'accounting', description: 'Lock a fiscal period (MFA)' },
  { code: 'fiscal_period.unlock', module: 'accounting', description: 'Unlock a fiscal period (MFA + approval)' },
  { code: 'report.execute', module: 'report', description: 'Execute a report' },
  { code: 'report.export', module: 'report', description: 'Export report (sensitive — MFA)' },
  { code: 'tax_rule.change', module: 'tax', description: 'Change tax rule (maker-checker)' },

  // Delivery / Service (M5)
  { code: 'delivery.create', module: 'delivery', description: 'Create a delivery order' },
  { code: 'delivery.dispatch', module: 'delivery', description: 'Dispatch a delivery' },
  { code: 'delivery.fail_resolve', module: 'delivery', description: 'Resolve a failed delivery' },
  { code: 'courier_cod.settle', module: 'delivery', description: 'Post a courier COD settlement' },
  { code: 'service.intake', module: 'service', description: 'Create a service request' },
  { code: 'service.complete', module: 'service', description: 'Complete a service request' },
  { code: 'warranty.fulfill', module: 'service', description: 'Fulfill a warranty claim' },

  // CRM / HR / Comms (M6)
  { code: 'lead.convert', module: 'crm', description: 'Convert a lead to customer' },
  { code: 'communication.campaign.send', module: 'communication', description: 'Send a marketing campaign' },
  { code: 'payroll.run', module: 'hr', description: 'Run payroll' },
  { code: 'payroll.post', module: 'hr', description: 'Post a payroll run' },
  { code: 'payroll.approve', module: 'hr', description: 'Approve a payroll run' },

  // Approvals
  { code: 'approval.resolve', module: 'approval', description: 'Approve/reject a maker-checker request' },
  { code: 'approval.waive', module: 'approval', description: 'Waive a reconciliation finding' },

  // Reconciliation
  { code: 'reconciliation.run', module: 'reconciliation', description: 'Run a reconciliation check' },
  { code: 'reconciliation.read', module: 'reconciliation', description: 'View reconciliation findings' },
  { code: 'reconciliation.resolve', module: 'reconciliation', description: 'Resolve a finding' },

  // Sensitive field permissions
  { code: 'field.cost.read', module: 'field', description: 'Read cost/margin fields' },
  { code: 'field.payroll.read', module: 'field', description: 'Read payroll fields' },
  { code: 'field.pii.read', module: 'field', description: 'Read PII fields' },

  // ── Gap-fill permissions (Phase 3) ──
  // Product
  { code: 'product.archive.company', module: 'catalogue', description: 'Archive/restore products' },
  // Sale
  { code: 'sale.hold.branch', module: 'sale', description: 'Hold and recall sales' },
  { code: 'sale.refund.branch', module: 'sale', description: 'Process sale refunds' },
  { code: 'sale.cost_margin.view', module: 'sale', description: 'View cost/margin on sales' },
  { code: 'sale.view.global', module: 'sale', description: 'View all sales across branches' },
  // Quotation
  { code: 'quotation.create.branch', module: 'sale', description: 'Create quotations' },
  { code: 'quotation.convert.branch', module: 'sale', description: 'Convert quotation to sale' },
  // Payment
  { code: 'payment.pay.branch', module: 'payment', description: 'Record payments' },
  { code: 'payment.reverse.branch', module: 'payment', description: 'Reverse payments' },
  { code: 'payment.refund.branch', module: 'payment', description: 'Process refunds' },
  // Advance
  { code: 'advance.receive.branch', module: 'payment', description: 'Receive customer/supplier advances' },
  { code: 'advance.apply.branch', module: 'payment', description: 'Apply advances to invoices' },
  // Account transfer
  { code: 'account.transfer.branch', module: 'accounting', description: 'Create account transfers' },
  { code: 'account.transfer.approve.company', module: 'accounting', description: 'Approve account transfers above threshold' },
  // Inventory
  { code: 'inventory.ledger.view.branch', module: 'inventory', description: 'View stock ledger (movement history)' },
  { code: 'inventory.damage.view.branch', module: 'inventory', description: 'View damaged stock' },
  { code: 'inventory.damage.manage.branch', module: 'inventory', description: 'Manage damaged stock adjustments' },
  // Customer/Supplier
  { code: 'customer.credit.view.branch', module: 'party', description: 'View customer credit limit and AR exposure' },
  { code: 'customer.credit.view.global', module: 'party', description: 'View customer credit across all branches' },
  // Purchase
  { code: 'purchase.landed_cost.manage.branch', module: 'purchasing', description: 'Manage landed cost allocations' },
  // Accounting
  { code: 'journal.adjustment.post.company', module: 'accounting', description: 'Post journal adjustments (requires approval above threshold)' },
  { code: 'journal.adjustment.approve.company', module: 'accounting', description: 'Approve journal adjustments' },
  { code: 'fiscal_period.lock.company', module: 'accounting', description: 'Lock/unlock fiscal periods' },
  { code: 'accounting.revaluate.company', module: 'accounting', description: 'Run multi-currency revaluation' },
  // Tax
  { code: 'tax.generate.company', module: 'tax', description: 'Generate statutory documents (Mushak)' },
  { code: 'tax.period.manage.company', module: 'tax', description: 'Manage tax return periods' },
  // Privacy (D09)
  { code: 'dsr.manage.company', module: 'privacy', description: 'Manage data subject requests' },
  { code: 'legal_hold.manage.company', module: 'privacy', description: 'Declare/release legal holds' },
  // Import/Export
  { code: 'import.execute.company', module: 'integration', description: 'Execute import jobs' },
  { code: 'import.approve.company', module: 'integration', description: 'Approve import job commits' },
  { code: 'export.data.branch', module: 'integration', description: 'Export data (scoped to branch)' },
  { code: 'export.sensitive.company', module: 'integration', description: 'Export with sensitive fields (cost/margin/PII)' },
  // Communications
  { code: 'communication.template.manage.company', module: 'communication', description: 'Manage communication templates' },
  { code: 'communication.campaign.manage.company', module: 'communication', description: 'Manage marketing campaigns' },
  // HR
  { code: 'employee.manage.branch', module: 'hr', description: 'Manage employees' },
  { code: 'attendance.manage.branch', module: 'hr', description: 'Manage attendance records' },
  { code: 'leave.manage.branch', module: 'hr', description: 'Manage leave requests' },
  // Backup
  { code: 'backup.download.company', module: 'system', description: 'Download backups (requires MFA)' },
  { code: 'backup.restore.request.company', module: 'system', description: 'Request production restore (platform ops only)' },
  // Platform
  { code: 'platform.onboarding.execute', module: 'platform', description: 'Onboard new tenants' },
  { code: 'platform.tenant.pilot_enable', module: 'platform', description: 'Enable pilot features for tenants' },
  { code: 'system.config.view', module: 'system', description: 'View system configuration' },
  // AM-BR — Fixed assets + bank reconciliation
  { code: 'asset.view.branch', module: 'asset', description: 'View fixed assets (branch-scoped)' },
  { code: 'asset.view.global', module: 'asset', description: 'View all fixed assets across branches' },
  { code: 'asset.manage.branch', module: 'asset', description: 'Acquire/dispose fixed assets (branch)' },
  { code: 'asset.depreciate.company', module: 'asset', description: 'Run depreciation on fixed assets (company)' },
  { code: 'bank.reconciliation.view.company', module: 'banking', description: 'View bank reconciliations (company)' },
  { code: 'bank.reconciliation.manage.company', module: 'banking', description: 'Create/match/finalize bank reconciliations (company)' },
];

export async function seedPermissions(): Promise<number> {
  let count = 0;
  for (const spec of PERMISSIONS) {
    await db.permission.upsert({
      where: { code: spec.code },
      create: spec,
      update: { description: spec.description, module: spec.module },
    });
    count++;
  }
  return count;
}

// System roles per §8.4
export const SYSTEM_ROLES = [
  {
    name: 'platform_operations',
    description: 'Platform-level operator. Bypasses tenant permissions.',
    permissions: ['platform.onboarding.execute', 'platform.tenants.read', 'platform.tenants.suspend', 'platform.recovery_epoch.declare', 'platform.backup.restore'],
  },
  {
    name: 'owner',
    description: 'Company owner. Full access within tenant. MFA mandatory.',
    permissions: ['*'],
  },
  {
    name: 'global_admin',
    description: 'Company global admin. Full access except owner-only operations. MFA mandatory.',
    permissions: ['company.*', 'branch.*', 'warehouse.*', 'user.*', 'role.*', 'device.*', 'product.*', 'category.*', 'tax.*', 'inventory.*', 'purchase.*', 'transfer.*', 'sale.*', 'shift.*', 'payment.*', 'gift_card.*', 'journal.*', 'expense.*', 'report.*', 'delivery.*', 'service.*', 'warranty.*', 'lead.*', 'communication.*', 'payroll.*', 'approval.*', 'reconciliation.*', 'field.*', 'asset.*', 'bank.*'],
  },
  {
    name: 'branch_manager',
    description: 'Branch manager. Branch-scoped operations + approvals.',
    permissions: ['company.read', 'branch.read', 'warehouse.read', 'user.read', 'product.*', 'inventory.*', 'purchase.*', 'transfer.*', 'sale.*', 'shift.*', 'expense.approve', 'approval.resolve', 'reconciliation.read', 'report.execute', 'asset.view.branch', 'asset.manage.branch', 'bank.reconciliation.view.company'],
  },
  {
    name: 'cashier',
    description: 'POS cashier. Posts sales, opens/closes shifts. No reports.',
    permissions: ['product.read', 'sale.post', 'sale.void', 'sale_return.post', 'shift.open', 'shift.close', 'gift_card.redeem', 'payment.allocate'],
  },
  {
    name: 'accountant',
    description: 'Accountant. Posts journals, expenses, reconciliations, period close. MFA mandatory.',
    permissions: ['journal.*', 'expense.*', 'report.*', 'reconciliation.*', 'fiscal_period.lock', 'tax.manage', 'approval.resolve', 'asset.view.branch', 'asset.depreciate.company', 'bank.reconciliation.view.company', 'bank.reconciliation.manage.company'],
  },
  {
    name: 'inventory_clerk',
    description: 'Inventory clerk. Receives purchases, posts counts/adjustments, manages transfers.',
    permissions: ['inventory.*', 'purchase.receive', 'transfer.*', 'stock_count.post', 'stock_adjustment.post', 'opening_stock.post', 'landed_cost.post'],
  },
  {
    name: 'service_technician',
    description: 'Service technician. Handles service requests and warranty claims.',
    permissions: ['service.*', 'warranty.fulfill', 'inventory.read', 'product.read'],
  },
  {
    name: 'purchase_officer',
    description: 'Purchase officer. Manages suppliers, POs, receiving prep, supplier returns.',
    permissions: ['supplier.*', 'purchase.*', 'purchase_return.post', 'landed_cost.post', 'inventory.read', 'product.read', 'report.execute'],
  },
  {
    name: 'sales_agent',
    description: 'Sales staff. Customers, quotations, sales, CRM, allowed discounts.',
    permissions: ['customer.*', 'quotation.*', 'sale.post', 'sale.read', 'sale.hold.branch', 'sale.refund.branch', 'discount.override', 'crm.lead.*', 'product.read', 'inventory.read', 'report.execute'],
  },
  {
    name: 'delivery_staff',
    description: 'Delivery staff. Assigned deliveries and proof of delivery only.',
    permissions: ['delivery.view.assigned', 'delivery.dispatch', 'delivery.complete', 'inventory.read', 'product.read'],
  },
  {
    name: 'hr_manager',
    description: 'HR manager. Employees, attendance, leave, payroll prep/approval per segregation.',
    permissions: ['hr.*', 'employee.*', 'attendance.*', 'leave.*', 'payroll.prepare', 'payroll.approve', 'report.execute'],
  },
  {
    name: 'auditor_viewer',
    description: 'Auditor / viewer. Read-only access across modules, no mutations, no secrets.',
    permissions: ['company.read', 'branch.read', 'warehouse.read', 'user.read', 'product.read', 'inventory.read', 'purchase.read', 'sale.read', 'sale.view.global', 'shift.read', 'payment.read', 'journal.read', 'expense.read', 'report.execute', 'reconciliation.read', 'audit.view', 'asset.view.global', 'bank.reconciliation.view.company'],
  },
] as const;
