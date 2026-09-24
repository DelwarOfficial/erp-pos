// F-56 regression: two unreferenced modules duplicated security-critical logic
// and would not have worked if anyone imported them.
//
//   src/lib/db/tenant.ts   a tenantDb proxy that injected `company_id`
//                          (snake_case) into Prisma where-clauses and matched
//                          models by table name. Prisma's client is camelCase,
//                          so it never matched and would not have scoped anything.
//   src/lib/db/exclude.ts  a second nextDocumentNumber that read a sequence and
//                          incremented it in a separate statement, with no lock:
//                          duplicate document numbers under concurrency.
//
// Both had plausible names and locations, so importing the wrong one by mistake
// was a real risk. They are deleted; this pins that there is exactly one of each.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function sources(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter(file => /\.(ts|tsx)$/.test(file))
    .map(file => path.join(root, file));
}

const posix = (file: string) => file.split(path.sep).join('/');

describe('F-56: no shadow copies of tenant scoping or document numbering', () => {
  it('the broken modules are gone', () => {
    expect(existsSync('src/lib/db/tenant.ts')).toBe(false);
    expect(existsSync('src/lib/db/exclude.ts')).toBe(false);
  });

  it('nextDocumentNumber is defined in exactly one place', () => {
    const definitions = sources('src').filter(file =>
      /export (async )?function nextDocumentNumber\b/.test(readFileSync(file, 'utf8')));
    expect(definitions.map(posix)).toEqual(['src/lib/numbering/index.ts']);
  });

  it('tenantDb is defined in exactly one place', () => {
    const definitions = sources('src').filter(file =>
      /export (const|function) tenantDb\b/.test(readFileSync(file, 'utf8')));
    expect(definitions.map(posix)).toEqual(['src/lib/db/index.ts']);
  });
});
