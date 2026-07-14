# PostgreSQL Quickstart

This guide walks through switching the ERP/POS system from SQLite (sandbox) to PostgreSQL 16 (production).

## Prerequisites

- Docker 24+ and Docker Compose v2 (for local Postgres + Redis + MinIO)
- Or: a managed PostgreSQL 16+ instance (AWS RDS, GCP Cloud SQL, Supabase, etc.)
- `psql` client (optional, for manual inspection)

## Option A: Local Docker Stack

### 1. Start Postgres + Redis + MinIO

```bash
docker compose -f docker/docker-compose.yml up -d postgres redis minio
```

Verify:
```bash
docker compose -f docker/docker-compose.yml ps
# All three services should show "healthy"
```

### 2. Set environment variables

Edit `.env` (copy from `.env.example` first if missing):

```bash
DATABASE_URL=postgresql://app_role:app_password_dev@localhost:5432/erp_pos?schema=public
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=erp-pos-storage

# Optional: Sentry + OpenTelemetry
SENTRY_DSN=
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

### 3. Switch schema + run migrations

```bash
bun run switch:postgres
```

This script:
1. Rewrites `prisma/schema.prisma` datasource from `sqlite` → `postgresql`
2. Runs `prisma generate` to rebuild the client
3. Executes all forward-only SQL migrations in `prisma/migrations/` (10 files)
4. Applies RLS policies, triggers, functions, and grants (idempotent)
5. Records each applied migration in `schema_migrations` table with checksum

### 4. Verify

```bash
# Health check should report database: ok, redis: ok, storage: ok
curl http://localhost:3000/api/v1/health

# Or check tables directly
docker compose -f docker/docker-compose.yml exec postgres \
  psql -U app_role -d erp_pos -c "\dt" | head -20
```

You should see ~78 tables (including `schema_migrations`).

### 5. Start the worker process (production)

```bash
bun run worker
```

This launches 5 BullMQ workers (outbox, communication, reconciliation, reservation-expiry, retention) that consume jobs from Redis.

## Option B: Managed Postgres (AWS RDS / Supabase / etc.)

1. Provision a Postgres 16 instance
2. Create a database `erp_pos` and a non-superuser role `app_role` with `BYPASSRLS` for migrations
3. Set `DATABASE_URL` in `.env`
4. Run `bun run switch:postgres`

## Rollback

Migrations are forward-only per §6 rule 12. To roll back:
- Restore from a DB snapshot (recommended)
- Or manually run the inverse SQL for a specific migration (not supported by the runner)

## Verification Scripts

```bash
# Dry-run validation (no Postgres needed — checks SQL syntax + ordering)
bun run scripts/validate-migrations-dry-run.ts

# RLS penetration tests (8 scenarios)
bash scripts/security/rls-penetration-test.sh

# Migration validation against fresh Postgres 16 container
bash scripts/validate-postgres-migrations.sh
```

## Troubleshooting

### "role app_role does not exist"
The `init-roles.sql` script in `docker/init-roles.sql` creates the roles on first container start. If you're using an existing database, run it manually:
```bash
psql -U postgres -d erp_pos -f docker/init-roles.sql
```

### "permission denied for table"
The app_role needs `BYPASSRLS` for migrations only. For runtime, use a separate role with RLS enforced. See `prisma/roles/0001_db_roles.sql`.

### "Prisma Client generated for SQLite"
Run `bunx prisma generate` after switching the schema provider. The `switch:postgres` script does this automatically.

### Migrations fail mid-way
The `schema_migrations` table records each successful migration. Re-running `bun run migrate:postgres` will skip already-applied migrations and resume from the failure.
