#!/bin/sh
# Creates least-privilege roles on first container start (docs/MULTI_TENANCY.md §5).
#   tahi_owner : owns the schema, used only by the one-shot `migrate` job
#   tahi_app   : used by api + worker; not owner, not superuser, NOBYPASSRLS
# Runs only when the data directory is empty (official postgres entrypoint behaviour).
set -eu

: "${TAHI_OWNER_PASSWORD:?TAHI_OWNER_PASSWORD is required}"
: "${TAHI_APP_PASSWORD:?TAHI_APP_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_pw="$TAHI_OWNER_PASSWORD" -v app_pw="$TAHI_APP_PASSWORD" -v db="$POSTGRES_DB" <<'SQL'
CREATE ROLE tahi_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEROLE NOCREATEDB;
CREATE ROLE tahi_app   LOGIN PASSWORD :'app_pw'   NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;

ALTER DATABASE :"db" OWNER TO tahi_owner;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO tahi_app;

ALTER SCHEMA public OWNER TO tahi_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO tahi_app;

-- Every table/sequence the owner creates later is usable (DML only) by the app role.
ALTER DEFAULT PRIVILEGES FOR ROLE tahi_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tahi_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tahi_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tahi_app;
SQL
