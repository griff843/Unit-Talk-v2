-- UTV2-1980: make governed pick performance service-role-only.
--
-- Role-guarded: each role-specific REVOKE/GRANT runs only when that role exists
-- (scratch Postgres in CI has no Supabase roles; Supabase always has all three).
-- security_invoker and the PUBLIC revoke are unconditional. A final check fails
-- closed: for every role that exists, the end-state privileges must be exactly
-- anon/authenticated = none, service_role = SELECT only, and the view must be
-- security_invoker. A guard therefore only skips on a MISSING role.
--
-- Recovery (run only in an authorized environment): see
-- db/migrations-rollback/20261022090000_revoke_governed_pick_performance_anon.down.sql
-- which restores the measured pre-change posture (anon and authenticated hold
-- all privileges, service_role holds all privileges, PUBLIC none, no
-- security_invoker). Production execution is not authorized by this migration
-- or by this lane.
--
-- Capture each staging snapshot (before, after, recovered, and reapplied) with:
--   SELECT role_name,
--          privilege,
--          has_table_privilege(
--            role_name,
--            'public.v_governed_pick_performance',
--            privilege
--          ) AS allowed
--   FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS roles(role_name)
--   CROSS JOIN unnest(ARRAY[
--     'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
--   ]) AS privileges(privilege)
--   ORDER BY role_name, privilege;

BEGIN;

ALTER VIEW public.v_governed_pick_performance
  SET (security_invoker = true);

REVOKE ALL PRIVILEGES ON TABLE public.v_governed_pick_performance
  FROM PUBLIC;

DO $$
DECLARE
  role_name text;
  priv text;
  expected boolean;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.v_governed_pick_performance FROM %I',
        role_name
      );
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT ON TABLE public.v_governed_pick_performance TO service_role';
  END IF;

  -- Fail-closed end-state check for every role that exists.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = 'public.v_governed_pick_performance'::regclass
      AND 'security_invoker=true' = ANY (coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'v_governed_pick_performance is not security_invoker after migration';
  END IF;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      FOREACH priv IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ] LOOP
        expected := (role_name = 'service_role' AND priv = 'SELECT');
        IF has_table_privilege(role_name, 'public.v_governed_pick_performance', priv)
           IS DISTINCT FROM expected THEN
          RAISE EXCEPTION 'v_governed_pick_performance end-state wrong: % % expected % ',
            role_name, priv, expected;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END
$$;

COMMIT;
