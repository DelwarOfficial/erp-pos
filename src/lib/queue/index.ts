// src/lib/queue/index.ts
// Redis + BullMQ queue setup per §1 technical stack.

import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { errorMeta, logger } from '@/lib/logging';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
    connection.on('error', (err) => logger.error('[redis] error', errorMeta(err)));
    connection.on('connect', () => logger.info('[redis] connected'));
  }
  return connection;
}

export const QUEUE_NAMES = {
  // F-48: only queues a worker consumes are declared. Webhook delivery runs
  // through the outbox; offline sync is a synchronous API; marketing SMS go
  // through SMS_SEND.
  OUTBOX: 'outbox', RECONCILIATION: 'reconciliation',
  RETENTION: 'retention', EXPIRE_RESERVATIONS: 'expire-reservations',
  // Customer due reminders: the scheduling tick, and one job per SMS send.
  DUE_REMINDERS: 'due-reminders', SMS_SEND: 'sms-send',
} as const;

const queues = new Map<string, Queue>();
export function getQueue(name: string): Queue {
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, {
      connection: getRedisConnection() as any,
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 100, removeOnFail: 500 },
    }));
  }
  return queues.get(name)!;
}

export async function enqueue(queueName: string, jobName: string, data: unknown, opts?: { delay?: number; priority?: number }) {
  return getQueue(queueName).add(jobName, data, { delay: opts?.delay, priority: opts?.priority });
}
