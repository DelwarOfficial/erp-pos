# MASTER GAP AUDIT PROMPT — ERP/POS Blueprint v4.2 (MariaDB)
# Evidence-First Production Readiness Audit (98→100)

> Use this prompt verbatim with an auditor agent or human red-team reviewer.
>
> READ-ONLY AUDIT ONLY.
> ZERO CODE EDITS.
> ZERO PRODUCTION MUTATIONS.
>
> Goal:
> Identify every confirmed implementation gap, unproven control, incomplete
> workflow, operational deficiency, and acceptance-evidence gap that prevents
> the ERP/POS from achieving evidence-supported production readiness under:
>
> 1. docs/master-plan/ERP_Pos_Blueprint_v4.1.md
>    - reconciled as Blueprint v4.2 for MariaDB
> 2. docs/adr/0007-mariadb-production-database.md
>
> MariaDB 11.8.x is the authoritative production database architecture.
> PostgreSQL/RLS-specific mechanisms are superseded.
>
> Audit outcomes, not obsolete PostgreSQL syntax.

======================================================================
ROLE
======================================================================

You are a paranoid production-readiness red-team auditor.

Trust nothing without evidence.

A module is NOT considered complete merely because:

- tables exist
- routes exist
- UI exists
- tests exist
- code compiles

A module is complete only when all applicable blueprint requirements are
demonstrated, including:

- schema
- workflow implementation
- permissions
- tenant/branch isolation
- API contract
- UI/page coverage
- accounting/stock effects where applicable
- reports
- reconciliation
- tests
- concurrency safety
- failure/rollback behavior
- operational acceptance criteria

Posted accounting, stock, serial, payment, tax, cashier, statutory, audit,
and other immutable ledger records must remain immutable.

Any architectural deviation from the blueprint requires an approved ADR.

Do not use memory as evidence.

For every major finding:
re-read the relevant blueprint requirement and inspect current implementation.

======================================================================
AUTHORITATIVE INPUTS
======================================================================

Read and audit:

1. docs/master-plan/ERP_Pos_Blueprint_v4.1.md
   - current content is Blueprint v4.2 MariaDB reconciliation
   - read all sections
   - §0–§21
   - §18A milestones M0–M8
   - §18B acceptance criteria
   - §20 D01–D20
   - Appendices A–F

2. docs/adr/0007-mariadb-production-database.md

3. README.md
   - Important File Paths
   - module coverage
   - architecture/deployment notes

4. Database implementation:
   - prisma/mariadb/schema.prisma
   - prisma/mariadb/migrations/**
   - prisma/functions/**
   - prisma/triggers/**
   - any MariaDB-specific SQL
   - legacy prisma/schema.prisma only for historical comparison if needed

5. Application implementation:
   - src/domain/commands/**
   - src/app/api/v1/**/route.ts
   - src/app/(erp)/dashboard/**
   - src/components/**
   - src/lib/**
   - src/adapters/**
   - src/workers/**
   - src/reports/**

6. Governance and operations:
   - docs/adr/**
   - docs/runbooks/**
   - docs/audits/**
   - .env.example
   - package.json
   - tests/**
   - worklog.md

Do not treat old PostgreSQL files or historical runbooks as authoritative
for current MariaDB production behavior unless the blueprint/ADR explicitly
marks them current.

======================================================================
ABSOLUTE SAFETY RULES
======================================================================

READ-ONLY audit.

Do NOT:

- edit files
- create migrations
- run prisma db push
- modify production .env
- change database schema
- restart production services
- deploy
- push Git commits
- mutate production data
- benchmark production destructively
- penetration-test production
- run destructive SQL against production
- print secrets

Never display:

- DATABASE_URL
- passwords
- access tokens
- refresh tokens
- cookies
- MFA secrets
- WebAuthn secrets
- Redis credentials
- encryption keys
- SMTP/API provider secrets

All executable database tests must use:

- disposable MariaDB
- local/test MariaDB
- isolated test fixtures

unless the business owner separately and explicitly authorizes a specific
production read-only check.

Never infer authorization.

======================================================================
EVIDENCE CLASSIFICATION
======================================================================

Every audited requirement must be classified as exactly one:

PASS
Requirement demonstrated by acceptable evidence.

CONFIRMED GAP
Implementation is absent, incorrect, incomplete, unsafe, or directly
contradicts the blueprint.

UNPROVEN
Implementation may exist, but required executable or documentary evidence
is missing or incomplete.

NOT APPLICABLE
Allowed only when the blueprint or approved ADR explicitly makes the
requirement inapplicable.

Important:

UNPROVEN is NOT the same as CONFIRMED GAP.

Do not describe something as "missing" unless absence is actually demonstrated.

Example:

Bad:
"Tenant isolation is missing because no penetration test was run."

Correct:
"Tenant isolation implementation exists, but executable cross-tenant proof
is UNPROVEN."

======================================================================
SEVERITY
======================================================================

P0 BLOCKER
- tenant escape
- cross-company mutation
- financial corruption
- stock corruption
- unsafe authentication bypass
- data loss
- duplicate financial posting
- broken immutable ledger
- unreconciled material accounting variance

P1 CRITICAL
- serious compliance deficiency
- backup/restore failure
- DR failure
- reconciliation control missing
- high-impact security weakness
- unsafe operational recovery
- major production workflow integrity problem

P2 MAJOR
- incomplete workflow
- missing UI/API integration
- important usability gap
- missing acceptance evidence
- major feature incompleteness without immediate data-corruption risk

P3 MINOR
- documentation mismatch
- polish
- minor UX inconsistency
- low-impact observability/documentation deficiency

Do not inflate severity solely because evidence is unavailable.

Use UNPROVEN + appropriate severity.

======================================================================
GATE 1 — MILESTONE COMPLETENESS
======================================================================

Audit Blueprint §18A M0–M8.

For every milestone verify:

- scope
- dependencies
- required database changes
- APIs
- UI
- permissions
- security controls
- integrations
- tests
- migration activities
- operational readiness
- exit criteria
- resolved decisions

M0–M7 must satisfy their required exit criteria before M8 can be considered
fully achieved.

For each incomplete milestone identify:

- CONFIRMED GAP
or
- UNPROVEN evidence

Do not mark an entire milestone failed merely because one optional feature
is feature-flagged where the blueprint permits that state.

======================================================================
GATE 2 — DATABASE SCHEMA & INTEGRITY
======================================================================

Audit the authoritative MariaDB schema against Blueprint §5 and ADR 0007.

First derive the authoritative expected table set from the current blueprint.

Do NOT rely solely on remembered counts.

The current blueprint may be approximately ~201 tables, but score using the
actual blueprint-derived set.

Check:

- missing tables
- extra unexplained tables
- wrong columns
- wrong nullability
- wrong DECIMAL precision
- missing PK
- missing FK
- missing UNIQUE
- missing CHECK
- missing tenant ownership
- missing branch ownership
- missing tenant-consistency constraints
- missing indexes required for FK/query integrity
- incorrect cascade behavior
- dangerous hard-delete paths

Interpret PostgreSQL-origin type descriptions through the MariaDB architecture
rules.

Expected semantic mappings include:

PostgreSQL UUID
→ application-generated or approved MariaDB UUID representation,
  typically CHAR(36) if that is the authoritative implementation

TIMESTAMPTZ
→ MariaDB DATETIME/TIMESTAMP storage with UTC semantics

JSONB
→ JSON with schema validation requirements preserved

BYTEA
→ BLOB / VARBINARY as appropriate

INET
→ validated textual/binary IP representation

PostgreSQL enum
→ CHECK, lookup table, or application enum according to implementation

GIN/GiST/partial UNIQUE/EXCLUDE
→ MariaDB-compatible equivalent preserving the same invariant

Do not fail implementation merely because PostgreSQL syntax is absent.

Audit the invariant.

----------------------------------------------------------------------
2A. Tenant ownership
----------------------------------------------------------------------

Every tenant-owned table must have appropriate tenant ownership.

Usually:

company_id

Branch-scoped entities must additionally contain or safely resolve:

branch_id

Junction-table exemptions are allowed only where the blueprint explicitly
permits inherited tenant scope and where cross-tenant linkage remains
structurally impossible.

----------------------------------------------------------------------
2B. Composite tenant relationship protection
----------------------------------------------------------------------

Verify cross-company FK relationships cannot be constructed.

Where appropriate, tenant-owned relationships should be protected by
equivalent constraints such as:

(company_id, foreign_id)
→ parent(company_id, id)

or another evidence-backed MariaDB mechanism producing the same outcome.

Flag:

- cross-company reference possible
- tenant ID present but not enforced
- application-only assumption where DB protection is feasible and required

----------------------------------------------------------------------
2C. Database immutability
----------------------------------------------------------------------

Verify database/application protections for:

- posted journal entries
- journal lines
- stock movements
- serial events
- audit logs
- finalized financial documents where blueprint requires immutability

Executable tests should demonstrate prohibited UPDATE/DELETE behavior where
applicable.

----------------------------------------------------------------------
2D. Database routines / posting mechanisms
----------------------------------------------------------------------

Verify the actual MariaDB/application mechanisms responsible for:

- document numbering
- journal balance enforcement
- posting integrity
- audit protection
- idempotency
- reconciliation

Do NOT require PostgreSQL:

- SECURITY DEFINER
- search_path
- pg function syntax

unless historical comparison is explicitly needed.

======================================================================
GATE 3 — TENANT, BRANCH & RBAC ISOLATION
======================================================================

MariaDB does NOT provide PostgreSQL native RLS.

Do NOT audit for:

- ENABLE RLS
- FORCE RLS
- current_setting()
- set_config()
- BYPASSRLS
- pg_roles
- pg_policies

Instead audit the MariaDB-native layered isolation contract.

Required layers:

1. companies is tenant root
2. company_id ownership
3. branch ownership where applicable
4. tenant-aware FKs
5. tenant-aware UNIQUE constraints
6. centralized tenant-scoped data access
7. trusted server-side request scope
8. RBAC
9. branch authorization
10. DB constraints/triggers
11. executable cross-tenant tests
12. restricted runtime DB privileges

Verify server-side scope resolves:

- company
- user
- permitted branches
- permissions
- global/platform-admin state where applicable

before tenant-owned business data access.

Tenant filtering and RBAC must BOTH succeed.

One does not replace the other.

----------------------------------------------------------------------
3A. Cross-tenant executable proof
----------------------------------------------------------------------

Use disposable MariaDB/test fixtures.

Prove:

Tenant A cannot:

- read Tenant B data
- update Tenant B data
- delete Tenant B data
- attach FK relationships to Tenant B resources
- assign Tenant B roles
- assign Tenant B branches
- post documents into Tenant B
- move inventory into Tenant B

Branch-limited user cannot:

- mutate foreign branch
- access foreign branch resources outside permission scope

Platform/global administration must be:

- explicit
- permission protected
- audited

If implementation appears correct but executable penetration proof is absent:

classify UNPROVEN, not CONFIRMED GAP.

----------------------------------------------------------------------
3B. Permissions
----------------------------------------------------------------------

Derive the authoritative permission catalogue and system-role catalogue from
the current blueprint.

Current expected counts may be approximately:

- 134 permissions
- 13 system roles

but do NOT fail solely because remembered counts differ.

Report actual blueprint-derived counts.

Verify:

- mutation routes require appropriate permission
- branch scope enforced
- global scope explicit
- protected/system roles cannot be abused
- last-admin protection exists
- unsafe role transfer/escalation blocked

----------------------------------------------------------------------
3C. MariaDB DB privileges
----------------------------------------------------------------------

Verify production architecture defines separated privilege scopes for:

- runtime application account
- migration account
- backup account
- reporting/read-only account where used

Runtime account must not possess unnecessary:

- schema modification
- user management
- administrative
- unrestricted FILE
- global destructive privileges

Migration credentials must not be used by normal application runtime.

Backup credentials must be least-privilege.

If actual production grants cannot be safely inspected:
classify runtime privilege evidence UNPROVEN.

Do not query production solely to satisfy this audit.

======================================================================
GATE 4 — TRANSACTION & WORKFLOW INTEGRITY
======================================================================

Audit every workflow in Blueprint §7.

Examples include:

- purchase receiving
- purchase return
- POS sale
- hold/recall
- split payment
- due sale
- return/refund
- delivery
- courier/COD
- service repair
- warranty replacement
- payment allocation
- installments
- landed cost
- stock count
- stock adjustment
- stock transfer
- quotation → sale

Every business mutation must execute in one explicit transactional boundary
where required by the blueprint.

Do NOT universally require SELECT ... FOR UPDATE.

Instead verify the workflow uses an appropriate evidence-backed MariaDB/InnoDB
concurrency control strategy, such as:

- SELECT ... FOR UPDATE
- atomic conditional UPDATE
- unique constraints
- version columns
- optimistic concurrency
- deterministic lock ordering
- transaction retries
- another demonstrated race-safe mechanism

For each workflow verify:

- document identity generated safely
- all dependent effects are atomic
- stock effect
- serial effect
- payment effect
- tax effect
- journal effect
- audit effect
- outbox effect
- idempotency

Same idempotency key + same request hash:
must replay committed result as designed.

Same key + different request hash:
must return conflict such as 409.

External network calls must not occur inside the transaction.

External effects should be dispatched after commit through the approved
outbox/worker mechanism.

----------------------------------------------------------------------
4A. Rollback integrity
----------------------------------------------------------------------

For critical workflows test failure paths.

Verify failed mutation leaves:

- no partial sale
- no partial payment
- no partial stock change
- no partial journal
- no orphan serial transition
- no duplicate outbox event
- no inconsistent balance projection

======================================================================
GATE 5 — FINANCIAL TRUTH
======================================================================

Audit accounting against Blueprint §2, §5.10, §11 and related decisions.

Verify:

- double-entry accounting
- debit == credit for every posted journal
- DECIMAL only for monetary values
- no binary floating-point accounting
- posted journals immutable
- corrections use reversal/return/compensating entries
- fiscal period controls
- account ownership/tenant isolation
- source-document provenance
- duplicate posting prevention

Reports must derive from authoritative posted accounting data.

Do not allow cached UI balances to become accounting authority.

----------------------------------------------------------------------
5A. Foreign currency
----------------------------------------------------------------------

Where applicable verify storage of:

- transaction currency
- original amount
- exchange rate
- base-currency amount

Verify revaluation/reversal policy per blueprint.

----------------------------------------------------------------------
5B. Reconciliation
----------------------------------------------------------------------

Audit all 22 reconciliation checks defined by the blueprint.

Include where applicable:

- journal balance
- AR vs GL
- AP vs GL
- stock quantity
- stock valuation
- tax snapshot
- cashier shifts
- gift-card liability
- reward-point liability
- fixed-asset NBV
- bank reconciliation
- other blueprint-defined checks

Any material unexplained financial variance:
P0 BLOCKER.

If reconciliation implementation exists but full executable run is unavailable:
UNPROVEN.

======================================================================
GATE 6 — SECURITY & PRIVACY
======================================================================

Audit blueprint security requirements, including where applicable:

- Argon2id configuration
- access token lifetime
- HttpOnly cookies
- Secure cookies
- SameSite policy
- refresh-token rotation
- family revoke on reuse
- TOTP
- WebAuthn
- login lockout
- distributed rate limiting
- CSRF
- Origin validation
- CSP
- HSTS
- frame-ancestors
- AES-256-GCM or approved encryption
- webhook HMAC
- replay window
- webhook deduplication
- append-only audit
- maker-checker controls
- secret handling

Do not assume protection from filenames.

Inspect implementation and tests.

----------------------------------------------------------------------
6A. Authentication abuse controls
----------------------------------------------------------------------

Verify layered protection where implemented:

- Redis identity throttle
- Redis IP throttle
- DB account lockout
- MFA throttling
- WebAuthn assertion throttling
- password reset throttling

If live Redis integration evidence is unavailable but implementation/tests
exist:
classify live distributed behavior UNPROVEN, not missing.

----------------------------------------------------------------------
6B. Privacy
----------------------------------------------------------------------

Verify blueprint requirements for:

- consent
- data subject requests
- deletion policy
- retention
- legal hold
- deletion blocking under legal hold
- auditability

Missing required legal/professional sign-off remains a gap when the blueprint
requires external approval.

======================================================================
GATE 7 — INTEGRATIONS & OFFLINE
======================================================================

Audit provider-neutral integrations.

Expected categories may include:

- SMS
- email
- courier
- payments
- fraud/risk
- notifications
- other blueprint providers

Verify:

- provider abstraction
- sandbox evidence where required
- timeout != success
- retries do not duplicate effects
- credentials encrypted
- no provider secrets in logs
- webhook authenticity
- webhook deduplication
- outbox/dead-letter visibility

----------------------------------------------------------------------
7A. Offline POS
----------------------------------------------------------------------

Offline POS remains subject to blueprint policy.

Verify where applicable:

- signed/bootstrap state
- recovery_epoch
- command sequence
- device registration
- stock budget leases
- restricted offline transaction types
- serialized-item restrictions
- gift-card restrictions
- conflict resolution UI
- replay safety
- sync storm behavior

Feature disabled is acceptable only when blueprint permits it and:

- navigation is absent
- API returns explicit not-enabled behavior
- incomplete implementation is not silently exposed

======================================================================
GATE 8 — REPORTS, RECONCILIATION & OPERATIONS
======================================================================

----------------------------------------------------------------------
8A. Reports
----------------------------------------------------------------------

Verify all blueprint-defined reports.

Current expected registry:
28 reports.

Derive the authoritative count from the current blueprint before scoring.

Verify each required report:

- exists
- has permission enforcement
- is tenant scoped
- is branch scoped where applicable
- uses authoritative sources
- exports correctly where required
- does not rely on stale/non-authoritative balances

MariaDB implementation may use:

- views
- projection tables
- refresh tables
- application-maintained reporting structures

Do NOT require PostgreSQL materialized views.

Financial reports must still derive from authoritative posted journal data.

----------------------------------------------------------------------
8B. Runbooks
----------------------------------------------------------------------

Verify required operational runbooks exist and, where required, have been
exercised.

Examples:

- security compromise
- POS outage
- duplicate payment
- reconciliation failure
- cashier variance
- failed migration
- backup restore
- disaster recovery
- COD mismatch
- period close
- dead-letter queue
- printer failure
- DSR/privacy incident

Documentation alone is not execution evidence.

----------------------------------------------------------------------
8C. Backup / restore / DR
----------------------------------------------------------------------

Audit MariaDB-native backup controls.

Expected outcomes include:

- scheduled logical backup
- mariadb-dump or approved MariaDB backup tooling
- encrypted storage
- restricted permissions
- off-server copy
- retention
- integrity verification
- restore test
- RPO target
- RTO target

Where blueprint requires PITR:

verify MariaDB binary-log/PITR evidence.

Do NOT claim PITR merely because the blueprint mentions it.

If binary-log/PITR implementation is not demonstrated:
classify UNPROVEN or CONFIRMED GAP according to evidence.

Do not use PostgreSQL:

- pg_dump
- WAL
- pgBackRest

as evidence for current MariaDB production readiness.

----------------------------------------------------------------------
8D. Migration controls
----------------------------------------------------------------------

Verify:

- prisma/mariadb/schema.prisma is production authority
- ordered MariaDB migrations
- fresh migration from zero
- repeat migrate deploy
- migration status clean
- no prisma db push in production
- destructive migration review
- schema drift detection
- forward-fix/rollback strategy

----------------------------------------------------------------------
8E. Performance
----------------------------------------------------------------------

Where blueprint defines SLOs verify evidence for:

- POS latency
- product search latency
- API latency
- worker behavior
- N+1 regressions
- high-cardinality queries
- required indexes

Do not mark performance PASS solely because unit tests pass.

----------------------------------------------------------------------
8F. Accessibility / localization / print
----------------------------------------------------------------------

Verify where required:

- keyboard POS operation
- touch targets
- responsive layout
- bn-BD
- en-BD
- thermal receipt
- A4
- printer failure recovery
- accessibility scan evidence

======================================================================
D01–D20 DECISION REGISTER
======================================================================

Audit every resolved decision in Blueprint §20.

For each D01–D20 classify:

PASS
CONFIRMED GAP
UNPROVEN
NOT APPLICABLE

Feature-flagged is not equivalent to implemented.

Where the blueprint requires implementation before enabling:
verify it.

Where external professional approval is required:
missing sign-off remains an explicit readiness gap.

Review:

- Appendix B
- Appendix E
- Appendix F

======================================================================
SUPPORT & LOYALTY SPECIAL CHECK
======================================================================

Explicitly inspect Support and Loyalty because prior audits identified
incomplete paths.

For Support verify:

- persistence authority
- API
- permission
- tenant scope
- UI
- comments
- attachment behavior
- status
- assignment
- audit
- tests

If live navigation uses only localStorage without authoritative backend
persistence:
CONFIRMED GAP.

For Loyalty verify:

- earning
- redemption
- reversal
- liability accounting
- balance authority
- expiration where required
- idempotency
- tenant scope
- tests

Reachable TODO/stub paths:
CONFIRMED GAP.

If an incomplete module is disabled:
verify it is absent from navigation and returns explicit not-enabled behavior.

======================================================================
DEAD CODE / DEAD DOCS
======================================================================

Identify:

- tables with no reachable workflow
- API with no UI/consumer
- UI backed by no authoritative persistence
- unused routes
- obsolete PostgreSQL runbooks
- obsolete RLS scripts
- legacy migration claims
- dead feature flags
- TODO implementation stubs
- documentation that falsely represents current MariaDB behavior

Do not classify historical documentation as harmful merely because it exists.

Only flag it when:

- presented as current
- used as acceptance evidence
- conflicts with authoritative ADR/blueprint

======================================================================
CI / TEST EVIDENCE
======================================================================

Inspect CI and executable tests.

Verify coverage for:

- TypeScript
- production build
- unit tests
- MariaDB integration
- auth
- sessions
- MFA
- WebAuthn
- CSRF
- RBAC
- tenant isolation
- branch isolation
- accounting
- inventory
- payments
- concurrency
- migrations
- Redis limiter
- N+1
- browser smoke
- critical mutation workflows
- rollback/failure workflows
- backup/restore where automated

A test that is permanently skipped without equivalent coverage is not PASS.

Optional/skipped tests must be evaluated individually.

If explicitly runnable and previously demonstrated:
report the evidence rather than calling them simply missing.

======================================================================
CRITICAL BROWSER ACCEPTANCE
======================================================================

Where required by Blueprint §18B, verify browser/API-integrated acceptance
for critical mutations.

Important workflows include:

- POS sale + payment
- purchase receiving
- inventory adjustment
- stock transfer
- journal posting + reversal
- bank reconciliation
- fixed asset + depreciation
- user/role/branch administration

Preferred evidence combines:

- browser/API success
- direct disposable MariaDB assertion

Verify:

- correct row state
- company ownership
- branch ownership
- stock effect
- journal effect
- balanced accounting
- audit/provenance
- idempotency
- no duplicate financial effect
- no duplicate stock effect

If only module-page smoke exists:
do NOT classify mutation workflow acceptance as PASS.

Use UNPROVEN unless the implementation is demonstrably incomplete.

======================================================================
ROLLBACK / FAILURE ACCEPTANCE
======================================================================

For critical workflows verify negative-path evidence such as:

- duplicate POS submission
- payment failure
- duplicate purchase receive
- invalid inventory adjustment
- unauthorized branch transfer
- closed fiscal period
- unbalanced journal
- duplicate reversal
- cross-tenant resource mutation
- unauthorized role/branch assignment

Verify:

- controlled 4xx response where appropriate
- no unexpected 500
- no partial stock
- no partial journal
- no duplicate payment
- no duplicate accounting
- no cross-tenant record
- transaction rollback complete

======================================================================
EVIDENCE RULES
======================================================================

No claim without evidence.

Acceptable evidence includes:

- exact file path + line
- test output
- build output
- MariaDB SHOW CREATE TABLE
- information_schema queries on disposable/test DB
- EXPLAIN
- test logs
- migration output
- browser E2E output
- documented exercised runbook evidence

Useful read-only commands may include:

- grep / rg
- cat / sed
- git diff / git status
- MariaDB SHOW CREATE TABLE
- MariaDB SHOW INDEX
- information_schema inspection
- EXPLAIN
- bun run test
- bunx tsc --noEmit

Do NOT use PostgreSQL-specific proof such as:

- psql
- pg_roles
- pg_policies
- RLS scripts

unless clearly examining historical artifacts.

Do NOT access production solely to obtain evidence.

======================================================================
AUDIT SCORING
======================================================================

The audit score must reflect evidence quality, not optimism.

Do not start from 100 and subtract arbitrary points.

Evaluate required gates and explain deductions.

Hard readiness rules:

Any confirmed P0:
maximum score 40.

Any unresolved P1 affecting production integrity/security/compliance:
maximum score 69 unless severity is explicitly justified otherwise.

Confirmed cross-tenant access defect:
maximum score 50.

Confirmed accounting corruption risk:
maximum score 60.

Confirmed stock integrity defect:
maximum score 60.

Production runtime crash in current candidate:
maximum score 60.

TypeScript/build failure:
maximum score 75.

Unexplained test failures:
maximum score 85.

No production-equivalent built runtime evidence:
maximum score 90.

No meaningful concurrency evidence for critical mutations:
maximum score 94.

No critical browser mutation acceptance:
maximum score 95.

No fresh/repeat MariaDB migration evidence:
maximum score 95.

Large UNPROVEN acceptance areas:
must reduce evidence-supported readiness even when no confirmed defect exists.

99/100 requires all mandatory production gates to be proven.

100/100 requires no material unresolved limitation, unproven mandatory gate,
external sign-off gap, or known incomplete required workflow.

======================================================================
OUTPUT FORMAT
======================================================================

Return:

1. Findings table
2. Executive summary

Do not return code edits.

----------------------------------------------------------------------
FINDINGS TABLE
----------------------------------------------------------------------

Columns:

ID
Blueprint Ref
Milestone
Severity
Evidence Status
Gap Description
Evidence
Impact if shipped
Fix pointer

Evidence Status must be:

PASS
CONFIRMED GAP
UNPROVEN
NOT APPLICABLE

Only include PASS rows when they materially help explain a disputed/high-risk
control.

Otherwise findings table should focus on:

- CONFIRMED GAP
- UNPROVEN

======================================================================
EXECUTIVE SUMMARY
======================================================================

Report:

Coverage:

- Modules fully proven: X / 19
- Workflows fully proven: X / blueprint-derived total
- Tenant-owned tables isolation-proven: X / blueprint-derived tenant table total
- Reports proven: X / blueprint-derived report total
- Reconciliation checks proven: X / blueprint-derived reconciliation total

Then:

Top 3 blockers

Confirmed gaps

Unproven mandatory controls

Dead code / dead docs

Database architecture compliance

Tenant isolation status

Accounting integrity status

Inventory integrity status

Security status

Backup/DR status

Critical workflow E2E status

External sign-off status

Next 3 moves to reach 100

Final score /100

READY FOR 99:
YES / NO

READY FOR LIVE:
YES / NO

READY FOR CUTOVER:
YES / NO

Explain each NO using evidence.

======================================================================
IMPORTANT INTERPRETATION RULES
======================================================================

1. MariaDB is authoritative.

2. PostgreSQL RLS absence is NOT itself a gap.

3. Weak tenant isolation IS a gap.

4. PostgreSQL-specific syntax must not be required when an equivalent
   MariaDB control preserves the invariant.

5. Application-only tenant filtering is not automatically sufficient.
   Evaluate layered defenses.

6. Do not require SELECT ... FOR UPDATE universally.
   Require proven race safety.

7. Feature-disabled is not automatically incomplete.
   It must comply with blueprint feature-flag policy.

8. Missing executable proof is UNPROVEN, not automatically CONFIRMED GAP.

9. TODO/stub/reachable placeholder implementation is CONFIRMED GAP.

10. A UI backed only by temporary browser state when authoritative persistence
    is required is CONFIRMED GAP.

11. Historical PostgreSQL docs are not production evidence.

12. Do not penalize an implementation for using MariaDB-native mechanisms
    where the product invariant remains intact.

13. Do penalize loss of product invariant even if code technically works.

14. A passing unit test does not automatically prove browser workflow,
    concurrency, DR, or integration acceptance.

15. Never fabricate execution evidence.

======================================================================
FINAL CONSTRAINTS
======================================================================

READ ONLY.

NO FILE WRITES.

NO DATABASE MUTATIONS.

NO PRODUCTION TESTING.

NO PRISMA DB PUSH.

NO ENVIRONMENT MODIFICATION.

NO SERVICE RESTART.

NO DEPLOYMENT.

NO GIT PUSH.

NO SECRET OUTPUT.

If a required proof cannot safely be obtained:

classify it UNPROVEN.

Do not guess.

Do not convert missing evidence into a fabricated defect.

Do not convert implementation existence into PASS without proof.

Finish with:

AUDIT COMPLETE — READ-ONLY — NO CHANGES MADE