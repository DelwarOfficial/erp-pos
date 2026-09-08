// tests/helpers/immutableTeardown.ts
// Deterministic teardown for suites that create IMMUTABLE business rows
// (stock_movements, payment_allocations, journal_lines, ...).
//
// Production invariants (IMMUTABLE_LEDGER triggers, RESTRICT FKs) MUST NOT be
// weakened for tests, and per-suite business cleanup via deleteMany is
// fundamentally incompatible with them: immutable rows cannot be deleted, and
// anything they reference cannot be deleted either.
//
// Contract this helper implements:
// - Suites MUST use a unique company per run (e.g. Date.now() codes) and scope
//   every assertion to that companyId. Leftover rows are therefore inert and
//   no test may depend on another suite's state.
// - The preferred environment is a disposable database per full-suite run,
//   in which case teardown is best-effort hygiene, not correctness.
// - Each delete step runs independently: steps blocked by IMMUTABLE_LEDGER
//   (SQLSTATE 45000) or FK RESTRICT (1451/1452) are recorded as `skipped` and
//   do NOT abort later steps. Any OTHER error is rethrown — real failures
//   (lost connection, bad query, tenant violation) must never be silent.
// - NEVER use this to swallow errors in behavioral assertions, only teardown.

export interface TeardownStep {
  /** Human label for the report, e.g. 'stockMovement'. */
  label: string;
  /** The delete operation to attempt. */
  run: () => Promise<unknown>;
}

export interface TeardownReport {
  deleted: string[];
  skipped: Array<{ label: string; reason: string }>;
}

const INVARIANT_BLOCK_PATTERN = /IMMUTABLE_LEDGER|1451|1452|foreign key constraint|a foreign key constraint fails/i;

export function isInvariantBlock(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: string })?.code ?? '';
  if (code === 'P2003' || code === 'P2014') return true;
  return INVARIANT_BLOCK_PATTERN.test(msg);
}

/**
 * Run teardown deletes in order. Returns which steps were blocked by
 * production invariants. Throws on any non-invariant error.
 */
export async function cleanupCompanyScope(steps: TeardownStep[]): Promise<TeardownReport> {
  const report: TeardownReport = { deleted: [], skipped: [] };
  for (const step of steps) {
    try {
      await step.run();
      report.deleted.push(step.label);
    } catch (e) {
      if (isInvariantBlock(e)) {
        const reason = e instanceof Error ? e.message.split('\n')[0] : String(e);
        report.skipped.push({ label: step.label, reason });
        continue;
      }
      throw e;
    }
  }
  if (report.skipped.length > 0) {
    console.warn(
      `[teardown] ${report.skipped.length} step(s) blocked by production invariants (expected): ` +
        report.skipped.map((s) => s.label).join(', '),
    );
  }
  return report;
}
