-- UTV2-1633 — least-privilege read-only Postgres role for diagnostics and reporting
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'reporting') THEN
    RAISE EXCEPTION
      'UTV2-1633 migration aborted: schema "reporting" does not exist. '
      'This migration depends on UTV2-1399 (fixture-excluding reporting '
      'views) having already been applied. Apply that migration first.';
  END IF;
END
$$;

DO $$ BEGIN
  CREATE ROLE reporting_reader
    NOLOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOREPLICATION
    NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON ROLE reporting_reader IS
  'UTV2-1633. Least-privilege, read-only NOLOGIN group role for diagnostics '
  'and reporting. SELECT on schema reporting only (present and future '
  'objects); CONNECT on the database; nothing else. No grant on schema '
  'public or any other schema. Not granted to any login/service credential '
  'by this migration -- that is a separate governed action.';

GRANT CONNECT ON DATABASE postgres TO reporting_reader;

GRANT USAGE ON SCHEMA reporting TO reporting_reader;

GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO reporting_reader;

ALTER DEFAULT PRIVILEGES IN SCHEMA reporting
  GRANT SELECT ON TABLES TO reporting_reader;

DO $$
DECLARE
  v_reporting_select_count int;
  v_public_grant_count     int;
BEGIN
  SELECT count(*) INTO v_reporting_select_count
  FROM information_schema.role_table_grants
  WHERE grantee = 'reporting_reader'
    AND table_schema = 'reporting'
    AND privilege_type = 'SELECT';

  IF v_reporting_select_count < 1 THEN
    RAISE EXCEPTION
      'UTV2-1633 sanity check failed: reporting_reader has % SELECT grants '
      'in schema reporting, expected at least 1. Grant did not take effect.',
      v_reporting_select_count;
  END IF;

  SELECT count(*) INTO v_public_grant_count
  FROM information_schema.role_table_grants
  WHERE grantee = 'reporting_reader'
    AND table_schema = 'public';

  IF v_public_grant_count > 0 THEN
    RAISE EXCEPTION
      'UTV2-1633 sanity check failed: reporting_reader holds % privilege '
      'grant row(s) on schema public. This role must have zero grants on public -- the '
      'reporting.* views are security-definer specifically so this role '
      'never needs base-table access.', v_public_grant_count;
  END IF;

  RAISE NOTICE
    'UTV2-1633: reporting_reader created. reporting SELECT grants=%, public grants=%',
    v_reporting_select_count, v_public_grant_count;
END
$$;

COMMIT;
;
