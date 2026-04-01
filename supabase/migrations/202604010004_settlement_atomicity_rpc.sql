-- UTV2-221: Atomic settlement RPC
-- Wraps INSERT settlement_records + UPDATE picks.status + INSERT pick_lifecycle
-- + INSERT audit_log in a single Postgres transaction.
--
-- Handles duplicate settlement via ON CONFLICT returning existing record.

create or replace function public.settle_pick_atomic(
  p_pick_id uuid,
  p_settlement jsonb,
  p_lifecycle_from_state text,
  p_lifecycle_to_state text,
  p_lifecycle_writer_role text,
  p_lifecycle_reason text,
  p_audit_action text,
  p_audit_actor text,
  p_audit_payload jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_settlement_row public.settlement_records;
  v_pick_row       public.picks;
  v_lce_row        public.pick_lifecycle;
  v_is_duplicate   boolean := false;
begin
  -- 1. Insert settlement record
  begin
    insert into public.settlement_records (
      pick_id, result, source, confidence, settled_by,
      evidence_ref, notes, review_reason, payload,
      settled_at, corrects_id
    ) values (
      p_pick_id,
      p_settlement->>'result',
      p_settlement->>'source',
      p_settlement->>'confidence',
      p_settlement->>'settled_by',
      p_settlement->>'evidence_ref',
      p_settlement->>'notes',
      p_settlement->>'review_reason',
      coalesce((p_settlement->'payload')::jsonb, '{}'::jsonb),
      coalesce((p_settlement->>'settled_at')::timestamptz, timezone('utc', now())),
      (p_settlement->>'corrects_id')::uuid
    )
    returning * into v_settlement_row;
  exception
    when unique_violation then
      -- Duplicate settlement — return existing
      select * into v_settlement_row
      from public.settlement_records
      where pick_id = p_pick_id
        and source = p_settlement->>'source'
        and corrects_id is null
      order by settled_at desc
      limit 1;

      v_is_duplicate := true;
  end;

  if v_is_duplicate then
    -- Return existing settlement without modifying pick state
    select * into v_pick_row from public.picks where id = p_pick_id;
    return jsonb_build_object(
      'settlement', to_jsonb(v_settlement_row),
      'pick', to_jsonb(v_pick_row),
      'lifecycleEvent', null,
      'duplicate', true
    );
  end if;

  -- 2. Transition pick lifecycle
  update public.picks
  set status = p_lifecycle_to_state,
      settled_at = case when p_lifecycle_to_state = 'settled' then timezone('utc', now()) else settled_at end,
      updated_at = timezone('utc', now())
  where id = p_pick_id
    and status = p_lifecycle_from_state
  returning * into v_pick_row;

  -- 3. Insert lifecycle event
  insert into public.pick_lifecycle (
    pick_id, from_state, to_state, writer_role, reason, payload, created_at
  ) values (
    p_pick_id, p_lifecycle_from_state, p_lifecycle_to_state,
    p_lifecycle_writer_role, p_lifecycle_reason,
    '{}'::jsonb, timezone('utc', now())
  )
  returning * into v_lce_row;

  -- 4. Insert audit log
  insert into public.audit_log (
    entity_type, entity_id, entity_ref, action, actor, payload, created_at
  ) values (
    'settlement_records', v_settlement_row.id, p_pick_id::text,
    p_audit_action, p_audit_actor, p_audit_payload, timezone('utc', now())
  );

  return jsonb_build_object(
    'settlement', to_jsonb(v_settlement_row),
    'pick', to_jsonb(v_pick_row),
    'lifecycleEvent', to_jsonb(v_lce_row),
    'duplicate', false
  );
end;
$$;
