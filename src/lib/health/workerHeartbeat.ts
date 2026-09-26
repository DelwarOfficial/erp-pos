// Worker liveness for the health check.
//
// The worker process (src/workers/index.ts) runs outbox delivery,
// reconciliation, retention, reservation expiry and campaigns. The health
// check probed the database, Redis and storage but reported the worker as
// 'skipped' unconditionally, so the worker could be dead for days while
// /api/v1/health returned 200.
//
// The worker now writes a heartbeat to Redis while every one of its BullMQ
// workers is running. The key carries a TTL, so a worker that crashes, hangs or
// is stopped stops refreshing it and the key disappears; the health check reads
// it and reports the worker as failed, which degrades overall health.

export const WORKER_HEARTBEAT_KEY = 'erp:health:worker-heartbeat';
export const WORKER_HEARTBEAT_INTERVAL_MS = 15_000;
/** Four missed beats: tolerant of a slow tick, quick to notice a dead worker. */
export const WORKER_HEARTBEAT_STALE_MS = 60_000;

interface HeartbeatWriter {
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}
interface HeartbeatReader {
  get(key: string): Promise<string | null>;
}

/** One beat. Written only when every worker reports running. */
export async function writeWorkerHeartbeat(redis: HeartbeatWriter, workersRunning: boolean, now = Date.now()): Promise<boolean> {
  if (!workersRunning) return false;
  await redis.set(WORKER_HEARTBEAT_KEY, String(now), 'PX', WORKER_HEARTBEAT_STALE_MS);
  return true;
}

/** On a clean shutdown: stop claiming liveness at once rather than after the TTL. */
export async function clearWorkerHeartbeat(redis: HeartbeatWriter): Promise<void> {
  await redis.del(WORKER_HEARTBEAT_KEY);
}

/**
 * The worker must be running wherever it is the only thing delivering the
 * outbox: production with Redis (see startOutboxWorker). Elsewhere delivery runs
 * inside the web process and there is no worker to watch.
 */
export function workerHealthRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WORKER_HEALTH_REQUIRED === 'true' || (env.NODE_ENV === 'production' && Boolean(env.REDIS_URL));
}

export async function readWorkerHealth(redis: HeartbeatReader, now = Date.now()): Promise<'ok' | 'fail'> {
  const value = await redis.get(WORKER_HEARTBEAT_KEY);
  const beat = value === null ? NaN : Number(value);
  if (!Number.isFinite(beat)) return 'fail';
  // The TTL removes a stale key; this also refuses one written with a bad clock.
  return now - beat <= WORKER_HEARTBEAT_STALE_MS && beat - now <= WORKER_HEARTBEAT_STALE_MS ? 'ok' : 'fail';
}
