-- UTV2-491 P7A-01: Add 'awaiting_approval' to picks.status check constraint
--
-- Phase 7A governance brake — enables non-human producers to land picks in a
-- pending-approval state that does not auto-distribute. The state is added to
-- the allow-list so the TypeScript FSM (packages/db/src/lifecycle.ts) can
-- represent and persist the new transitions.
--
-- This migration is purely additive. No existing row has its status changed,
-- no existing path is blocked. The atomic submission RPC
-- (process_submission_atomic) continues to default 'validated' and is NOT
-- modified here — that decision belongs to UTV2-492 if it needs non-human
-- producers to use the atomic path.
--
-- Idempotent: DROP IF EXISTS + ADD lets this re-apply cleanly if schema drift
-- from prior manual dashboard edits is detected at apply time.
--
-- Rollback SQL (run manually if needed — NOT executed by this migration):
--   -- 1. Verify no rows use the new state before rollback:
--   SELECT count(*) FROM public.picks WHERE status = 'awaiting_approval';
--   -- If count > 0, move them to 'voided' first:
--   --   UPDATE public.picks SET status = 'voided' WHERE status = 'awaiting_approval';
--   -- 2. Restore the pre-UTV2-491 constraint:
--   ALTER TABLE public.picks DROP CONSTRAINT IF EXISTS picks_status_check;
--   ALTER TABLE public.picks ADD CONSTRAINT picks_status_check CHECK (
--     status in ('draft', 'validated', 'queued', 'posted', 'settled', 'voided')
--   );

ALTER TABLE public.picks DROP CONSTRAINT IF EXISTS picks_status_check;

ALTER TABLE public.picks ADD CONSTRAINT picks_status_check CHECK (
  status in ('draft', 'validated', 'awaiting_approval', 'queued', 'posted', 'settled', 'voided')
);

COMMENT ON CONSTRAINT picks_status_check ON public.picks IS
  'UTV2-491: lifecycle state allow-list. awaiting_approval added in Phase 7A for the governance brake. See packages/db/src/lifecycle.ts for the canonical FSM.';
