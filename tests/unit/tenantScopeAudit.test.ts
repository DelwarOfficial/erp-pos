// tests/unit/tenantScopeAudit.test.ts
// Static guard: authenticated route handlers must not perform tenant-scoped
// Prisma work outside an explicit tenant scope (runInTenantContext /
// withAuthenticatedTenant / withTenant). requirePermission is self-scoped
// since the middleware fix and is therefore allowed.
//
// This mirrors the audit methodology (brace-aware handler extraction +
// paren-matched scope spans). It is intentionally structural, not textual:
// formatting changes do not break it. Known false-positive risk is handled
// by asserting on call identities, not line numbers.
//
// EXEMPTIONS (documented, review on change):
// - admin/risk-alerts/evaluate: evaluateRiskAlerts() is intentionally
//   platform-global (systemDb, same service the cron worker calls).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const API_ROOT = join(process.cwd(), 'src', 'app', 'api');
const PRINT_ROOT = join(process.cwd(), 'src', 'app', 'print');
const SCOPERS = ['runInTenantContext', 'withAuthenticatedTenant', 'withTenant('];
// Service functions that use the tenant-scoped client internally.
const SERVICE_CALLS = [
  'listFeatureFlags', 'toggleFeatureFlag', 'seedFeatureFlags', 'isFeatureEnabled',
  'requireFeatureFlag', 'generateMushak', 'generateWithholdingCertificate',
  'beginRegistration', 'finishRegistration', 'listCredentials', 'revokeCredential',
  'beginAuthentication', 'finishAuthentication', 'validateImport', 'commitImport',
  'seedPermissions', 'seedDefaultCoa', 'seedLocalization', 'getApprovalThresholds',
  'requiresApproval', 'createApprovalRequest', 'resolveApprovalRequest',
  'lockPeriod', 'unlockPeriod', 'runPeriodCloseWorkflow', 'runRevaluation',
  'reportArAging', 'reportApAging', 'reportBalanceSheet', 'reportCashFlow',
  'reportDashboardSummary',
];
// System-scoped by design: allowed outside tenant context with justification.
const EXEMPT: Array<{ file: string; handler: string; call: string; reason: string }> = [
  {
    file: 'src/app/api/v1/admin/risk-alerts/evaluate/route.ts',
    handler: 'POST',
    call: 'evaluateRiskAlerts',
    reason: 'platform-global systemDb service (same as cron worker), admin-gated',
  },
];

const DB_OP = /\bdb\.(\w+)\s*\.\s*(findFirst|findMany|findUnique|create|update|delete|count|aggregate|upsert|createMany|updateMany|deleteMany)\s*\(/g;

interface Handler {
  name: string;
  body: string;
}

function extractHandlers(src: string): Handler[] {
  const lines = src.split('\n');
  const out: Handler[] = [];
  const head = /^\s*export\s+async\s+function\s+(\w+)/;
  for (let i = 0; i < lines.length; i++) {
    const m = head.exec(lines[i]);
    if (!m) continue;
    let depth = 0;
    let parens = 0;
    let started = false;
    let end = i;
    for (let j = i; j < lines.length; j++) {
      const text = j > i ? lines[j] : lines[j].slice(m[0].length);
      for (const ch of text) {
        if (ch === '(') parens++;
        else if (ch === ')') parens--;
        else if (ch === '{' && parens <= 0) { depth++; started = true; }
        else if (ch === '}' && parens <= 0 && started) depth--;
      }
      if (started && depth === 0) { end = j; break; }
    }
    out.push({ name: m[1], body: lines.slice(i, end + 1).join('\n') });
  }
  return out;
}

/** Paren-matched spans of scoper calls: [start, end] offsets in body. */
function scopeSpans(body: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const sc of SCOPERS) {
    let idx = 0;
    while (true) {
      const at = body.indexOf(sc, idx);
      if (at < 0) break;
      // find opening paren
      let k = at + sc.length;
      while (k < body.length && body[k] !== '(') k++;
      let depth = 0;
      let inStr: string | null = null;
      for (; k < body.length; k++) {
        const ch = body[k];
        if (inStr) {
          if (ch === inStr && body[k - 1] !== '\\') inStr = null;
        } else if (ch === '"' || ch === "'" || ch === '`') {
          inStr = ch;
        } else if (ch === '(') {
          depth++;
        } else if (ch === ')') {
          depth--;
          if (depth === 0) break;
        }
      }
      spans.push([at, k]);
      idx = at + 1;
    }
  }
  return spans;
}

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (e === 'route.ts') out.push(p);
  }
  return out;
}

describe('tenant scope audit (static guard)', () => {
  it('no authenticated handler performs tenant work outside explicit scope', () => {
    const files = [...routeFiles(API_ROOT), ...routeFiles(PRINT_ROOT)];
    expect(files.length).toBeGreaterThan(100);
    const violations: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const rel = f.replace(process.cwd() + '/', '').replace(/\\/g, '/');
      for (const h of extractHandlers(src)) {
        if (!h.body.includes('authenticateRequest()') && !h.body.includes('verifyAccessToken(')) continue;
        const spans = scopeSpans(h.body);
        const inScope = (pos: number) => spans.some(([a, b]) => pos >= a && pos <= b);
        const check = (pattern: RegExp, label: (m: RegExpMatchArray) => string) => {
          for (const m of h.body.matchAll(pattern)) {
            const pos = (m.index ?? 0);
            if (inScope(pos)) continue;
            const isExempt = EXEMPT.some(
              (x) => rel.endsWith(x.file.replace('src/', '')) || rel === x.file,
            );
            if (!isExempt) violations.push(`${rel} :: ${h.name} :: ${label(m)}`);
          }
        };
        check(new RegExp(DB_OP.source, 'g'), (m) => `${m[1]}.${m[2]}`);
        for (const s of SERVICE_CALLS) {
          check(new RegExp(`\\b${s}\\s*\\(`, 'g'), () => `${s} (service)`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('enterWith is never used for request scoping', () => {
    // The removed enterTenantContext() must not return in any form. Comments
    // may document the ban, so strip them before matching live code.
    const stripComments = (src: string) =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n');
    const lib = stripComments(readFileSync(join(process.cwd(), 'src/lib/db/transactionContext.ts'), 'utf8'));
    expect(lib).not.toMatch(/\.enterWith\(/);
    expect(lib).not.toMatch(/export function enterTenantContext/);
    const mw = stripComments(readFileSync(join(process.cwd(), 'src/lib/auth/middleware.ts'), 'utf8'));
    expect(mw).not.toMatch(/enterTenantContext/);
    expect(mw).not.toMatch(/\.enterWith\(/);
    // No route or lib may import it either.
    const importers: string[] = [];
    for (const f of [...routeFiles(API_ROOT)]) {
      const src = stripComments(readFileSync(f, 'utf8'));
      if (/enterTenantContext/.test(src)) importers.push(f);
    }
    expect(importers).toEqual([]);
  });
});
