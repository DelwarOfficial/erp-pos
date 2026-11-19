// An unexpected error never sends its own message (SQL, tables, file paths)
// to the client in production; it is logged with the reference id instead.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorResponse } from '@/lib/errors/codes';

afterEach(() => vi.unstubAllEnvs());

describe('unexpected errors in API responses', () => {
  const leak = new Error("Invalid `tx.rewardPointConfirmation.create()` invocation in D:\app\.next\server\chunk.js: The table `reward_point_confirmations` does not exist");

  it('production: a plain message and the reference, no internals', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const response = errorResponse(leak, 'ref-123');
    expect(response.status).toBe(500);
    const text = JSON.stringify(await response.json());
    expect(text).toContain('INTERNAL_ERROR');
    expect(text).toContain('ref-123');
    expect(text).not.toMatch(/reward_point_confirmations|invocation|\.next|chunk\.js/);
  });

  it('development keeps the cause for debugging', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(JSON.stringify(await errorResponse(leak, 'ref-1').json())).toContain('does not exist');
  });
});
