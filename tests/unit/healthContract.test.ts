import { describe, expect, it } from 'vitest';
import { checkLabel, parseHealth, overallHealth } from '@/lib/health/contract';

const healthy = { status: 'ok', service: 'erp-pos', checks: { database: 'ok', redis: 'ok', storage: 'skipped' },
  details: { database: { response_ms: 1 }, redis: { response_ms: 2 } }, response_ms: 3, timestamp: '2026-09-12T00:00:00.000Z' };
describe('shared operational health contract', () => {
  it('accepts the independently observed checks.database contract', () => {
    const value = parseHealth(healthy)!;
    expect(checkLabel(value.checks.database)).toBe('Healthy');
    expect(checkLabel(value.checks.redis)).toBe('Healthy');
    expect(checkLabel(value.checks.storage)).toBe('Not monitored');
  });
  for (const dependency of ['database', 'redis']) {
    for (const state of ['fail', 'unavailable', 'degraded', 'unknown']) {
      it(`${dependency} ${state} can never render overall Healthy`, () => {
        const value = parseHealth({ ...healthy, checks: { ...healthy.checks, [dependency]: state } })!;
        expect(value.status).not.toBe('ok');
        expect(checkLabel(value.checks[dependency as 'database' | 'redis'])).toBe(['fail', 'unavailable'].includes(state) ? 'Unavailable' : state === 'degraded' ? 'Degraded' : 'Unknown');
      });
    }
  }
  for (const value of [null, {}, { db: 'reachable' }, { ...healthy, checks: {} }, { ...healthy, response_ms: -1 }]) {
    it('rejects malformed or obsolete payloads without inventing a dependency outage', () => expect(parseHealth(value)).toBeNull());
  }
  it('strips unapproved properties and raw errors', () => {
    const value = parseHealth({ ...healthy, phase: 'internal', infrastructure: 'private', details: {
      database: { response_ms: 1, error: 'private diagnostics' }, redis: { response_ms: 2 } } });
    expect(JSON.stringify(value)).not.toMatch(/internal|private|phase|error/);
  });
  it('optional storage failure degrades overall status', () => {
    expect(overallHealth({ database: 'ok', redis: 'ok', storage: 'fail', worker: 'skipped' })).toBe('degraded');
  });
});
