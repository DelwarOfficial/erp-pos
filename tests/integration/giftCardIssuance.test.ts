import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { issueAccessToken } from '@/lib/auth/jwt';
import { ACCESS_COOKIE_NAME } from '@/lib/auth/cookieNames';
import { checkGiftCardLiability } from '@/lib/reconciliation/checks';

const injected = vi.hoisted(() => ({ cookies: new Map<string, string>(), failure: '' }));
vi.mock('next/headers', () => ({ cookies: async () => ({
  get: (name: string) => injected.cookies.has(name) ? { value: injected.cookies.get(name) } : undefined,
}) }));
// Only inject a write exception; transactions, authentication and all SQL remain real.
vi.mock('@/lib/db/transaction', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/db/transaction')>();
  return { ...actual, withTenant: (ctx: Parameters<typeof actual.withTenant>[0], work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
    actual.withTenant(ctx, tx => work(new Proxy(tx, { get(target, key) {
      const delegate = Reflect.get(target, key);
      if (key !== injected.failure) return delegate;
      return new Proxy(delegate, { get(model, operation) {
        const method = Reflect.get(model, operation);
        if (operation !== 'create' && operation !== 'update') return method;
        return async (...args: Array<{ data?: { action?: string } }>) => {
          if (key === 'idempotencyRequest' && operation !== 'update') return method.apply(model, args);
          if (key === 'auditLog' && args[0]?.data?.action !== 'gift_card.issue') return method.apply(model, args);
          throw new Error('SYNTHETIC_PRIVATE_DRIVER_DETAILS');
        };
      } });
    } }))).catch((error: unknown) => {
      const e = error as { code?: string; name?: string; message?: string };
      console.log('ISSUANCE_ERROR_CLASS', e.name, e.code, {
        deadlock: /deadlock/i.test(e.message ?? ''), unique: /unique|duplicate/i.test(e.message ?? ''),
        timeout: /timeout/i.test(e.message ?? ''), tenant: /TENANT/i.test(e.message ?? ''),
        transaction: /transaction/i.test(e.message ?? ''),
        changed: /Record has changed/i.test(e.message ?? ''),
        driverCodes: e.message?.match(/(?:code: \d+|state: "[A-Z0-9]+")/g),
      });
      throw error;
    }) };
});
import { POST } from '@/app/api/v1/gift-cards/route';

const db = new PrismaClient();
const companyA = '7ff2f39e-a402-4744-adcc-a9e4f2897ef2';
const companyB = '7e05c6d3-ce29-4740-8298-ed2a45ef4d41';
let a: Awaited<ReturnType<typeof loadFixture>>, b: Awaited<ReturnType<typeof loadFixture>>;
let familyId: string;

async function loadFixture(companyId: string) {
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  expect(company.displayName).toMatch(/^Synthetic Company [AB]$/);
  const branches = await db.branch.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
  expect(branches).toHaveLength(2);
  const user = await db.user.findFirstOrThrow({ where: { companyId } });
  const role = await db.role.findFirstOrThrow({ where: { companyId, name: 'Synthetic issuer' } });
  const cash = await db.financialAccount.findFirstOrThrow({ where: { companyId, branchId: branches[0].id } });
  const expense = await db.chartOfAccount.upsert({
    where: { companyId_code: { companyId, code: 'giftMarketing' } }, update: {},
    create: { companyId, code: 'giftMarketing', name: 'Synthetic marketing', accountClass: 'expense',
      accountSubtype: 'operating_expense', normalBalance: 'D', allowManualPosting: true },
  });
  return { companyId, branches, user, role, cash, expense };
}

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable')
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  console.log('Database environment: LOCAL / DISPOSABLE; Host: 127.0.0.1; Port: 43318; Database name: readiness_20260912_disposable');
  const version = await db.$queryRaw<Array<{ version: string }>>`SELECT VERSION() AS version`;
  expect(version[0].version).toMatch(/^11\.8\..*MariaDB/);
  a = await loadFixture(companyA); b = await loadFixture(companyB);
  for (const code of ['gift_card.issue', 'payment.pay.branch', 'journal.post']) {
    const permission = await db.permission.upsert({ where: { code }, update: {},
      create: { code, module: 'loyalty', description: 'Synthetic issuance permission' } });
    await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: a.role.id, permissionId: permission.id } },
      update: {}, create: { roleId: a.role.id, permissionId: permission.id } });
  }
  familyId = randomUUID(); const sessionId = randomUUID();
  await db.refreshToken.create({ data: { companyId: companyA, userId: a.user.id, familyId, sessionId,
    tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600000), mfaVerified: true } });
  injected.cookies.set(ACCESS_COOKIE_NAME, await issueAccessToken({
    sub: a.user.id, company_id: companyA, scope: 'multi_branch', is_global: false,
    branch_ids: a.branches.map(branch => branch.id), family_id: familyId, session_id: sessionId, mfa_verified: true,
  }));
});
afterAll(async () => {
  if (familyId) await db.refreshToken.updateMany({ where: { familyId }, data: { revokedAt: new Date() } });
  await db.$disconnect();
});

function sold(overrides = {}) { return { mode: 'sold', face_value: '100.25', branch_id: a.branches[0].id,
  financial_account_id: a.cash.id, cash_received: true, ...overrides }; }
function promo(overrides = {}) { return { mode: 'promotional', face_value: '100.25', branch_id: a.branches[0].id,
  expense_account_id: a.expense.id, ...overrides }; }
async function request(body: unknown, key = randomUUID()) {
  const response = await POST(new NextRequest('http://localhost/api/v1/gift-cards', {
    method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}
async function counts(companyId = companyA) {
  return { cards: await db.giftCard.count({ where: { companyId } }),
    ledger: await db.giftCardTransaction.count({ where: { companyId } }),
    journals: await db.journalEntry.count({ where: { companyId } }),
    lines: await db.journalLine.count({ where: { companyId } }),
    events: await db.businessEvent.count({ where: { companyId } }),
    audits: await db.auditLog.count({ where: { companyId } }),
    payments: await db.payment.count({ where: { companyId } }),
    idempotency: await db.idempotencyRequest.count({ where: { companyId } }) };
}
async function assertChain(body: { id: string; journal_entry_id: string; payment_id: string | null }, mode: string) {
  const card = await db.giftCard.findUniqueOrThrow({ where: { id: body.id } });
  expect(card.companyId).toBe(companyA); expect(card.issuedBy).toBe(a.user.id);
  expect(card.faceValue.eq('100.25')).toBe(true);
  const ledger = await db.giftCardTransaction.findMany({ where: { giftCardId: card.id } });
  expect(ledger).toHaveLength(1);
  expect(ledger[0]).toMatchObject({ companyId: companyA, entryType: 'issue', createdBy: a.user.id });
  expect(ledger[0].amountDelta.eq(card.faceValue)).toBe(true);
  const journal = await db.journalEntry.findUniqueOrThrow({ where: { id: body.journal_entry_id }, include: { lines: true } });
  expect(journal).toMatchObject({ companyId: companyA, sourceType: 'gift_card', sourceId: card.id, status: 'posted', postingKind: 'gift_card_issue', currencyCode: 'BDT' });
  expect(ledger[0].eventId).toBe(journal.eventId);
  expect(await db.businessEvent.findUniqueOrThrow({ where: { id: journal.eventId } })).toMatchObject({ companyId: companyA, sourceId: card.id });
  expect(journal.lines).toHaveLength(2);
  const debit = journal.lines.reduce((sum, row) => sum.plus(row.debitBase), new Prisma.Decimal(0));
  const credit = journal.lines.reduce((sum, row) => sum.plus(row.creditBase), new Prisma.Decimal(0));
  expect(debit.eq('100.25') && credit.eq(debit)).toBe(true);
  expect(journal.lines.every(row => row.companyId === companyA && row.branchId === a.branches[0].id)).toBe(true);
  const policy = await db.accountingPolicy.findUniqueOrThrow({ where: { companyId: companyA } });
  expect(journal.lines.find(row => row.creditBase.gt(0))?.chartOfAccountId).toBe(policy.giftCardLiabilityAccountId);
  expect(journal.lines.find(row => row.debitBase.gt(0))?.chartOfAccountId).toBe(mode === 'sold' ? a.cash.chartOfAccountId : a.expense.id);
  const audits = await db.auditLog.findMany({ where: { companyId: companyA, entityId: card.id, action: 'gift_card.issue' } });
  expect(audits).toHaveLength(1);
  expect(JSON.parse(audits[0].afterValue!)).toMatchObject({ mode, journal_entry_id: journal.id, payment_id: body.payment_id });
  if (mode === 'sold') {
    const payment = await db.payment.findUniqueOrThrow({ where: { id: body.payment_id! } });
    expect(payment).toMatchObject({ companyId: companyA, branchId: a.branches[0].id,
      financialAccountId: a.cash.id, paymentStatus: 'posted', direction: 'incoming', methodReference: card.id, clientTxnId: card.id });
    expect(payment.amount.eq('100.25') && payment.baseAmount.eq('100.25')).toBe(true);
  } else expect(body.payment_id).toBeNull();
  expect(await checkGiftCardLiability(db, companyA)).toEqual([]);
}

it.each(['sold', 'promotional'])('%s issuance creates one Decimal-exact, tenant-safe, balanced chain', async mode => {
  const before = await counts(), other = await counts(companyB);
  const response = await request(mode === 'sold' ? sold() : promo());
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  expect(response.body.face_value).toBe('100.25');
  await assertChain(response.body, mode);
  const after = await counts();
  expect(after.cards - before.cards).toBe(1); expect(after.ledger - before.ledger).toBe(1);
  expect(after.journals - before.journals).toBe(1); expect(after.events - before.events).toBe(1);
  expect(after.audits - before.audits).toBe(2); expect(after.payments - before.payments).toBe(mode === 'sold' ? 1 : 0);
  expect(await counts(companyB)).toEqual(other);
});

it.each(['giftCardTransaction', 'journalLine', 'auditLog', 'payment', 'idempotencyRequest'])('rolls back all writes when %s fails, then safely retries', async delegate => {
  const before = await counts(), key = randomUUID();
  injected.failure = delegate;
  let response;
  try { response = await request(sold(), key); } finally { injected.failure = ''; }
  expect(response.status).toBe(500);
  expect(JSON.stringify(response.body)).not.toContain('SYNTHETIC_PRIVATE_DRIVER_DETAILS');
  expect(await counts()).toEqual(before);
  const retry = await request(sold(), key);
  expect(retry.status, JSON.stringify(retry.body)).toBe(201);
  await assertChain(retry.body, 'sold');
});

it.each(['foreign-branch', 'foreign-cash', 'foreign-expense', 'wrong-branch-cash', 'missing-account', 'no-mode', 'no-cash', 'extra-tenant', 'sub-cent', 'zero', 'expired'])('rejects %s without partial business state', async scenario => {
  const before = await counts(), other = await counts(companyB);
  const bodies: Record<string, unknown> = {
    'foreign-branch': sold({ branch_id: b.branches[0].id }), 'foreign-cash': sold({ financial_account_id: b.cash.id }),
    'foreign-expense': promo({ expense_account_id: b.expense.id }), 'wrong-branch-cash': sold({ branch_id: a.branches[1].id }),
    'missing-account': sold({ financial_account_id: randomUUID() }), 'no-mode': { face_value: '100.25' },
    'no-cash': sold({ cash_received: false }), 'extra-tenant': sold({ company_id: companyB }),
    'sub-cent': sold({ face_value: '100.251' }), zero: sold({ face_value: '0' }), expired: sold({ expires_at: '2020-01-01T00:00:00Z' }),
  };
  const result = await request(bodies[scenario]);
  expect([400, 403]).toContain(result.status);
  expect(await counts()).toEqual(before); expect(await counts(companyB)).toEqual(other);
});

it.each(['liability', 'expense', 'cash-currency', 'closed-period'])('fails closed for invalid %s accounting prerequisites', async scenario => {
  const before = await counts();
  const policy = await db.accountingPolicy.findUniqueOrThrow({ where: { companyId: companyA } });
  const period = await db.fiscalPeriod.findFirstOrThrow({ where: { companyId: companyA } });
  try {
    if (scenario === 'liability') await db.chartOfAccount.update({ where: { id: policy.giftCardLiabilityAccountId }, data: { isActive: false } });
    if (scenario === 'expense') await db.chartOfAccount.update({ where: { id: a.expense.id }, data: { allowManualPosting: false } });
    if (scenario === 'cash-currency') {
      await db.currency.upsert({ where: { code: 'USD' }, update: {}, create: { code: 'USD', name: 'US Dollar' } });
      await db.financialAccount.update({ where: { id: a.cash.id }, data: { currencyCode: 'USD' } });
    }
    if (scenario === 'closed-period') await db.fiscalPeriod.update({ where: { id: period.id }, data: { status: 'soft_closed' } });
    const response = await request(scenario === 'expense' ? promo() : sold());
    expect([400, 409], JSON.stringify(response.body)).toContain(response.status);
    expect(await counts()).toEqual(before);
  } finally {
    await db.chartOfAccount.update({ where: { id: policy.giftCardLiabilityAccountId }, data: { isActive: true } });
    await db.chartOfAccount.update({ where: { id: a.expense.id }, data: { allowManualPosting: true } });
    await db.financialAccount.update({ where: { id: a.cash.id }, data: { currencyCode: a.cash.currencyCode } });
    await db.fiscalPeriod.update({ where: { id: period.id }, data: { status: period.status } });
  }
});

it('replays committed issuance exactly and rejects same-key changed payload', async () => {
  const key = randomUUID();
  const original = await request(sold(), key); expect(original.status).toBe(201);
  const before = await counts();
  expect(await request(sold(), key)).toEqual(original);
  expect((await request(sold({ face_value: '200.25' }), key)).status).toBe(409);
  expect(await counts()).toEqual(before);
});

it('concurrent same-key retries cannot duplicate cards, journals, receipts or events', async () => {
  const before = await counts(), key = randomUUID();
  const results = await Promise.all([request(sold(), key), request(sold(), key)]);
  expect(results.every(result => [201, 409].includes(result.status)), JSON.stringify(results)).toBe(true);
  expect(results.some(result => result.status === 201)).toBe(true);
  const replay = await request(sold(), key);
  expect(replay.status, JSON.stringify(replay.body)).toBe(201);
  for (const result of results) if (result.status === 201) expect(result.body).toEqual(replay.body);
  const after = await counts();
  expect(after.cards - before.cards).toBe(1); expect(after.ledger - before.ledger).toBe(1);
  expect(after.journals - before.journals).toBe(1); expect(after.events - before.events).toBe(1);
  expect(after.payments - before.payments).toBe(1); expect(after.audits - before.audits).toBe(2);
  await assertChain(replay.body, 'sold');
  console.log('GIFT_CARD_CONCURRENCY', results.map(result => result.status), 'replay', replay.status);
});

it('requires funding/posting permission in addition to gift-card issuance permission', async () => {
  const permission = await db.permission.findUniqueOrThrow({ where: { code: 'journal.post' } });
  const before = await counts();
  await db.rolePermission.delete({ where: { roleId_permissionId: { roleId: a.role.id, permissionId: permission.id } } });
  try { expect((await request(promo())).status).toBe(403); expect(await counts()).toEqual(before); }
  finally { await db.rolePermission.create({ data: { roleId: a.role.id, permissionId: permission.id } }); }
});
