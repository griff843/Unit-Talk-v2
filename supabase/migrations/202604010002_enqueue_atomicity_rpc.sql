-- UTV2-219: Atomic enqueue + lifecycle transition RPC
-- Wraps UPDATE picks.status + INSERT pick_lifecycle + INSERT distribution_outbox
-- in a single Postgres transaction to prevent zombie queued picks.
--
-- Returns null if pick is not in expected state (already queued/posted/etc).

create or replace function public.enqueue_distribution_atomic(
  p_pick_id uuid,
  p_from_state text,
  p_to_state text,
  p_writer_role text,
  p_reason text,
  p_lifecycle_created_at timestamptz,
  p_outbox_target text,
  p_outbox_payload jsonb,
  p_outbox_idempotency_key text
) returns jsonb
language plpgsql
as $$
declare
  v_pick_row   public.picks;
  v_lce_row    public.pick_lifecycle;
  v_outbox_row public.distribution_outbox;
begin
  -- 1. Conditionally update pick status (only if in expected from_state)
  update public.picks
  set status = p_to_state,
      updated_at = timezone('utc', now())
  where id = p_pick_id
    and status = p_from_state
  returning * into v_pick_row;

  if v_pick_row.id is null then
    -- Pick not in expected state — return null (caller handles)
    return null;
  end if;

  -- 2. Insert lifecycle event
  insert into public.pick_lifecycle (
    pick_id, from_state, to_state, writer_role, reason, payload, created_at
  ) values (
    p_pick_id, p_from_state, p_to_state, p_writer_role, p_reason,
    '{}'::jsonb, p_lifecycle_created_at
  )
  returning * into v_lce_row;

  -- 3. Insert outbox record
  insert into public.distribution_outbox (
    pick_id, target, status, attempt_count, payload, idempotency_key
  ) values (
    p_pick_id, p_outbox_target, 'pending', 0,
    p_outbox_payload, p_outbox_idempotency_key
  )
  on conflict (idempotency_key) where idempotency_key is not null
  do update set pick_id = distribution_outbox.pick_id -- no-op, return existing
  returning * into v_outbox_row;

  return jsonb_build_object(
    'pick', to_jsonb(v_pick_row),
    'lifecycleEvent', to_jsonb(v_lce_row),
    'outbox', to_jsonb(v_outbox_row)
  );
end;
$$;
