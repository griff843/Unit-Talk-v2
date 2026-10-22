-- WORK-2026102204: restore the measured pre-change privilege posture.
-- Run only in an authorized environment. Production execution is not
-- authorized by this rollback script or by this lane.

BEGIN;

ALTER VIEW public.v_governed_pick_performance
  RESET (security_invoker);

REVOKE ALL PRIVILEGES ON TABLE public.v_governed_pick_performance
  FROM PUBLIC, anon, authenticated, service_role;

GRANT ALL PRIVILEGES ON TABLE public.v_governed_pick_performance
  TO anon, authenticated, service_role;

COMMIT;
