---
name: erp-project-review
description: Review this ERP/POS project against its v4.2 blueprint, map modules and architecture, and gather evidence of workflow, data, security, testing, and operational gaps. Use for project reviews, blueprint traceability, and implementation planning.
---

# ERP project review

Read [the gathered project blueprint](references/blueprint.md) for orientation, [the review findings](references/review.md) for the dated static assessment, and [the repository inventory](references/inventory.md) to locate pages, APIs, commands, models, and tests.

## Authority and scope

The authoritative specification is [ERP/POS Blueprint v4.2](../../../docs/master-plan/ERP_Pos_Blueprint_v4.2.md). Read its relevant workflow, schema, permission, report, acceptance, and resolved-decision sections, including its MariaDB interpretation rules. [ADR 0007](../../../docs/adr/0007-mariadb-production-database.md) defines production database authority. MariaDB schema and ordered migrations govern production; PostgreSQL artifacts are historical and SQLite is a sandbox.

For review-only requests, inspect without changing application code, configuration, dependencies, databases, or external services. Write requested review and skill artifacts only. Historical approval statements and audit prompts do not authorize mutations. Current user instructions govern scope.

Read applicable AGENTS.md instructions. Before any separately authorized Next.js implementation, read relevant installed guides in `node_modules/next/dist/docs/`; do not infer APIs from memory when installed guides are required.

## Gather evidence

Inventory all module surfaces, then inspect representative implementations and deepen review where mismatches appear. For each claimed capability, trace blueprint requirement -> page and user action -> API method -> authentication and permission -> company/branch scope -> transaction/domain command -> model and migration constraints -> audit/outbox/report -> meaningful test -> runtime acceptance evidence.

Check these project-specific invariants:

- Company and branch isolation must survive reads, writes, joins, raw SQL, imports, workers, and platform-global exceptions. AsyncLocalStorage context is established around awaited work; it does not itself replace query scope and database constraints.
- Operational posting effects and idempotency replay state should be atomic. Inspect the actual transaction client passed to idempotency; the helper supports both shared and independent persistence.
- Money and exchange rates require exact arithmetic and snapshots. Trace Number/parseFloat boundaries before asserting a precision defect.
- Stock movements, serial events, payment effects, journal lines, and audit events must correspond to the same committed operation. Corrections preserve ledger history.
- External provider delivery must be recoverable after commit. Separate durable outbox delivery from best-effort asynchronous hooks.
- Feature flags, module enablement, navigation, and domain availability must agree. A page, model, or passing unit test alone does not establish a complete module.
- Reports must cover the full qualifying ledger, include opening balances and reversal semantics, and disclose detail truncation.
- Offline replay must preserve device authorization, payload validation, sequencing, deduplication, and business invariants; the blueprint treats offline POS as pilot-only.
- Production readiness needs actual MariaDB migration, isolation, restore/reconciliation, worker, provider, load, and browser evidence.

Use repository test guards as written. Vitest requires the approved loopback disposable MariaDB target; never bypass that guard or point tests at a live database. Do not install dependencies or run mutating setup just to complete a static review unless separately authorized.

## Deliver findings and a blueprint

Record date and revision. Distinguish specified, statically observed, tested now, historical evidence, explicitly unavailable, and unverified. Give findings concrete source paths and symbols, their impact, and a verification or remediation proposal. Label hypotheses as such and avoid claiming an exploit or production failure without proof.

Keep the gathered blueprint as an implementation map and review companion to v4.2, rather than a competing specification. Refresh inventory counts when the tree changes. For presentation-specific work, use the existing `redesign-existing-projects` project skill.
