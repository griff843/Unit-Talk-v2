-- UTV2-920: fail closed when atomic RPC pick transitions affect zero rows.
--
-- The RPC signatures stay unchanged for application compatibility. The
-- dependent writes now happen only after the owning pick transition is proven.

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
  update public.picks
  set status = p_to_state,
      updated_at = timezone('utc', now())
  where id = p_pick_id
    and status = p_from_state
  returning * into v_pick_row;

  if v_pick_row.id is null then
    return null;
  end if;

  insert into public.pick_lifecycle (
    pick_id, from_state, to_state, writer_role, reason, payload, created_at
  ) values (
    p_pick_id, p_from_state, p_to_state, p_writer_role, p_reason,
    '{}'::jsonb, p_lifecycle_created_at
  )
  returning * into v_lce_row;

  insert into public.distribution_outbox (
    pick_id, target, status, attempt_count, payload, idempotency_key
  ) values (
    p_pick_id, p_outbox_target, 'pending', 0,
    p_outbox_payload, p_outbox_idempotency_key
  )
  on conflict (idempotency_key) where idempotency_key is not null
  do update set pick_id = distribution_outbox.pick_id
  returning * into v_outbox_row;

  return jsonb_build_object(
    'pick', to_jsonb(v_pick_row),
    'lifecycleEvent', to_jsonb(v_lce_row),
    'outbox', to_jsonb(v_outbox_row)
  );
end;
$$;

create or replace function public.confirm_delivery_atomic(
  p_outbox_id uuid,
  p_pick_id uuid,
  p_worker_id text,
  p_receipt_type text,
  p_receipt_status text,
  p_receipt_channel text,
  p_receipt_external_id text,
  p_receipt_idempotency_key text,
  p_receipt_payload jsonb,
  p_lifecycle_from_state text,
  p_lifecycle_to_state text,
  p_lifecycle_writer_role text,
  p_lifecycle_reason text,
  p_audit_action text,
  p_audit_payload jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_outbox_row  public.distribution_outbox;
  v_pick_row    public.picks;
  v_lce_row     public.pick_lifecycle;
  v_receipt_row public.distribution_receipts;
  v_already_sent boolean := false;
begin
  update public.distribution_outbox
  set status = 'sent',
      updated_at = timezone('utc', now())
  where id = p_outbox_id
    and status = 'processing'
  returning * into v_outbox_row;

  if v_outbox_row.id is null then
    select * into v_outbox_row
    from public.distribution_outbox
    where id = p_outbox_id;

    if v_outbox_row.status = 'sent' then
      v_already_sent := true;
    else
      return jsonb_build_object(
        'error', format('outbox %s is in unexpected state: %s', p_outbox_id, v_outbox_row.status),
        'alreadyConfirmed', false
      );
    end if;
  end if;

  if v_already_sent then
    return jsonb_build_object(
      'outbox', to_jsonb(v_outbox_row),
      'alreadyConfirmed', true
    );
  end if;

  update public.picks
  set status = p_lifecycle_to_state,
      posted_at = case when p_lifecycle_to_state = 'posted' then timezone('utc', now()) else posted_at end,
      updated_at = timezone('utc', now())
  where id = p_pick_id
    and status = p_lifecycle_from_state
  returning * into v_pick_row;

  if v_pick_row.id is null then
    raise exception
      'INVALID_DELIVERY_TRANSITION pick_id=% outbox_id=% expected_state=% attempted_state=%',
      p_pick_id, p_outbox_id, p_lifecycle_from_state, p_lifecycle_to_state
      using errcode = 'P0001';
  end if;

  insert into public.pick_lifecycle (
    pick_id, from_state, to_state, writer_role, reason, payload, created_at
  ) values (
    p_pick_id, p_lifecycle_from_state, p_lifecycle_to_state,
    p_lifecycle_writer_role, p_lifecycle_reason,
    '{}'::jsonb, timezone('utc', now())
  )
  returning * into v_lce_row;

  insert into public.distribution_receipts (
    outbox_id, external_id, receipt_type, status, channel,
    idempotency_key, payload, recorded_at
  ) values (
    p_outbox_id, p_receipt_external_id, p_receipt_type, p_receipt_status,
    p_receipt_channel, p_receipt_idempotency_key,
    p_receipt_payload, timezone('utc', now())
  )
  on conflict (idempotency_key) where idempotency_key is not null
  do update set outbox_id = distribution_receipts.outbox_id
  returning * into v_receipt_row;

  insert into public.audit_log (
    entity_type, entity_id, entity_ref, action, actor, payload, created_at
  ) values (
    'distribution_outbox', p_outbox_id, p_pick_id::text,
    p_audit_action, p_worker_id, p_audit_payload, timezone('utc', now())
  );

  return jsonb_build_object(
    'outbox', to_jsonb(v_outbox_row),
    'lifecycleEvent', to_jsonb(v_lce_row),
    'receipt', to_jsonb(v_receipt_row),
    'alreadyConfirmed', false
  );
end;
$$;

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
  select * into v_settlement_row
  from public.settlement_records
  where pick_id = p_pick_id
    and source = p_settlement->>'source'
    and corrects_id is null
  order by settled_at desc
  limit 1;

  if v_settlement_row.id is not null then
    select * into v_pick_row from public.picks where id = p_pick_id;

    return jsonb_build_object(
      'settlement', to_jsonb(v_settlement_row),
      'pick', to_jsonb(v_pick_row),
      'lifecycleEvent', null,
      'duplicate', true
    );
  end if;

  select * into v_pick_row
  from public.picks
  where id = p_pick_id
  for update;

  if v_pick_row.id is null then
    raise exception
      'INVALID_SETTLEMENT_TRANSITION pick_id=% expected_state=% attempted_state=% reason=pick_not_found',
      p_pick_id, p_lifecycle_from_state, p_lifecycle_to_state
      using errcode = 'P0001';
  end if;

  if v_pick_row.status is distinct from p_lifecycle_from_state then
    raise exception
      'INVALID_SETTLEMENT_TRANSITION pick_id=% expected_state=% actual_state=% attempted_state=%',
      p_pick_id, p_lifecycle_from_state, v_pick_row.status, p_lifecycle_to_state
      using errcode = 'P0001';
  end if;

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
    return jsonb_build_object(
      'settlement', to_jsonb(v_settlement_row),
      'pick', to_jsonb(v_pick_row),
      'lifecycleEvent', null,
      'duplicate', true
    );
  end if;

  update public.picks
  set status = p_lifecycle_to_state,
      settled_at = case when p_lifecycle_to_state = 'settled' then timezone('utc', now()) else settled_at end,
      updated_at = timezone('utc', now())
  where id = p_pick_id
    and status = p_lifecycle_from_state
  returning * into v_pick_row;

  if v_pick_row.id is null then
    raise exception
      'INVALID_SETTLEMENT_TRANSITION pick_id=% expected_state=% attempted_state=%',
      p_pick_id, p_lifecycle_from_state, p_lifecycle_to_state
      using errcode = 'P0001';
  end if;

  insert into public.pick_lifecycle (
    pick_id, from_state, to_state, writer_role, reason, payload, created_at
  ) values (
    p_pick_id, p_lifecycle_from_state, p_lifecycle_to_state,
    p_lifecycle_writer_role, p_lifecycle_reason,
    '{}'::jsonb, timezone('utc', now())
  )
  returning * into v_lce_row;

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
