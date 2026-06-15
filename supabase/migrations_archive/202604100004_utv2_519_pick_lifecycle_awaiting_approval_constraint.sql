-- UTV2-519 P7A-04 Corrective: extend pick_lifecycle.to_state allow-list
-- to include 'awaiting_approval'.
--
-- Background
-- ----------
-- UTV2-491 (202604100003) added 'awaiting_approval' to picks_status_check but
-- did NOT add it to the sibling `pick_lifecycle_to_state_check` constraint on
-- the pick_lifecycle events table (originally declared in 202603200002
-- v2_schema_hardening). As a result the Phase 7A governance brake could
-- successfully update picks.status to 'awaiting_approval' (first write) but
-- the subsequent INSERT into pick_lifecycle(to_state='awaiting_approval') was
-- rejected by Postgres with a CHECK violation. Because the two writes were
-- not wrapped in a transaction (packages/db/src/lifecycle.ts lines 141-144),
-- the status update committed and the DB was left structurally inconsistent:
-- picks.status = 'awaiting_approval' with no matching lifecycle event, no
-- 'pick.governance_brake.applied' audit row, and the submission endpoint
-- returning HTTP 400.
--
-- This migration is purely additive. No existing row has its status changed,
-- no existing path is blocked. It only widens the allow-list on the
-- pick_lifecycle events table so that UTV2-491's FSM update can be persisted
-- end to end.
--
-- Scope audit
-- -----------
-- A grep of supabase/migrations/*.sql for pick_lifecycle check constraints
-- shows only `pick_lifecycle_to_state_check` and the unrelated
-- `pick_lifecycle_writer_role_check`. The `from_state` column is unconstrained
-- (text, nullable) — no companion check to extend.
--
-- Idempotent: DROP IF EXISTS + ADD lets this re-apply cleanly if schema drift
-- from prior manual dashboard edits is detected at apply time.
--
-- Rollback SQL (run manually if needed — NOT executed by this migration):
--   -- 1. Verify no rows use the new to_state before rollback:
--   SELECT count(*) FROM public.pick_lifecycle WHERE to_state = 'awaiting_approval';
--   -- If count > 0, decide whether to leave them or re-map them before the swap.
--   -- 2. Restore the pre-UTV2-519 constraint:
--   ALTER TABLE public.pick_lifecycle DROP CONSTRAINT IF EXISTS pick_lifecycle_to_state_check;
--   ALTER TABLE public.pick_lifecycle ADD CONSTRAINT pick_lifecycle_to_state_check CHECK (
--     to_state in ('draft', 'validated', 'queued', 'posted', 'settled', 'voided')
--   );

ALTER TABLE public.pick_lifecycle DROP CONSTRAINT IF EXISTS pick_lifecycle_to_state_check;

ALTER TABLE public.pick_lifecycle ADD CONSTRAINT pick_lifecycle_to_state_check CHECK (
  to_state in ('draft', 'validated', 'awaiting_approval', 'queued', 'posted', 'settled', 'voided')
);

COMMENT ON CONSTRAINT pick_lifecycle_to_state_check ON public.pick_lifecycle IS
  'UTV2-519: lifecycle event to_state allow-list. awaiting_approval added in Phase 7A corrective to close the UTV2-491 gap where picks_status_check allowed awaiting_approval but pick_lifecycle_to_state_check did not. See packages/db/src/lifecycle.ts for the canonical FSM.';
