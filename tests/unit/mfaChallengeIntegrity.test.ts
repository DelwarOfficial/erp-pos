import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  type Row = { id: string; companyId: string; userId: string; action: string; challenge: string;
    createdAt: Date; expiresAt: Date; consumedAt: Date | null };
  const rows = new Map<string, Row>();
  const matches = (row: Row | undefined, where: any) => !!row
    && row.companyId === where.companyId && row.userId === where.userId
    && row.action === where.action && row.challenge === where.challenge
    && row.consumedAt === null && row.expiresAt > where.expiresAt.gt
    && row.createdAt.getTime() === where.createdAt.getTime();
  return { rows, delegate: {
    create: vi.fn(async ({ data }: any) => { rows.set(data.id, { ...data, consumedAt: null }); return { id: data.id }; }),
    findFirst: vi.fn(async ({ where }: any) => matches(rows.get(where.id), where) ? { id: where.id } : null),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const row = rows.get(where.id);
      if (!matches(row, where)) return { count: 0 };
      rows.set(where.id, { ...row!, consumedAt: data.consumedAt });
      return { count: 1 };
    }),
  } };
});
vi.mock('@/lib/db', () => ({ systemDb: { webAuthnChallenge: store.delegate } }));
import { issueMfaChallenge, readMfaChallenge, consumeMfaChallenge } from '@/lib/auth/mfaChallenge';

const identity = { userId: 'synthetic-user', companyId: 'tenant-a', familyId: 'synthetic-family' };

describe('password-to-MFA challenge integrity', () => {
  beforeEach(() => { store.rows.clear(); vi.clearAllMocks(); });

  it('rejects unsigned JSON before any persistence lookup', async () => {
    expect(await readMfaChallenge(JSON.stringify(identity)) === null).toBe(true);
    expect(store.delegate.findFirst).not.toHaveBeenCalled();
  });

  for (const field of ['userId', 'companyId', 'purpose', 'familyId']) {
    it(`rejects tampered ${field}`, async () => {
      const value = await issueMfaChallenge(identity);
      const [body, signature] = value.split('.');
      const data = JSON.parse(Buffer.from(body, 'base64url').toString());
      data[field] = 'tampered';
      const altered = `${Buffer.from(JSON.stringify(data)).toString('base64url')}.${signature}`;
      expect(await readMfaChallenge(altered) === null).toBe(true);
    });
  }

  it('rejects a signed challenge without a server record', async () => {
    const value = await issueMfaChallenge(identity);
    store.rows.clear();
    expect(await readMfaChallenge(value) === null).toBe(true);
  });

  it('rejects expired server state', async () => {
    const value = await issueMfaChallenge(identity);
    for (const row of store.rows.values()) row.expiresAt = new Date(0);
    expect(await readMfaChallenge(value) === null).toBe(true);
  });

  it('requires the same database purpose', async () => {
    const value = await issueMfaChallenge(identity);
    for (const row of store.rows.values()) row.action = 'registration';
    expect(await readMfaChallenge(value) === null).toBe(true);
  });

  it('accepts valid state once and rejects replay', async () => {
    const value = await issueMfaChallenge(identity);
    const payload = await readMfaChallenge(value);
    expect(payload !== null).toBe(true);
    await consumeMfaChallenge(payload!);
    expect(await readMfaChallenge(value) === null).toBe(true);
    await expect(consumeMfaChallenge(payload!)).rejects.toMatchObject({ httpStatus: 401 });
  });

  it('allows one winner for competing consumptions (CAS contract, not DB concurrency proof)', async () => {
    const payload = await readMfaChallenge(await issueMfaChallenge(identity));
    const results = await Promise.allSettled([consumeMfaChallenge(payload!), consumeMfaChallenge(payload!)]);
    expect(results.filter(r => r.status === 'fulfilled').length).toBe(1);
  });
});
