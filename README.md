# ERP/POS

Multi-tenant ERP/POS for Bangladesh electronics retail, service and warranty operations. A Next.js dashboard and POS interface sit alongside transactional sales, inventory, purchasing, accounting and background workers.

This README describes the current repository. Product requirements live in the [v4.2 blueprint](docs/master-plan/ERP_Pos_Blueprint_v4.2.md); dated audits record verified behavior. Passing a test subset is not a blanket production-readiness claim.

## Stack and architecture

| Area | Implementation |
| --- | --- |
| UI | Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Radix/shadcn |
| Application | TypeScript modular monolith; API routes call domain commands |
| Database | MariaDB 11.8 through Prisma 6 |
| Queues | Redis and BullMQ; separate worker process |
| Files | S3-compatible storage |
| Verification | Vitest, Playwright and axe |
| Observability | Sentry and OpenTelemetry |

MariaDB is authoritative: use `prisma/mariadb/schema.prisma` and its ordered migrations. The default `prisma/schema.prisma` is a SQLite sandbox. PostgreSQL schemas, SQL, scripts and RLS descriptions are historical. MariaDB tenant isolation uses application scope and database constraints, not PostgreSQL RLS. See [ADR 0007](docs/adr/0007-mariadb-production-database.md).

Business defaults include BDT and Asia/Dhaka. Modules cover POS/sales, stock, purchasing, payments, journals, assets, bank reconciliation, service, deliveries, CRM, HR and administration. Availability and permissions vary; the catalogue UI currently supports list/create, not edit/delete.

## Local development

Prerequisites: Node.js compatible with the lockfiles (installed Next.js requires >=20.9.0), Bun for seed/worker scripts, a dedicated development MariaDB 11.8 database, and Redis. Configure storage/providers for the features being exercised.

```sh
bun install --frozen-lockfile
```

Copy `.env.example` to an ignored `.env`. Review its values: templates and legacy staging helpers are not a ready-to-run MariaDB environment. Configure `DATABASE_URL`, `JWT_SECRET`, `APP_ENCRYPTION_KEY` and `REDIS_URL` for your local services. Use separate generated secrets and a `mysql://` database URL. See [.env.production.example](.env.production.example) for deployment configuration variables.

With the dedicated development target configured:

```sh
bunx --no-install prisma validate --schema=prisma/mariadb/schema.prisma
bunx --no-install prisma generate --schema=prisma/mariadb/schema.prisma
bunx --no-install prisma migrate deploy --schema=prisma/mariadb/schema.prisma
bunx --no-install prisma migrate status --schema=prisma/mariadb/schema.prisma
```

For initial local setup, set `PLATFORM_ADMIN_PASSWORD` before running `bun run seed`. The seed provisions the platform company, roles, permissions and administrator, not complete business fixtures. Do not rely on a shared default password or replace password hashes directly.

Start web and worker processes in separate terminals:

```sh
bunx --no-install next dev -p 3000
bun run worker
```

Open `http://localhost:3000/login`. On Windows PowerShell, `npx.cmd --no-install next dev -p 3000` is an alternative web command; `.cmd` avoids PowerShell execution-policy issues with npm wrappers.

### Legacy helpers

- Generic `db:*` package scripts use Prisma's default schema. They are not the MariaDB migration workflow above.
- `migrate:postgres`, `switch:postgres` and existing `staging:*` helpers retain PostgreSQL assumptions. Do not use them for MariaDB deployment.
- `docker/docker-compose.yml` starts PostgreSQL and configures web/worker services for it. It is not a MariaDB deployment recipe. Its Redis/MinIO services can be considered separately.

## Build and run

Package build/start commands use POSIX shell syntax and Bun:

```sh
bun run build
bun run start
```

`build` compiles Next.js, removes public source maps and copies static/public assets into standalone output. Workers run separately. Follow the [production migration runbook](docs/runbooks/production-migration.md) for release migration and target verification.

For a local Windows compilation check and server using regular `.next` output:

```powershell
npx.cmd --no-install next build --webpack
node scripts/remove-public-sourcemaps.mjs .next/static
npx.cmd --no-install next start -p 3000
```

This Windows sequence does not package standalone assets or migrate/seed a database. The UI audit verified webpack production builds; it does not establish that every bundler/deployment path was tested.

## Verification

```sh
bun run lint
bunx --no-install tsc --noEmit
```

Vitest refuses arbitrary database targets. The checked-in runner supplies a sanitized environment and uses only local MariaDB at `127.0.0.1:43318`, database `readiness_20260912_disposable`:

```sh
node scripts/verify-access-tests.mjs
node scripts/verify-access-tests.mjs tests/integration/generalLedgerCoverage.test.ts
```

Provision and migrate that disposable database first using the explicit MariaDB schema. Tests can write synthetic records; immutable records may remain after teardown. A bare `bun run test` without approved database configuration is intentionally refused. Run timing-sensitive scale tests without concurrent builds and record load conditions.

| Browser configuration | Purpose |
| --- | --- |
| `playwright.presentation.config.ts` | Fixture-only responsive, theme, accessibility and interaction checks |
| `playwright.ui-health.config.ts` | Authenticated workspace/health checks with guarded disposable personas |
| `playwright.access.config.ts` | Access-control checks |
| `playwright.module-smoke.config.ts` | Module smoke coverage |
| `playwright.config.ts` | General E2E; inspect setup and environment requirements before running |

Install Chromium with `bunx --no-install playwright install chromium`. Set `E2E_BASE_URL` to an isolated running app, then run presentation checks:

```sh
bunx --no-install playwright test --config=playwright.presentation.config.ts
```

That configuration does not start a server. It mocks browser API traffic and cannot prove real transaction behavior. Production CSP can prevent webpack development bundles from hydrating; prefer a production build for representative runtime checks instead of relaxing production headers.

Evidence and limitations:

- [UI/UX debugging audit](docs/ui-taste-debug-audit.md): dated build, presentation, production-smoke and workflow results, fixture boundaries and remaining UAT.
- [UI design system](docs/ui-design-system.md) and [modernization audit](docs/ui-modernization-audit.md).
- [Architecture decisions](docs/adr/), [audits](docs/audits/) and [runbooks](docs/runbooks/).

No `.github/workflows/ci.yml` is checked into this checkout. Old badge counts and historical pipeline descriptions are not live CI evidence.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/app/(erp)/dashboard/` | Operational UI |
| `src/app/(auth)/` | Authentication UI |
| `src/app/api/v1/` | HTTP API |
| `src/components/` | Shared UI, session and PWA components |
| `src/domain/` | Business commands and domain behavior |
| `src/lib/` | Authentication, tenant context and supporting services |
| `src/workers/` | Background processing |
| `prisma/mariadb/` | Authoritative schema and migrations |
| `tests/` | Unit, integration, browser and load verification |
| `scripts/` | Verification, seed, operational and historical tooling |
| `docs/` | Blueprint, ADRs, audits and runbooks |
| `public/` | Assets, locales and service worker |

## Repository hygiene

Commit source, migrations, lockfiles, sanitized environment examples and reviewable documentation. `.gitignore` excludes local environments, build/type caches, test reports, local databases, scratch space and machine-specific Graphify metadata. Curated screenshots and documents are not globally ignored.

Ignoring a path does not remove existing Git history or sanitize previously published secrets. Keep local environment files, session captures and database copies out of project exports.

## Backup and recovery

Follow the [backup/restore runbook](docs/runbooks/backup-restore.md). MariaDB logical-backup scripts live under `scripts/backup/`; legacy PostgreSQL WAL tooling is not MariaDB recovery evidence. PITR, offsite immutability and achieved RPO/RTO require dated rehearsals.

## License

Proprietary. All rights reserved.
