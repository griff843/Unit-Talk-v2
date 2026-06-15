-- UTV2-539 / DEBT-002 Corrective: atomic backfill RPC for stranded
-- `awaiting_approval` picks left behind by the pre-UTV2-519 non-atomic
-- `transitionPickLifecycle` bug.
--
-- Background
-- ----------
-- A bounded set of `picks` rows exist in the live DB with
-- `status='awaiting_approval'` but no matching `pick_lifecycle` row of
-- `to_state='awaiting_approval'`. Those rows are the residue of the
-- pre-UTV2-519 non-atomic two-write pattern in
-- packages/db/src/lifecycle.ts (lines 141-144), which committed the
-- `picks.status` UPDATE while the sibling `pick_lifecycle` INSERT was
-- rejected by `pick_lifecycle_to_state_check` (UTV2-491 / UTV2-519 gap).
--
-- DEBT-002 in `docs/06_status/KNOWN_DEBT.md` tracks the cleanup. The plan
-- in `docs/06_status/UTV2-539-CLEANUP-PLAN.md` classifies each stranded
-- row as either a fixture (delete) or a production-backfill (run this RPC).
-- The matching dry-run + execute script lives at
-- `apps/api/src/scripts/utv2-539-awaiting-approval-cleanup.ts`.
--
-- This RPC is the BACKFILL half. It does NOT mutate the `picks` row — the
-- `status` column is already `awaiting_approval`. It only inserts the
-- missing sibling `pick_lifecycle` row plus the matching `audit_log` row,
-- atomically, so the chain becomes structurally consistent.
--
-- Behavior
-- --------
-- 1. `SELECT status FROM picks WHERE id = p_pick_id FOR UPDATE` — locks the
--    target pick row and reads its current status.
-- 2. If `status` is distinct from `'awaiting_approval'`, RAISE EXCEPTION
--    `INVALID_BACKFILL_STATE` (SQLSTATE P0001). This is the drift guard:
--    if the row has been moved out of `awaiting_approval` since the
--    inventory snapshot was taken, the backfill must abort fail-closed
--    rather than write a phantom lifecycle event.
-- 3. If a `pick_lifecycle` row already exists for this pick with
--    `to_state='awaiting_approval'`, RAISE EXCEPTION `ALREADY_BACKFILLED`
--    (SQLSTATE P0001). This is the idempotency guard: prevents a double
--    backfill if the cleanup script is accidentally re-run after a
--    successful pass.
-- 4. INSERT the new `pick_lifecycle` row with
--    `from_state='validated'`, `to_state='awaiting_approval'`,
--    `writer_role='operator_override'` (the only value in
--    `pick_lifecycle_writer_role_check` that fits operator-initiated
--    remediation), `reason='backfill_utv2_519_remediation'`.
-- 5. INSERT the matching `audit_log` row with
--    `action='pick.governance_brake.backfilled'`,
--    `entity_type='picks'`, `entity_id=<new lifecycle event id>` (FK to
--    the primary entity per the audit_log convention),
--    `entity_ref=p_pick_id::text` (pick id as text per the audit_log
--    convention), `actor='system:utv2-539-backfill'`, payload carrying
--    the Linear issue, the corrective_of pointer, the run timestamp, and
--    the original-strand marker.
-- 6. Return jsonb: `{ pickId, lifecycleEventId, backfilledAt }`.
--
-- Both writes happen in the implicit function transaction — if either
-- INSERT fails, the entire RPC rolls back and no partial state is left
-- in the DB.
--
-- Why a dedicated RPC and not `transition_pick_lifecycle`
-- -------------------------------------------------------
-- `transition_pick_lifecycle` validates that the target pick is currently
-- in `from_state` AND updates `picks.status` to `to_state`. The DEBT-002
-- backfill needs the opposite: the pick is ALREADY in
-- `awaiting_approval`, and we must NOT touch `picks.status` (the row is
-- already in the correct state — only the sibling lifecycle event is
-- missing). A dedicated RPC keeps that semantic explicit and prevents
-- accidental status mutation during remediation.
--
-- Rollback SQL (run manually if needed — NOT executed by this migration)
-- ----------------------------------------------------------------------
-- Step A: reverse the data writes produced by this RPC (run BEFORE the
-- DROP FUNCTION below to avoid orphan audit rows pointing at a missing
-- function definition):
--
--   DELETE FROM public.audit_log
--    WHERE action = 'pick.governance_brake.backfilled'
--      AND payload->>'linear_issue' = 'UTV2-539';
--
--   DELETE FROM public.pick_lifecycle
--    WHERE reason = 'backfill_utv2_519_remediation';
--
-- Step B: drop the RPC itself:
--
--   DROP FUNCTION IF EXISTS public.backfill_pick_awaiting_approval(uuid, text);

create or replace function public.backfill_pick_awaiting_approval(
  p_pick_id uuid,
  p_linear_issue text
) returns jsonb
language plpgsql
as $$
declare
  v_current_status text;
  v_existing_count integer;
  v_event_row public.pick_lifecycle;
begin
  -- 1. Lock the target pick and read current status.
  select status
    into v_current_status
    from public.picks
   where id = p_pick_id
   for update;

  if not found then
    raise exception 'INVALID_BACKFILL_STATE: pick % not found', p_pick_id
      using errcode = 'P0001';
  end if;

  -- 2. Drift guard — must still be awaiting_approval.
  if v_current_status is distinct from 'awaiting_approval' then
    raise exception 'INVALID_BACKFILL_STATE: pick % status=% expected awaiting_approval', p_pick_id, v_current_status
      using errcode = 'P0001';
  end if;

  -- 3. Idempotency guard — refuse to double-backfill.
  select count(*)
    into v_existing_count
    from public.pick_lifecycle
   where pick_id = p_pick_id
     and to_state = 'awaiting_approval';

  if v_existing_count > 0 then
    raise exception 'ALREADY_BACKFILLED: pick % already has an awaiting_approval lifecycle row', p_pick_id
      using errcode = 'P0001';
  end if;

  -- 4. Insert the missing sibling lifecycle event.
  insert into public.pick_lifecycle (
    pick_id, from_state, to_state, writer_role, reason, payload, created_at
  ) values (
    p_pick_id,
    'validated',
    'awaiting_approval',
    'operator_override',
    'backfill_utv2_519_remediation',
    '{}'::jsonb,
    timezone('utc', now())
  )
  returning * into v_event_row;

  -- 5. Insert the matching audit_log row. entity_id is the FK to the
  -- primary entity (the new lifecycle event id), entity_ref is the pick id
  -- as text — both follow the canonical audit_log convention documented in
  -- root CLAUDE.md.
  insert into public.audit_log (
    action, entity_type, entity_id, entity_ref, actor, payload, created_at
  ) values (
    'pick.governance_brake.backfilled',
    'picks',
    v_event_row.id,
    p_pick_id::text,
    'system:utv2-539-backfill',
    jsonb_build_object(
      'linear_issue', p_linear_issue,
      'corrective_of', 'UTV2-519',
      'backfill_ran_at', timezone('utc', now()),
      'original_pick_lifecycle_strand', true
    ),
    timezone('utc', now())
  );

  -- 6. Return the structured result.
  return jsonb_build_object(
    'pickId', p_pick_id,
    'lifecycleEventId', v_event_row.id,
    'backfilledAt', timezone('utc', now())
  );
end;
$$;

grant execute on function public.backfill_pick_awaiting_approval(uuid, text) to service_role;

comment on function public.backfill_pick_awaiting_approval(uuid, text) is
  'UTV2-539 / DEBT-002: atomic backfill RPC for stranded awaiting_approval picks left by the pre-UTV2-519 non-atomic transitionPickLifecycle bug. Locks picks row FOR UPDATE, validates current status is awaiting_approval (raises INVALID_BACKFILL_STATE / SQLSTATE P0001 on drift), validates no prior awaiting_approval lifecycle row exists (raises ALREADY_BACKFILLED / SQLSTATE P0001 if so), inserts the missing pick_lifecycle row + matching audit_log row in one transaction, and returns { pickId, lifecycleEventId, backfilledAt }. Does NOT mutate picks.status — the row is already in the correct state. Paired with apps/api/src/scripts/utv2-539-awaiting-approval-cleanup.ts.';
