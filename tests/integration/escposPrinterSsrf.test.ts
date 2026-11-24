// Red-team workstream 3: GET /api/v1/print/escpos/{saleId}?printer=host:port
// opened a raw TCP socket to any host. The parameter is now refused before any
// socket or database work, and the receipt bytes still download.
// Disposable MariaDB; only the session is stubbed.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import net from 'node:net';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const auth = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/auth/middleware', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/auth/middleware')>()),
  authenticateRequest: async () => auth.current,
}));
import { GET } from '@/app/api/v1/print/escpos/[saleId]/route';
import * as escpos from '@/lib/escpos';
import { postSale } from '@/domain/commands/m3/PostSale';
import { withTenant } from '@/lib/db/transaction';

const db = new PrismaClient();
const COMPANY_ID = 'e3c7a2b1-2c33-4e5f-9a41-7c8d9e0f1a23';
let saleId: string;

const get = (id: string, query = '') => GET(new NextRequest(`http://local.test/api/v1/print/escpos/${id}${query}`), { params: Promise.resolve({ saleId: id }) });

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (target.hostname !== '127.0.0.1' || target.port !== '43318' || target.pathname !== '/readiness_20260912_disposable') {
    throw new Error('Only the known local synthetic disposable MariaDB is permitted');
  }
  const fx = await ensureSyntheticIssuerTenant(db, { companyId: COMPANY_ID, label: 'PR', code: 'SYN-PR' });
  const perm = await db.permission.findFirstOrThrow({ where: { code: 'sale.read' } });
  const role = await db.role.create({ data: { companyId: COMPANY_ID, name: `reader-${randomUUID().slice(0, 6)}`, permissions: { create: [{ permissionId: perm.id }] } } });
  const user = await db.user.create({ data: { companyId: COMPANY_ID, name: 'Reader', email: `${randomUUID()}@example.invalid`, passwordHash: 'x', accessScope: 'global', roles: { create: { roleId: role.id } } } });
  auth.current = { userId: user.id, companyId: COMPANY_ID, branchIds: [], accessScope: 'global', isGlobal: false,
    ctx: { companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, userId: user.id, correlationId: randomUUID(), requestId: randomUUID() } };
  const warehouseId = (await db.warehouse.create({ data: { companyId: COMPANY_ID, branchId: fx.branches[0].id, name: `PR-${randomUUID().slice(0, 6)}`, code: `PR${randomUUID().slice(0, 4)}` } })).id;
  const category = await db.category.create({ data: { companyId: COMPANY_ID, name: `PR-${randomUUID().slice(0, 6)}`, code: `PR${randomUUID().slice(0, 4)}` } });
  const unit = await db.unit.create({ data: { companyId: COMPANY_ID, name: `Piece-${randomUUID().slice(0, 6)}`, code: `PR${randomUUID().slice(0, 4)}` } });
  const productId = (await db.product.create({ data: { companyId: COMPANY_ID, name: 'Service plan', code: `PR-${randomUUID().slice(0, 6)}`, productType: 'service', categoryId: category.id, unitId: unit.id } })).id;
  const ctx = { companyId: COMPANY_ID, branchIds: [], allBranches: true, isGlobal: false, userId: undefined, correlationId: randomUUID(), requestId: randomUUID() } as never;
  saleId = (await withTenant(ctx, t => postSale(t, { companyId: COMPANY_ID, branchId: fx.branches[0].id, warehouseId, cashierId: user.id,
    currencyCode: 'BDT', exchangeRate: 1, businessDate: new Date(), items: [{ productId, qty: 1, unitPrice: 500 }],
    payments: [{ paymentMethod: 'cash', amount: 500, financialAccountId: fx.cash.id }] } as never, randomUUID()))).saleId;
}, 120_000);
afterEach(() => vi.restoreAllMocks());
afterAll(() => db.$disconnect());

describe('ESC/POS print route', () => {
  it.each(['127.0.0.1:81', '169.254.169.254:80', '10.0.0.5:9100', 'printer.example.com', ''])(
    'refuses printer=%s before opening a socket', async host => {
      const connect = vi.spyOn(net.Socket.prototype, 'connect');
      const res = await get(saleId, `?printer=${encodeURIComponent(host)}`);
      expect(res.status).toBe(400);
      expect(connect).not.toHaveBeenCalled();
    });

  it('refuses the parameter before reading the sale', async () => {
    expect((await get(randomUUID(), '?printer=127.0.0.1:81')).status).toBe(400);
  });

  it('still returns the receipt bytes, without any socket', async () => {
    const connect = vi.spyOn(net.Socket.prototype, 'connect');
    const res = await get(saleId);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(50);
    expect(connect).not.toHaveBeenCalled();
  });

  it('no longer offers a network-printer sender', () => {
    expect('sendToNetworkPrinter' in escpos).toBe(false);
  });
});
