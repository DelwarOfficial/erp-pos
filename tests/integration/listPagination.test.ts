// F-72 regression: list endpoints that returned every row.
//
// Twenty routes read reference data with findMany and no limit. They now page
// with a cursor: the default page is the maximum (the UI fetches them without
// parameters to fill dropdowns), and every response says whether more remain.
// This runs the real tax-components route against the disposable MariaDB with
// 2,500 components -- sorted by type and calculation order, which almost all
// share, so only the id tie-break makes the order total -- and a second company
// alongside. Only authentication is stubbed.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const A = randomUUID();
const B = randomUUID();
const TOTAL = 2_500;

const auth = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: async () => auth.current,
  requirePermission: async () => undefined,
}));

const db = new PrismaClient();
const asCompany = (companyId: string) => {
  auth.current = {
    companyId, userId: randomUUID(), isGlobal: false,
    ctx: { companyId, branchIds: [], allBranches: true, isGlobal: false, correlationId: randomUUID(), requestId: randomUUID() },
  };
};
const get = async (query = '') => {
  const { GET } = await import('@/app/api/v1/tax-components/route');
  return GET(new NextRequest(`http://localhost/api/v1/tax-components${query}`));
};

beforeAll(async () => {
  await ensureSyntheticIssuerTenant(db, { companyId: A, label: 'LP', code: `SYN-LPA-${A.slice(0, 8)}` });
  await ensureSyntheticIssuerTenant(db, { companyId: B, label: 'LQ', code: `SYN-LPB-${B.slice(0, 8)}` });
  // One type, three calculation orders: the sort key alone is not a total order.
  await db.$executeRawUnsafe(`
    INSERT INTO tax_components (id, company_id, component_code, name, component_type, calculation_order, effective_from)
    SELECT CONCAT(?, seq), ?, CONCAT('C', seq), CONCAT('Component ', seq), 'vat', 1 + seq % 3, '2026-01-01' FROM seq_1_to_${TOTAL}`,
  `lp-${A.slice(0, 8)}-`, A);
  await db.taxComponent.create({ data: { companyId: B, componentCode: 'OTHER', name: 'Other', componentType: 'vat', effectiveFrom: new Date('2026-01-01') } });
}, 120_000);

afterAll(() => db.$disconnect());

describe('cursor-paged list endpoints', () => {
  it('bounds a request with no parameters, and says more remain', async () => {
    asCompany(A);
    const body = await (await get()).json();
    expect(body.items).toHaveLength(1_000);
    expect(body.has_more).toBe(true);
    expect(body.next_cursor).toBe(body.items[999].id);
  });

  it('pages through every row exactly once, in order, and only this company\'s', async () => {
    asCompany(A);
    const seen: Array<{ id: string; calculation_order: number }> = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const body: { items: Array<{ id: string; calculation_order: number }>; has_more: boolean; next_cursor: string | null } =
        await (await get(`?limit=300${cursor ? `&cursor=${cursor}` : ''}`)).json();
      seen.push(...body.items);
      cursor = body.next_cursor;
      pages++;
    } while (cursor);

    expect(pages).toBe(Math.ceil(TOTAL / 300));
    expect(seen).toHaveLength(TOTAL);
    expect(new Set(seen.map(c => c.id)).size).toBe(TOTAL);
    expect(seen.every(c => c.id.startsWith(`lp-${A.slice(0, 8)}-`))).toBe(true);
    // Calculation order, then id: the sequence the route promises.
    const sorted = [...seen].sort((x, y) => x.calculation_order - y.calculation_order || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    expect(seen.map(c => c.id)).toEqual(sorted.map(c => c.id));
  });

  it('returns a small list whole, with nothing more to fetch', async () => {
    asCompany(B);
    const body = await (await get()).json();
    expect(body).toMatchObject({ has_more: false, next_cursor: null });
    expect(body.items.map((c: { component_code: string }) => c.component_code)).toEqual(['OTHER']);
  });

  it.each([['?limit=0'], ['?limit=1001'], ['?limit=abc'], ['?cursor=%27%20OR%201%3D1']])('rejects %s', async query => {
    asCompany(A);
    expect((await get(query)).status).toBe(400);
  });
});
