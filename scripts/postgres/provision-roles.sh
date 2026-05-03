#!/usr/bin/env bash
# Unit Talk V2 — Postgres Login Role Provisioner
# UTV2-789
#
# Creates login roles (with passwords) from environment variables and
# grants the corresponding group roles defined in roles.sql.
#
# Prerequisites:
#   1. roles.sql has already been applied (group roles exist)
#   2. The following env vars are set:
#      - DATABASE_URL            — superuser connection (for DDL)
#      - UT_APP_PASSWORD         — password for ut_app_runtime
#      - UT_INGESTION_PASSWORD   — password for ut_ingestion_runtime
#      - UT_SCANNER_PASSWORD     — password for ut_scanner_runtime
#      - UT_METRICS_PASSWORD     — password for ut_metrics_runtime
#      - UT_MIGRATION_PASSWORD   — password for ut_migration_runtime
#
# Usage:
#   source local.env && bash scripts/postgres/provision-roles.sh
#   # or with explicit DATABASE_URL:
#   DATABASE_URL=postgres://postgres:password@host:5432/db bash scripts/postgres/provision-roles.sh

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${UT_APP_PASSWORD:?UT_APP_PASSWORD must be set}"
: "${UT_INGESTION_PASSWORD:?UT_INGESTION_PASSWORD must be set}"
: "${UT_SCANNER_PASSWORD:?UT_SCANNER_PASSWORD must be set}"
: "${UT_METRICS_PASSWORD:?UT_METRICS_PASSWORD must be set}"
: "${UT_MIGRATION_PASSWORD:?UT_MIGRATION_PASSWORD must be set}"

log() { echo "[provision-roles] $*"; }
fail() { echo "[provision-roles] FAIL: $*" >&2; exit 1; }

log "Applying group role definitions (roles.sql)..."
psql "$DATABASE_URL" -f "$(dirname "$0")/roles.sql" || fail "roles.sql failed"
log "Group roles applied."

psql "$DATABASE_URL" <<SQL

-- ut_app_runtime — used by apps/api, apps/worker, apps/alert-agent
DO \$\$ BEGIN
  CREATE ROLE ut_app_runtime LOGIN PASSWORD '$UT_APP_PASSWORD';
EXCEPTION WHEN duplicate_object THEN
  ALTER ROLE ut_app_runtime PASSWORD '$UT_APP_PASSWORD';
END \$\$;
GRANT app_user TO ut_app_runtime;

-- ut_ingestion_runtime — used by apps/ingestor
DO \$\$ BEGIN
  CREATE ROLE ut_ingestion_runtime LOGIN PASSWORD '$UT_INGESTION_PASSWORD';
EXCEPTION WHEN duplicate_object THEN
  ALTER ROLE ut_ingestion_runtime PASSWORD '$UT_INGESTION_PASSWORD';
END \$\$;
GRANT ingestion_writer TO ut_ingestion_runtime;

-- ut_scanner_runtime — used by pick scanner and scoring services
DO \$\$ BEGIN
  CREATE ROLE ut_scanner_runtime LOGIN PASSWORD '$UT_SCANNER_PASSWORD';
EXCEPTION WHEN duplicate_object THEN
  ALTER ROLE ut_scanner_runtime PASSWORD '$UT_SCANNER_PASSWORD';
END \$\$;
GRANT scanner_user TO ut_scanner_runtime;

-- ut_metrics_runtime — used by command-center, dashboards, monitoring
DO \$\$ BEGIN
  CREATE ROLE ut_metrics_runtime LOGIN PASSWORD '$UT_METRICS_PASSWORD';
EXCEPTION WHEN duplicate_object THEN
  ALTER ROLE ut_metrics_runtime PASSWORD '$UT_METRICS_PASSWORD';
END \$\$;
GRANT metrics_user TO ut_metrics_runtime;

-- ut_migration_runtime — used only during migration windows, not by runtime services
DO \$\$ BEGIN
  CREATE ROLE ut_migration_runtime LOGIN PASSWORD '$UT_MIGRATION_PASSWORD';
EXCEPTION WHEN duplicate_object THEN
  ALTER ROLE ut_migration_runtime PASSWORD '$UT_MIGRATION_PASSWORD';
END \$\$;
GRANT migration_owner TO ut_migration_runtime;

SQL

log "Login roles provisioned:"
log "  ut_app_runtime       → app_user"
log "  ut_ingestion_runtime → ingestion_writer"
log "  ut_scanner_runtime   → scanner_user"
log "  ut_metrics_runtime   → metrics_user"
log "  ut_migration_runtime → migration_owner"
log ""
log "Next: update connection strings in each service's env to use the login roles."
log "Run scripts/postgres/validate-roles.sql to verify grants."
