-- prisma/roles/0001_db_roles.sql
-- PostgreSQL 16+ — DB roles per §6 rule 9.
-- Creates four roles with strict privilege separation.
-- Run as superuser during initial deployment.
--
-- Usage:
--   psql -h <host> -U postgres -d postgres \
--     -v app_password="..." \
--     -v migration_password="..." \
--     -v backup_password="..." \
--     -v reporting_password="..." \
--     -f prisma/roles/0001_db_roles.sql

-- 1. app_role — application runtime (NOSUPERUSER, NOBYPASSRLS)
CREATE ROLE app_role
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  LOGIN PASSWORD :'app_password';

-- 2. migration_role — forward-only migrations only (BYPASSRLS)
CREATE ROLE migration_role
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS
  LOGIN PASSWORD :'migration_password';

-- 3. backup_role — nightly pg_dump + WAL archive (read-only)
CREATE ROLE backup_role
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  LOGIN PASSWORD :'backup_password';

-- 4. reporting_role — read-only OLAP queries (subject to RLS)
CREATE ROLE reporting_role
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  LOGIN PASSWORD :'reporting_password';

-- Non-login role that owns all SECURITY DEFINER functions.
CREATE ROLE function_owner NOLOGIN;
