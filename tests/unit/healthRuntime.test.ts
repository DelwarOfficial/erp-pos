import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const probes = vi.hoisted(() => ({ count: vi.fn(), connect: vi.fn(), ping: vi.fn(), disconnect: vi.fn(), head: vi.fn(), get: vi.fn() }));
vi.mock('@prisma/client', () => ({ PrismaClient: class { currency = { count: probes.count }; } }));
vi.mock('@/lib/db/tenantClient', () => ({ applyTenantIsolation: (client: unknown) => client }));
vi.mock('ioredis', () => ({ default: class {
  connect = probes.connect; ping = probes.ping; disconnect = probes.disconnect; get = probes.get;
  on() { return this; }
} }));
vi.mock('@/lib/storage', () => ({ getStorage: () => ({ headObject: probes.head }) }));

describe('safe runtime health probes', () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:1');
    vi.stubEnv('S3_BUCKET', ''); vi.stubEnv('DISABLE_S3_HEALTH', 'true');
    probes.count.mockResolvedValue(1); probes.connect.mockResolvedValue(undefined);
    probes.ping.mockResolvedValue('PONG'); probes.get.mockResolvedValue(null); probes.head.mockResolvedValue({ exists: false });
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

  // F-70: the worker was reported 'skipped' unconditionally, so a dead worker
  // left /api/v1/health at 200.
  describe('worker liveness where the worker is required', () => {
    beforeEach(() => { vi.stubEnv('NODE_ENV', 'production'); });

    it('is healthy while the heartbeat is fresh', async () => {
      probes.get.mockResolvedValue(String(Date.now() - 5_000));
      const { getRuntimeHealth } = await import('@/lib/health/runtime');
      expect(await getRuntimeHealth()).toMatchObject({ status: 'ok', checks: { worker: 'ok' } });
    });

    it('degrades when the worker has stopped beating', async () => {
      probes.get.mockResolvedValue(null); // key expired: worker stopped
      const { getRuntimeHealth } = await import('@/lib/health/runtime');
      expect(await getRuntimeHealth()).toMatchObject({ status: 'degraded', checks: { database: 'ok', redis: 'ok', worker: 'fail' } });
    });

    it('degrades on a stale heartbeat', async () => {
      probes.get.mockResolvedValue(String(Date.now() - 61_000));
      const { getRuntimeHealth } = await import('@/lib/health/runtime');
      expect(await getRuntimeHealth()).toMatchObject({ status: 'degraded', checks: { worker: 'fail' } });
    });

    it('does not claim a healthy worker when the heartbeat cannot be read', async () => {
      probes.get.mockRejectedValue(new Error('sensitive-redis-diagnostic'));
      const { getRuntimeHealth } = await import('@/lib/health/runtime');
      const result = await getRuntimeHealth();
      expect(result).toMatchObject({ status: 'degraded', checks: { worker: 'unknown' } });
      expect(JSON.stringify(result)).not.toContain('sensitive-redis-diagnostic');
    });

    it('turns the public probe to 503', async () => {
      const { GET } = await import('@/app/api/v1/health/route');
      const response = await GET();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: 'degraded', service: 'erp-pos' });
    });
  });
});
