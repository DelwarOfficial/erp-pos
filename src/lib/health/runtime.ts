import { PrismaClient } from '@prisma/client';
import { applyTenantIsolation } from '@/lib/db/tenantClient';
import IORedis from 'ioredis';
import { getStorage } from '@/lib/storage';
import packageInfo from '../../../package.json';
import { healthResponseSchema, overallHealth, type HealthResponse } from './contract';

// Dedicated quiet probe connection. Preserve tenant guards; Currency is shared
// reference data. The normal client logs raw Prisma exceptions on failure.
const db = applyTenantIsolation(new PrismaClient({ log: [] }));

async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Health check timed out')), 2000);
    })]);
  } finally { clearTimeout(timer); }
}
async function checkRuntime(): Promise<HealthResponse> {
  const started = Date.now();
  const checks: HealthResponse['checks'] = { database: 'unknown', redis: 'unknown', storage: 'skipped', worker: 'skipped' };
  const details: HealthResponse['details'] = {};
  await Promise.all([
    (async () => {
      const start = Date.now();
      try { await bounded(db.currency.count()); checks.database = 'ok'; } catch { checks.database = 'fail'; }
      details.database = { response_ms: Date.now() - start };
    })(),
    (async () => {
      const start = Date.now();
      if (!process.env.REDIS_URL) { checks.redis = 'fail'; return; }
      const redis = new IORedis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 1500,
        commandTimeout: 1500, maxRetriesPerRequest: 0, retryStrategy: () => null, enableOfflineQueue: false });
      // No raw connection/error logging from this dedicated probe connection.
      redis.on('error', () => undefined);
      try { await bounded(redis.connect()); checks.redis = await bounded(redis.ping()) === 'PONG' ? 'ok' : 'fail'; }
      catch { checks.redis = 'fail'; }
      finally { redis.disconnect(); details.redis = { response_ms: Date.now() - start }; }
    })(),
    (async () => {
      if (process.env.DISABLE_S3_HEALTH === 'true' || !process.env.S3_BUCKET) return;
      const start = Date.now();
      try { await bounded(getStorage().headObject('__healthcheck__')); checks.storage = 'ok'; }
      catch { checks.storage = 'fail'; }
      details.storage = { response_ms: Date.now() - start };
    })(),
  ]);
  return healthResponseSchema.parse({ status: overallHealth(checks), service: 'erp-pos', checks, details,
    version: packageInfo.version, response_ms: Date.now() - started, timestamp: new Date().toISOString(), uptime_seconds: Math.floor(process.uptime()) });
}
// Share/throttle runtime probes, never tenant business data.
let pending: Promise<HealthResponse> | undefined;
let checkedAt = 0;
export function getRuntimeHealth(): Promise<HealthResponse> {
  if (!pending || Date.now() - checkedAt >= 5000) {
    checkedAt = Date.now();
    pending = checkRuntime().catch(() => { pending = undefined; throw new Error('Health check unavailable'); });
  }
  return pending;
}
