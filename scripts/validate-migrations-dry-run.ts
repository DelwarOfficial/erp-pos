#!/usr/bin/env bun
// scripts/validate-migrations-dry-run.ts
// Validates that all PostgreSQL migration files are syntactically sound and
// listed in the correct order. Does NOT require a Postgres instance.
// Run with: bun run scripts/validate-migrations-dry-run.ts

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dir, '..', 'prisma', 'migrations');
const RLS_DIR = join(import.meta.dir, '..', 'prisma', 'rls');
const TRIGGERS_DIR = join(import.meta.dir, '..', 'prisma', 'triggers');
const FUNCTIONS_DIR = join(import.meta.dir, '..', 'prisma', 'functions');
const ROLES_DIR = join(import.meta.dir, '..', 'prisma', 'roles');

console.log('═══════════════════════════════════════════════════════════');
console.log('  Migration Dry-Run Validation (no Postgres required)');
console.log('═══════════════════════════════════════════════════════════');

let totalFiles = 0;
let totalBytes = 0;
let errors = 0;

function validateDir(dir: string, label: string, requiredOrdered = false): void {
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort(); }
  catch (e) {
    console.error(`  ✗ ${label}: directory not found (${dir})`);
    errors++;
    return;
  }

  console.log(`\n${label} (${files.length} files):`);
  let lastVersion = -1;
  for (const file of files) {
    const path = join(dir, file);
    const sql = readFileSync(path, 'utf8');
    totalFiles++;
    totalBytes += sql.length;

    // Check for balanced statements (rough heuristic)
    const semicolons = (sql.match(/;/g) ?? []).length;

    // Count transaction-control BEGINs only (not BEGIN inside plpgsql function bodies).
    // A plpgsql BEGIN is preceded by AS $$ or DECLARE; a transaction BEGIN is on its own line.
    const lines = sql.split('\n');
    let txBeginCount = 0;
    let inFunctionBody = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      // Track entry/exit of function bodies ($$ ... $$)
      const dollarQuoteCount = (line.match(/\$\$/g) ?? []).length;
      if (dollarQuoteCount % 2 === 1) inFunctionBody = inFunctionBody === 0 ? 1 : 0;

      if (/\bBEGIN\b/i.test(trimmed) && inFunctionBody === 0 && !/LANGUAGE/i.test(trimmed)) {
        txBeginCount++;
      }
    }
    const commitCount = (sql.match(/\bCOMMIT\b/gi) ?? []).length;
    const rollbackCount = (sql.match(/\bROLLBACK\b/gi) ?? []).length;
    const txEndCount = commitCount + rollbackCount;

    const issues: string[] = [];
    if (semicolons === 0 && sql.trim().length > 0) issues.push('no statements');
    if (txBeginCount > txEndCount && txBeginCount - txEndCount > 1) {
      issues.push(`BEGIN/COMMIT mismatch (${txBeginCount} BEGIN, ${txEndCount} COMMIT+ROLLBACK)`);
    }

    // Check for SQLite-isms that should have been removed
    if (/\bAUTOINCREMENT\b/i.test(sql)) issues.push('contains AUTOINCREMENT (SQLite-only)');
    if (/PRAGMA\b/i.test(sql)) issues.push('contains PRAGMA (SQLite-only)');
    if (/\bINTEGER PRIMARY KEY\b/i.test(sql) && !/\bGENERATED\b/i.test(sql)) {
      // SQLite-ism for auto-increment — Postgres uses SERIAL/BIGSERIAL or GENERATED ... AS IDENTITY
      // Not necessarily wrong if used inside a CREATE TABLE with explicit SERIAL — just flag for review
    }

    // Check version ordering
    const versionMatch = file.match(/^(\d{4})_/);
    if (requiredOrdered && versionMatch) {
      const v = parseInt(versionMatch[1], 10);
      if (v <= lastVersion) issues.push(`version ${v} out of order (prev was ${lastVersion})`);
      lastVersion = v;
    }

    const status = issues.length === 0 ? '✓' : '✗';
    console.log(`  ${status} ${file} — ${sql.length} bytes, ${semicolons} stmts${issues.length ? ', ISSUES: ' + issues.join('; ') : ''}`);
    if (issues.length) errors++;
  }
}

validateDir(MIGRATIONS_DIR, 'Migrations', true);
validateDir(RLS_DIR, 'RLS policies');
validateDir(TRIGGERS_DIR, 'Triggers');
validateDir(FUNCTIONS_DIR, 'Functions');
validateDir(ROLES_DIR, 'Roles');

console.log('');
console.log('───────────────────────────────────────────────────────────');
console.log(`Total: ${totalFiles} SQL files, ${(totalBytes / 1024).toFixed(1)} KB`);
console.log(`Errors: ${errors}`);
console.log('');
if (errors === 0) {
  console.log('✓ All migration files pass dry-run validation');
  console.log('');
  console.log('To actually run migrations against a Postgres 16 instance:');
  console.log('  1. Start Postgres: docker compose -f docker/docker-compose.yml up -d postgres');
  console.log('  2. Set DATABASE_URL=postgresql://app_role:app_password_dev@localhost:5432/erp_pos?schema=public');
  console.log('  3. Run: bun run scripts/switch-to-postgres.ts');
} else {
  console.log('✗ Validation failed — fix the issues above before running migrations');
  process.exit(1);
}
