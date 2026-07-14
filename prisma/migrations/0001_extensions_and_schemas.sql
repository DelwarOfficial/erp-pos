-- prisma/migrations/0001_extensions_and_schemas.sql
-- PostgreSQL 16 — extensions + schema setup.
-- Forward-only. Run via migration_role.

BEGIN;

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- trigram search on product.name
CREATE EXTENSION IF NOT EXISTS "btree_gist";     -- EXCLUDE USING gist on int8range
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";      -- uuid_generate_v4() (legacy fallback)
CREATE EXTENSION IF NOT EXISTS "citext";         -- case-insensitive email

-- Schema for audit/security (separate for clarity, same DB)
CREATE SCHEMA IF NOT EXISTS audit;

-- Set default search_path for app_role to public only (no schema qualification
-- needed in queries). Function_owner has a safe search_path set per function.
SET search_path = public;

COMMIT;
