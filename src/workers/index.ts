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

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY ?? '4', 10);

function log(level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, source: 'worker', msg, meta }));
}

export function startWorkers(): void {
  log('info', 'Starting BullMQ workers', { queues: Object.values(QUEUE_NAMES), concurrency: CONCURRENCY });

  // ── Outbox worker — drains outbox_events table and delivers webhooks ──
  const outboxWorker = new Worker(
    QUEUE_NAMES.OUTBOX,
    async (_job: Job) => {
      const count = await processOutboxBatch();
      return { delivered: count };
    },
    { connection: getRedisConnection(), concurrency: CONCURRENCY },
  );
  outboxWorker.on('completed', (job) => log('info', 'outbox batch completed', { jobId: job.id }));
  outboxWorker.on('failed', (job, err) => log('error', 'outbox batch failed', { jobId: job?.id, err: err.message }));

  // ── Communication worker — sends SMS/email/notification batches ──
  const communicationWorker = new Worker(
    QUEUE_NAMES.COMMUNICATION,
    async (job: Job) => processCommunicationCampaign(job.data.campaignId),
    { connection: getRedisConnection(), concurrency: CONCURRENCY },
  );
  communicationWorker.on('failed', (job, err) => log('error', 'communication campaign failed', { jobId: job?.id, err: err.message }));

  // ── Reconciliation worker — periodic reconciliation runs ──
  const reconciliationWorker = new Worker(
    QUEUE_NAMES.RECONCILIATION,
    async (job: Job) => runScheduledReconciliation(job.data.checks ?? 'all'),
    { connection: getRedisConnection(), concurrency: 1 },
  );
  reconciliationWorker.on('failed', (job, err) => log('error', 'reconciliation failed', { jobId: job?.id, err: err.message }));

  // ── Reservation expiry worker — releases stale cart/hold reservations ──
  const reservationWorker = new Worker(
    QUEUE_NAMES.EXPIRE_RESERVATIONS,
    async (_job: Job) => expireStaleReservations(),
    { connection: getRedisConnection(), concurrency: 1 },
  );
  reservationWorker.on('failed', (_job, err) => log('error', 'reservation expiry failed', { err: err.message }));

  // ── Retention worker — GDPR-style anonymization + soft-delete of old audit logs ──
  const retentionWorker = new Worker(
    QUEUE_NAMES.RETENTION,
    async (job: Job) => runRetentionJob(job.data.policy ?? 'default'),
    { connection: getRedisConnection(), concurrency: 1 },
  );
  retentionWorker.on('failed', (job, err) => log('error', 'retention job failed', { jobId: job?.id, err: err.message }));

  log('info', 'All workers started');

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
  }

  // Graceful shutdown
  const shutdown = async () => {
    log('info', 'Shutting down workers...');
    await Promise.allSettled([
      outboxWorker.close(),
      communicationWorker.close(),
      reconciliationWorker.close(),
      reservationWorker.close(),
      retentionWorker.close(),
    ]);
    await getRedisConnection().quit();
    log('info', 'Workers shut down cleanly');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Entrypoint when run as `bun src/workers/index.ts`
if (require.main === module) {
  startWorkers();
}
