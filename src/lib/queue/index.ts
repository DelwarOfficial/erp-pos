// src/lib/queue/index.ts
// Redis + BullMQ queue setup per §1 technical stack.

import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
    connection.on('error', (err) => console.error('[redis] Error:', err.message));
    connection.on('connect', () => console.log('[redis] Connected'));
  }
  return connection;
}

export const QUEUE_NAMES = {
  OUTBOX: 'outbox', WEBHOOK: 'webhook', COMMUNICATION: 'communication',
  OFFLINE_SYNC: 'offline-sync', RECONCILIATION: 'reconciliation',
  RETENTION: 'retention', EXPIRE_RESERVATIONS: 'expire-reservations',
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
