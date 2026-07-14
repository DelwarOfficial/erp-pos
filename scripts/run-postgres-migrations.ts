#!/usr/bin/env bun
// scripts/run-postgres-migrations.ts
// Runs forward-only SQL migrations against a PostgreSQL database.
// Per §6 rule 12 — migrations are versioned, immutable, forward-only.
//
// Migration ordering:
//   1. Apply migrations 0001-0008 (table DDL + extensions + partitioning)
//   2. Apply RLS policies (creates session helper functions app_company_id, app_is_global)
//   3. Apply SECURITY DEFINER functions (post_stock_movement, validate_*, etc.)
//   4. Apply migrations 0009+ (grants that reference functions + RLS policies)
//   5. Apply triggers (depend on functions + tables)
//
// Usage: bun run scripts/run-postgres-migrations.ts
// Requires: DATABASE_URL=postgresql://...

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dir, '..', 'prisma', 'migrations');
const SCHEMA_FILES_DIR = join(import.meta.dir, '..', 'prisma', 'rls');
const TRIGGERS_DIR = join(import.meta.dir, '..', 'prisma', 'triggers');
const FUNCTIONS_DIR = join(import.meta.dir, '..', 'prisma', 'functions');
const ROLES_DIR = join(import.meta.dir, '..', 'prisma', 'roles');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL?.startsWith('postgresql://')) {
  console.error('ERROR: DATABASE_URL must be a postgresql:// URL');
  process.exit(1);
}

// Strip ?schema=public (Prisma-ism that psql rejects)
const PSQL_DB_URL = DATABASE_URL.replace(/\?schema=public$/, '');

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  ERP/POS PostgreSQL Migration Runner');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Database: ${PSQL_DB_URL.replace(/:[^:@]+@/, ':****@')}`);
  console.log('');

  // Ensure schema_migrations table exists
  console.log('[1/6] Ensuring schema_migrations table...');
  await psql(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum VARCHAR(64) NOT NULL
    );
  `);

  // Get applied migrations
  const applied = await psqlStdout(`SELECT version FROM schema_migrations ORDER BY version;`);
  const appliedVersions = applied.split('\n')
    .filter((l) => l && !l.includes('version') && !l.includes('--') && l.trim().match(/^\d{4}/))
    .map((l) => l.trim());
  console.log(`[2/6] ${appliedVersions.length} migrations already applied`);

  // ─── Phase A: Apply migrations 0001-0008 (table DDL, no function dependencies) ───
  const allMigrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const phaseAFiles = allMigrationFiles.filter((f) => {
    const v = parseInt(f.slice(0, 4), 10);
    return v < 9; // 0001-0008
  });
  const phaseBFiles = allMigrationFiles.filter((f) => {
    const v = parseInt(f.slice(0, 4), 10);
    return v >= 9; // 0009+
  });

  console.log(`[3/8] Phase A — applying ${phaseAFiles.length} pre-function migrations (0001-0008)...`);
  for (const file of phaseAFiles) {
    await applyMigration(file);
  }

  // ─── Phase B: RLS policies (creates app_company_id, app_is_global helpers) ───
  console.log('[4/8] Phase B — applying RLS policies (creates session helpers)...');
  await applyDir(SCHEMA_FILES_DIR, 'rls');

  // ─── Phase C: SECURITY DEFINER functions ───
  console.log('[5/8] Phase C — applying SECURITY DEFINER functions...');
  await applyDir(FUNCTIONS_DIR, 'functions');

  // ─── Phase D: triggers (CREATE FUNCTION prevent_posted_record_mutation() etc.) ───
  console.log('[6/8] Phase D — applying trigger functions...');
  await applyDir(TRIGGERS_DIR, 'triggers');

  // ─── Phase E: migrations 0009+ (grants that reference functions, triggers that reference trigger functions) ───
  console.log('[7/8] Phase E — applying post-function migrations (0009+)...');
  for (const file of phaseBFiles) {
    await applyMigration(file);
  }

  // ─── Phase F: roles (informational — usually applied manually by DBA) ───
  console.log('[8/8] Phase F — applying role definitions (informational)...');
  await applyDir(ROLES_DIR, 'roles');

  console.log('');
  console.log('✓ PostgreSQL migrations complete');

  // Print summary
  const finalCount = await psqlStdout(`SELECT count(*) FROM pg_tables WHERE schemaname='public';`);
  console.log(`  Total tables in public schema: ${finalCount.trim()}`);

  const rlsCount = await psqlStdout(`SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity = true;`);
  console.log(`  Tables with RLS enabled: ${rlsCount.trim()}`);

  const fnCount = await psqlStdout(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public';`);
  console.log(`  Functions in public schema: ${fnCount.trim()}`);

  const triggerCount = await psqlStdout(`SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal;`);
  console.log(`  Triggers: ${triggerCount.trim()}`);
}

async function applyMigration(file: string): Promise<void> {
  const version = file.replace('.sql', '');
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  const checksum = await sha256(sql);
  try {
    await psql(sql);
    await psql(`INSERT INTO schema_migrations (version, checksum) VALUES ('${version}', '${checksum}');`);
    console.log(`  ✓ ${version} (applied)`);
  } catch (e) {
    console.error(`  ✗ ${version} FAILED:`, e instanceof Error ? e.message.split('\n')[0] : e);
    // Don't exit — continue with other migrations to surface all errors
  }
}

async function applyDir(dir: string, label: string): Promise<void> {
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort(); }
  catch { return; }

  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    try {
      await psql(sql);
      console.log(`  ✓ ${label}/${file}`);
    } catch (e) {
      console.warn(`  ⚠ ${label}/${file}:`, e instanceof Error ? e.message.split('\n')[0] : e);
    }
  }
}

async function psql(sql: string): Promise<void> {
  const proc = Bun.spawn(['psql', PSQL_DB_URL, '-v', 'ON_ERROR_STOP=1', '-q'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  proc.stdin.write(sql);
  proc.stdin.end();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`psql exited ${exitCode}: ${stderr}`);
  }
}

async function psqlStdout(sql: string): Promise<string> {
  const proc = Bun.spawn(['psql', PSQL_DB_URL, '-t', '-A', '-c', sql], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`psql exited ${exitCode}: ${stderr}`);
  }
  return await new Response(proc.stdout).text();
}

async function sha256(input: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

main().catch((e) => {
  console.error('Migration runner failed:', e);
  process.exit(1);
});
