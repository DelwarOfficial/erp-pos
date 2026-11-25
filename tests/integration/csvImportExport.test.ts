// CSV import + export, end to end through the routes (disposable MariaDB).
//   - the four document templates (opening stock, sale, purchase, transfer)
//     write real rows through the domain commands;
//   - re-importing the same file with 'skip' creates nothing twice;
//   - 'update' changes records in place; barcode and customer group columns
//     create their linked rows;
//   - master data exports in import format and imports back (round trip);
//   - tenant isolation, the row limit, dry-run jobs, sensitive export needs a
//     fresh MFA check, and audit rows for commit and export.
// Only the session lookup is stubbed (and cookies, for the MFA check).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const auth = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/auth/middleware', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/auth/middleware')>()),
  authenticateRequest: async () => auth.current,
}));
const jar = vi.hoisted(() => ({ access: '' }));
vi.mock('next/headers', async importOriginal => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  cookies: async () => ({ set: () => undefined, delete: () => undefined,
    get: (name: string) => (name.includes('refresh') || !jar.access ? undefined : { name, value: jar.access }) }),
}));
import { POST as uploadRoute } from '@/app/api/v1/import-jobs/route';
import { POST as commitRoute } from '@/app/api/v1/import-jobs/[id]/commit/route';
import { GET as masterExport } from '@/app/api/v1/export-jobs/master/route';
import { issueRefreshToken } from '@/lib/auth/refreshToken';
import { issueAccessToken } from '@/lib/auth/jwt';
import { generateCsv, parseCsv } from '@/lib/import-export/csv';
import { getTemplateHeader, MAX_IMPORT_ROWS } from '@/lib/import-export/templates';

const db = new PrismaClient();
const COMPANY_A = 'c1a7e2d4-5b66-4c88-9d10-e2f3a4b5c601';
const COMPANY_B = 'c1a7e2d4-5b66-4c88-9d10-e2f3a4b5c602';
const R = randomUUID().slice(0, 6).toUpperCase();
const PERMS = ['import.execute.company', 'import.approve.company', 'sale.post', 'purchase.create', 'transfer.dispatch',
  'opening_stock.post', 'export.data.branch', 'export.sensitive.company'];

type Tenant = { companyId: string; userId: string; branchCode: string; whA: string; whB: string; auth: unknown };
let A: Tenant;
let B: Tenant;

async function tenant(companyId: string, label: string): Promise<Tenant> {
  const fx = await ensureSyntheticIssuerTenant(db, { companyId, label, code: `SYN-${label}` });
  // Opening stock needs somewhere to book its value.
  const equity = await db.chartOfAccount.findFirst({ where: { companyId, code: 'csv-equity' } })
    ?? await db.chartOfAccount.create({ data: { companyId, code: 'csv-equity', name: 'Opening balance equity', accountClass: 'equity', accountSubtype: 'equity', normalBalance: 'C' } });
  await db.accountingPolicy.update({ where: { companyId }, data: { openingBalanceEquityAccountId: equity.id } });
  const flag = await db.featureFlag.findFirst({ where: { companyId, flagKey: 'import_csv_enabled' } });
  if (flag) await db.featureFlag.update({ where: { id: flag.id }, data: { enabled: true } });
  else await db.featureFlag.create({ data: { companyId, flagKey: 'import_csv_enabled', enabled: true, rolloutRules: '{}', updatedBy: fx.user.id } });
  const perms = await db.permission.findMany({ where: { code: { in: PERMS } } });
  expect(perms).toHaveLength(PERMS.length);
  const role = await db.role.create({ data: { companyId, name: `csv-${randomUUID().slice(0, 6)}`, permissions: { create: perms.map(p => ({ permissionId: p.id })) } } });
  const userId = (await db.user.create({ data: { companyId, name: 'CSV importer', email: `${randomUUID()}@example.invalid`, passwordHash: 'x', accessScope: 'global', roles: { create: { roleId: role.id } } } })).id;
  const branch = fx.branches[0];
  const wh = async (suffix: string) => (await db.warehouse.create({ data: { companyId, branchId: (suffix === 'B' ? fx.branches[1] : branch).id, name: `CSV-${R}-${suffix}`, code: `CSV${R}${suffix}`, warehouseType: 'retail' } })).code;
  // The sale and purchase use the branch's retail warehouse: make it this run's.
  await db.warehouse.updateMany({ where: { companyId, branchId: branch.id, NOT: { code: { startsWith: `CSV${R}` } } }, data: { isActive: false } });
  const whA = await wh('A');
  const whB = await wh('B');
  return { companyId, userId, branchCode: branch.code, whA, whB,
    auth: { userId, companyId, branchIds: [], accessScope: 'global', isGlobal: false,
      ctx: { companyId, branchIds: [], allBranches: true, isGlobal: false, userId, correlationId: randomUUID(), requestId: randomUUID() } } };
}

const as = (t: Tenant) => { auth.current = t.auth; };
const csv = (type: string, rows: Array<Record<string, string>>) => {
  const header = getTemplateHeader(type)!;
  return generateCsv([header, ...rows.map(row => header.map(column => row[column] ?? ''))], { escapeFormulas: false });
};

async function upload(type: string, content: string, opts: { strategy?: string; dryRun?: boolean } = {}) {
  const form = new FormData();
  form.append('file', new File([content], `${type}.csv`, { type: 'text/csv' }));
  form.append('job_type', type);
  form.append('dry_run', String(opts.dryRun ?? false));
  form.append('duplicate_strategy', opts.strategy ?? 'skip');
  const res = await uploadRoute(new NextRequest('http://local.test/api/v1/import-jobs', {
    method: 'POST', body: form, headers: { 'Idempotency-Key': `t-${randomUUID()}` } }));
  return { status: res.status, body: await res.json() as { job: { id: string; status: string; validRows: number; invalidRows: number } } };
}
async function commit(jobId: string, content: string) {
  const res = await commitRoute(new NextRequest(`http://local.test/api/v1/import-jobs/${jobId}/commit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `t-${randomUUID()}` },
    body: JSON.stringify({ csvContent: content }) }), { params: Promise.resolve({ id: jobId }) });
  return { status: res.status, body: await res.json() as { status: string; committedRows: number; skippedRows: number; failedRows: number;
    documents?: Array<{ sourceKey: string; entityId: string; referenceNo: string }>; error?: { code: string; message: string } } };
}
async function importFile(type: string, content: string, strategy = 'skip') {
  const up = await upload(type, content, { strategy });
  expect(up.status).toBe(201);
  expect(up.body.job.invalidRows).toBe(0);
  const done = await commit(up.body.job.id, content);
  expect(done.status).toBe(200);
  return { jobId: up.body.job.id, ...done.body };
}
async function exportCsv(type: string, sensitive = false) {
  const res = await masterExport(new NextRequest(`http://local.test/api/v1/export-jobs/master?entity_type=${type}&include_sensitive=${sensitive}`));
  return { status: res.status, text: await res.text() };
}

const P1 = `P1-${R}`, P2 = `P2-${R}`, P3 = `P3-${R}`, CAT = `CAT-${R}`, UNIT = `U-${R}`;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  A = await tenant(COMPANY_A, 'CSVA');
  B = await tenant(COMPANY_B, 'CSVB');
}, 180_000);
afterAll(() => db.$disconnect());

describe('master data import', () => {
  it('imports categories, units and products, with barcodes', async () => {
    as(A);
    await importFile('category', csv('category', [{ code: CAT, name: `Cat ${R}` }]));
    await importFile('unit', csv('unit', [{ code: UNIT, name: `Unit ${R}` }]));
    const r = await importFile('product', csv('product', [
      { code: P1, name: 'Fan', category: CAT, unit: UNIT, product_type: 'standard', default_price: '500', reference_cost: '300', barcode: `BC1-${R}` },
      { code: P2, name: 'Iron', category: CAT, unit: UNIT, product_type: 'standard', default_price: '800', reference_cost: '600' },
      { code: P3, name: 'Battery', category: CAT, unit: UNIT, product_type: 'standard', default_price: '100', reference_cost: '50', track_batches: 'true' },
    ]));
    expect(r).toMatchObject({ committedRows: 3, failedRows: 0 });
    const p1 = await db.product.findFirstOrThrow({ where: { companyId: COMPANY_A, code: P1 }, include: { barcodes: true } });
    expect(p1.barcodes).toEqual([expect.objectContaining({ code: `BC1-${R}`, symbology: 'CODE128', isPrimary: true })]);
  });

  it("'update' changes the product in place instead of failing on the duplicate", async () => {
    as(A);
    const r = await importFile('product', csv('product', [{ code: P2, name: 'Steam iron', category: CAT, unit: UNIT, product_type: 'standard', default_price: '850' }]), 'update');
    expect(r).toMatchObject({ committedRows: 1, failedRows: 0 });
    const rows = await db.product.findMany({ where: { companyId: COMPANY_A, code: P2 } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Steam iron' });
    expect(rows[0].defaultPrice.toString()).toBe('850');
    expect(rows[0].referenceCost.toString()).toBe('600'); // an empty cell keeps the stored value
  });

  it("'skip' and 'fail' behave as before on a duplicate", async () => {
    as(A);
    const content = csv('product', [{ code: P1, name: 'Changed', category: CAT, unit: UNIT, product_type: 'standard' }]);
    expect(await importFile('product', content, 'skip')).toMatchObject({ committedRows: 0, skippedRows: 1 });
    expect(await importFile('product', content, 'fail')).toMatchObject({ committedRows: 0, failedRows: 1, status: 'failed' });
    expect((await db.product.findFirstOrThrow({ where: { companyId: COMPANY_A, code: P1 } })).name).toBe('Fan');
  });

  it('sets the customer group by name, and names a missing group', async () => {
    as(A);
    const group = await db.customerGroup.create({ data: { companyId: COMPANY_A, name: `VIP ${R}` } });
    const phone = `018${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const r = await importFile('customer', csv('customer', [
      { name: 'Karim', phone, customer_group: `VIP ${R}` },
      { name: 'Nobody', phone: `${phone}9`, customer_group: `Missing ${R}` },
    ]));
    expect(r).toMatchObject({ committedRows: 1, failedRows: 1 });
    expect((await db.customer.findFirstOrThrow({ where: { companyId: COMPANY_A, phone } })).customerGroupId).toBe(group.id);
    const error = await db.importJobError.findFirstOrThrow({ where: { importJobId: r.jobId, errorCode: 'INSERT_FAILED' } });
    expect(error.errorMessage).toContain(`Customer group not found: Missing ${R}`);
  });
});

describe('document imports', () => {
  it('opening stock writes the movement, the balance and the batch', async () => {
    as(A);
    const r = await importFile('opening_stock', csv('opening_stock', [
      { warehouse_code: A.whA, product_code: P1, qty: '10', unit_cost: '300' },
      { warehouse_code: A.whA, product_code: P2, qty: '5', unit_cost: '600' },
      { warehouse_code: A.whA, product_code: P3, qty: '20', unit_cost: '50', batch_number: `LOT-${R}`, expiry_date: '2027-06-30' },
    ]));
    expect(r).toMatchObject({ committedRows: 3, failedRows: 0 });
    const wh = await db.warehouse.findFirstOrThrow({ where: { companyId: COMPANY_A, code: A.whA } });
    const p1 = await db.product.findFirstOrThrow({ where: { companyId: COMPANY_A, code: P1 } });
    const stock = await db.warehouseStock.findFirstOrThrow({ where: { companyId: COMPANY_A, warehouseId: wh.id, productId: p1.id } });
    expect(stock.qtyOnHand.toString()).toBe('10');
    expect(stock.movingAverageCost.toString()).toBe('300');
    expect(await db.stockMovement.count({ where: { companyId: COMPANY_A, warehouseId: wh.id, movementType: 'opening_stock' } })).toBe(3);
    const p3 = await db.product.findFirstOrThrow({ where: { companyId: COMPANY_A, code: P3 } });
    const batch = await db.productBatch.findFirstOrThrow({ where: { companyId: COMPANY_A, warehouseId: wh.id, productId: p3.id } });
    expect(batch).toMatchObject({ batchNo: `LOT-${R}` });
    expect(batch.qtyOnHand.toString()).toBe('20');
  });

  it('a sale file posts one sale per reference, with stock and payment, and never twice', async () => {
    as(A);
    const ref = `S-${R}`;
    const content = csv('sale_draft', [
      { reference_no: ref, branch_code: A.branchCode, product_code: P1, qty: '2', unit_price: '500', payment_method: 'cash', payment_amount: '1000' },
      { reference_no: ref, branch_code: A.branchCode, product_code: P2, qty: '1', unit_price: '850', payment_method: 'cash', payment_amount: '850' },
    ]);
    const r = await importFile('sale_draft', content);
    expect(r).toMatchObject({ committedRows: 2, failedRows: 0 });
    expect(r.documents).toHaveLength(1);
    const sale = await db.sale.findUniqueOrThrow({ where: { id: r.documents![0].entityId }, include: { items: true } });
    expect(sale.referenceNo).toBe(r.documents![0].referenceNo);
    expect(sale.referenceNo).not.toBe(ref); // the number is generated; the file's reference is the grouping key
    expect(sale.items).toHaveLength(2);
    expect(sale.grandTotal.toString()).toBe('1850');
    const wh = await db.warehouse.findFirstOrThrow({ where: { companyId: COMPANY_A, code: A.whA } });
    const p1 = await db.product.findFirstOrThrow({ where: { companyId: COMPANY_A, code: P1 } });
    expect((await db.warehouseStock.findFirstOrThrow({ where: { companyId: COMPANY_A, warehouseId: wh.id, productId: p1.id } })).qtyOnHand.toString()).toBe('8');
    expect(await db.stockMovement.count({ where: { companyId: COMPANY_A, referenceId: sale.id, movementType: 'sale_issue' } })).toBe(2);
    const paid = await db.paymentAllocation.aggregate({ where: { companyId: COMPANY_A, saleId: sale.id }, _sum: { allocatedAmount: true } });
    expect(paid._sum.allocatedAmount?.toString()).toBe('1850');

    // The same file again: nothing new.
    const again = await importFile('sale_draft', content);
    expect(again).toMatchObject({ committedRows: 0, skippedRows: 2 });
    expect(await db.importJobEntity.count({ where: { companyId: COMPANY_A, jobType: 'sale_draft', sourceKey: ref } })).toBe(1);
  });

  it('a sale with a bad line is not imported at all', async () => {
    as(A);
    const ref = `S2-${R}`;
    const up = await upload('sale_draft', csv('sale_draft', [
      { reference_no: ref, branch_code: A.branchCode, product_code: P1, qty: '1', unit_price: '500' },
      { reference_no: ref, branch_code: A.branchCode, product_code: P1, qty: 'two', unit_price: '500' },
    ]));
    const done = await commit(up.body.job.id, csv('sale_draft', [
      { reference_no: ref, branch_code: A.branchCode, product_code: P1, qty: '1', unit_price: '500' },
      { reference_no: ref, branch_code: A.branchCode, product_code: P1, qty: 'two', unit_price: '500' },
    ]));
    expect(done.body).toMatchObject({ committedRows: 0, failedRows: 2, status: 'failed' });
    expect(await db.importJobEntity.count({ where: { companyId: COMPANY_A, sourceKey: ref } })).toBe(0);
  });

  it('a purchase file creates a draft order and moves no stock', async () => {
    as(A);
    const supplierName = `Supplier ${R}`;
    await importFile('supplier', csv('supplier', [{ name: supplierName }]));
    const before = await db.stockMovement.count({ where: { companyId: COMPANY_A } });
    const r = await importFile('purchase', csv('purchase', [
      { supplier_name: supplierName, branch_code: A.branchCode, product_code: P1, qty: '4', unit_cost: '290', reference_no: `P-${R}` },
      { supplier_name: supplierName, branch_code: A.branchCode, product_code: P2, qty: '2', unit_cost: '590', reference_no: `P-${R}` },
    ]));
    expect(r).toMatchObject({ committedRows: 2, failedRows: 0 });
    const purchase = await db.purchase.findUniqueOrThrow({ where: { id: r.documents![0].entityId }, include: { items: true } });
    expect(purchase.orderStatus).toBe('draft');
    expect(purchase.items).toHaveLength(2);
    expect(purchase.grandTotal.toString()).toBe('2340');
    expect(await db.stockMovement.count({ where: { companyId: COMPANY_A } })).toBe(before);
  });

  it('a transfer file creates a pending transfer through the transfer command', async () => {
    as(A);
    const r = await importFile('transfer_draft', csv('transfer_draft', [
      { from_warehouse_code: A.whA, to_warehouse_code: A.whB, product_code: P1, qty: '1', reference_no: `T-${R}` },
      { from_warehouse_code: A.whA, to_warehouse_code: A.whB, product_code: P1, qty: '2', reference_no: `T-${R}` },
    ]));
    expect(r).toMatchObject({ committedRows: 2, failedRows: 0 });
    const transfer = await db.transfer.findUniqueOrThrow({ where: { id: r.documents![0].entityId }, include: { items: true } });
    expect(transfer.status).toBe('pending');
    expect(transfer.items).toHaveLength(1); // one line per product
    expect(transfer.items[0].qtyRequested.toString()).toBe('3');
  });
});

describe('export and round trip', () => {
  it('exports products in import format, and an edited file imports back', async () => {
    as(A);
    const out = await exportCsv('product');
    expect(out.status).toBe(200);
    const rows = parseCsv(out.text);
    expect(rows[0]).toEqual(getTemplateHeader('product'));
    const header = rows[0];
    const p1Row = rows.find(row => row[0] === P1)!;
    expect(p1Row[header.indexOf('reference_cost')]).toBe(''); // sensitive, not asked for
    expect(p1Row[header.indexOf('barcode')]).toBe(`BC1-${R}`);

    // Edit the price of one product and import the file back with 'update'.
    p1Row[header.indexOf('default_price')] = '525';
    const edited = generateCsv([header, p1Row], { escapeFormulas: false });
    const r = await importFile('product', edited, 'update');
    expect(r).toMatchObject({ committedRows: 1, failedRows: 0 });
    const products = await db.product.findMany({ where: { companyId: COMPANY_A, code: P1 } });
    expect(products).toHaveLength(1);
    expect(products[0].defaultPrice.toString()).toBe('525');
    expect(products[0].referenceCost.toString()).toBe('300');
  });

  it("one company's export never holds another company's rows", async () => {
    as(B);
    const out = await exportCsv('product');
    expect(out.status).toBe(200);
    expect(out.text).not.toContain(P1);
    // B imports the same code: it gets its own product, A's is untouched.
    await importFile('category', csv('category', [{ code: CAT, name: `Cat ${R}` }]));
    await importFile('unit', csv('unit', [{ code: UNIT, name: `Unit ${R}` }]));
    await importFile('product', csv('product', [{ code: P1, name: 'B fan', category: CAT, unit: UNIT, product_type: 'standard' }]), 'update');
    expect((await db.product.findFirstOrThrow({ where: { companyId: COMPANY_A, code: P1 } })).name).toBe('Fan');
    expect((await db.product.findFirstOrThrow({ where: { companyId: COMPANY_B, code: P1 } })).name).toBe('B fan');
  });

  it('sensitive columns need a fresh MFA check', async () => {
    as(A);
    const issued = await issueRefreshToken({ companyId: COMPANY_A, userId: A.userId, mfaVerified: false, mfaVerifiedAt: null });
    jar.access = await issueAccessToken({ sub: A.userId, company_id: COMPANY_A, scope: 'global', is_global: false, branch_ids: [],
      session_id: issued.sessionId ?? randomUUID(), family_id: issued.familyId, mfa_verified: true });
    const refused = await exportCsv('customer', true);
    expect(refused.status).toBe(403);
    expect(JSON.parse(refused.text).error.code).toBe('INVALID_MFA');

    const fresh = await issueRefreshToken({ companyId: COMPANY_A, userId: A.userId, mfaVerified: true, mfaVerifiedAt: new Date() });
    jar.access = await issueAccessToken({ sub: A.userId, company_id: COMPANY_A, scope: 'global', is_global: false, branch_ids: [],
      session_id: fresh.sessionId ?? randomUUID(), family_id: fresh.familyId, mfa_verified: true });
    const allowed = await exportCsv('customer', true);
    expect(allowed.status).toBe(200);
    expect(parseCsv(allowed.text)[0]).toEqual(getTemplateHeader('customer'));
  });

  it('writes audit rows for an import commit and an export, without row contents', async () => {
    const commitAudit = await db.auditLog.findFirstOrThrow({ where: { companyId: COMPANY_A, action: 'import.commit' }, orderBy: { occurredAt: 'desc' } });
    expect(JSON.parse(commitAudit.afterValue!)).toMatchObject({ file_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(commitAudit.afterValue).not.toContain('Fan');
    const exportAudit = await db.auditLog.findFirstOrThrow({ where: { companyId: COMPANY_A, action: 'export.master' } });
    expect(JSON.parse(exportAudit.afterValue!)).toMatchObject({ entity_type: expect.any(String) });
  });
});

describe('limits and dry runs', () => {
  it(`rejects a file of more than ${MAX_IMPORT_ROWS} rows at validation`, async () => {
    as(A);
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ name: `Bulk ${i}` }));
    const up = await upload('brand', csv('brand', rows));
    expect(up.body.job.status).toBe('invalid');
    const error = await db.importJobError.findFirstOrThrow({ where: { importJobId: up.body.job.id } });
    expect(error.errorCode).toBe('ROW_LIMIT_EXCEEDED');
  }, 60_000);

  it('a dry-run job can never be committed', async () => {
    as(A);
    const content = csv('brand', [{ name: `Dry ${R}` }]);
    const up = await upload('brand', content, { dryRun: true });
    expect(up.body.job.status).toBe('ready');
    const done = await commit(up.body.job.id, content);
    expect(done.status).toBe(409);
    expect(await db.brand.count({ where: { companyId: COMPANY_A, name: `Dry ${R}` } })).toBe(0);
  });

  it('refuses a strategy the template does not support', async () => {
    as(A);
    const up = await upload('sale_draft', csv('sale_draft', [{ reference_no: 'x' }]), { strategy: 'update' });
    expect(up.status).toBe(400);
  });
});
