import Redis from 'ioredis';

/** Request-scoped auth connection: never reuse BullMQ's unbounded offline queue. */
export function createRateLimitRedis() {
  const client = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
    lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0,
    connectTimeout: 1000, commandTimeout: 1000, retryStrategy: () => null,
  });
  client.on('error', () => { /* Caller returns controlled failure; never log connection details. */ });
  return client;
}
