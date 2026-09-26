// src/workers/index.ts
// Worker entrypoint — runs as a separate process (Dockerfile.worker) in production.
// Per §1 (BullMQ/Redis) + §5.16 (outbox) + §6 (queue architecture).
//
// In sandbox/dev, the outbox worker runs via setInterval inside the web process.
// In production (NODE_ENV=production + REDIS_URL set), BullMQ workers take over
// and process jobs from queues: outbox, communication, reconciliation, retention, expire-reservations.

import { Worker, type Job } from 'bullmq';
import { getRedisConnection, getQueue, QUEUE_NAMES } from '@/lib/queue';
import { processOutboxBatch } from '@/workers/outboxWorker';
import { runScheduledReconciliation } from '@/lib/reconciliation/scheduler';
import { expireStaleReservations } from '@/lib/inventory/reservationExpiry';
import { processCommunicationCampaign } from '@/lib/communication/campaignProcessor';
import { runRetentionJob } from '@/lib/retention/job';
import { assertProductionSecurityConfig } from '@/lib/config/productionGuards';
import { initWorkerErrorTracking, captureJobFailure, flushWorkerErrorTracking } from '@/workers/sentry';
import { clearWorkerHeartbeat, writeWorkerHeartbeat, WORKER_HEARTBEAT_INTERVAL_MS } from '@/lib/health/workerHeartbeat';

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY ?? '4', 10);

function log(level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, source: 'worker', msg, meta }));
}

export async function startWorkers(): Promise<void> {
  // The worker decrypts webhook secrets and runs retention and reconciliation;
  // it must refuse unsafe production configuration exactly as the web process does.
  assertProductionSecurityConfig();
  // Before any worker exists, so a failure during startup is itself reported.
  const tracking = initWorkerErrorTracking();
  log(tracking ? 'info' : 'warn',
    tracking ? 'Error tracking active' : 'SENTRY_DSN not set: worker failures will be logged but not reported');
  log('info', 'Starting BullMQ workers', { queues: Object.values(QUEUE_NAMES), concurrency: CONCURRENCY });

  // ── Outbox worker — drains outbox_events table and delivers webhooks ──
  const outboxWorker = new Worker(
    QUEUE_NAMES.OUTBOX,
    async (_job: Job) => {
      const count = await processOutboxBatch();
      return { delivered: count };
    },
    { connection: getRedisConnection() as any, concurrency: CONCURRENCY },
  );
  outboxWorker.on('completed', (job) => log('info', 'outbox batch completed', { jobId: job.id }));
  outboxWorker.on('failed', (job, err) => {
    log('error', 'outbox batch failed', { jobId: job?.id, err: err.message });
    captureJobFailure(QUEUE_NAMES.OUTBOX, job?.id, err);
  });

  // ── Communication worker — sends SMS/email/notification batches ──
  const communicationWorker = new Worker(
    QUEUE_NAMES.COMMUNICATION,
    async (job: Job) => processCommunicationCampaign(job.data.campaignId),
    { connection: getRedisConnection() as any, concurrency: CONCURRENCY },
  );
  communicationWorker.on('failed', (job, err) => {
    log('error', 'communication campaign failed', { jobId: job?.id, err: err.message });
    captureJobFailure(QUEUE_NAMES.COMMUNICATION, job?.id, err);
  });

  // ── Reconciliation worker — periodic reconciliation runs ──
  const reconciliationWorker = new Worker(
    QUEUE_NAMES.RECONCILIATION,
    async (_job: Job) => runScheduledReconciliation(),
    { connection: getRedisConnection() as any, concurrency: 1 },
  );
  reconciliationWorker.on('failed', (job, err) => {
    log('error', 'reconciliation failed', { jobId: job?.id, err: err.message });
    captureJobFailure(QUEUE_NAMES.RECONCILIATION, job?.id, err);
  });

  // ── Reservation expiry worker — releases stale cart/hold reservations ──
  const reservationWorker = new Worker(
    QUEUE_NAMES.EXPIRE_RESERVATIONS,
    async (_job: Job) => expireStaleReservations(),
    { connection: getRedisConnection() as any, concurrency: 1 },
  );
  reservationWorker.on('failed', (job, err) => {
    log('error', 'reservation expiry failed', { err: err.message });
    captureJobFailure(QUEUE_NAMES.EXPIRE_RESERVATIONS, job?.id, err);
  });

  // ── Retention worker — GDPR-style anonymization + soft-delete of old audit logs ──
  const retentionWorker = new Worker(
    QUEUE_NAMES.RETENTION,
    async (job: Job) => runRetentionJob(job.data.policy ?? 'default'),
    { connection: getRedisConnection() as any, concurrency: 1 },
  );
  retentionWorker.on('failed', (job, err) => {
    log('error', 'retention job failed', { jobId: job?.id, err: err.message });
    captureJobFailure(QUEUE_NAMES.RETENTION, job?.id, err);
  });

  log('info', 'All workers started');

  // ── Heartbeat for /api/v1/health (src/lib/health/workerHeartbeat.ts) ──
  // Beats only while every worker is running; a crashed, hung or stopped
  // process stops beating and the key expires, which degrades health.
  const workers = [outboxWorker, communicationWorker, reconciliationWorker, reservationWorker, retentionWorker];
  const beat = async () => {
    try {
      const alive = await writeWorkerHeartbeat(getRedisConnection(), workers.every(w => w.isRunning()));
      if (!alive) log('warn', 'Heartbeat withheld: not every worker is running');
    } catch (e) {
      log('warn', 'Heartbeat write failed', { error: e instanceof Error ? e.message : String(e) });
    }
  };
  await beat();
  const heartbeat = setInterval(beat, WORKER_HEARTBEAT_INTERVAL_MS);

  // ── Schedule daily reconciliation + risk alert evaluation ──
  // BullMQ repeatable job — runs every day at 9am Asia/Dhaka (3am UTC).
  // No external cron service needed.
  try {
    const reconQueue = getQueue(QUEUE_NAMES.RECONCILIATION);
    // Remove any existing repeatable job first (idempotent startup)
    const existing = await reconQueue.getRepeatableJobs();
    for (const job of existing) {
      if (job.id === 'daily-reconciliation') {
        await reconQueue.removeRepeatableByKey(job.key);
      }
    }
    // Add daily repeatable job — cron pattern: minute hour day-month month day-week
    // "0 3 * * *" = 3:00 AM UTC daily = 9:00 AM Asia/Dhaka
    await reconQueue.add('daily-reconciliation', { checks: 'all' }, {
      repeat: { pattern: '0 3 * * *' },
      jobId: 'daily-reconciliation',
    });
    log('info', 'Daily reconciliation + risk alert evaluation scheduled (3am UTC / 9am Asia/Dhaka)');
  } catch (e) {
    log('warn', 'Failed to schedule daily reconciliation (Redis may be unavailable)', { error: e instanceof Error ? e.message : String(e) });
    // A reconciliation that never gets scheduled fails silently every night.
    captureJobFailure(QUEUE_NAMES.RECONCILIATION, 'daily-reconciliation-schedule', e);
  }

  // Graceful shutdown
  const shutdown = async () => {
    log('info', 'Shutting down workers...');
    clearInterval(heartbeat);
    await clearWorkerHeartbeat(getRedisConnection()).catch(() => undefined);
    await Promise.allSettled([
      outboxWorker.close(),
      communicationWorker.close(),
      reconciliationWorker.close(),
      reservationWorker.close(),
      retentionWorker.close(),
    ]);
    await getRedisConnection().quit();
    await flushWorkerErrorTracking();
    log('info', 'Workers shut down cleanly');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Entrypoint when run as `bun src/workers/index.ts`
if (require.main === module) {
  // An unhandled failure here previously became an unhandled rejection with no
  // report. Capture it, flush, and exit non-zero so the supervisor restarts us.
  startWorkers().catch(async (e) => {
    captureJobFailure('startup', undefined, e);
    await flushWorkerErrorTracking();
    log('error', 'Worker startup failed', { error: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  });
}
