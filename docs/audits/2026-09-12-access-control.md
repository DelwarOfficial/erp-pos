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
