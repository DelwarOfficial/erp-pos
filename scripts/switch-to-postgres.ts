#!/usr/bin/env bun
// scripts/switch-to-postgres.ts
// One-shot script: switches the Prisma schema from SQLite to PostgreSQL,
// regenerates the client, and runs forward-only SQL migrations.
//
// Usage:
//   DATABASE_URL=postgresql://app_role:password@localhost:5432/erp_pos \
//     bun run scripts/switch-to-postgres.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_PATH = join(import.meta.dir, '..', 'prisma', 'schema.prisma');

console.log('═══════════════════════════════════════════════════════════');
console.log('  Switching Prisma schema to PostgreSQL');
console.log('═══════════════════════════════════════════════════════════');

if (!process.env.DATABASE_URL?.startsWith('postgresql://')) {
  console.error('ERROR: Set DATABASE_URL to a postgresql:// URL before running this script.');
  process.exit(1);
}

// 1. Swap provider in schema.prisma
let schema = readFileSync(SCHEMA_PATH, 'utf8');
const before = schema;
schema = schema.replace(
  /datasource db \{\s*provider = "sqlite"/,
  'datasource db {\n  provider = "postgresql"',
);
if (schema === before) {
  console.log('✓ Schema already set to postgresql');
} else {
  writeFileSync(SCHEMA_PATH, schema);
  console.log('✓ schema.prisma provider changed: sqlite → postgresql');
}

// 2. Regenerate Prisma client
console.log('');
console.log('[2/3] Regenerating Prisma client...');
const { execSync } = await import('node:child_process');
try {
  execSync('bunx prisma generate', { stdio: 'inherit', cwd: join(import.meta.dir, '..') });
} catch {
  console.error('Failed to regenerate Prisma client');
  process.exit(1);
}

// 3. Run migrations
console.log('');
console.log('[3/3] Running PostgreSQL migrations...');
try {
  execSync('bun run scripts/run-postgres-migrations.ts', { stdio: 'inherit', cwd: join(import.meta.dir, '..') });
} catch {
  console.error('Migration failed');
  process.exit(1);
}

console.log('');
console.log('✓ PostgreSQL switch complete');
console.log('');
console.log('Next steps:');
console.log('  1. Update your .env: DATABASE_URL=postgresql://...');
console.log('  2. Set REDIS_URL for BullMQ workers');
console.log('  3. Start the worker process: bun run src/workers/index.ts');
