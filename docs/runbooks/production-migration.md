# MariaDB migration runbook

MariaDB 11.8 is authoritative. PostgreSQL files and RLS references are historical only (see docs/adr/0007-mariadb-production-database.md). This runbook is not deployment authorization. Never test against production.

## Disposable rehearsal first

1. Verify commit, clean tree, locked dependencies and fresh disposable MariaDB 11.8 target.
2. Supply DATABASE_URL through protected local configuration. Print safe host/port/database classification only; never credentials or full URL. Do not source production environments.
3. Use locked Prisma version and explicit schema:

```bash
bun install --frozen-lockfile
bunx --no-install prisma validate --schema=prisma/mariadb/schema.prisma
bunx --no-install prisma generate --schema=prisma/mariadb/schema.prisma
bunx --no-install prisma migrate deploy --schema=prisma/mariadb/schema.prisma
bunx --no-install prisma migrate status --schema=prisma/mariadb/schema.prisma
```

4. Repeat deploy; require no pending migrations/errors. Compare constraints/indexes/triggers/routines/views with migration-managed definitions.
5. Run tenant/branch/RBAC, accounting, inventory, concurrency, rollback, browser and build tests.
6. Rehearse backup/restore using [backup-restore.md](backup-restore.md). Migration success alone is not readiness.

## Persistent deployment gate

Applied migrations are immutable. New forward-only MariaDB migrations only. Never reset/db push, rewrite history, or execute legacy PostgreSQL migration scripts. Rehearse DDL locking/duration/disk requirements and recovery strategy first.

Only after explicit operator authorization: verify target/commit; verify final backup; enforce approved write freeze where needed; run rehearsed migrate deploy; validate migration status and invariants; follow separately approved release/smoke plan. No secrets in logs; no DEFINER=root.

MariaDB tenant isolation uses application context and tenant-scoped/composite constraints. PostgreSQL RLS, EXCLUDE and SECURITY DEFINER assumptions do not apply.

## Release 2026-11: pending migrations

Deployments that last ran `20261001000200_security_events_append_only` have
four to apply, in this order (Prisma applies them by name):

| Migration | Kind | What it does | Locking / duration |
|---|---|---|---|
| `20261118000100_cashier_customer_read` | Data | Grants `customer.read` to system `cashier` roles | Row inserts in `role_permissions`; seconds |
| `20261118000200_cashier_manager_collection_grants` | Data | Grants collection/payment read permissions to system `cashier` and `branch_manager` roles | Row inserts; seconds |
| `20261118000300_loyalty_accounts_coupon_permission` | Data | Per company: creates chart accounts 2500 (Reward Points Liability) and 5700 (Reward Points Expense) where those codes are free, links 5700 as the reward expense account where none is set, adds `coupon.manage` to roles holding `gift_card.issue` | Inserts into `chart_of_accounts`, one `UPDATE` on `accounting_policies` (unset rows only); seconds per thousand companies |
| `20261119000100_reward_point_confirmations` | DDL | Creates `reward_point_confirmations` (customer consent codes for spending points) | New empty table; no existing table is altered |

All four are additive. The three data migrations insert only where missing
and update only unset values, so re-running their SQL changes nothing.
On a fresh install they do nothing: onboarding's seed creates the same rows.

Rehearsal evidence (disposable MariaDB 11.8, `readiness_20260912_disposable`,
1,069 companies, 2026-11-19): upgrade applied all four; a second
`migrate deploy` reported no pending migrations; `migrate diff` from the
database to `schema.prisma` was empty; re-executing the three data
migrations' SQL left permission, grant, account and policy counts unchanged.
The keys migration `20261119000200_reward_point_confirmation_keys` (company
and composite tenant foreign keys for the new table) follows the four above
and was rehearsed the same way.

Fresh-install rehearsal (new empty database `readiness_fresh_20261119_disposable`
on the same disposable server, 2026-11-19): all 19 migrations applied in 22 s;
a second deploy reported none pending; `migrate status` up to date;
`migrate diff` empty; `scripts/audit-production-db.mjs` (read-only) passed
migrations (19, checksums match) and schema (187 tables, 61 triggers match the
fingerprint). On an empty database the three data migrations do nothing;
onboarding then creates the same rows from code, and
`tests/unit/freshInstallLoyaltyParity.test.ts` checks that it matches what the
migrations give an upgraded company. That check found that the system
`global_admin` role lacked `coupon.manage` on fresh installs (the catalogue
now grants it), while the migration grants it on upgrade.

The audit's warnings on that server are about server configuration, and apply
to production: set `time_zone` deliberately, size the InnoDB buffer pool
(≥ 512 MB), enable the binary log for point-in-time recovery, create
triggers with a non-root DEFINER, and connect the app with a user that has
only this database's privileges.

Before running in production:

1. Take and verify a full backup ([backup-restore.md](backup-restore.md)).
   Record the backup id with the release.
2. Check whether any company already uses account code 2500 or 5700 for
   something else. Those companies are skipped, and earn no reward points
   until an account with subtype `reward_points_liability` (and
   `reward_expense`) exists. Sales still post.
3. Make sure `CRON_API_TOKEN`, `REDIS_URL` and the three keys in
   [go-live-checklist.md](go-live-checklist.md) are set. The new code needs
   them, not the migrations.

Run, with the production `DATABASE_URL` supplied by the deployment
environment (never printed):

```bash
bunx --no-install prisma migrate status --schema=prisma/mariadb/schema.prisma
bunx --no-install prisma migrate deploy --schema=prisma/mariadb/schema.prisma
bunx --no-install prisma migrate status --schema=prisma/mariadb/schema.prisma
```

Then check:

```sql
SELECT COUNT(*) FROM reward_point_confirmations;               -- table exists (0 rows)
SELECT COUNT(*) FROM permissions WHERE code = 'coupon.manage';  -- 1
SELECT COUNT(*) FROM accounting_policies WHERE reward_expense_account_id IS NULL; -- companies skipped in step 2
```

If you have to back out: deploy the previous application release. The new
table is unused by older code and can stay. The data migrations only added
permissions and accounts, so they can stay too. Do not delete the 2500/5700
accounts once points have been earned against them.

## Failure handling

Stop on command errors/invariant mismatches. Never mark failed migrations applied to bypass failure. Application rollback does not undo committed MariaDB DDL. Restore into a new isolated database, reconcile, obtain explicit cutover approval. Never automatically overwrite persistent data.

## Recovery evidence

Binary-log PITR, immutable offsite backups and achieved RPO/RTO: **UNPROVEN** without dated executable rehearsal. No production commands were executed for this documentation change.
