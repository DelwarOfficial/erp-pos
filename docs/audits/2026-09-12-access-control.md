# Access Control implementation record

Baseline: `b6e809241071480c52c7b5610401d83c0bd46167`, branch `main`.
Production is not accessed. This record describes discovery and planned work,
not completion or verification.

| Feature | Existing | Partial | Missing | Planned reuse |
|---|---|---|---|---|
| Users/company/branches | Yes | | | MariaDB User, Company, Branch |
| Roles/permission catalogue | Yes | | | Role, Permission, RolePermission |
| User roles/branch grants | Yes | | | UserRole, UserBranchAccess |
| Admin CRUD APIs/UI | | | Yes | Existing route guards, dashboard components |
| Authentication/MFA | Yes | | | authenticateRequest, signed challenges, enrollment |
| Password reset/invitation | | Permission only | Safe workflow | Purpose-separated one-time challenge store |
| Tenant/branch enforcement | Yes | | | withTenant, tenant client, explicit target predicates |
| Audit | Yes | Atomic helper incomplete | | Transaction-client audit writes |
| Protected roles | | isSystemRole + seed definitions | CRUD protections | Protect all system roles |
| Last-admin protection | | | Yes | Company-row locking and post-change usable-admin check |

## Discovery evidence

- `prisma/mariadb/schema.prisma`: User (403), Role (513), Permission (530),
  RolePermission (542), UserRole (554), UserBranchAccess (566). Email uniqueness
  is `(company_id, email)`; login accepts company code. Preserve this tenant-aware
  identity contract rather than inventing global email uniqueness.
- `src/lib/permissions/catalogue.ts`: existing user.read/create/update/deactivate/
  reset_password and role.read/create/update/assign. No duplicate grant names.
- `src/lib/auth/middleware.ts`: live account/company validation, explicit tenant
  context and permission guard. Platform means PLATFORM company + global access,
  not a role-name string. Tenant global access means all branches of one company.
- `src/lib/db/transaction.ts`: tenant-bound Serializable transaction.
- `src/lib/audit/index.ts`: current audit helper uses root client rather than
  supplied transaction. New administration writes must audit using the same tx.
- Repo-wide searches of src/scripts/tests found role/user creation in onboarding
  and seeding, but no administration CRUD or password-reset endpoint.
- Existing `WebAuthnChallenge` supports purpose, expiry and consumed-at; MFA
  already reuses it with a distinct action. Reset tokens can reuse this store
  with a different action and only a persisted hash, without duplicate tables.
- `SYSTEM_ROLES` identifies protected roles. Existing owner wildcard seed also
  includes platform codes: granting authority must reject platform-only codes
  for tenant administrators even when legacy role rows contain them.

## Security design

Every administration mutation requires explicit permission and verified MFA,
rechecks authority inside its transaction, locks the target company row, validates
target IDs, and records a sanitized audit event in that same transaction.
Platform cross-company operations use the already-authorized platform context
with explicit company predicates; no new unrestricted client is introduced.
Platform audit provenance remains in the actor's company, with target company
recorded in metadata, preserving the existing composite audit-user FK.

Tenant transfer of existing users is prohibited: create a separate tenant identity
instead of rewriting financial/audit provenance. Branch-limited managers cannot
manage global or out-of-branch users. Permission grants cannot exceed the actor's
current authority. System roles cannot be edited/deleted. Active assigned roles
cannot be deleted. Last usable company/platform administration access must survive
every role/user mutation, including concurrent attempts.

Invitation/reset links use short-lived one-time hashed tokens and fragment-based
URLs, revealed once to the authorized administrator for secure delivery. Reset
does not disable MFA or unlock/suspend policy; sessions and pending challenges
are revoked atomically when password changes. No external email service is assumed.

## Continuation evidence — 2026-09-13

Continuation started on `main` at `c426dc08204469e42901b2425bd78b68a1cd9059`.
The existing implementation commits `6ec5629` and `c426dc0` were already present;
this continuation does not claim authorship of those commits. The pre-existing
`tsconfig.tsbuildinfo` modification is preserved and excluded from intended commits.

### Focused corrections

- Role assignment/filter options are paged (25 at a time), preserving assigned
  IDs across pages. A browser regression assigns a role beyond the first page.
- Branch scope selector has an explicit accessible name.
- Last-admin invariant rejection returns HTTP 409 with a useful explanation;
  permission denials remain 403. Transaction rollback/locking is unchanged.
- Browser tests use real browser fetch for localhost Secure-cookie semantics,
  and independent tenant-user fixtures rather than cross-test state.
- All 13 admin handlers have executable 401/403-before-data-access tests.
- Reset tests cover tampering, replacement, expiry, replay, concurrent use,
  MFA preservation, session revocation, and invalidation after role changes.
- Auth endpoint fixtures now create a real active refresh family and grant the
  current `approval.read` permission. Production authorization was not weakened.
- Offline tests execute the actual service-worker fetch handler and prove auth
  and admin writes fail offline without opening the persistent mutation queue.
- E2E runner compares authored runtime inputs against the built snapshot and
  rejects stale builds. Source copies exclude environment/database files.

### Executed verification

All database tests use synthetic fixtures on guarded MariaDB 11.8.6,
127.0.0.1:43318, database `readiness_20260912_disposable`.

- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: PASS,
  zero errors after the focused application changes.
- `node scripts/verify-access-tests.mjs tests/integration/accessControl.test.ts tests/integration/accessQueryCount.test.ts tests/unit/accessPolicy.test.ts tests/unit/accessApiAuthorization.test.ts tests/unit/tenantEndpoints.test.ts tests/unit/routePermissionCoverage.test.ts tests/unit/mfaEnrollment.test.ts`:
  PASS, 7 files / 289 tests. Includes 18 real MariaDB access security tests,
  26 admin handler-denial tests and 7 tenant endpoint tests.
- `node scripts/verify-access-tests.mjs tests/unit/accessOfflineSafety.test.ts tests/integration/accessQueryCount.test.ts`:
  PASS, 2 files / 6 tests (includes the subsequently added EXPLAIN test).
- User listing: 7 actual SQL statements at N=1, N=10, N=100, including roles
  and branches. No SQL text/bind parameters were logged by instrumentation.
- Representative user-page EXPLAIN: `users_company_id_idx`, access `ref`,
  estimated 100 rows, `Using index condition; Using where; Using filesort`.
  This verifies the tenant predicate, not every relation/filter/production plan.
  No new index justified by these results.
- Fresh deployment previously executed via `node scripts/verify-access-migrations.mjs`:
  schema validation PASS; all 6 existing migrations applied from zero to
  `access_fresh_1789228518079`; repeat deploy PASS, no pending migrations.
  No existing migration changed; no new migration required by this module.
- Initial Access browser run failed 4/4. Diagnosed selector ambiguity,
  dependent worker fixtures and APIRequestContext cookie behavior; corrected
  and awaiting the current-source build/rerun. Initial failure is not a PASS.
- `node scripts/verify-access-tests.mjs`: FAIL, 62 files (57 passed, 4 failed,
  1 skipped); 893 tests (878 passed, 10 failed, 5 skipped). All Access-specific
  tests passed. The four failing files are `tests/integration/security.test.ts`,
  `tests/unit/journalEntry.test.ts`, `tests/unit/journalReversal.test.ts`, and
  `tests/unit/postSale.test.ts`. The optional N+1 MariaDB suite remained skipped;
  the separate Access MariaDB query-count/EXPLAIN tests did execute.

### Remaining gates / limitations

- Final current-source build and browser rerun results must be recorded after
  completion; an older successful build is not proof of current source.
- Full suite is not green. Identified unrelated failures:
  journal fixtures lack an open fiscal period (3 assertions); sale fixtures
  lack accounting policy prerequisites (5); legacy security tests expect
  PostgreSQL RLS and external `grep` on Windows (2). No financial guard or
  database invariant was relaxed to hide these failures.
- Company/branch option endpoints still cap results at 100; large deployments
  need paginated/searchable option selection. Role options are now paged.
- Reset links require secure manual delivery; no email delivery is claimed.
- Reset rate limiting reuses process-local infrastructure; distributed rate
  limiting across multiple instances is not proven here.
- Protected legacy tenant roles containing platform codes cannot be newly
  assigned by tenant administrators. Clean up legacy grants through a separate
  reviewed data migration rather than weakening the grant ceiling.
- Existing Next config skips build-time type checking; separate tsc is required.
  Existing Sentry instrumentation/deprecation and middleware-to-proxy warnings
  remain outside this focused change.

Overall readiness: NOT READY until outstanding gates are resolved.
Production access/changes: NONE. Deployment/restarts/push: NONE.
