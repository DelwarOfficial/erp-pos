import { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { verifiedDryRunUrl, safeError } from './safety';

const targetInfo = verifiedDryRunUrl();
const target = new SQL(targetInfo.url, { bigint: true, max: 25 });
const documentType = `MIGRATION_PROBE_${Date.now()}`;
const report = {
  target_database: targetInfo.database,
  requested: 100,
  completed: 0,
  unique_numbers: 0,
  duplicate_numbers: 0,
  contiguous: false,
  duration_ms: 0,
  failures: [] as Array<{ code?: string; message: string }>,
};

try {
  const companies = await target`SELECT id FROM companies ORDER BY created_at LIMIT 1`;
  if (!companies.length) throw new Error('CONCURRENCY_PROBE_REQUIRES_ETL_COMPANY');
  const companyId = String(companies[0].id);
  const started = performance.now();

  const issued = await Promise.all(Array.from({ length: report.requested }, async () => {
    return target.begin(async (tx) => {
      await tx`
        INSERT INTO document_sequences
          (id, company_id, branch_id, document_type, fiscal_year, prefix, next_number, padding, version)
        VALUES (${randomUUID()}, ${companyId}, ${null}, ${documentType}, 0, 'PROBE-', ${BigInt(2)}, 6, 1)
        ON DUPLICATE KEY UPDATE next_number = next_number + 1, version = version + 1
      `;
      const rows = await tx`
        SELECT next_number - 1 AS issued_number FROM document_sequences
        WHERE company_id = ${companyId} AND branch_id IS NULL
          AND document_type = ${documentType} AND fiscal_year = 0
        FOR UPDATE
      `;
      if (rows.length !== 1) throw new Error('CONCURRENCY_SEQUENCE_LOOKUP_FAILED');
      return BigInt(rows[0].issued_number);
    });
  }));

  report.duration_ms = Math.round(performance.now() - started);
  report.completed = issued.length;
  const unique = new Set(issued.map(String));
  report.unique_numbers = unique.size;
  report.duplicate_numbers = issued.length - unique.size;
  const sorted = [...unique].map(BigInt).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  report.contiguous = sorted.length === report.requested
    && sorted.every((value, index) => value === BigInt(index + 1));
  if (report.duplicate_numbers || !report.contiguous) process.exitCode = 1;

  await target`
    DELETE FROM document_sequences
    WHERE company_id = ${companyId} AND branch_id IS NULL
      AND document_type = ${documentType} AND fiscal_year = 0
  `;
} catch (error) {
  report.failures.push(safeError(error));
  process.exitCode = 1;
} finally {
  await target.close();
  console.log(JSON.stringify(report, null, 2));
}
