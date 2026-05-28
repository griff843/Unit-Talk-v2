-- UTV2-1107: DB-layer FSM enforcement for picks.status
-- Adds a BEFORE UPDATE trigger that validates every picks.status transition against
-- the canonical FSM graph from @unit-talk/contracts, closing the gap where
-- service-role direct UPDATE bypasses the TypeScript lifecycle guards.
--
-- Canonical FSM (matches pickLifecycleTransitions in @unit-talk/contracts):
--   draft           → validated, voided
--   validated       → queued, awaiting_approval, voided
--   awaiting_approval → queued, voided
--   queued          → posted, voided
--   posted          → settled, voided
--   settled         → [] (terminal)
--   voided          → [] (terminal)
--
-- Same-state updates are passed through (no-op; trigger fires only when
-- OLD.status IS DISTINCT FROM NEW.status via WHEN clause).

CREATE OR REPLACE FUNCTION public.picks_fsm_transition_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed TEXT[];
BEGIN
  -- Resolve allowed transitions for the current state
  CASE OLD.status
    WHEN 'draft'              THEN allowed := ARRAY['validated', 'voided'];
    WHEN 'validated'          THEN allowed := ARRAY['queued', 'awaiting_approval', 'voided'];
    WHEN 'awaiting_approval'  THEN allowed := ARRAY['queued', 'voided'];
    WHEN 'queued'             THEN allowed := ARRAY['posted', 'voided'];
    WHEN 'posted'             THEN allowed := ARRAY['settled', 'voided'];
    WHEN 'settled'            THEN allowed := ARRAY[]::TEXT[];
    WHEN 'voided'             THEN allowed := ARRAY[]::TEXT[];
    ELSE
      RAISE EXCEPTION 'FSM_PICK_TRANSITION_REJECTED: unknown from_state % for pick %',
        OLD.status, OLD.id
        USING ERRCODE = 'P0001',
              DETAIL  = format('pick_id=%s from_state=%s to_state=%s', OLD.id, OLD.status, NEW.status);
  END CASE;

  -- Reject illegal transitions
  IF NOT (NEW.status = ANY(allowed)) THEN
    RAISE EXCEPTION 'FSM_PICK_TRANSITION_REJECTED: % → % is not a valid pick lifecycle transition for pick %',
      OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'P0001',
            DETAIL  = format('pick_id=%s from_state=%s to_state=%s', OLD.id, OLD.status, NEW.status);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.picks_fsm_transition_guard() IS
  'Enforces the canonical pick lifecycle FSM for every picks.status update, including '
  'service-role direct UPDATEs that bypass the TypeScript lifecycle layer.';

-- Drop existing trigger if it exists (idempotent re-run safety)
DROP TRIGGER IF EXISTS picks_fsm_guard ON public.picks;

CREATE TRIGGER picks_fsm_guard
  BEFORE UPDATE ON public.picks
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.picks_fsm_transition_guard();

COMMENT ON TRIGGER picks_fsm_guard ON public.picks IS
  'DB-level FSM guard (UTV2-1107). Fires only when status changes. '
  'Raises SQLSTATE P0001 / FSM_PICK_TRANSITION_REJECTED on invalid transitions.';
