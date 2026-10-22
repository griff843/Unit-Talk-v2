-- WORK-2026102201: make governed pick performance service-role-only.
--
-- Recovery (run only in an authorized environment):
--   ALTER VIEW public.v_governed_pick_performance RESET (security_invoker);
--   REVOKE ALL PRIVILEGES ON TABLE public.v_governed_pick_performance FROM PUBLIC, service_role;
--   GRANT ALL PRIVILEGES ON TABLE public.v_governed_pick_performance TO anon, authenticated;
--   GRANT ALL PRIVILEGES ON TABLE public.v_governed_pick_performance TO service_role;
--
-- This restores the measured pre-change role posture: anon and authenticated
-- have all view privileges, service_role retains full access, PUBLIC has none,
-- and the view uses PostgreSQL's default security-definer behavior. Prove the
-- recovery on staging with before/after has_table_privilege snapshots, then
-- reapply this migration before promotion. Production execution is not
-- authorized by this migration or by this lane.
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
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.v_governed_pick_performance
  TO service_role;

COMMIT;
