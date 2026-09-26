// Measures query plans for the hot tenant queries before and after
// prisma/mariadb/migrations/20260926000100_tenant_leading_composite_indexes.
//
// The shared disposable test database holds a few hundred rows per table, where
// the optimizer scans everything whatever the indexes are, so its plans prove
// nothing. This creates a throwaway database, applies every migration EXCEPT the
// one under test, loads production-like volume dominated by one large tenant,
// and runs ANALYZE FORMAT=JSON -- which executes the query and reports rows
// actually read and time actually spent -- before and after applying it.
//
// Local disposable MariaDB only. The benchmark database is dropped at the end.
//
// Usage: node scripts/benchmarks/index-plans.mjs

import { PrismaClient } from '@prisma/client';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const UNDER_TEST = '20260926000100_tenant_leading_composite_indexes';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const name = `index_bench_${Date.now()}`;
const admin = new URL('mysql://127.0.0.1:43318/readiness_20260912_disposable');
admin.username = 'root';
if (admin.hostname !== '127.0.0.1' || admin.port !== '43318') throw new Error('Local disposable MariaDB only');

const BIG = 'tenant-big';
const OTHERS = ['tenant-b', 'tenant-c', 'tenant-d', 'tenant-e'];
const ROWS = { entries: 200_000, sales: 200_000, payments: 200_000, audit: 300_000, security: 150_000 };

// The queries the application issues, written as the SQL Prisma produces for them.
const QUERIES = {
  'ledger: account totals to a date (trial balance, balance sheet)': `
    SELECT jl.chart_of_account_id, SUM(jl.debit_base), SUM(jl.credit_base)
    FROM journal_lines jl
    WHERE jl.company_id = '${BIG}'
      AND jl.journal_entry_id IN (
        SELECT je.id FROM journal_entries je
        WHERE je.company_id = '${BIG}' AND je.status IN ('posted', 'reversed') AND je.entry_date <= '2026-03-31')
    GROUP BY jl.chart_of_account_id`,
  'sales: one month for one company, newest first': `
    SELECT id, reference_no, business_date, grand_total FROM sales
    WHERE company_id = '${BIG}' AND business_date BETWEEN '2026-06-01' AND '2026-06-30 23:59:59'
    ORDER BY business_date DESC LIMIT 50`,
  'payments: one day for one company': `
    SELECT id, amount FROM payments
    WHERE company_id = '${BIG}' AND business_date BETWEEN '2026-06-15' AND '2026-06-15 23:59:59'`,
  'webhook: resolve payment by provider reference': `
    SELECT id FROM payments WHERE payment_method = 'bkash' AND method_reference = 'REF-123457'`,
  'audit log: newest 50 for one company': `
    SELECT id, action, occurred_at FROM audit_logs WHERE company_id = '${BIG}' ORDER BY occurred_at DESC LIMIT 50`,
  'retention: security events older than cutoff': `
    SELECT COUNT(*) FROM security_events WHERE company_id = '${BIG}' AND occurred_at < '2026-02-01'`,
};

/** A deterministic tenant for row n: 90% the big tenant, the rest spread. */
const tenantOf = column => `IF(${column} % 10 = 0, ELT(1 + (${column} DIV 10) % 4, ${OTHERS.map(t => `'${t}'`).join(', ')}), '${BIG}')`;
/** A date spread evenly over 2026-01-01 .. 2026-09-26. */
const dateOf = (column, total) => `TIMESTAMPADD(SECOND, FLOOR((${column} / ${total}) * 23068800), '2026-01-01')`;

const SEED = [
  'SET FOREIGN_KEY_CHECKS = 0',
  `INSERT INTO journal_entries (id, company_id, entry_no, event_id, posting_kind, entry_date, source_type, source_id, description, created_by, status)
   SELECT CONCAT('je-', seq), ${tenantOf('seq')}, CONCAT('JE-', seq), CONCAT('ev-', seq), 'sale_revenue',
          ${dateOf('seq', ROWS.entries)}, 'sale', CONCAT('s-', seq), 'bench', 'u', IF(seq % 50 = 0, 'reversed', 'posted')
   FROM seq_1_to_${ROWS.entries}`,
  `INSERT INTO journal_lines (id, company_id, journal_entry_id, line_no, chart_of_account_id, debit_base, credit_base)
   SELECT CONCAT('jl-', seq), ${tenantOf('((seq + 1) DIV 2)')}, CONCAT('je-', (seq + 1) DIV 2), 2 - seq % 2,
          CONCAT('coa-', seq % 40), IF(seq % 2 = 1, 100, 0), IF(seq % 2 = 0, 100, 0)
   FROM seq_1_to_${ROWS.entries * 2}`,
  `INSERT INTO sales (id, company_id, branch_id, warehouse_id, reference_no, client_txn_id, biller_id, business_date, grand_total)
   SELECT CONCAT('sa-', seq), ${tenantOf('seq')}, 'br', 'wh', CONCAT('INV-', seq), CONCAT('ct-', seq), 'u',
          ${dateOf('seq', ROWS.sales)}, 100
   FROM seq_1_to_${ROWS.sales}`,
  `INSERT INTO payments (id, company_id, branch_id, reference_no, client_txn_id, payment_type, financial_account_id,
                         business_date, created_by, payment_method, method_reference, amount)
   SELECT CONCAT('pa-', seq), ${tenantOf('seq')}, 'br', CONCAT('PMT-', seq), CONCAT('ct-', seq), 'sale_receipt', 'fa',
          ${dateOf('seq', ROWS.payments)}, 'u', ELT(1 + seq % 3, 'cash', 'bkash', 'nagad'), CONCAT('REF-', seq), 100
   FROM seq_1_to_${ROWS.payments}`,
  `INSERT INTO audit_logs (id, company_id, correlation_id, action, entity_type, entity_id, occurred_at)
   SELECT CONCAT('al-', seq), ${tenantOf('seq')}, 'c', 'sale.post', 'sale', CONCAT('s-', seq), ${dateOf('seq', ROWS.audit)}
   FROM seq_1_to_${ROWS.audit}`,
  `INSERT INTO security_events (id, company_id, event_type, occurred_at)
   SELECT CONCAT('se-', seq), ${tenantOf('seq')}, 'login_failed', ${dateOf('seq', ROWS.security)}
   FROM seq_1_to_${ROWS.security}`,
  'SET FOREIGN_KEY_CHECKS = 1',
];

const TABLES = ['journal_entries', 'journal_lines', 'sales', 'payments', 'audit_logs', 'security_events'];

function planSummary(json) {
  const text = JSON.stringify(json);
  const keys = [...new Set([...text.matchAll(/"key":"([^"]+)"/g)].map(m => m[1]))];
  const rowsRead = [...text.matchAll(/"r_rows":([\d.]+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
  const scanned = [...text.matchAll(/"r_loops":([\d.]+),"rows":([\d.]+)/g)];
  const time = Number(/"r_total_time_ms":([\d.]+)/.exec(text)?.[1] ?? NaN);
  const fullScan = /"access_type":"ALL"/.test(text);
  const filesort = /"filesort"/.test(text);
  return { keys: keys.join(', ') || '(none)', rowsRead: Math.round(rowsRead), timeMs: Number(time.toFixed(2)), fullScan, filesort, examined: scanned.length };
}

async function measure(db) {
  await db.$executeRawUnsafe(`ANALYZE TABLE ${TABLES.join(', ')}`);
  const results = {};
  for (const [label, sql] of Object.entries(QUERIES)) {
    const best = [];
    // Three runs, keep the fastest: the first run warms the buffer pool.
    for (let i = 0; i < 3; i++) {
      const rows = await db.$queryRawUnsafe(`ANALYZE FORMAT=JSON ${sql}`);
      best.push(planSummary(JSON.parse(Object.values(rows[0])[0])));
    }
    results[label] = best.sort((a, b) => a.timeMs - b.timeMs)[0];
  }
  return results;
}

function splitStatements(sql) {
  return sql.split(/;\s*\n/).map(s => s.replace(/^(\s*--[^\n]*\n)+/g, '').trim()).filter(Boolean);
}

const setup = new PrismaClient({ datasources: { db: { url: admin.toString() } }, log: [] });
await setup.$executeRawUnsafe(`CREATE DATABASE ${name} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await setup.$disconnect();

const target = new URL(admin); target.pathname = `/${name}`;
mkdirSync(join(root, '.local'), { recursive: true });
const work = mkdtempSync(join(root, '.local', 'index-bench-'));
try {
  cpSync(join(root, 'prisma/mariadb/schema.prisma'), join(work, 'schema.prisma'));
  mkdirSync(join(work, 'migrations'));
  for (const entry of readdirSync(join(root, 'prisma/mariadb/migrations'))) {
    if (entry === UNDER_TEST) continue;
    cpSync(join(root, 'prisma/mariadb/migrations', entry), join(work, 'migrations', entry), { recursive: true });
  }
  const env = { ...process.env, DATABASE_URL: target.toString(), CHECKPOINT_DISABLE: '1' };
  const migrate = spawnSync(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema=schema.prisma'],
    { cwd: work, env, encoding: 'utf8' });
  if (migrate.status !== 0) throw new Error(`migrate deploy failed:\n${migrate.stdout}\n${migrate.stderr}`);

  const db = new PrismaClient({ datasources: { db: { url: target.toString() } }, log: [] });
  try {
    const started = Date.now();
    for (const statement of SEED) await db.$executeRawUnsafe(statement);
    console.log(`Seeded in ${((Date.now() - started) / 1000).toFixed(1)}s:`, ROWS);

    const before = await measure(db);
    const migration = readFileSync(join(root, 'prisma/mariadb/migrations', UNDER_TEST, 'migration.sql'), 'utf8');
    for (const statement of splitStatements(migration)) await db.$executeRawUnsafe(statement);
    const after = await measure(db);

    console.log('\n| Query | Before: index | rows read | ms | After: index | rows read | ms |');
    console.log('|---|---|---:|---:|---|---:|---:|');
    for (const label of Object.keys(QUERIES)) {
      const b = before[label], a = after[label];
      const flag = p => `${p.fullScan ? ' [full scan]' : ''}${p.filesort ? ' [filesort]' : ''}`;
      console.log(`| ${label} | ${b.keys}${flag(b)} | ${b.rowsRead} | ${b.timeMs} | ${a.keys}${flag(a)} | ${a.rowsRead} | ${a.timeMs} |`);
    }
    console.log('\nJSON', JSON.stringify({ before, after }));
  } finally {
    await db.$disconnect();
  }
} finally {
  const cleanup = new PrismaClient({ datasources: { db: { url: admin.toString() } }, log: [] });
  await cleanup.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${name}`);
  await cleanup.$disconnect();
  rmSync(work, { recursive: true, force: true });
  console.log(`\nDropped ${name}`);
}
