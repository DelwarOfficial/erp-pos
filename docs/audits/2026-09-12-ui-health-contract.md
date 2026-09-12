# Overview and System Health contract

Scope: production-facing UI code only. No production access, deployment, service
restart, or remote push. Earlier live-readiness remediation remains separate.

## Overview

Overview reuses the dashboard shell's authenticated `/api/v1/me` response for
company and assigned branch context. It adds no database aggregation or per-row
requests. Branch labels are intersected with authenticated branch IDs. Shortcuts
require their existing operation permission. Platform administrators receive no
cross-company business aggregation. No financial KPI is displayed without a
verified authoritative source. Session failure remains an error, not zero data.

Historical dashboard engineering material is preserved in
`2026-09-12-historical-dashboard-notes.md`, not presented as completed controls.

## Health API

- `GET /api/v1/health`: public minimal readiness `{ status, service }` only.
- `GET /api/v1/admin/health`: existing `system.config.view` permission required
  before probing; authentication/authorization failures remain 401/403.
- Both return 200 for healthy readiness, 503 for degraded/unavailable checks.
  Detailed responses are private/no-store; public responses are no-store.
- UI and backend share `src/lib/health/contract.ts`. `checks.database`, not the
  obsolete `db` property, determines the database card.
- Database and Redis are required. Required failure means overall Unavailable;
  an unknown/skipped required check means Degraded, never Healthy.
- Storage is optional: unconfigured/disabled is Not monitored; probe failure
  means Degraded. A successful HEAD, including a normal missing sentinel object,
  verifies the configured storage request, not durability or upload permissions.
- Queue workers are explicitly Not monitored. Redis PING does not verify workers.
- Version is package version, not a deployment SHA. Uptime is process uptime,
  not whole-cluster availability. No cluster/SLA claim is made.
- Probes have time bounds and five-second shared cache. UI polls every ten
  seconds and clears stale results when fetching fails. API/network/malformed
  response failure is not displayed as a database outage.
- Response schema allows only check states, timings, timestamp, service, version
  and uptime. No raw errors, SQL, credentials, infrastructure addresses, phase
  labels, or engineering checklist is returned.

## Local verification method

`node scripts/verify-ui-health.mjs build` creates a source-only isolated copy under
`.local/`, excludes environment/database files, and uses an allowlisted process
environment. Dependencies are shared with the workspace. It runs Next's
production webpack build; production environment files are never loaded.

`node scripts/verify-ui-health.mjs e2e` requires that successful build, refuses to
reuse an occupied local port, starts its own loopback server, and stops only that
server. Browser traces/videos/screenshots are disabled. Contract-interception
tests block service workers; an additional real navigation test uses the normal
browser service-worker policy without intercepting API responses.
Fixtures are synthetic, created only on the explicitly guarded disposable
MariaDB 11.8 database. Test session tokens are generated locally and never logged.
Login/MFA enrollment and offline/PWA flows are outside this UI test's scope.

Real local tests exercise successful database and unavailable Redis health
(Redis is not configured), with browser-intercepted contracts covering healthy
Redis, degraded/unavailable states, malformed responses, and network failures.
They do not claim verification of a live Redis cluster or worker heartbeat.

Verification results must be recorded after execution; this contract itself is
not a PASS certificate or overall ERP live-readiness approval.

## Executed evidence (2026-09-12)

- `node node_modules/vitest/vitest.mjs run tests/unit/healthContract.test.ts tests/unit/healthApiAuthorization.test.ts tests/unit/healthRuntime.test.ts tests/unit/routePermissionCoverage.test.ts --reporter=dot`:
  PASS, 4 files / 228 tests. Includes 28 health-specific tests and 200 HTTP-policy
  assertions (199 handlers plus the complete inventory assertion).
- `node node_modules/vitest/vitest.mjs run tests/integration/readinessDatabase.test.ts --reporter=dot`:
  PASS, 1 file / 4 tests on guarded disposable MariaDB 11.8.6. Includes actual
  tenant/branch denial, audit capacity, and 100-consumer single-use challenge proof.
- Initial isolated build failed due to Windows cross-drive module resolution
  between the C-drive temporary copy and D-drive dependencies. Same-drive isolated
  build succeeded; a package-version named-import warning was then corrected.
- Initial Chromium run: 12 passed / 3 failed. All three failures were strict
  locator ambiguity with Next's built-in route announcer. Assertions now scope to
  `main`; no application authorization/error behavior was weakened.

- `node node_modules/typescript/bin/tsc --noEmit --incremental false`:
  PASS after final application edits, zero errors. The existing Next config skips
  build-time type validation, so this separate check is required and was executed.
- `git -c core.safecrlf=false diff --check`: PASS.

Final build and browser rerun results are pending until recorded below.
