import { SQL } from 'bun';
import { verifiedDryRunUrl, safeError } from './safety';

const targetInfo = verifiedDryRunUrl();
const target = new SQL(targetInfo.url, { bigint: true, max: 1 });
const report = {
  target_database: targetInfo.database,
  plans: [] as Array<{ query: string; steps: Array<Record<string, unknown>> }>,
  full_scans: 0,
  failures: [] as Array<{ code?: string; message: string }>,
};

function safeSteps(rows: any[]): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    select_type: row.select_type,
    table: row.table,
    access_type: row.type,
    possible_keys: row.possible_keys,
    key: row.key,
    estimated_rows: Number(row.rows ?? 0),
    extra: row.Extra,
  }));
}

try {
  const companies = await target`SELECT id FROM companies ORDER BY created_at LIMIT 1`;
  if (!companies.length) throw new Error('EXPLAIN_REQUIRES_ETL_COMPANY');
  const companyId = String(companies[0].id);
  const sequences = await target`SELECT document_type, fiscal_year FROM document_sequences WHERE company_id = ${companyId} LIMIT 1`;
  const documentType = sequences[0]?.document_type ?? 'SALE';
  const fiscalYear = Number(sequences[0]?.fiscal_year ?? new Date().getUTCFullYear());

  const candidates = [
    {
      name: 'document_sequence_lock',
      run: () => target`EXPLAIN SELECT id, next_number FROM document_sequences
        WHERE company_id = ${companyId} AND branch_id IS NULL
          AND document_type = ${documentType} AND fiscal_year = ${fiscalYear} FOR UPDATE`,
    },
    {
      name: 'posted_trial_balance',
      run: () => target`EXPLAIN SELECT jl.chart_of_account_id, SUM(jl.debit_base), SUM(jl.credit_base)
        FROM journal_lines jl JOIN journal_entries je
          ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
        WHERE jl.company_id = ${companyId} AND je.status = 'posted'
        GROUP BY jl.chart_of_account_id`,
    },
    {
      name: 'inventory_valuation',
      run: () => target`EXPLAIN SELECT warehouse_id, product_id, qty_on_hand, moving_average_cost
        FROM warehouse_stocks WHERE company_id = ${companyId} AND qty_on_hand > 0`,
    },
    {
      name: 'sales_recent',
      run: () => target`EXPLAIN SELECT id, reference_no, sale_status, grand_total
        FROM sales WHERE company_id = ${companyId} ORDER BY business_date DESC LIMIT 100`,
    },
  ];

  for (const candidate of candidates) {
    const steps = safeSteps(await candidate.run());
    report.plans.push({ query: candidate.name, steps });
    report.full_scans += steps.filter((step) => step.access_type === 'ALL' && Number(step.estimated_rows) > 100).length;
  }
  if (report.full_scans) process.exitCode = 1;
} catch (error) {
  report.failures.push(safeError(error));
  process.exitCode = 1;
} finally {
  await target.close();
  console.log(JSON.stringify(report, null, 2));
}
