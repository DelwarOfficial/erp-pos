# Full Codebase Bug Hunt and Remediation Prompt

Reusable prompt for driving an agent through a complete correctness audit and fix pass
on this repository, with an explicit go-live scoring rubric. Paste the block below as
the task prompt. Adjust the scope line if you want a partial run.

---

## The prompt

You are performing a full correctness audit and remediation pass on this ERP/POS
codebase. The goal is a production go-live readiness score of 98/100 against the rubric
at the end of this prompt. Work in phases. Do not skip ahead, and do not stop at the
first batch of findings.

### Context you must establish first

Before reading any application code:

1. Read `AGENTS.md` and `CLAUDE.md`. This project pins a Next.js version whose APIs and
   conventions differ from common training data — read the relevant guides under
   `node_modules/next/dist/docs/` before writing or judging any framework code. Heed
   deprecation notices.
2. Read `docs/master-plan/ERP_Pos_Blueprint_v4.2.md` for intended domain behavior, and
   scan `docs/adr/` for decisions that constrain the design.
3. Read the most recent files in `docs/audits/` so you do not re-report findings that
   were already triaged, and so you can verify claimed remediations actually landed.
4. Read `docs/runbooks/go-live-checklist.md` and treat every unchecked item as an open
   finding until proven otherwise.
5. Establish how the three database targets relate: `prisma/schema.prisma`,
   `prisma/schema.postgres.prisma`, and `prisma/mariadb/`, plus the `m1`–`m7` and
   `m-gap` additions files, and the `rls/`, `triggers/`, `functions/`, `roles/`
   directories. Any finding about data integrity must state which targets it affects.

Write what you learned to `docs/audits/<date>-audit-context.md` before proceeding. Keep
it short — it exists so later phases and later sessions do not re-derive it.

### Phase 1 — Static sweep

Run the project's own gates and capture real output. Do not summarize a failure you did
not actually run.

- `bun run lint`
- `bunx tsc --noEmit`
- `bun run test`
- `bun run test:e2e` (note which projects are skipped and why)

Then sweep for mechanical defect classes across `src/`:

- `any`, `as unknown as`, and non-null assertions (`!`) in code paths that touch money,
  quantity, tax, or permissions
- unawaited promises and floating async calls, especially inside route handlers
- `catch` blocks that swallow errors or return success
- `console.*` left in server code where the logging subsystem in `src/lib/logging`
  should be used
- environment variables read directly rather than through the project's config path,
  and any that are missing from `.env.example`

Report each with `file:line`, the class of defect, and whether it is reachable in a
request path.

### Phase 2 — Domain correctness (the highest-value phase)

This is an accounting and inventory system. Most severe bugs will be here, not in the
framework layer. For each area below, trace at least one complete write path from the
route handler through `src/domain` and `src/lib` to the database, and state whether the
invariant holds under concurrency and under partial failure.

**Money and ledger.** Every posting in `src/lib/accounting` and
`src/app/api/v1/journal-entries`, `accounting`, `accounting-policies`. Check: debits
equal credits on every entry; no floating-point arithmetic on monetary values anywhere;
rounding is applied once and at a defined boundary; multi-currency entries record the
rate used and cannot be reposted at a different rate; reversals net to zero rather than
deleting rows. Check `exchange-rates`, `fiscal-periods`, and `tax-periods` for entries
posted into closed periods.

**Inventory.** `src/domain/inventory`, `src/lib/inventory`, and the `inventory`,
`transfers`, `stock-adjustments`, `stock-counts`, `serials`, `landed-costs` routes.
Check: stock cannot go negative unless explicitly allowed by policy; costing method is
applied consistently; transfers are atomic across both locations; serial and batch
identity is never duplicated or orphaned; a stock count reconciliation cannot double-post.

**Sales, returns, refunds, payments.** `sales`, `sale-returns`, `refunds`, `payments`,
`installments`, `gift-cards`, `cashier-shifts`. Check: a return cannot exceed the
original quantity or value across multiple partial returns; refunds cannot exceed
captured payments; gift card redemption is atomic against balance and cannot be
double-spent under concurrent requests; shift close totals reconcile to the underlying
transactions. Gift cards are the most recently changed area — audit them hardest.

**Purchases and payables.** `purchases`, `purchase-returns`, `suppliers`,
`courier-settlements`, `reconciliations`, `bank-reconciliations`, `account-transfers`.
Check three-way match logic, over-receipt handling, and that settlement postings cannot
be applied twice.

**Tax.** `src/lib/tax`, `tax-codes`, `tax-components`, `tax-periods`. Check inclusive
versus exclusive computation, compound components, rounding order relative to line
versus document totals, and that historical documents keep the rate in force at their
date rather than the current rate.

**Payroll and assets.** `src/lib/payroll`, `payroll-runs`, `advances`, `fixed-assets`,
`fixed-asset-categories`. Check depreciation schedules, disposal postings, and that an
advance is recovered exactly once.

For each invariant, state explicitly whether it is enforced in application code, by a
database constraint or trigger, or in both. An invariant enforced only in application
code on a multi-writer system is a finding.

### Phase 3 — Concurrency, idempotency, and transactions

- Every route that mutates state: is it wrapped in a transaction, and is the isolation
  level sufficient for the invariant it claims? Read-then-write without a lock or a
  unique constraint is a finding.
- `src/lib/idempotency`: which mutating endpoints actually use it? List every mutating
  route that does not. Retries are certain in a POS with unreliable connectivity.
- `src/app/api/v1/offline`: check the sync/replay path for duplicate application,
  clock-skew ordering, and conflict resolution that silently drops a write.
- `src/lib/numbering`: document and receipt number generation must not produce gaps that
  violate statutory sequencing, nor duplicates under concurrency.
- `src/lib/queue` and `src/workers`: are jobs idempotent, do they have retry limits and
  dead-letter handling, and can a redelivered job double-post to the ledger?

### Phase 4 — Security and access control

- `src/lib/access`, `src/lib/permissions`, `src/middleware.ts`: is every route under
  `src/app/api/v1` covered by an authorization check? Produce the list of routes with no
  check and justify each one. Cross-check against
  `docs/audits/2026-09-12-access-control.md` and `docs/TOKEN-SCOPE.md`.
- Multi-tenancy and branch scoping: can a request read or write another branch's or
  tenant's rows by supplying an ID? Test the IDOR case on at least five resources.
- `src/lib/auth`: session lifetime and rotation, argon2 parameters, TOTP replay window,
  WebAuthn challenge storage and origin verification, password reset token entropy,
  single use, and expiry.
- Injection surface: any raw SQL or `$queryRawUnsafe`, any dynamic Prisma filter built
  from user input, any file path or S3 key derived from user input.
- `webhooks`, `webhook-endpoints`: outbound signing, inbound signature verification,
  replay window, and SSRF protection on user-supplied URLs.
- Secrets: scan the tree for committed credentials. `cookies.txt` and `headers.txt` sit
  at the repository root — inspect both and report whether they contain live session or
  auth material, and whether they are gitignored.
- Compliance paths: `data-subject-requests`, `legal-holds`, `src/lib/retention`,
  `audit-logs`. Check that a deletion request cannot erase rows under legal hold, and
  that the audit log is append-only.

### Phase 5 — Framework, performance, and operations

- Server/client boundary correctness for this Next.js version: server-only code reachable
  from a client component, secrets leaking into the client bundle, caching and
  revalidation defaults applied to per-tenant data.
- N+1 query patterns and unbounded queries — any list endpoint without pagination, any
  report in `src/reports` that loads the full table.
- Missing indexes for the filters actually used by the hot routes.
- Observability: `instrumentation.ts`, Sentry configs, `src/lib/telemetry`. Are errors in
  background workers and queue consumers actually captured? Is PII scrubbed before it
  reaches Sentry?
- `src/lib/health` and `api/v1/health`: does the health check verify dependencies, or
  does it return 200 unconditionally?
- Migration safety: any migration that drops or renames a column without a backfill and
  an expand-contract sequence.

### Output format

Produce `docs/audits/<date>-full-bug-hunt.md` containing a findings table, ordered by
severity, one row per finding:

| ID | Severity | Area | `file:line` | Defect | Failure scenario | Fix | Verified by |

Severity definitions:

- **P0** — data loss, money computed or posted incorrectly, authentication bypass,
  cross-tenant data exposure. Blocks go-live.
- **P1** — a domain invariant that can be violated under realistic concurrency or retry,
  a missing authorization check on a sensitive route, a silent failure path.
- **P2** — correctness bug with a workaround, missing validation, performance cliff.
- **P3** — maintainability, dead code, missing test coverage on a critical path.

Every finding must include a concrete failure scenario: specific inputs or interleaving
that produce the wrong result. A finding you cannot make concrete is a hypothesis —
label it as such in a separate section rather than inflating the table.

### Remediation rules

1. Fix in severity order: all P0, then all P1, then P2. Do not begin P2 until P1 is clear.
2. Every fix ships with a regression test that fails before the change and passes after.
   For concurrency findings, the test must exercise the interleaving, not just the happy
   path.
3. A domain invariant gets enforced at the database level — constraint, unique index, or
   trigger — in addition to application code, across every database target the finding
   affects. Add the same guard to `schema.prisma`, `schema.postgres.prisma`, and the
   MariaDB schema, and say so in the finding row.
4. One logical fix per commit, using the repository's existing commit-message convention.
   Never bundle unrelated fixes.
5. Do not refactor beyond what the fix requires. If a fix reveals a structural problem
   too large for this pass, file it as a separate P3 finding with a proposed approach.
6. After each severity tier, re-run the full gate set from Phase 1 and record the result
   in the findings document.
7. Report honestly. If a fix is partial, if a test is skipped, if a gate still fails —
   say so explicitly with the output. A silently narrowed scope is worse than an open
   finding.

### Scoring rubric — target 98/100

Score the project at the end of the pass and show the arithmetic.

| Dimension | Points | Full marks require |
|---|---:|---|
| Domain correctness (money, inventory, tax) | 25 | No P0 or P1 open; every invariant in Phase 2 enforced at the database level; ledger balance provable by test |
| Concurrency, idempotency, transactions | 15 | All mutating routes transactional and idempotent; numbering and offline replay proven safe by test |
| Security and access control | 15 | Every route authorized; no IDOR; no injection surface; no committed secrets; auth parameters at current best practice |
| Data integrity and migrations | 10 | Constraints present on all three database targets; every migration reversible or expand-contract |
| Test coverage of critical paths | 10 | Every P0/P1 fix has a regression test; ledger, stock, tax, and refund paths covered end to end |
| Error handling and resilience | 8 | No swallowed errors; worker retries bounded with dead-letter handling; partial failures leave no half-posted state |
| Observability and operations | 7 | Errors captured from every surface including workers; health check verifies dependencies; PII scrubbed |
| Performance | 5 | No N+1 or unbounded query on a hot path; indexes match actual filters |
| Framework correctness | 5 | Server/client boundary clean; no secret in the client bundle; caching correct for per-tenant data |

Deduct the full weight of a dimension for any open P0 in it, half for an open P1. State
the residual 2 points you are accepting and why, since 100 implies no known risk at all.

### What not to do

- Do not report style preferences as bugs.
- Do not claim a fix works without running something that proves it.
- Do not rewrite working subsystems because a different structure would be cleaner.
- Do not mark the pass complete while any gate from Phase 1 is failing.

---

## Running this in parts

For a narrower run, replace the phase list with a single phase and keep the output
format, remediation rules, and rubric unchanged. The rubric only produces a meaningful
score after Phases 1 through 5 have all been executed at least once.
