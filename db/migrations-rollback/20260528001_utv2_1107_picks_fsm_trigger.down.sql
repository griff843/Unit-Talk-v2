-- Down script for 20260528001_utv2_1107_picks_fsm_trigger
-- Reverts: drops the picks_fsm_guard BEFORE UPDATE trigger and its backing
-- trigger function introduced by UTV2-1107.
--
-- After applying this down script, service-role direct UPDATE picks SET status
-- will no longer be checked against the canonical FSM graph at the DB layer.
-- The TypeScript lifecycle guards in packages/db/src/lifecycle.ts remain in
-- place for application-layer paths, but DB-level enforcement is removed.
--
-- This script is safe to replay: both DROP IF EXISTS.

DROP TRIGGER IF EXISTS picks_fsm_guard ON public.picks;

DROP FUNCTION IF EXISTS public.picks_fsm_transition_guard();
