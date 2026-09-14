import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('middleware Edge dependency boundary', () => {
  it('uses only dependency-free cookie names, never server sessions', () => {
    const middleware = readFileSync('src/middleware.ts', 'utf8');
    const names = readFileSync('src/lib/auth/cookieNames.ts', 'utf8');
    expect(middleware).toContain("from '@/lib/auth/cookieNames'");
    expect(middleware).not.toContain("from '@/lib/auth/sessions'");
    expect(names).not.toMatch(/next\/headers|next\/server|node:|Prisma|jwt|refreshToken|mfaChallenge|process\./);
  });
});
