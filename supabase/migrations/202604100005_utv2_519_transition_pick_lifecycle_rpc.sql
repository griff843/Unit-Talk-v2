-- UTV2-519 P7A-04 Corrective: atomic pick lifecycle transition RPC.
--
-- Wraps `UPDATE picks.status` + `INSERT pick_lifecycle` in a single Postgres
-- transaction so they succeed or roll back together. Replaces the two-write
-- pattern in packages/db/src/lifecycle.ts (lines 141-144) which could leave
-- picks.status updated while the lifecycle event insert failed a CHECK or
-- other constraint (e.g. the UTV2-491 vs UTV2-519 awaiting_approval gap).
--
-- Behavior
-- --------
-- 1. `SELECT status FROM picks WHERE id = p_pick_id FOR UPDATE` — locks the
--    row and fetches the current status.
-- 2. If not found, RAISE EXCEPTION 'PICK_NOT_FOUND' (SQLSTATE P0001). The
--    caller maps this back to the InvalidPickStateError sentinel.
-- 3. If current status != p_from_state, RAISE EXCEPTION
--    'INVALID_LIFECYCLE_TRANSITION' (SQLSTATE P0001). The caller maps this
--    back to the InvalidTransitionError sentinel.
-- 4. UPDATE picks SET status = p_to_state, updated_at = now().
-- 5. INSERT INTO pick_lifecycle (pick_id, from_state, to_state, writer_role,
--    reason, payload, created_at) VALUES (...) RETURNING *.
-- 6. Return jsonb with { pickId, fromState, toState, eventId }. Any failure
--    inside the function raises and Postgres rolls back both writes.
--
-- Why no FSM check here
-- ---------------------
-- The TypeScript FSM in packages/db/src/lifecycle.ts (`allowedTransitions`)
-- remains the canonical FSM and is evaluated BEFORE this RPC is invoked. This
-- RPC only guards the from_state race — it does not duplicate the full FSM.
-- Matches the design of enqueue_distribution_atomic which also validates from
-- state at the SQL layer but not the full FSM.

create or replace function public.transition_pick_lifecycle(
  p_pick_id uuid,
  p_from_state text,
  p_to_state text,
  p_writer_role text,
  p_reason text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_current_status text;
  v_event_row public.pick_lifecycle;
begin
  -- 1. Lock the row and read current status.
  select status
    into v_current_status
    from public.picks
   where id = p_pick_id
   for update;

  if not found then
    raise exception 'PICK_NOT_FOUND: %', p_pick_id
      using errcode = 'P0001';
  end if;

  -- 2. Validate from_state matches.
  if v_current_status is distinct from p_from_state then
    raise exception 'INVALID_LIFECYCLE_TRANSITION: expected %, got %', p_from_state, v_current_status
      using errcode = 'P0001';
  end if;

  -- 3. Update picks.status.
  update public.picks
     set status = p_to_state,
         updated_at = timezone('utc', now())
   where id = p_pick_id;

  -- 4. Insert the lifecycle event.
  insert into public.pick_lifecycle (
    pick_id, from_state, to_state, writer_role, reason, payload, created_at
  ) values (
    p_pick_id,
    p_from_state,
    p_to_state,
    p_writer_role,
    p_reason,
    coalesce(p_payload, '{}'::jsonb),
    timezone('utc', now())
  )
  returning * into v_event_row;

  return jsonb_build_object(
    'pickId', p_pick_id,
    'fromState', p_from_state,
    'toState', p_to_state,
    'eventId', v_event_row.id
  );
end;
$$;

grant execute on function public.transition_pick_lifecycle(uuid, text, text, text, text, jsonb) to service_role;

comment on function public.transition_pick_lifecycle(uuid, text, text, text, text, jsonb) is
  'UTV2-519: atomic pick lifecycle transition. Replaces the two-write pattern in lifecycle.ts. Locks picks row FOR UPDATE, validates from_state, updates picks.status and inserts pick_lifecycle event in one transaction. Raises PICK_NOT_FOUND or INVALID_LIFECYCLE_TRANSITION (SQLSTATE P0001) on guard failures; any other constraint error (e.g. pick_lifecycle_to_state_check) rolls both writes back.';
