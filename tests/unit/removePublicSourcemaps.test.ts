// F-69 regression: browser source maps must not remain in the served build.
//
// productionBrowserSourceMaps was set whenever SENTRY_AUTH_TOKEN was, and
// because it was set explicitly, @sentry/nextjs did not turn on deletion after
// upload: a build with the old config left 64 .map files under .next/static,
// served at /_next/static. The config now asks for deletion explicitly, and the
// build runs this script afterwards as a backstop.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { removePublicSourcemaps } from '../../scripts/remove-public-sourcemaps.mjs';

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('removePublicSourcemaps', () => {
  it('removes every .map at any depth and keeps everything else', () => {
    dir = mkdtempSync(join(tmpdir(), 'static-'));
    mkdirSync(join(dir, 'chunks', 'app'), { recursive: true });
    const files = {
      'chunks/a.js': 'x', 'chunks/a.js.map': '{}', 'chunks/app/b.js': 'y',
      'chunks/app/b.js.map': '{}', 'css/c.css.map': '{}', 'media/font.woff2': 'f',
    };
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), body);
    }

    expect(removePublicSourcemaps(dir)).toHaveLength(3);
    for (const path of Object.keys(files)) {
      expect(existsSync(join(dir, path))).toBe(!path.endsWith('.map'));
    }
  });

  it('does nothing when there is no build output', () => {
    dir = mkdtempSync(join(tmpdir(), 'static-'));
    expect(removePublicSourcemaps(join(dir, 'missing'))).toEqual([]);
  });
});

describe('build configuration', () => {
  it('asks Sentry to delete source maps after upload, and runs the backstop', () => {
    const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');
    expect(config).toMatch(/deleteSourcemapsAfterUpload:\s*true/);
    const scripts = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).scripts;
    // The static directory is copied into the standalone bundle, so the
    // backstop must run before that copy.
    expect(scripts.build).toMatch(/next build && node scripts\/remove-public-sourcemaps\.mjs \.next\/static && cp -r \.next\/static/);
  });
});
