-- docker/init-roles.sql
-- Creates the 4 DB roles on initial container startup.

-- app_role (application runtime)
CREATE ROLE app_role NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS LOGIN PASSWORD 'app_password_dev';

-- migration_role (BYPASSRLS for schema changes)
CREATE ROLE migration_role NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS LOGIN PASSWORD 'migration_password_dev';

-- backup_role (read-only for pg_dump)
CREATE ROLE backup_role NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS LOGIN PASSWORD 'backup_password_dev';

-- reporting_role (read-only OLAP, subject to RLS)
CREATE ROLE reporting_role NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS LOGIN PASSWORD 'reporting_password_dev';

-- function_owner (non-login, owns SECURITY DEFINER functions)
CREATE ROLE function_owner NOLOGIN;

-- Grant initial privileges
GRANT CREATE ON DATABASE erp_pos TO migration_role;
GRANT CONNECT ON DATABASE erp_pos TO app_role, backup_role, reporting_role;
