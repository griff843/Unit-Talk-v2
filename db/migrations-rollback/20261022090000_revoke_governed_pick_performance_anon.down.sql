-- UTV2-1980: restore the measured pre-change privilege posture.
-- Run only in an authorized environment. Production execution is not
-- authorized by this rollback script or by this lane.
--
-- Role-guarded like the up migration: role-specific statements run only when
-- the role exists. Fail-closed check: every existing role among anon,
-- authenticated, service_role must end holding ALL privileges, and the view
-- must have no security_invoker option.

BEGIN;

ALTER VIEW public.v_governed_pick_performance
  RESET (security_invoker);

REVOKE ALL PRIVILEGES ON TABLE public.v_governed_pick_performance
  FROM PUBLIC;

DO $$
DECLARE
  role_name text;
  priv text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.v_governed_pick_performance FROM %I',
        role_name
      );
      EXECUTE format(
        'GRANT ALL PRIVILEGES ON TABLE public.v_governed_pick_performance TO %I',
        role_name
      );
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = 'public.v_governed_pick_performance'::regclass
      AND reloptions IS NOT NULL
      AND EXISTS (SELECT 1 FROM unnest(reloptions) o WHERE o LIKE 'security_invoker%')
  ) THEN
    RAISE EXCEPTION 'v_governed_pick_performance still has security_invoker after rollback';
  END IF;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      FOREACH priv IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ] LOOP
        IF NOT has_table_privilege(role_name, 'public.v_governed_pick_performance', priv) THEN
          RAISE EXCEPTION 'v_governed_pick_performance rollback end-state wrong: % lacks %',
            role_name, priv;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END
$$;

COMMIT;
