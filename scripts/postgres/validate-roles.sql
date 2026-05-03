-- Unit Talk V2 — Postgres Role Validation Queries
-- UTV2-789
--
-- Run against the Hetzner Postgres to verify the role model is correctly applied.
-- Connect as superuser or migration_owner.
--
-- Usage:
--   psql $DATABASE_URL -f scripts/postgres/validate-roles.sql

\echo '=== Group Roles ==='
SELECT rolname, rolsuper, rolinherit, rolcanlogin
FROM pg_catalog.pg_roles
WHERE rolname IN ('app_user', 'ingestion_writer', 'scanner_user', 'metrics_user', 'migration_owner')
ORDER BY rolname;

\echo ''
\echo '=== Login Roles and Their Group Memberships ==='
SELECT
  m.rolname AS login_role,
  g.rolname AS group_role,
  r.rolsuper AS is_superuser
FROM pg_catalog.pg_auth_members am
JOIN pg_catalog.pg_roles m ON m.oid = am.member
JOIN pg_catalog.pg_roles g ON g.oid = am.roleid
JOIN pg_catalog.pg_roles r ON r.oid = am.member
WHERE m.rolname IN ('ut_app_runtime', 'ut_ingestion_runtime', 'ut_scanner_runtime', 'ut_metrics_runtime', 'ut_migration_runtime')
ORDER BY m.rolname;

\echo ''
\echo '=== Superuser Check (all login roles must be FALSE) ==='
SELECT rolname, rolsuper
FROM pg_catalog.pg_roles
WHERE rolname IN ('ut_app_runtime', 'ut_ingestion_runtime', 'ut_scanner_runtime', 'ut_metrics_runtime')
  AND rolcanlogin = true
ORDER BY rolname;

\echo ''
\echo '=== Table Grants on picks (expect: app_user has SELECT,INSERT,UPDATE; ingestion_writer has none) ==='
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'picks'
  AND grantee IN ('app_user', 'ingestion_writer', 'scanner_user', 'metrics_user')
ORDER BY grantee, privilege_type;

\echo ''
\echo '=== Table Grants on provider_offers (expect: ingestion_writer has SELECT,INSERT,UPDATE; app_user has SELECT) ==='
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'provider_offers'
  AND grantee IN ('app_user', 'ingestion_writer', 'scanner_user', 'metrics_user')
ORDER BY grantee, privilege_type;

\echo ''
\echo '=== Table Grants on pick_candidates (expect: scanner_user has SELECT,INSERT,UPDATE) ==='
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'pick_candidates'
  AND grantee IN ('app_user', 'ingestion_writer', 'scanner_user', 'metrics_user')
ORDER BY grantee, privilege_type;

\echo ''
\echo '=== distribution_outbox write check (metrics_user must NOT have INSERT/UPDATE) ==='
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'distribution_outbox'
  AND grantee = 'metrics_user'
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');

\echo ''
\echo 'If the last query returns rows, metrics_user has unexpected write access — provisioning error.'
\echo 'Validation complete.'
