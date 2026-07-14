// GET /api/v1/health
// Public health check — no auth required. Reports DB + Redis + S3 + worker health.
// Per §16 monitoring requirements (readiness/liveness probes).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getRedisConnection } from '@/lib/queue';
import { getStorage } from '@/lib/storage';

export async function GET() {
  const startedAt = Date.now();
  const version = process.env.APP_VERSION ?? '1.0.0';
  const phase = 'M0-M8+gaps';

  const checks: Record<string, 'ok' | 'fail' | 'skipped'> = {
    database: 'skipped',
    redis: 'skipped',
    storage: 'skipped',
  };
  const details: Record<string, unknown> = {};

  // DB check
  try {
    const start = Date.now();
    await db.currency.count();
    checks.database = 'ok';
    details.database = { response_ms: Date.now() - start };
  } catch (e) {
    checks.database = 'fail';
    details.database = { error: e instanceof Error ? e.message : 'Unknown' };
  }

  // Redis check (skipped if no REDIS_URL — sandbox mode)
  if (process.env.REDIS_URL) {
    try {
      const start = Date.now();
      const redis = getRedisConnection();
      const pong = await redis.ping();
      checks.redis = pong === 'PONG' ? 'ok' : 'fail';
      details.redis = { response_ms: Date.now() - start };
    } catch (e) {
      checks.redis = 'fail';
      details.redis = { error: e instanceof Error ? e.message : 'Unknown' };
    }
  }

  // Storage check (skipped in test env)
  if (process.env.NODE_ENV !== 'test' && !process.env.DISABLE_S3_HEALTH) {
    try {
      const storage = getStorage();
      // headObject returns { exists: false } for any missing key — that's OK,
      // it proves we can talk to the bucket.
      await storage.headObject('__healthcheck__');
      checks.storage = 'ok';
    } catch (e) {
      checks.storage = 'fail';
      details.storage = { error: e instanceof Error ? e.message : 'Unknown' };
    }
  }

  const allOk = Object.values(checks).every((v) => v === 'ok' || v === 'skipped');
  const status = allOk ? 'ok' : 'degraded';

  return NextResponse.json(
    {
      status,
      service: 'erp-pos',
      phase,
      version,
      checks,
      details,
      response_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 },
  );
}
