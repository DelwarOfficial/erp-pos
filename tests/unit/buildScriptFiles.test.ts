// A clean clone must be able to build. `npm run build` once named a helper in
// scripts/build/, which .gitignore's `build/` rule kept out of every commit:
// it worked on the developer's machine and failed everywhere else.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const { scripts } = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
const helpers = [...scripts.build.matchAll(/\bnode (scripts\/\S+)/g)].map(match => match[1]);

describe('npm run build', () => {
  it('adds instrumentation (the production start-up guard) to the standalone server', () => {
    expect(helpers).toContain('scripts/standalone-instrumentation.mjs');
  });

  it.each(helpers)('%s exists and is outside the git-ignored directory names', helper => {
    expect(existsSync(helper)).toBe(true);
    expect(helper.split('/').slice(0, -1)).not.toEqual(expect.arrayContaining(['build']));
    expect(helper).not.toMatch(/\/(dist|out|coverage|node_modules)\//);
  });

  it('stops the process, rather than serving 500s, when the guard refuses', () => {
    const hook = readFileSync('instrumentation.ts', 'utf8');
    expect(hook).toMatch(/assertProductionSecurityConfig\(\);\s*\} catch[\s\S]{0,400}process\.exit\(1\)/);
  });
});
