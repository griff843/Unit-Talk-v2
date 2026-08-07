-- UTV2-1633 — rollback for the reporting_reader least-privilege role.
--
-- FULLY REVERSIBLE. Not IRREVERSIBLE, and therefore correctly absent from
-- db/migrations-rollback/irreversible-exemption-registry.json.
--
-- The up migration created exactly one role (`reporting_reader`) and granted
-- it CONNECT on the database, USAGE on schema `reporting`, SELECT on every
-- table/view in `reporting`, and a default-privileges entry for future
-- `reporting` objects. It altered no object it didn't create, and owns
-- nothing: `reporting` and its views (owned by UTV2-1399) are untouched by
-- this rollback.
--
-- `DROP OWNED BY reporting_reader` revokes every privilege granted TO this
-- role on any object in the current database (including the schema USAGE,
-- table SELECT, and database CONNECT grants above) and drops anything it
-- owns (nothing, since it is a NOLOGIN role that never created an object).
-- The explicit REVOKEs beforehand are defence-in-depth, not strictly
-- required, and make each privilege this rollback removes individually
-- auditable rather than implicit in a single catch-all statement.

BEGIN;

-- Explicit REVOKEs first (defence in depth / auditability). Each mirrors a
-- GRANT in the up migration exactly.
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting
  REVOKE SELECT ON TABLES FROM reporting_reader;

REVOKE SELECT ON ALL TABLES IN SCHEMA reporting FROM reporting_reader;
REVOKE USAGE ON SCHEMA reporting FROM reporting_reader;
REVOKE CONNECT ON DATABASE postgres FROM reporting_reader;

-- Belt-and-suspenders: remove any privilege or default-privilege entry this
-- role holds anywhere in the current database, and drop anything it owns
-- (nothing, by construction -- reporting_reader is NOLOGIN and never issued
-- a CREATE). Safe to run even if the explicit REVOKEs above already cleared
-- everything; DROP OWNED BY is a no-op once there is nothing left to drop.
DROP OWNED BY reporting_reader;

DROP ROLE IF EXISTS reporting_reader;

-- Fail-closed check: the role must be gone, and nothing outside this
-- rollback's own scope may have been touched.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_reader') THEN
    RAISE EXCEPTION
      'UTV2-1633 rollback failed: role "reporting_reader" still exists after '
      'DROP ROLE. It may still own an object or hold a privilege this '
      'script did not anticipate -- inspect pg_shdepend before retrying.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'reporting') THEN
    RAISE EXCEPTION
      'UTV2-1633 rollback aborted: schema "reporting" is missing. This '
      'rollback must never remove or depend on removing that schema -- it '
      'belongs to UTV2-1399, not this migration. Something else deleted it; '
      'do not proceed.';
  END IF;
END
$$;

COMMIT;
