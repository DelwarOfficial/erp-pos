# Audit context — 2026-09-21

Established before reading application code, per
`docs/audits/FULL-CODEBASE-BUG-HUNT-PROMPT.md`. Baseline: `865df2a`, branch `main`,
clean working tree at start.

## Framework

Next.js **16.2.10**, App Router. Agent-facing docs are present at
`node_modules/next/dist/docs/` (`01-app`, `02-pages`, `03-architecture`, `04-community`)
and must be consulted before judging framework code, per `AGENTS.md`.

## Toolchain reality

`package.json` scripts assume **Bun**, but Bun is not on PATH in this environment. Only
Node 
and npm/npx are available. Gates must be invoked directly:

| Intent | Script (documented) | What actually runs here |
|---|---|---|
| Typecheck | — | `node node_modules/typescript/bin/tsc --noEmit --incremental false` |
| Lint | `bun run lint` | `node node_modules/eslint/bin/eslint.js src instrumentation.ts` |
| Unit + integration | `bun run test` | `node scripts/verify-access-tests.mjs` |
| E2E | `bun run test:e2e` | Playwright; not run in this phase |

`scripts/verify-access-tests.mjs` is the project's real test entry point. It copies
`src`, `tests`, `prisma`, `scripts` into a fresh `.local/access-tests-*` workdir,
junctions `node_modules`, strips inherited `.env*` and sqlite files, injects synthetic
`JWT_SECRET`/`APP_ENCRYPTION_KEY`, and points `DATABASE_URL` at
`mysql://root@127.0.0.1:43318/readiness_20260912_disposable`. That MariaDB instance is
listening locally and is the disposable fixture used by the previous audits. No
production environment file is loaded by any gate.

## Database targets

Three schema targets, all of which a data-integrity finding must be assessed against:

- `prisma/schema.prisma` — 181 models, the default target
- `prisma/schema.postgres.prisma` — historical; ADR 0007 moved production to MariaDB
- `prisma/mariadb/` — production target, generated via `scripts/build-mariadb-schema.mjs`

Supporting SQL lives in `prisma/rls/`, `prisma/triggers/`, `prisma/functions/`,
`prisma/roles/`, plus module slice files `m1`–`m7-additions.prisma` and
`m-gap-additions.prisma`.

## Decisions that constrain findings

From `docs/adr/`:

- `0001-db-roles` — four DB roles (app / migration / backup / reporting)
- `0002-rls-via-middleware` — tenant isolation is enforced by RLS driven from middleware,
  so any query issued through `systemDb` bypasses that enforcement and must justify itself
- `0003-sqlite-vs-postgres`, `0007-mariadb-production-database` — MariaDB 11.8+ in production
- `0004-idempotency` — every mutation carries an `Idempotency-Key`
- `0005-auth-mfa` — MFA mandatory for owners and global admins
- `0006-document-numbering` — leased document numbers, gap-free sequencing

## Prior audit state

- `2026-09-16-p1-remediation.md` — four blockers closed (reconciliation status handling,
  gift-card authority = sum of ledger deltas, MFA rate-limiter Redis isolation, MariaDB
  backup/restore). Recorded 920 passed / 5 skipped at that time.
- `2026-09-17-relational-validation.md` — **FAIL**, stopped on gift-card issuance writing
  no ledger entry.
- `2026-09-19-gift-card-issuance.md` — issuance remediated inside one Serializable
  `withTenant` transaction; verdict on gift cards overall remained **NOT READY** because
  redemption accounting was still failing. That failure is still open (see Phase 1).

The five skipped tests are opt-in N+1 MariaDB tests, unchanged from the earlier audit.

## Go-live checklist

`docs/runbooks/go-live-checklist.md` has **every item unchecked** — code quality,
security, database, infrastructure, feature flags, accounting, load, accessibility,
deployment, and all external sign-offs (tax, legal, labour, PCI QSA, accounting, forex).
Per the audit prompt each unchecked item is an open finding until proven otherwise;
several are contradicted by Phase 1 evidence rather than merely unproven.

## Scope note

This session performs read-only analysis and local gate execution. No production access,
no deployment, no push, no migration, no history rewrite.
