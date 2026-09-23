// Shared disposable-DB fixture bootstrap (GAP-1 remediation).
// Makes integration suites self-provisioning on a freshly migrated EMPTY MariaDB:
// zero manual reference-data insertion. All setup is findFirst-then-create (idempotent).
import type { PrismaClient, Branch, User, Role, FinancialAccount, ChartOfAccount } from '@prisma/client';
import { randomUUID } from 'node:crypto';

type Db = PrismaClient;

export async function ensureBdt(db: Db): Promise<void> {
  await db.currency.upsert({ where: { code: 'BDT' }, update: {}, create: {
    code: 'BDT', name: 'Bangladeshi Taka', decimalPlaces: 2, isActive: true,
  } });
}

/**
 * Idempotently provisions one synthetic issuer tenant with everything the
 * gift-card relational suites require: company (stable id), branches A/B,
 * user, 'Synthetic issuer' role, cash financial account on branch A,
 * manual-postable marketing expense CoA, gift-card liability CoA,
 * accounting policy with the nine blueprint-required mappings, and an open
 * fiscal period covering today.
 */
export async function ensureSyntheticIssuerTenant(db: Db, opts: {
  companyId: string; label: string; code: string;
}) {
  await ensureBdt(db);
  const company = await db.company.upsert({ where: { id: opts.companyId }, update: {}, create: {
    id: opts.companyId, code: opts.code, legalName: 'Synthetic Company ' + opts.label,
    displayName: 'Synthetic Company ' + opts.label, baseCurrencyCode: 'BDT', status: 'active',
  } });
  const branches: Branch[] = [];
  for (const code of ['A', 'B']) {
    let branch = await db.branch.findFirst({ where: { companyId: company.id, code } });
    if (!branch) branch = await db.branch.create({ data: { companyId: company.id, code, name: 'Synthetic ' + code, isActive: true } });
    branches.push(branch);
  }
  let role: Role | null = await db.role.findFirst({ where: { companyId: company.id, name: 'Synthetic issuer' } });
  if (!role) role = await db.role.create({ data: { companyId: company.id, name: 'Synthetic issuer' } });
  let user: User | null = await db.user.findFirst({ where: { companyId: company.id } });
  if (!user) user = await db.user.create({ data: {
    companyId: company.id, name: 'Synthetic user', email: randomUUID() + '@example.invalid',
    passwordHash: 'not-a-login', accessScope: 'multi_branch',
    roles: { create: { roleId: role.id } },
  } });
  for (const branch of branches) {
    const existing = await db.userBranchAccess.findFirst({ where: { userId: user.id, branchId: branch.id } });
    if (!existing) await db.userBranchAccess.create({ data: { userId: user.id, branchId: branch.id } });
  }
  const coa = async (code: string, name: string, accountClass: 'asset' | 'liability' | 'expense' | 'revenue',
    subtype: 'current_asset' | 'current_liability' | 'operating_expense' | 'operating_revenue', normalBalance: 'D' | 'C',
    extra: { allowManualPosting?: boolean } = {}) => {
    let account: ChartOfAccount | null = await db.chartOfAccount.findFirst({ where: { companyId: company.id, code } });
    if (!account) account = await db.chartOfAccount.create({ data: {
      companyId: company.id, code, name, accountClass, accountSubtype: subtype, normalBalance, isActive: true, ...extra,
    } });
    return account;
  };
  const cash = await coa('cash', 'Synthetic cash', 'asset', 'current_asset', 'D');
  const liability = await coa('giftLiability', 'Synthetic gift-card liability', 'liability', 'current_liability', 'C');
  const expense = await coa('giftMarketing', 'Synthetic marketing', 'expense', 'operating_expense', 'D', { allowManualPosting: true });
  // Sales revenue MUST be a different account from the gift-card liability:
  // redemption posts Dr liability / Cr revenue, and mapping both roles to one
  // account makes that entry net to zero, so the liability is never
  // extinguished and no correct implementation can satisfy the gate.
  const revenue = await coa('revenue', 'Synthetic revenue', 'revenue', 'operating_revenue', 'C');
  // Each policy role needs its own account. Mapping several roles onto one
  // account makes a two-line entry net to zero on that account, which hides
  // whether the posting happened at all.
  const inventory = await coa('inventory', 'Synthetic inventory', 'asset', 'current_asset', 'D');
  const receivable = await coa('ar', 'Synthetic receivable', 'asset', 'current_asset', 'D');
  const payable = await coa('ap', 'Synthetic payable', 'liability', 'current_liability', 'C');
  const cogs = await coa('cogs', 'Synthetic cost of sales', 'expense', 'operating_expense', 'D');
  let financialAccount: FinancialAccount | null = await db.financialAccount.findFirst({ where: {
    companyId: company.id, branchId: branches[0].id, accountType: 'cash',
  } });
  if (!financialAccount) financialAccount = await db.financialAccount.create({ data: {
    companyId: company.id, branchId: branches[0].id, name: 'Synthetic cash box', accountType: 'cash',
    currencyCode: 'BDT', chartOfAccountId: cash.id, isActive: true,
  } });
  // Upsert, not create-if-absent: a company provisioned by an earlier version
  // of this helper keeps its old mappings otherwise, and several roles sharing
  // one account make two-line entries net to zero on it.
  const policyAccounts = {
    companyId: company.id, inventoryAccountId: inventory.id, cogsAccountId: cogs.id,
    salesRevenueAccountId: revenue.id, arAccountId: receivable.id, apAccountId: payable.id,
    customerAdvanceAccountId: liability.id, supplierAdvanceAccountId: cash.id,
    purchaseVarianceAccountId: expense.id, giftCardLiabilityAccountId: liability.id,
  };
  await db.accountingPolicy.upsert({
    where: { companyId: company.id },
    update: policyAccounts,
    create: policyAccounts,
  });
  const y = new Date().getUTCFullYear();
  const period = await db.fiscalPeriod.findFirst({ where: {
    companyId: company.id, status: 'open', periodStart: { lte: new Date() }, periodEnd: { gte: new Date() },
  } });
  if (!period) await db.fiscalPeriod.create({ data: {
    companyId: company.id, periodName: y + ' FY',
    periodStart: new Date(Date.UTC(y, 0, 1)), periodEnd: new Date(Date.UTC(y, 11, 31)), status: 'open',
  } });
  // D02: the loyalty feature flag is tenant-level and disabled by default; gift-card
  // suites explicitly test this module, so the fixture enables it for the tenant.
  const flag = await db.featureFlag.findFirst({ where: { companyId: company.id, flagKey: 'loyalty_enabled' } });
  if (!flag) await db.featureFlag.create({ data: {
    companyId: company.id, flagKey: 'loyalty_enabled', enabled: true, rolloutRules: '{}', updatedBy: user.id,
  } });
  return { companyId: company.id, branches, user, role, cash: financialAccount, expense };
}
