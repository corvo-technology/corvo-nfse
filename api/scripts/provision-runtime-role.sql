-- Run after migrations as an administrator. No password is embedded or printed.
-- psql "$MIGRATION_DATABASE_URL" -v runtime_role=corvo_runtime \
--   -v migration_role=corvo -v app_schema=corvo -f scripts/provision-runtime-role.sql
\set ON_ERROR_STOP on
\if :{?runtime_role}
\else
  \echo 'Missing -v runtime_role=...'
  \quit 2
\endif
\if :{?migration_role}
\else
  \echo 'Missing -v migration_role=...'
  \quit 2
\endif
\if :{?app_schema}
\else
  \echo 'Missing -v app_schema=...'
  \quit 2
\endif
BEGIN;
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT', :'runtime_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=:'runtime_role')
\gexec
SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT', :'runtime_role')
\gexec
SELECT format('GRANT USAGE ON SCHEMA %I TO %I', :'app_schema', :'runtime_role')
\gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', :'app_schema', :'runtime_role')
\gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', :'app_schema', :'runtime_role')
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'migration_role', :'app_schema', :'runtime_role')
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I', :'migration_role', :'app_schema', :'runtime_role')
\gexec
SELECT format('REVOKE ALL ON TABLE %I.migrations FROM %I', :'app_schema', :'runtime_role')
\gexec
COMMIT;
-- Set the runtime password separately with psql's \password command.
