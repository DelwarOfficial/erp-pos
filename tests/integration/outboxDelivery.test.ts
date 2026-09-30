// F-45: an outbox event is delivered once per endpoint even with several
// runners, an endpoint that already has it is not sent it again, and the event
// is published only when every endpoint has it. Disposable MariaDB; HTTP mocked.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { encryptString } from '@/lib/crypto';
import { ensureSyntheticIssuerTenant } from './helpers/disposableFixtures';

const post = vi.fn();
vi.mock('@/lib/integrations/outboundUrl', () => ({ postToOutboundUrl: (...args: unknown[]) => post(...args) }));
const { processOutboxBatch, OUTBOX_LEASE_MS } = await import('@/workers/outboxWorker');

const db = new PrismaClient();
const A: string = randomUUID();
let fx: Awaited<ReturnType<typeof ensureSyntheticIssuerTenant>>;
// Events are due in the year 2000, and runs are dated then, so only this
// file's events are picked up from the shared database.
const T0 = new Date('2000-01-01T00:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

async function endpoint(url: string) {
  return db.webhookEndpoint.create({ data: { companyId: A, url, secretCiphertext: new Uint8Array(encryptString('whsec_test').ciphertext), subscribedEvents: '["sale.posted"]', createdBy: fx.user.id } });
}
async function event() {
  const business = await db.businessEvent.create({ data: { companyId: A, eventType: 'sale.posted', sourceType: 'sale', sourceId: randomUUID(), correlationId: randomUUID() } });
  return db.outboxEvent.create({ data: { companyId: A, businessEventId: business.id, eventName: 'sale.posted', aggregateType: 'sale', aggregateId: business.sourceId, payload: '{"x":1}', nextAttemptAt: T0 } });
}

beforeAll(async () => {
  fx = await ensureSyntheticIssuerTenant(db, { companyId: A, label: 'OB', code: `SYN-OB-${A.slice(0, 8)}` });
}, 120_000);
afterAll(async () => {
  // Keep the shared database free of due-in-2000 events for later runs.
  await db.outboxEvent.updateMany({ where: { companyId: A, status: 'pending' }, data: { status: 'skipped' } });
  await db.$disconnect();
});

describe('outbox delivery', () => {
  it('two runners at once deliver each endpoint once', async () => {
    await endpoint('https://a.example.com/hook');
    const e = await event();
    post.mockReset();
    post.mockImplementation(async () => { await new Promise(r => setTimeout(r, 50)); return { ok: true, status: 200, body: 'ok' }; });
    await Promise.all([processOutboxBatch(at(1000)), processOutboxBatch(at(1000))]);
    expect(post).toHaveBeenCalledTimes(1);
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: e.id } })).status).toBe('published');
  });

  it('retries only the endpoint that failed, and publishes when all have it', async () => {
    await db.webhookEndpoint.updateMany({ where: { companyId: A }, data: { status: 'disabled' } });
    const good = await endpoint('https://good.example.com/hook');
    await endpoint('https://flaky.example.com/hook');
    const e = await event();
    post.mockReset();
    post.mockImplementation(async (url: string) => (url.includes('flaky') ? { ok: false, status: 503, body: 'busy' } : { ok: true, status: 200, body: 'ok' }));
    await processOutboxBatch(at(1000));
    let row = await db.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
    expect(row).toMatchObject({ status: 'pending', attemptCount: 1 });
    expect(post).toHaveBeenCalledTimes(2);

    // Next attempt: the flaky endpoint recovers; the good one is not sent it again.
    post.mockReset();
    post.mockResolvedValue({ ok: true, status: 200, body: 'ok' });
    await db.outboxEvent.update({ where: { id: e.id }, data: { nextAttemptAt: at(2000) } });
    await processOutboxBatch(at(3000));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toContain('flaky');
    row = await db.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.status).toBe('published');
    expect(await db.webhookDelivery.count({ where: { outboxEventId: e.id, webhookEndpointId: good.id } })).toBe(1);
  });

  it('a claimed event is left alone until its lease expires', async () => {
    await db.webhookEndpoint.updateMany({ where: { companyId: A }, data: { status: 'disabled' } });
    await endpoint('https://c.example.com/hook');
    const e = await event();
    // Claimed by a runner that then crashed.
    await db.outboxEvent.update({ where: { id: e.id }, data: { nextAttemptAt: at(1000 + OUTBOX_LEASE_MS) } });
    post.mockReset();
    post.mockResolvedValue({ ok: true, status: 200, body: 'ok' });
    await processOutboxBatch(at(1000));
    expect(post).not.toHaveBeenCalled();
    await processOutboxBatch(at(2000 + OUTBOX_LEASE_MS));
    expect(post).toHaveBeenCalledTimes(1);
  });
});
