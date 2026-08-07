-- UTV2-1633 — least-privilege read-only Postgres role for diagnostics and reporting
--
-- PROBLEM
--   Every diagnostic, monitoring, and reporting path today authenticates with
--   the Supabase service role, which carries full write and delete capability
--   on production. The 2026-07-30 CI-writes-to-production incident (UTV2-1630)
--   was possible because read-shaped work held a write-shaped credential.
--   Closing the workflow exposure removed the reachable paths; it did not
--   remove the capability.
--
-- WHAT THIS MIGRATION DOES
--   Creates exactly one NOLOGIN group role, `reporting_reader`:
--     - CONNECT on the database (explicit grant, for auditability -- see note
--       below on why this is not merely a no-op given existing PUBLIC grants)
--     - USAGE on schema `reporting` only (the UTV2-1399 fixture-excluding
--       reporting surface)
--     - SELECT on every current object in `reporting`, plus (via ALTER
--       DEFAULT PRIVILEGES) every future object created there
--   Nothing else. No INSERT/UPDATE/DELETE/TRUNCATE anywhere, no CREATE
--   anywhere, no role administration (NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
--   NOREPLICATION, NOBYPASSRLS -- all Postgres defaults for a plain CREATE
--   ROLE, restated explicitly here so the grant is self-documenting and
--   auditable without cross-referencing Postgres's default-attribute table).
--
-- WHY ZERO GRANTS ON SCHEMA public
--   UTV2-1399's reporting.* views are deliberately NOT created
--   WITH (security_invoker = true) -- they run with the privileges of their
--   definer (postgres), so a consumer can read the fixture-excluded surface
--   without ever holding a grant on public.picks / public.submissions /
--   public.settlement_records. Granting reporting_reader anything on `public`
--   would reopen exactly the path this role exists to remove, and would also
--   be redundant: reporting_reader never needs it. This migration grants
--   NOTHING on schema public, and the guard test
--   (scripts/ci/utv2-1633-reporting-reader-role-guard.test.ts) enforces that
--   mechanically.
--
--   Note on the existing PUBLIC pseudo-role grant on schema `public`: this
--   Supabase project's `public` schema already carries
--   `GRANT USAGE ON SCHEMA public TO PUBLIC` (pre-existing, not introduced by
--   this migration -- verified read-only against production, 2026-08-01).
--   Schema USAGE alone does not confer SELECT on any table in that schema;
--   reporting_reader receives no table- or view-level grant in `public`, and
--   every relation there has RLS enabled, so `SELECT` on any `public.*`
--   relation fails with "permission denied for table ..." before RLS is even
--   evaluated. See the guard test and docs/06_status/proof/UTV2-1633/ for the
--   measured negative demonstration.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   - Does not create a LOGIN role. reporting_reader is a NOLOGIN group role,
--     matching the existing app_user / ingestion_writer / scanner_user /
--     metrics_user / migration_owner pattern (scripts/postgres/roles.sql).
--     Granting this role to any real login/service credential, or replacing
--     an existing service-role credential with it anywhere, is a separate
--     governed production action requiring explicit PM authorization and is
--     NOT performed by this migration or this lane.
--   - Does not touch `auth`, `vault`, `storage`, `extensions`, or any other
--     schema. Verified read-only against production: none of those schemas
--     grant USAGE to PUBLIC, so reporting_reader has zero implicit path into
--     them, and this migration adds no explicit grant either.
--
-- REVERSIBILITY
--   The down script revokes every privilege this migration grants (schema
--   USAGE, table SELECT, the default-privileges entry, database CONNECT) via
--   `DROP OWNED BY reporting_reader` plus explicit REVOKEs for defence in
--   depth, then drops the role. No object the role was granted on (i.e. the
--   `reporting` schema and its views, owned by UTV2-1399) is altered or
--   dropped by this rollback -- only the role itself, and its privileges, are
--   removed.
--
-- DEPENDENCY
--   Requires schema `reporting` (UTV2-1399) to already exist. Sequenced
--   immediately after it in the migration ledger (timestamp
--   20260801000000 > 20260731000000). The fail-closed guard below aborts
--   with a clear error rather than a bare "schema does not exist" if this
--   invariant is ever violated by an out-of-order replay.

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

-- CONNECT on the database. PUBLIC already carries this grant in this project
-- (verified read-only, 2026-08-01), so this is technically redundant today,
-- but it is granted explicitly and unconditionally so the role's declared
-- privilege set is self-describing and does not silently depend on a PUBLIC
-- grant that could be revoked elsewhere without anyone noticing this role
-- needs it.
GRANT CONNECT ON DATABASE postgres TO reporting_reader;

-- USAGE on schema reporting only. No USAGE grant of any kind is issued on
-- schema public, auth, vault, storage, or extensions.
GRANT USAGE ON SCHEMA reporting TO reporting_reader;

-- SELECT on every object presently in reporting (the five UTV2-1399 views).
-- ALL TABLES IN SCHEMA also covers views in Postgres's grammar.
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO reporting_reader;

-- Future reporting.* objects are readable without a follow-up migration.
-- Unqualified (no FOR ROLE) so it applies to objects created by whichever
-- role runs this migration -- the same role that created the UTV2-1399
-- views it must match, whatever that role turns out to be for a given
-- environment (production and the CI scratch-Postgres round-trip drill both
-- apply migrations as a single role, so "the current role" and "the role
-- that owns reporting's existing views" are always the same role).
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting
  GRANT SELECT ON TABLES TO reporting_reader;

-- Fail-closed sanity check: confirm the grant set is exactly what this
-- migration intends before committing -- SELECT on reporting, and nothing on
-- public.
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
