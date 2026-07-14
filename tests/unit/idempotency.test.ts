// tests/unit/idempotency.test.ts
// Tests for the idempotency middleware:
//   - same key + same hash → return stored response (isReplay=true)
//   - same key + different hash → 409 IDEMPOTENCY_KEY_REUSED
//   - first call → executes work and stores response

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { computeRequestHash, withIdempotency } from '../../src/lib/idempotency';
import { buildTenantContext, runInTenantContext } from '../../src/lib/db/transaction';
import { seedPermissions } from '../../src/lib/permissions/catalogue';
import { hashPassword } from '../../src/lib/auth/password';

const db = new PrismaClient();

let companyId: string;
let userId: string;

beforeAll(async () => {
  await db.$connect();
  await seedPermissions();
  // Create test company + user
  const company = await db.company.create({
    data: {
      code: 'TEST-IDEM-' + Date.now(),
      legalName: 'Idempotency Test Co',
      displayName: 'Idempotency Test',
      baseCurrencyCode: 'BDT',
      status: 'active',
    },
  });
  companyId = company.id;
  const user = await db.user.create({
    data: {
      companyId,
      name: 'Test User',
      email: 'test-' + Date.now() + '@idempotency.local',
      passwordHash: await hashPassword('TestPassword123!'),
      accessScope: 'single_branch',
    },
  });
  userId = user.id;
});

afterAll(async () => {
  // Clean up — delete in dependency order
  if (companyId) {
    await db.idempotencyRequest.deleteMany({ where: { companyId } });
    await db.securityEvent.deleteMany({ where: { companyId } });
  }
  if (userId) await db.user.deleteMany({ where: { id: userId } });
  if (companyId) await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

const ctx = () => buildTenantContext({
  companyId,
  userId,
  branchIds: [],
  isGlobal: false,
  correlationId: 'test-' + Math.random().toString(36).slice(2),
});

describe('idempotency', () => {
  it('executes work on first call', async () => {
    const key = 'idem-test-' + Date.now() + '-1';
    const hash = computeRequestHash({ method: 'POST', path: '/test', body: { a: 1 } });

    const result = await runInTenantContext(ctx(), () =>
      withIdempotency(
        { idempotencyKey: key, operation: 'test', requestHash: hash, companyId, userId },
        async () => ({ status: 200, body: { ok: true, n: Math.random() }, resourceType: 'test', resourceId: '1' }),
      ),
    );

    expect(result.isReplay).toBe(false);
    expect(result.status).toBe(200);
    expect((result.body as { ok: boolean }).ok).toBe(true);
  });

  it('replays stored response on same key + same hash', async () => {
    const key = 'idem-test-' + Date.now() + '-2';
    const hash = computeRequestHash({ method: 'POST', path: '/test', body: { a: 1 } });

    // First call
    const first = await runInTenantContext(ctx(), () =>
      withIdempotency(
        { idempotencyKey: key, operation: 'test', requestHash: hash, companyId, userId },
        async () => ({ status: 200, body: { ok: true, n: Math.random() }, resourceType: 'test', resourceId: '1' }),
      ),
    );

    // Second call with same key + hash → should replay
    const second = await runInTenantContext(ctx(), () =>
      withIdempotency(
        { idempotencyKey: key, operation: 'test', requestHash: hash, companyId, userId },
        async () => ({ status: 200, body: { ok: true, n: Math.random() }, resourceType: 'test', resourceId: '1' }),
      ),
    );

    expect(second.isReplay).toBe(true);
    expect(second.body).toEqual(first.body);
  });

  it('rejects same key + different hash with 409', async () => {
    const key = 'idem-test-' + Date.now() + '-3';
    const hash1 = computeRequestHash({ method: 'POST', path: '/test', body: { a: 1 } });
    const hash2 = computeRequestHash({ method: 'POST', path: '/test', body: { a: 2 } });

    // First call
    await runInTenantContext(ctx(), () =>
      withIdempotency(
        { idempotencyKey: key, operation: 'test', requestHash: hash1, companyId, userId },
        async () => ({ status: 200, body: { ok: true }, resourceType: 'test', resourceId: '1' }),
      ),
    );

    // Second call with same key + DIFFERENT hash → 409
    await expect(
      runInTenantContext(ctx(), () =>
        withIdempotency(
          { idempotencyKey: key, operation: 'test', requestHash: hash2, companyId, userId },
          async () => ({ status: 200, body: { ok: true }, resourceType: 'test', resourceId: '1' }),
        ),
      ),
    ).rejects.toThrowError(/Idempotency key was used with a different request body/);

    // Verify a security event was recorded
    const events = await db.securityEvent.findMany({
      where: { companyId, eventType: 'idempotency_key_hash_mismatch' },
    });
    expect(events.length).toBeGreaterThan(0);
  });
});
