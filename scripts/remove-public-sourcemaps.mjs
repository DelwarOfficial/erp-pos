// Deletes every source map from the publicly served build output.
//
// Next.js serves .next/static at /_next/static. Browser source maps are built
// only so @sentry/nextjs can upload them, and the Sentry plugin deletes them
// after a successful upload. If the upload fails, or a build turns on
// productionBrowserSourceMaps without Sentry, they would be published and the
// full client source could be reconstructed from them. This runs after every
// build, before the static directory is copied into the standalone bundle.
//
// Usage: node scripts/remove-public-sourcemaps.mjs [staticDir]

import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function removePublicSourcemaps(staticDir) {
  let entries;
  try {
    entries = readdirSync(staticDir, { recursive: true, withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const removed = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.map')) continue;
    const path = join(entry.parentPath ?? entry.path, entry.name);
    rmSync(path);
    removed.push(path);
  }
  return removed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const staticDir = resolve(process.argv[2] ?? '.next/static');
  const removed = removePublicSourcemaps(staticDir);
  console.log(`remove-public-sourcemaps: ${removed.length} source map(s) removed from ${staticDir}`);
}
