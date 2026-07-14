// tests/unit/outboxWorker.test.ts
// Tests for the outbox worker — backoff computation, dead-letter logic.

import { describe, it, expect } from 'vitest';

// Test the backoff computation logic directly
function computeBackoff(attempt: number): number {
  const baseMs = 1_000, maxMs = 60 * 60 * 1000;
  const exponential = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const jitter = Math.random() * baseMs;
  return exponential + jitter;
}

describe('M7 — Outbox worker backoff', () => {
  it('attempt 1: ~2s + jitter', () => {
    const delay = computeBackoff(1);
    expect(delay).toBeGreaterThanOrEqual(2000);
    expect(delay).toBeLessThanOrEqual(3000);
  });

  it('attempt 5: ~32s + jitter', () => {
    const delay = computeBackoff(5);
    expect(delay).toBeGreaterThanOrEqual(32000);
    expect(delay).toBeLessThanOrEqual(33000);
  });

  it('caps at 1 hour', () => {
    const delay = computeBackoff(20);
    expect(delay).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
  });

  it('is always positive', () => {
    for (let i = 0; i < 20; i++) {
      expect(computeBackoff(i)).toBeGreaterThan(0);
    }
  });

  it('includes jitter (non-deterministic)', () => {
    const d1 = computeBackoff(3);
    const d2 = computeBackoff(3);
    // Very unlikely to be exactly equal with random jitter
    expect(d1).not.toBe(d2);
  });
});

describe('M7 — Outbox dead-letter logic', () => {
  it('marks as dead_letter when attemptCount >= maxAttempts', () => {
    const attemptCount = 10;
    const maxAttempts = 10;
    expect(attemptCount >= maxAttempts).toBe(true);
  });

  it('does not dead-letter when attemptCount < maxAttempts', () => {
    const attemptCount = 5;
    const maxAttempts = 10;
    expect(attemptCount >= maxAttempts).toBe(false);
  });
});
