import { z } from 'zod';

export const checkStateSchema = z.enum(['ok', 'degraded', 'fail', 'unavailable', 'skipped', 'unknown']);
const timing = z.object({ response_ms: z.number().finite().nonnegative() });
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'unavailable']), service: z.literal('erp-pos'),
  checks: z.object({ database: checkStateSchema, redis: checkStateSchema, storage: checkStateSchema, worker: checkStateSchema.optional() }),
  details: z.object({ database: timing.optional(), redis: timing.optional(), storage: timing.optional() }),
  response_ms: z.number().finite().nonnegative(), timestamp: z.string().datetime(),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/).optional(),
  uptime_seconds: z.number().finite().nonnegative().optional(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type CheckState = z.infer<typeof checkStateSchema>;

// Database/Redis required; storage optional. Redis PING cannot prove worker health.
export function overallHealth(checks: HealthResponse['checks']): HealthResponse['status'] {
  if ([checks.database, checks.redis].some(value => ['fail', 'unavailable'].includes(value))) return 'unavailable';
  if (checks.database !== 'ok' || checks.redis !== 'ok' || !['ok', 'skipped'].includes(checks.storage)
    || (checks.worker && !['ok', 'skipped'].includes(checks.worker))) return 'degraded';
  return 'ok';
}
export function checkLabel(status: CheckState): string {
  return { ok: 'Healthy', degraded: 'Degraded', fail: 'Unavailable', unavailable: 'Unavailable', skipped: 'Not monitored', unknown: 'Unknown' }[status];
}
export function parseHealth(value: unknown): HealthResponse | null {
  const parsed = healthResponseSchema.safeParse(value);
  if (!parsed.success) return null;
  const derived = overallHealth(parsed.data.checks);
  const rank = { ok: 0, degraded: 1, unavailable: 2 };
  return { ...parsed.data, status: rank[derived] > rank[parsed.data.status] ? derived : parsed.data.status };
}
