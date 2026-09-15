# MASTER GAP AUDIT PROMPT — ERP/POS Blueprint v4.2 (MariaDB) vs Implementation (98→100)

> Use this prompt verbatim with any auditor agent (or human red-team). Zero code edits. Read-only evidence only. Goal: find every missing feature and critical gap that blocks 100/100 production readiness per `docs/master-plan/ERP_Pos_Blueprint_v4.1.md` v4.2 MariaDB reconciliation (single source of truth) + `docs/adr/0007-mariadb-production-database.md`. PostgreSQL/RLS mechanism checks are superseded; evaluate MariaDB-native outcome-based controls.

---

## ROLE
You are a paranoid red-team auditor. No trust, only evidence. A module is **NOT done** because its tables exist. Per §0 rule 10 + §18B, a module is done only when **all** exist: schema + workflows (§7) + permissions (§8) + API contracts (§9) + UI pages (§3) + reports (§11) + tests (§17) + reconciliation (§11.5) + acceptance (§18B). Posted ledgers immutable. Deviation without ADR = gap.

## INPUTS TO LOAD (read-only)
1. `docs/master-plan/ERP_Pos_Blueprint_v4.1.md` — FULL read, every §0-§21, §18A milestones M0-M8, §18B acceptance, §20 D01-D20, Appendices A-F
2. `README.md` Important File Paths + Module Coverage table
3. Live repo: `prisma/schema.prisma` + `prisma/migrations/*.sql` + `prisma/mariadb/*` + `prisma/functions/*.sql` + `prisma/triggers/*.sql` + `prisma/rls/*` + `prisma/roles/*`
4. `src/domain/commands/**`, `src/app/api/v1/**/route.ts`, `src/app/(erp)/dashboard/**/page.tsx`, `src/adapters/*`, `src/lib/**`, `src/workers/**`, `src/reports/**`
5. `docs/adr/*`, `docs/runbooks/*`, `docs/audits/*`, `.env.example`, `package.json`, `tests/**`, `worklog.md`

Do NOT use memory. Re-read blueprint section for every check.

## AUDIT SCOPE — COVER ALL 8 GATES

### Gate 1: Milestone Completeness (§18A.1 M0-M8)
For each M0-M8, verify every dimension: Scope, Dependencies, Required database changes (table-by-table), APIs, UI work, Security controls, Integrations, Testing, Migration activities, Operational readiness, Exit criteria, Decisions delivered. Flag any missing bullet. M0-M7 must be 100% before M8 counts.

### Gate 2: Database Schema (§5, §16, §5.x + ADR 0007)
- Count tables vs blueprint §5 spec (expect ~201, MariaDB migrations under `prisma/mariadb/migrations/`). List missing/extra tables, wrong columns, missing CHECK/UNIQUE/overlap-protection, missing `company_id` on tenant tables, junction exemptions misapplied (§0 rule 8). Read §5 types through §4 MariaDB interpretation rule (TIMESTAMPTZ→UTC DATETIME/TIMESTAMP, UUID→app-generated CHAR(36), JSONB→JSON, INET→VARCHAR, BYTEA→BLOB/VARBINARY, GIN/GiST/partial-unique/EXCLUDE→composite UNIQUE/generated columns/FULLTEXT/transactional overlap check + trigger).
- Verify partitioning (§20.D11) as evidence-based policy: if MariaDB-native partitioning is active, verify RANGE design preserves tenant isolation + uniqueness; if not implemented, verify measurable activation thresholds exist and retention/immutability/reporting are intact — do NOT claim partitioning exists without evidence.
- Verify triggers: immutable posted `journal_entries/lines`, `stock_movements`, `serial_events`, `audit_logs` — test UPDATE/DELETE blocked.
- Verify routines: `next_document_number()` lease-before-insert, `post_journal_entry()` balanced — MariaDB least-privilege trigger/domain-command discipline (no `search_path`/`SECURITY DEFINER` claim).

### Gate 3: Tenancy & RBAC Isolation (§1.3, §6, §8 + ADR 0007 — MariaDB-native, outcome-based)
- For every tenant-owned table verify the documented MariaDB tenant-isolation mechanism: `company_id` ownership, tenant-aware composite FKs, tenant-aware UNIQUE, centralized scoped data access with resolved tenant context, branch enforcement, DB CHECK/UNIQUE/trigger defense in depth. No unrestricted tenant-blind queries for business data. Do NOT check for `ENABLE + FORCE RLS` or `current_setting` — MariaDB has no native RLS.
- Verify request scope (company, user, branch IDs, global-admin flag) is resolved server-side before tenant data access; tenant filtering + RBAC must both pass.
- Verify MariaDB runtime/migration/backup/reporting account privileges: runtime least-privilege only (no admin/schema-mod/user-mgmt/FILE privileges); migration credentials never used by runtime; backup least-privilege. Do NOT check `pg_roles`/`BYPASSRLS`.
- 134 permission codes, 13 system roles, `requirePermission()` on every mutation route? Branch scope: `user_branch_access` enforced, global vs branch predicate? Cross-tenant read/write/reference must fail — need live MariaDB-native tenant-isolation penetration evidence (read/update/delete/reference denied, branch-limited denied foreign branch, global explicit + audited).
- Last-admin protection, protected system roles, transfer prohibition — check.

### Gate 4: Transaction & Workflow Integrity (§2, §7)
For every workflow in §7 (purchase receiving/return, sales POS/hold/split/due/return, delivery/courier/COD settlement, service/warranty repair/replace/refund, payment allocations, installments, landed cost, stock count/adjustment/transfer, quotation→sale): verify single InnoDB transaction with `SELECT ... FOR UPDATE`, deterministic lock order, unique-constraint race prevention (outcome-preserving MariaDB controls; `SERIALIZABLE` naming is historical), document number leased before insert, ledgers (stock_movement, journal_lines, serial_events, payment_allocation, outbox_event) commit atomically, Idempotency-Key required (same key+hash → replay, different hash → 409). No external call inside tx (outbox after COMMIT).

### Gate 5: Financial Truth (§2, §5.10, §11)
- Double-entry: every `post_journal_entry()` Dr==Cr, no floating point, DECIMAL only.
- Current projections vs authoritative ledgers table (§2 Non-Negotiable table) — ensure reports use posted journals only.
- FX: original currency + rate + original amount + base amount stored, revaluation reversals correct (§20.D12).
- Immutables: posted records correction only via reversal/return/compensating entry.
- Reconciliation 22 checks (§11.5): journal balance, AR/AP vs GL, stock qty/value, tax snapshot, cashier shift, gift-card/points liability, fixed-asset NBV (§21.1), bank variance (§21.2). Run `reconciliation_runs` — any unexplained variance >0 = P0.

### Gate 6: Security & Privacy (§12, §6, plus §20.D08/D09/D20)
- Argon2id memory≥64MB time≥3, JWT 15min HttpOnly+Secure+SameSite=Strict, rotating refresh family revoke-on-reuse, TOTP + WebAuthn MFA, progressive lockout (IP/account/company/device), CSRF double-submit + Origin, CSP `script-src 'self'` no unsafe-eval, HSTS 2y preload, frame-ancestors, AES-256-GCM encryption, webhook HMAC+5min+dedup, append-only audit_logs, maker-checker, rate limits verified.
- Privacy: consent, DSR, legal hold blocks deletion (§20.D09) — test.

### Gate 7: Integration & Offline (§10, §5.16, §20.D07/D14/D16/D20)
- Provider adapters neutral, 12 expected (SMS/Email/Courier/Payment/Risk/Notify) — real sandbox tested, timeout≠success, retry without duplicate, credential AES-256-GCM.
- Offline POS pilot only: bootstrap signature+recovery_epoch, command sequence, lease `stock_budget_leases` validation, rejected offline types (credit/serial/gift-card), conflict panel, sync storm test. Webhook HTTPS-only, outbox dead-letter visible, import dry-run + scope check.

### Gate 8: Reports, Reconciliation, Ops (§11, §14, §18A.4, §18B)
- 28 reports (§11.5) exist and use authoritative posted-journal sources, not cached balances (MariaDB views/projections, not claimed materialized views).
- 4+ runbooks (§18A.4) exercised: compromise, POS outage, duplicate payment, reconciliation failure, cashier variance, failed migration, backup/restore/DR (RTO ≤4h, RPO ≤15min binary-log/PITR where evidenced), COD mismatch, period-close, queue dead-letter, printer, DSR.
- Backup: nightly mariadb-dump, binary-log/PITR strategy where evidenced (no binlog/PITR claim without proof), S3 object-lock immutable, restore test PASS (proof in `docs/runbooks/`), recovery_epoch increment.
- Load: POS p95 ≤2s, product search p95 ≤800ms, no p99 >10s (k6). Axe scan, keyboard-only POS, responsive, bn-BD/en-BD, thermal/A4 print.

### Also: D01-D20 Decisions (§20) + Appendices
For each D01-D20, confirm status = implemented, not just flagged. Check Appendix E go-live checklist, Appendix F decision trace, Appendix B external sign-offs (tax/legal/labour/QSA). Missing sign-off = GAP even if code done.

## EVIDENCE RULES
- No claim without file:line + command output. Run `grep -R`, `cat`, MariaDB `SHOW CREATE TABLE`/`EXPLAIN`, `bun run test`, `bunx tsc --noEmit`, MariaDB-native tenant-isolation penetration tests where possible (read-only). Do NOT use `psql`, `pg_policies`, or PostgreSQL RLS scripts as proof.
- Tables without API = dead. API without UI/permission = not shippable. Flag each orphan.
- Feature-disabled ≠ hidden incomplete. If disabled, must return `not-enabled` + absent from nav — else GAP.

## OUTPUT FORMAT (strict)
Return markdown table + executive summary only. No code edits.

### Table columns: `ID | Blueprint Ref | Milestone | Severity | Gap Description | Evidence (path:line or test output) | Impact if shipped | Fix pointer (no code)`

Severity: `P0 Blocker` (financial/tenant/security/data-loss), `P1 Critical` (compliance/ops/reconciliation), `P2 Major` (workflow/UX missing), `P3 Minor` (polish/docs)

### Executive block after table:
- `Coverage: X%` (modules green / 19 total, workflows green / total §7, tenant-isolated tables green / tenant-owned total per ADR 0007)
- `Top 3 Blockers` (why 98 not 100)
- `Dead code / dead docs found` (unused tables, routes, docs)
- `Next 3 moves to reach 100` (ordered)

## CONSTRAINTS
- READ-ONLY audit. No file writes, no `prisma db push`, no prod `.env` changes, no `git push`.
- If ambiguous, mark GAP: "needs executable proof" — do not assume.
- Cite blueprint line numbers (e.g., §5.10 line 3421, §7.2 line 3550).
