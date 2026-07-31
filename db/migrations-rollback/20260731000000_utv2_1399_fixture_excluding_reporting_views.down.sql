-- UTV2-1399 — rollback for the fixture-excluding reporting views.
--
-- FULLY REVERSIBLE. Not IRREVERSIBLE, and therefore correctly absent from
-- db/migrations-rollback/irreversible-exemption-registry.json.
--
-- The up migration created exactly one schema (`reporting`) and placed every
-- object it created inside it: one IMMUTABLE classifier function and five
-- views. It altered no base table, dropped no column, and mutated no row.
-- Dropping the schema therefore restores the prior reporting behaviour exactly
-- — any consumer still reading public.picks / public.submissions /
-- public.settlement_records is unaffected before, during and after this script,
-- because those relations were never touched.
--
-- No data is lost by this rollback: the reporting surface is derived, and every
-- row it exposed (and every row it excluded) remains in the base tables.

BEGIN;

-- CASCADE drops the five views and the classifier function together. Nothing
-- outside `reporting` depends on them: the dependency direction is
-- reporting -> public, never public -> reporting. Verified by the guard below,
-- which fails closed rather than silently cascading into public.*.
DO $$
DECLARE
  v_external_dependents int;
BEGIN
  SELECT count(*)
    INTO v_external_dependents
  FROM pg_depend d
  JOIN pg_rewrite r     ON r.oid = d.objid
  JOIN pg_class   v     ON v.oid = r.ev_class
  JOIN pg_namespace vn  ON vn.oid = v.relnamespace
  JOIN pg_class   ref   ON ref.oid = d.refobjid
  JOIN pg_namespace rn  ON rn.oid = ref.relnamespace
  WHERE rn.nspname = 'reporting'
    AND vn.nspname <> 'reporting'
    AND d.deptype = 'n';

  IF v_external_dependents > 0 THEN
    RAISE EXCEPTION
      'UTV2-1399 rollback aborted: % object(s) outside schema "reporting" '
      'depend on it. DROP SCHEMA ... CASCADE would remove them too. Repoint '
      'those consumers at public.* first, then re-run this rollback.',
      v_external_dependents;
  END IF;
END
$$;

DROP SCHEMA IF EXISTS reporting CASCADE;

COMMIT;
