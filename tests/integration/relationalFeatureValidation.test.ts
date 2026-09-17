import { afterAll, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient, type Branch, type Warehouse } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { issueAccessToken } from '@/lib/auth/jwt';
import { ACCESS_COOKIE_NAME } from '@/lib/auth/cookieNames';

const cookies = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({ cookies: async () => ({
  get: (name: string) => cookies.has(name) ? { value: cookies.get(name) } : undefined,
}) }));
// Authentication, RBAC, tenant middleware, idempotency and database are real.
import { POST as issueGiftCard } from '@/app/api/v1/gift-cards/route';
const db = new PrismaClient();
afterAll(() => db.$disconnect());

async function fixture(label: string, permissionIds: string[]) {
  return db.$transaction(async tx => {
    const company = await tx.company.create({ data: {
      code: 'REL-' + label + '-' + randomUUID(), legalName: 'Synthetic Company ' + label,
      displayName: 'Synthetic Company ' + label, baseCurrencyCode: 'BDT', status: 'active',
    } });
    const companyId = company.id;
    const branches: Branch[] = [];
    const warehouses: Warehouse[] = [];
    for (const code of ['BR1', 'BR2']) {
      const branch = await tx.branch.create({ data: { companyId, code, name: 'Synthetic ' + code } });
      branches.push(branch);
      warehouses.push(await tx.warehouse.create({ data: {
        companyId, branchId: branch.id, code: 'WH-' + code, name: 'Synthetic ' + code, warehouseType: 'retail',
      } }));
    }
    const role = await tx.role.create({ data: {
      companyId, name: 'Synthetic issuer', permissions: { create: permissionIds.map(permissionId => ({ permissionId })) },
    } });
    const user = await tx.user.create({ data: {
      companyId, name: 'Synthetic user', email: randomUUID() + '@example.invalid',
      passwordHash: 'not-a-login', accessScope: 'multi_branch',
      roles: { create: { roleId: role.id } },
      branchAccess: { create: branches.map(branch => ({ branchId: branch.id })) },
    } });
    const accounts: Record<string, string> = {};
    for (const [code, accountClass, normalBalance] of [
      ['cash', 'asset', 'D'], ['inventory', 'asset', 'D'], ['cogs', 'expense', 'D'],
      ['revenue', 'revenue', 'C'], ['ar', 'asset', 'D'], ['ap', 'liability', 'C'],
      ['customerAdvance', 'liability', 'C'], ['supplierAdvance', 'asset', 'D'],
      ['variance', 'expense', 'D'], ['giftLiability', 'liability', 'C'],
      ['taxInput', 'asset', 'D'], ['taxOutput', 'liability', 'C'],
    ]) {
      accounts[code] = (await tx.chartOfAccount.create({ data: {
        companyId, code, name: 'Synthetic ' + code, accountClass, normalBalance,
        accountSubtype: accountClass === 'asset' ? 'current_asset' : accountClass === 'liability'
          ? 'current_liability' : accountClass === 'expense' ? 'operating_expense' : 'operating_revenue',
      } })).id;
    }
    await tx.accountingPolicy.create({ data: {
      companyId, inventoryAccountId: accounts.inventory, cogsAccountId: accounts.cogs,
      salesRevenueAccountId: accounts.revenue, arAccountId: accounts.ar, apAccountId: accounts.ap,
      customerAdvanceAccountId: accounts.customerAdvance, supplierAdvanceAccountId: accounts.supplierAdvance,
      purchaseVarianceAccountId: accounts.variance, giftCardLiabilityAccountId: accounts.giftLiability,
    } });
    const financialAccount = await tx.financialAccount.create({ data: {
      companyId, branchId: branches[0].id, chartOfAccountId: accounts.cash,
      name: 'Synthetic cash', accountType: 'cash', currencyCode: 'BDT',
    } });
    await tx.fiscalPeriod.create({ data: {
      companyId, periodName: 'Synthetic FY', periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-12-31T23:59:59Z'), status: 'open',
    } });
    const customer = await tx.customer.create({ data: {
      companyId, name: 'Synthetic customer', preferredBranchId: branches[0].id,
    } });
    const supplier = await tx.supplier.create({ data: { companyId, name: 'Synthetic supplier', currencyCode: 'BDT' } });
    const category = await tx.category.create({ data: { companyId, code: 'CAT', name: 'Synthetic category' } });
    const unit = await tx.unit.create({ data: {
      companyId, code: 'PC', name: 'Piece', conversionFactor: '1', allowFractional: false,
    } });
    const taxComponent = await tx.taxComponent.create({ data: {
      companyId, componentCode: 'VAT', name: 'Synthetic VAT', rate: '5',
      effectiveFrom: new Date('2026-01-01'), inputAccountId: accounts.taxInput, outputAccountId: accounts.taxOutput,
    } });
    const taxCode = await tx.taxCode.create({ data: {
      companyId, code: 'VAT5', name: 'Synthetic VAT5', effectiveFrom: new Date('2026-01-01'),
      components: { create: { taxComponentId: taxComponent.id } },
    } });
    const product = await tx.product.create({ data: {
      companyId, categoryId: category.id, unitId: unit.id, defaultTaxCodeId: taxCode.id,
      code: 'PRODUCT', name: 'Synthetic product', productType: 'standard', defaultPrice: '100.25',
    } });
    await tx.featureFlag.create({ data: { companyId, flagKey: 'loyalty_enabled', enabled: true, updatedBy: user.id } });
    return { company, branches, warehouses, role, user, customer, supplier, category, unit, product,
      accounts, financialAccount, taxCode, taxComponent };
  }, { timeout: 30000 });
}

async function rejected(action: () => Promise<unknown>, relation: string, expected = 'P2003') {
  let failure: unknown;
  try { await action(); } catch (e) { failure = e; }
  // An infrastructure/timeout error is not evidence that a relation was protected.
  if (expected === 'TENANT_VIOLATION') {
    expect(failure, relation).toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);
    expect((failure as Error).message, relation).toContain('TENANT_VIOLATION');
  } else {
    expect(failure, relation).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((failure as Prisma.PrismaClientKnownRequestError).code, relation).toBe(expected);
  }
  console.log('RELATIONAL_PASS', relation, expected);
}

it('validates relational chains in order and stops at first unmet invariant', async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318'
      || target.pathname !== '/readiness_20260912_disposable')
    throw new Error('Only known local synthetic disposable MariaDB permitted');
  const version = await db.$queryRaw<Array<{ version: string }>>`SELECT VERSION() AS version`;
  expect(version[0].version).toMatch(/^11\.8\..*MariaDB/);
  const migrations = await db.$queryRaw<Array<{ unfinished: bigint }>>`
    SELECT COUNT(*) AS unfinished FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
  expect(Number(migrations[0].unfinished)).toBe(0);
  const permission = await db.permission.upsert({ where: { code: 'gift_card.issue' },
    update: {}, create: { code: 'gift_card.issue', module: 'loyalty', description: 'Synthetic issue permission' } });
  const paymentPermission = await db.permission.upsert({ where: { code: 'payment.pay.branch' },
    update: {}, create: { code: 'payment.pay.branch', module: 'payments', description: 'Synthetic receipt permission' } });
  const a = await fixture('A', [permission.id, paymentPermission.id]);
  const b = await fixture('B', [permission.id, paymentPermission.id]);
  console.log('RELATIONAL_FIXTURES', JSON.stringify({
    companyA: a.company.id, companyB: b.company.id, companies: 2, branches: 4, warehouses: 4,
    users: 2, roles: 2, customers: 2, suppliers: 2, products: 2, categories: 2, units: 2,
    taxCodes: 2, taxComponents: 2, chartAccounts: 24, accountingPolicies: 2,
  }));
  for (const f of [a, b]) {
    expect(await db.branch.count({ where: { companyId: f.company.id } })).toBe(2);
    const warehouses = await db.warehouse.findMany({ where: { companyId: f.company.id }, include: { branch: true } });
    expect(warehouses).toHaveLength(2);
    expect(warehouses.every(w => w.branch.companyId === w.companyId)).toBe(true);
    const product = await db.product.findUniqueOrThrow({ where: { id: f.product.id }, include: { category: true, unit: true } });
    expect([product.companyId, product.category.companyId, product.unit.companyId]).toEqual(Array(3).fill(f.company.id));
  }
  console.log('RELATIONAL_PASS', 'foundation creates and parent/child ownership');
  await db.customer.update({ where: { id: a.customer.id }, data: { name: 'Synthetic updated customer' } });
  expect((await db.customer.findUniqueOrThrow({ where: { id: a.customer.id } })).name).toBe('Synthetic updated customer');
  await rejected(() => db.warehouse.create({ data: {
    companyId: a.company.id, branchId: randomUUID(), code: 'INVALID', name: 'Synthetic invalid',
  } }), 'warehouses.branch_id -> absent branches.id');
  await rejected(() => db.warehouse.create({ data: {
    companyId: a.company.id, branchId: b.branches[0].id, code: 'FOREIGN', name: 'Synthetic foreign',
  } }), 'warehouses(company_id,branch_id) -> other tenant branch');
  await rejected(() => db.product.create({ data: {
    companyId: a.company.id, categoryId: b.category.id, unitId: a.unit.id, code: 'FOREIGN', name: 'Synthetic foreign',
  } }), 'products(company_id,category_id) -> other tenant category');
  await rejected(() => db.taxCodeComponent.create({ data: {
    taxCodeId: a.taxCode.id, taxComponentId: b.taxComponent.id,
  } }), 'tax_code_components -> other tenant tax_component', 'TENANT_VIOLATION');
  await rejected(() => db.userRole.create({ data: {
    userId: a.user.id, roleId: b.role.id,
  } }), 'user_roles -> other tenant role', 'TENANT_VIOLATION');
  await rejected(() => db.branch.create({ data: {
    companyId: a.company.id, code: 'BR1', name: 'Synthetic duplicate',
  } }), 'branches(company_id,code) tenant uniqueness', 'P2002');
  await rejected(() => db.branch.delete({ where: { id: a.branches[0].id } }), 'branch deletion with warehouse/customer references');
  const rollbackId = randomUUID();
  const rollback = new Error('SYNTHETIC_FORCED_ROLLBACK');
  await expect(db.$transaction(async tx => {
    await tx.customer.create({ data: { id: rollbackId, companyId: a.company.id, name: 'Synthetic rollback' } });
    throw rollback;
  })).rejects.toBe(rollback);
  expect(await db.customer.count({ where: { id: rollbackId } })).toBe(0);
  expect(await db.warehouse.count({ where: { companyId: a.company.id, code: { in: ['INVALID', 'FOREIGN'] } } })).toBe(0);
  expect(await db.product.count({ where: { companyId: a.company.id, code: 'FOREIGN' } })).toBe(0);
  expect(await db.taxCodeComponent.count({ where: { taxCodeId: a.taxCode.id, taxComponentId: b.taxComponent.id } })).toBe(0);
  expect(await db.userRole.count({ where: { userId: a.user.id, roleId: b.role.id } })).toBe(0);
  console.log('RELATIONAL_PASS', 'foundation rollback leaves no customer row');

  // First transactional chain: actual authenticated issuance must establish ledger authority.
  const familyId = randomUUID(), sessionId = randomUUID();
  await db.refreshToken.create({ data: {
    companyId: a.company.id, userId: a.user.id, familyId, sessionId, tokenHash: randomUUID(),
    expiresAt: new Date(Date.now() + 3600000), mfaVerified: true,
  } });
  cookies.set(ACCESS_COOKIE_NAME, await issueAccessToken({
    sub: a.user.id, company_id: a.company.id, scope: 'multi_branch', is_global: false,
    branch_ids: a.branches.map(branch => branch.id), family_id: familyId, session_id: sessionId, mfa_verified: true,
  }));
  const response = await issueGiftCard(new NextRequest('http://localhost/api/v1/gift-cards', {
    method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ face_value: '100.25', mode: 'sold', branch_id: a.branches[0].id,
      financial_account_id: a.financialAccount.id, cash_received: true }),
  }));
  expect(response.status, 'authorized valid gift issuance must succeed').toBe(201);
  const body = await response.json();
  const card = await db.giftCard.findUniqueOrThrow({ where: { id: body.id } });
  expect(card.companyId).toBe(a.company.id);
  expect(card.issuedBy).toBe(a.user.id);
  const ledger = await db.giftCardTransaction.findMany({ where: { companyId: a.company.id, giftCardId: card.id } });
  const journals = await db.journalEntry.findMany({ where: { companyId: a.company.id }, include: { lines: true } });
  const payments = await db.payment.count({ where: { companyId: a.company.id } });
  const audits = await db.auditLog.count({ where: { companyId: a.company.id, entityId: card.id, action: 'gift_card.issue' } });
  const Money = Prisma.Decimal.clone({ precision: 80 });
  const ledgerBalance = ledger.reduce((sum, row) => sum.plus(row.amountDelta), new Money(0));
  const liability = journals.filter(j => ['posted', 'reversed'].includes(j.status))
    .flatMap(j => j.lines).filter(line => line.chartOfAccountId === a.accounts.giftLiability)
    .reduce((sum, line) => sum.plus(line.creditBase).minus(line.debitBase), new Money(0));
  console.log('RELATIONAL_GIFT_PROOF', JSON.stringify({
    cardId: card.id, companyId: card.companyId, httpStatus: response.status, faceValue: card.faceValue.toFixed(),
    ledgerRows: ledger.length, ledgerBalance: ledgerBalance.toFixed(), journals: journals.length,
    glLiability: liability.toFixed(), payments, auditRows: audits,
  }));
  expect(ledgerBalance.eq(card.faceValue),
    'STOP: gift_cards.id -> gift_card_transactions.gift_card_id: issued value missing from authoritative ledger').toBe(true);
  expect(liability.eq(ledgerBalance), 'STOP: gift-card ledger -> posted liability GL mismatch').toBe(true);
  // Do not continue to another module after an assertion fails. Retain only synthetic evidence.
}, 60000);
