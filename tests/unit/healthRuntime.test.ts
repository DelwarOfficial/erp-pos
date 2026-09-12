import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const probes = vi.hoisted(() => ({ count: vi.fn(), connect: vi.fn(), ping: vi.fn(), disconnect: vi.fn(), head: vi.fn() }));
vi.mock('@prisma/client', () => ({ PrismaClient: class { currency = { count: probes.count }; } }));
vi.mock('@/lib/db/tenantClient', () => ({ applyTenantIsolation: (client: unknown) => client }));
vi.mock('ioredis', () => ({ default: class {
  connect = probes.connect; ping = probes.ping; disconnect = probes.disconnect;
  on() { return this; }
} }));
vi.mock('@/lib/storage', () => ({ getStorage: () => ({ headObject: probes.head }) }));

describe('safe runtime health probes', () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:1');
    vi.stubEnv('S3_BUCKET', ''); vi.stubEnv('DISABLE_S3_HEALTH', 'true');
    probes.count.mockResolvedValue(1); probes.connect.mockResolvedValue(undefined);
    probes.ping.mockResolvedValue('PONG'); probes.head.mockResolvedValue({ exists: false });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

  it('shares probes and reports unmonitored optional services honestly', async () => {
    const { getRuntimeHealth } = await import('@/lib/health/runtime');
    const results = await Promise.all(Array.from({ length: 10 }, () => getRuntimeHealth()));
    expect(probes.count).toHaveBeenCalledTimes(1);
    expect(probes.disconnect).toHaveBeenCalledTimes(1);
    expect(results[0].status).toBe('ok');
    expect(results[0].checks).toEqual({ database: 'ok', redis: 'ok', storage: 'skipped', worker: 'skipped' });
  });
  it('missing required Redis configuration cannot report healthy', async () => {
    vi.stubEnv('REDIS_URL', '');
    const { getRuntimeHealth } = await import('@/lib/health/runtime');
    expect(await getRuntimeHealth()).toMatchObject({ status: 'unavailable', checks: { redis: 'fail' } });
    expect(probes.connect).not.toHaveBeenCalled();
  });
  it('database failure is unavailable without returning raw errors', async () => {
    probes.count.mockRejectedValue(new Error('sensitive-database-diagnostic'));
    const { getRuntimeHealth } = await import('@/lib/health/runtime');
    const result = await getRuntimeHealth();
    expect(result).toMatchObject({ status: 'unavailable', checks: { database: 'fail' } });
    expect(JSON.stringify(result)).not.toContain('sensitive-database-diagnostic');
  });
  it('Redis failure closes its probe connection and hides diagnostics', async () => {
    probes.connect.mockRejectedValue(new Error('sensitive-redis-diagnostic'));
    const { getRuntimeHealth } = await import('@/lib/health/runtime');
    const result = await getRuntimeHealth();
    expect(result).toMatchObject({ status: 'unavailable', checks: { redis: 'fail' } });
    expect(probes.disconnect).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('sensitive-redis-diagnostic');
  });
  it('optional storage failure degrades rather than inventing a database outage', async () => {
    vi.stubEnv('S3_BUCKET', 'synthetic'); vi.stubEnv('DISABLE_S3_HEALTH', 'false');
    probes.head.mockRejectedValue(new Error('sensitive-storage-diagnostic'));
    const { getRuntimeHealth } = await import('@/lib/health/runtime');
    const result = await getRuntimeHealth();
    expect(result).toMatchObject({ status: 'degraded', checks: { database: 'ok', storage: 'fail' } });
    expect(JSON.stringify(result)).not.toContain('sensitive-storage-diagnostic');
  });
  it('a stalled database probe returns a bounded failure', async () => {
    vi.useFakeTimers(); probes.count.mockReturnValue(new Promise(() => undefined));
    const { getRuntimeHealth } = await import('@/lib/health/runtime');
    const pending = getRuntimeHealth();
    await vi.advanceTimersByTimeAsync(2001);
    expect(await pending).toMatchObject({ status: 'unavailable', checks: { database: 'fail' } });
  });
});
