// Read-only audit of a deployed MariaDB database against this repository.
//
//   node scripts/audit-production-db.mjs
//
// Connects with DATABASE_URL (from the environment, or the .env Prisma loads)
// and checks, without writing anything:
//
//   1. Server: version, sql_mode, time zone, character set, storage engine,
//      buffer pool, binary logging (point-in-time recovery), trigger definers,
//      and the privileges of the connecting user.
//   2. Migrations: every row of _prisma_migrations finished and not rolled
//      back, the same set as prisma/mariadb/migrations, and each checksum equal
//      to the sha256 of the migration.sql on this machine -- a migration edited
//      after it was applied shows up here.
//   3. Schema: tables, columns, indexes, foreign keys, CHECK constraints and
//      triggers against prisma/mariadb/schema-fingerprint.json, generated from a
//      clean replay of the migrations. `prisma migrate diff` does not see CHECK
//      constraints or triggers; this does.
//
// Read-only by construction: one connection, set to READ ONLY before anything
// else runs, and every statement must be SELECT, SHOW or WITH. It prints no
// credentials, no connection string and no row data. Exit code 0 when nothing
// fails, 1 when a check fails, 2 when the audit could not run.
//
// Maintainers: after adding a migration, regenerate the fingerprint from a
// fresh LOCAL database built from the migrations alone:
//
//   node scripts/audit-production-db.mjs --write-fingerprint
//
// which refuses any host but localhost.

import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(root, 'prisma/mariadb/migrations');
const FINGERPRINT = join(root, 'prisma/mariadb/schema-fingerprint.json');
const writeFingerprint = process.argv.includes('--write-fingerprint');

const results = [];
const report = (status, check, detail = '') => results.push({ status, check, detail });

// ── Connection: one connection, read-only, statements checked ──────────────

function connectionUrl() {
  // Prisma reads .env itself when the variable is not in the environment.
  let raw = process.env.DATABASE_URL;
  if (!raw && existsSync(join(root, '.env'))) {
    const line = readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/).find(l => /^\s*DATABASE_URL\s*=/.test(l));
    raw = line?.replace(/^\s*DATABASE_URL\s*=\s*/, '').replace(/^["']|["']$/g, '');
  }
  if (!raw) throw new Error('DATABASE_URL is not set (environment or .env).');
  let url;
  try { url = new URL(raw); } catch { throw new Error('DATABASE_URL is not a valid URL.'); }
  if (url.protocol !== 'mysql:') throw new Error(`DATABASE_URL must be mysql:// for MariaDB (found ${url.protocol}).`);
  if (writeFingerprint && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('--write-fingerprint only runs against a local database built from the migrations.');
  }
  url.searchParams.set('connection_limit', '1');
  return url;
}

const READ_ONLY = /^\s*(SELECT|SHOW|WITH)\b/i;
let db;
async function q(sql) {
  if (!READ_ONLY.test(sql)) throw new Error('Refusing a statement that is not SELECT, SHOW or WITH.');
  return db.$queryRawUnsafe(sql);
}

// ── Schema fingerprint ──────────────────────────────────────────────────────

const norm = value => value === null || value === undefined ? null
  : String(value).replace(/\s+/g, ' ').replace(/`/g, '').trim().toLowerCase();

async function fingerprint() {
  const where = `table_schema = DATABASE() AND table_name <> '_prisma_migrations'`;
  const tables = await q(`SELECT table_name AS t, engine AS e, table_collation AS c FROM information_schema.tables WHERE ${where} AND table_type = 'BASE TABLE' ORDER BY t`);
  const columns = await q(`SELECT table_name AS t, column_name AS c, column_type AS ty, is_nullable AS n, column_default AS d, extra AS x, collation_name AS co
    FROM information_schema.columns WHERE ${where} ORDER BY t, ordinal_position`);
  const indexes = await q(`SELECT table_name AS t, index_name AS i, non_unique AS nu, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS cols
    FROM information_schema.statistics WHERE ${where} GROUP BY table_name, index_name, non_unique ORDER BY t, i`);
  const fks = await q(`SELECT k.table_name AS t, k.constraint_name AS n, GROUP_CONCAT(k.column_name ORDER BY k.ordinal_position) AS cols,
      k.referenced_table_name AS rt, GROUP_CONCAT(k.referenced_column_name ORDER BY k.ordinal_position) AS rcols, r.update_rule AS u, r.delete_rule AS dr
    FROM information_schema.key_column_usage k
    JOIN information_schema.referential_constraints r ON r.constraint_schema = k.constraint_schema AND r.constraint_name = k.constraint_name AND r.table_name = k.table_name
    WHERE k.table_schema = DATABASE() AND k.referenced_table_name IS NOT NULL
    GROUP BY k.table_name, k.constraint_name, k.referenced_table_name, r.update_rule, r.delete_rule ORDER BY t, n`);
  const checks = await q(`SELECT table_name AS t, constraint_name AS n, check_clause AS cl FROM information_schema.check_constraints
    WHERE constraint_schema = DATABASE() ORDER BY t, n`);
  const triggers = await q(`SELECT trigger_name AS n, event_object_table AS t, action_timing AS w, event_manipulation AS e, action_statement AS s
    FROM information_schema.triggers WHERE trigger_schema = DATABASE() ORDER BY n`);

  const out = { tables: {}, triggers: {} };
  for (const r of tables) out.tables[r.t] = { engine: r.e, collation: r.c, columns: {}, indexes: {}, foreignKeys: {}, checks: {} };
  for (const r of columns) if (out.tables[r.t]) out.tables[r.t].columns[r.c] = { type: norm(r.ty), nullable: r.n === 'YES', default: norm(r.d), extra: norm(r.x) || null, collation: r.co ?? null };
  for (const r of indexes) if (out.tables[r.t]) out.tables[r.t].indexes[r.i] = { unique: Number(r.nu) === 0, columns: r.cols };
  for (const r of fks) if (out.tables[r.t]) out.tables[r.t].foreignKeys[r.n] = { columns: r.cols, references: `${r.rt}(${r.rcols})`, onUpdate: r.u, onDelete: r.dr };
  for (const r of checks) if (out.tables[r.t]) out.tables[r.t].checks[r.n] = norm(r.cl);
  for (const r of triggers) out.triggers[r.n] = { table: r.t, timing: r.w, event: r.e, body: createHash('sha256').update(norm(r.s)).digest('hex').slice(0, 16) };
  return out;
}

function compareFingerprints(expected, actual) {
  let structural = 0;
  let textual = 0;
  const fail = msg => { structural++; report('FAIL', 'schema', msg); };
  const warn = msg => { textual++; report('WARN', 'schema', msg); };

  for (const table of Object.keys(expected.tables)) {
    const e = expected.tables[table];
    const a = actual.tables[table];
    if (!a) { fail(`table ${table} is missing`); continue; }
    if (a.engine !== e.engine) fail(`${table}: engine ${a.engine}, expected ${e.engine}`);
    if (a.collation !== e.collation) warn(`${table}: collation ${a.collation}, expected ${e.collation}`);
    for (const [name, col] of Object.entries(e.columns)) {
      const got = a.columns[name];
      if (!got) { fail(`${table}.${name} is missing`); continue; }
      if (got.type !== col.type || got.nullable !== col.nullable) fail(`${table}.${name}: ${got.type}${got.nullable ? ' NULL' : ' NOT NULL'}, expected ${col.type}${col.nullable ? ' NULL' : ' NOT NULL'}`);
      else if (got.default !== col.default || got.extra !== col.extra) warn(`${table}.${name}: default/extra "${got.default}"/"${got.extra}", expected "${col.default}"/"${col.extra}"`);
    }
    for (const name of Object.keys(a.columns)) if (!e.columns[name]) fail(`${table}.${name} exists but no migration creates it`);
    for (const [name, idx] of Object.entries(e.indexes)) {
      const got = a.indexes[name];
      if (!got) fail(`${table}: index ${name} (${idx.columns}) is missing`);
      else if (got.columns !== idx.columns || got.unique !== idx.unique) fail(`${table}: index ${name} is ${got.unique ? 'UNIQUE ' : ''}(${got.columns}), expected ${idx.unique ? 'UNIQUE ' : ''}(${idx.columns})`);
    }
    for (const name of Object.keys(a.indexes)) if (!e.indexes[name]) warn(`${table}: index ${name} (${a.indexes[name].columns}) exists but no migration creates it`);
    for (const [name, fk] of Object.entries(e.foreignKeys)) {
      const got = a.foreignKeys[name];
      if (!got) fail(`${table}: foreign key ${name} (${fk.columns}) -> ${fk.references} is missing`);
      else if (got.columns !== fk.columns || got.references !== fk.references || got.onDelete !== fk.onDelete || got.onUpdate !== fk.onUpdate) {
        fail(`${table}: foreign key ${name} differs (${got.columns} -> ${got.references} ${got.onDelete}/${got.onUpdate})`);
      }
    }
    for (const name of Object.keys(a.foreignKeys)) if (!e.foreignKeys[name]) warn(`${table}: foreign key ${name} exists but no migration creates it`);
    for (const [name, clause] of Object.entries(e.checks)) {
      if (!(name in a.checks)) fail(`${table}: CHECK ${name} is missing`);
      else if (a.checks[name] !== clause) warn(`${table}: CHECK ${name} reads differently (server version formatting?)`);
    }
    for (const name of Object.keys(a.checks)) if (!(name in e.checks)) warn(`${table}: CHECK ${name} exists but no migration creates it`);
  }
  for (const table of Object.keys(actual.tables)) if (!expected.tables[table]) fail(`table ${table} exists but no migration creates it`);
  for (const [name, t] of Object.entries(expected.triggers)) {
    const got = actual.triggers[name];
    if (!got) fail(`trigger ${name} on ${t.table} is missing`);
    else if (got.table !== t.table || got.timing !== t.timing || got.event !== t.event) fail(`trigger ${name} is ${got.timing} ${got.event} on ${got.table}, expected ${t.timing} ${t.event} on ${t.table}`);
    else if (got.body !== t.body) warn(`trigger ${name}: body differs from the migrations`);
  }
  for (const name of Object.keys(actual.triggers)) if (!expected.triggers[name]) fail(`trigger ${name} exists but no migration creates it`);

  const tables = Object.keys(expected.tables).length;
  const triggers = Object.keys(expected.triggers).length;
  if (structural === 0) report('PASS', 'schema', `${tables} tables and ${triggers} triggers match the migrations${textual ? ` (${textual} textual differences, see WARN)` : ''}`);
}

// ── Checks ──────────────────────────────────────────────────────────────────

async function checkServer() {
  const [v] = await q(`SELECT VERSION() AS version, @@sql_mode AS sql_mode, @@time_zone AS tz, @@system_time_zone AS system_tz,
    @@character_set_server AS charset, @@collation_server AS collation, @@default_storage_engine AS engine,
    @@innodb_buffer_pool_size AS buffer_pool, @@log_bin AS log_bin, @@binlog_format AS binlog_format,
    @@lower_case_table_names AS lctn, @@max_allowed_packet AS max_packet, @@transaction_isolation AS isolation,
    @@innodb_lock_wait_timeout AS lock_wait, @@max_connections AS max_connections`);
  const version = String(v.version);
  const [major, minor] = version.split('.').map(Number);
  if (!/mariadb/i.test(version)) report('FAIL', 'server', `not MariaDB: ${version}`);
  else if (major < 10 || (major === 10 && minor < 11)) report('WARN', 'server', `MariaDB ${version}: the migrations are tested on 11.8`);
  else report('PASS', 'server', `MariaDB ${version}`);

  const modes = String(v.sql_mode).split(',');
  if (!modes.includes('STRICT_TRANS_TABLES') && !modes.includes('STRICT_ALL_TABLES')) {
    report('FAIL', 'sql_mode', `no STRICT_TRANS_TABLES: out-of-range and truncated values are silently altered instead of rejected (${v.sql_mode || 'empty'})`);
  } else report('PASS', 'sql_mode', v.sql_mode);

  // Prisma writes DateTime as UTC wall time; the server zone matters for NOW() in SQL.
  report(['+00:00', 'UTC'].includes(String(v.tz)) || (v.tz === 'SYSTEM' && /^(UTC|GMT)$/i.test(String(v.system_tz))) ? 'PASS' : 'WARN',
    'time_zone', `${v.tz} (system ${v.system_tz}); database-side NOW()/CURRENT_TIMESTAMP defaults follow it`);
  report(String(v.charset).startsWith('utf8mb4') ? 'PASS' : 'WARN', 'charset', `${v.charset} / ${v.collation}`);
  report(v.engine === 'InnoDB' ? 'PASS' : 'FAIL', 'engine', `default ${v.engine}`);
  const poolMb = Math.round(Number(v.buffer_pool) / 1048576);
  report(poolMb >= 512 ? 'PASS' : 'WARN', 'buffer_pool', `${poolMb} MB${poolMb < 512 ? ': below 512 MB, large imports and stock counts slow sharply once data outgrows it' : ''}`);
  report(Number(v.log_bin) === 1 ? 'PASS' : 'WARN', 'binlog', Number(v.log_bin) === 1 ? `on (${v.binlog_format})` : 'off: point-in-time recovery between backups is not possible');
  report('INFO', 'settings', `isolation ${v.isolation}, lock wait ${v.lock_wait}s, max_connections ${v.max_connections}, max_allowed_packet ${Math.round(Number(v.max_packet) / 1048576)} MB, lower_case_table_names ${v.lctn}`);

  const tables = await q(`SELECT table_name AS t, engine AS e, table_collation AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`);
  const notInnoDb = tables.filter(t => t.e !== 'InnoDB').map(t => t.t);
  const notUtf8mb4 = tables.filter(t => !String(t.c).startsWith('utf8mb4')).map(t => t.t);
  report(notInnoDb.length ? 'FAIL' : 'PASS', 'tables', notInnoDb.length ? `not InnoDB (no transactions or foreign keys): ${notInnoDb.join(', ')}` : `${tables.length} tables, all InnoDB`);
  if (notUtf8mb4.length) report('WARN', 'tables', `not utf8mb4: ${notUtf8mb4.join(', ')}`);

  const definers = await q(`SELECT DISTINCT definer AS d FROM information_schema.triggers WHERE trigger_schema = DATABASE()`);
  const rootDefined = definers.map(r => String(r.d)).filter(d => /^root@/i.test(d));
  report(rootDefined.length ? 'WARN' : 'PASS', 'trigger_definer', rootDefined.length ? 'triggers are defined by root (runbook: no DEFINER=root)' : `definers: ${definers.map(r => String(r.d).replace(/@.*/, '@…')).join(', ') || 'none'}`);

  // Grants, without any password hash MariaDB may include.
  try {
    const grants = (await q('SHOW GRANTS')).map(row => String(Object.values(row)[0]).replace(/IDENTIFIED BY (PASSWORD )?'[^']*'/gi, 'IDENTIFIED BY <redacted>').replace(/ TO .*$/, ''));
    const broad = grants.filter(g => /ALL PRIVILEGES ON \*\.\*|\bSUPER\b|GRANT OPTION|ON \*\.\*/i.test(g) && !/^GRANT USAGE ON \*\.\*$/i.test(g.trim()));
    report(broad.length ? 'WARN' : 'PASS', 'privileges', broad.length ? `the application user has server-wide privileges: ${broad.join(' | ')}` : grants.join(' | '));
  } catch {
    report('INFO', 'privileges', 'SHOW GRANTS not permitted');
  }
}

async function checkMigrations() {
  const expected = readdirSync(MIGRATIONS, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
  let rows;
  try {
    rows = await q(`SELECT migration_name AS name, checksum, finished_at AS finished, rolled_back_at AS rolled_back, applied_steps_count AS steps FROM _prisma_migrations ORDER BY started_at`);
  } catch {
    report('FAIL', 'migrations', '_prisma_migrations does not exist: prisma migrate deploy has never run here');
    return;
  }
  const failed = rows.filter(r => !r.finished && !r.rolled_back);
  const rolledBack = rows.filter(r => r.rolled_back);
  const applied = rows.filter(r => r.finished && !r.rolled_back);
  for (const r of failed) report('FAIL', 'migrations', `${r.name} started and never finished: resolve before deploying anything else`);
  if (rolledBack.length) report('INFO', 'migrations', `rolled back: ${rolledBack.map(r => r.name).join(', ')}`);

  const names = new Set(applied.map(r => r.name));
  const pending = expected.filter(n => !names.has(n));
  const unknown = [...names].filter(n => !expected.includes(n));
  if (pending.length) report('FAIL', 'migrations', `not applied: ${pending.join(', ')}`);
  if (unknown.length) report('FAIL', 'migrations', `applied but not in this repository: ${unknown.join(', ')}`);

  let edited = 0;
  for (const r of applied) {
    const file = join(MIGRATIONS, r.name, 'migration.sql');
    if (!existsSync(file)) continue;
    const sum = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (sum !== r.checksum) {
      edited++;
      report('FAIL', 'migrations', `${r.name}: migration.sql here differs from what was applied (checksum mismatch). Line endings changed by git, or the file was edited after it ran.`);
    }
  }
  if (!failed.length && !pending.length && !unknown.length && !edited) report('PASS', 'migrations', `${applied.length} applied, all finished, checksums match`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const url = connectionUrl();
  db = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  await db.$executeRawUnsafe('SET SESSION TRANSACTION READ ONLY');
  const [{ name }] = await q('SELECT DATABASE() AS name');
  const where = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? 'local' : 'remote';
  console.log(`Auditing database "${name}" on a ${where} MariaDB, read-only.\n`);

  if (writeFingerprint) {
    const fp = await fingerprint();
    writeFileSync(FINGERPRINT, `${JSON.stringify(fp, null, 1)}\n`);
    console.log(`Wrote ${FINGERPRINT}: ${Object.keys(fp.tables).length} tables, ${Object.keys(fp.triggers).length} triggers.`);
    return 0;
  }

  await checkServer();
  await checkMigrations();
  if (!existsSync(FINGERPRINT)) report('FAIL', 'schema', 'prisma/mariadb/schema-fingerprint.json is missing from this checkout');
  else compareFingerprints(JSON.parse(readFileSync(FINGERPRINT, 'utf8')), await fingerprint());

  const order = { FAIL: 0, WARN: 1, INFO: 2, PASS: 3 };
  for (const r of results.sort((a, b) => order[a.status] - order[b.status])) {
    console.log(`${r.status.padEnd(4)}  ${r.check.padEnd(16)} ${r.detail}`);
  }
  const counts = Object.fromEntries(Object.keys(order).map(s => [s, results.filter(r => r.status === s).length]));
  console.log(`\n${counts.FAIL} failed, ${counts.WARN} warnings, ${counts.PASS} passed.`);
  return counts.FAIL > 0 ? 1 : 0;
}

main()
  .then(code => { process.exitCode = code; })
  .catch(error => {
    // Never echo the connection string: Prisma errors can include it.
    console.error(`Audit could not run: ${String(error?.message ?? error).replace(/mysql:\/\/[^\s"']+/g, 'mysql://<redacted>')}`);
    process.exitCode = 2;
  })
  .finally(() => db?.$disconnect());
