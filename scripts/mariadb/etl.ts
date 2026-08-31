import { SQL } from 'bun';
import { verifiedDryRunUrl, verifiedSourceCopy, hasFlag, safeError } from './safety';

const BATCH_SIZE = 250;
const sourceInfo = await verifiedSourceCopy();
const targetInfo = verifiedDryRunUrl();
const source = new SQL({ adapter: 'sqlite', filename: sourceInfo.path, readonly: true, create: false, safeIntegers: true });
const target = new SQL(targetInfo.url, { bigint: true, max: 1 });

const report = {
  source_sha256: sourceInfo.sha256,
  target_database: targetInfo.database,
  tables: [] as Array<{ table: string; source_rows: number; target_rows: number }>,
  source_rows: 0,
  inserted_rows: 0,
  failed_rows: 0,
  failures: [] as Array<{ table: string; batch_start: number; code?: string; message: string }>,
};

try {
  const integrity = await source`PRAGMA integrity_check`;
  if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') throw new Error('SOURCE_SQLITE_INTEGRITY_FAILED');
  const sourceOrphans = await source`PRAGMA foreign_key_check`;
  if (sourceOrphans.length) throw new Error(`SOURCE_SQLITE_ORPHANS:${sourceOrphans.length}`);

  const sourceTableRows = await source`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'
    ORDER BY name
  `;
  const sourceTables: string[] = sourceTableRows.map((row: any) => String(row.name));
  const targetTableRows = await target`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = ${targetInfo.database} AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
  `;
  const targetTables = new Set(targetTableRows.map((row: any) => String(row.name)));
  const missing = sourceTables.filter((table) => !targetTables.has(table));
  if (missing.length) throw new Error(`TARGET_TABLES_MISSING:${missing.join(',')}`);

  await target.begin(async (tx) => {
    await tx`SET FOREIGN_KEY_CHECKS = 0`;
    try {
      if (hasFlag('--truncate-dryrun')) {
        for (const table of [...sourceTables].reverse()) await tx`DELETE FROM ${tx(table)}`;
      }

      for (const table of sourceTables) {
        const rows = await source`SELECT * FROM ${source(table)}`;
        report.source_rows += rows.length;
        const existing = await tx`SELECT COUNT(*) AS count FROM ${tx(table)}`;
        if (!hasFlag('--truncate-dryrun') && Number(existing[0].count) !== 0) {
          throw new Error(`TARGET_TABLE_NOT_EMPTY:${table}`);
        }

        for (let start = 0; start < rows.length; start += BATCH_SIZE) {
          const batch = rows.slice(start, start + BATCH_SIZE);
          try {
            await tx`INSERT INTO ${tx(table)} ${tx(batch)}`;
            report.inserted_rows += batch.length;
          } catch (error) {
            report.failed_rows += batch.length;
            report.failures.push({ table, batch_start: start, ...safeError(error) });
            throw new Error(`ETL_BATCH_FAILED:${table}:${start}`);
          }
        }

        const targetCount = await tx`SELECT COUNT(*) AS count FROM ${tx(table)}`;
        report.tables.push({ table, source_rows: rows.length, target_rows: Number(targetCount[0].count) });
      }
    } finally {
      await tx`SET FOREIGN_KEY_CHECKS = 1`;
    }
  });
} catch (error) {
  if (!report.failures.length) report.failures.push({ table: '[setup]', batch_start: 0, ...safeError(error) });
  process.exitCode = 1;
} finally {
  await Promise.allSettled([source.close(), target.close()]);
  console.log(JSON.stringify(report, null, 2));
}
