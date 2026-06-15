-- UTV2-220: Delivery idempotency RPCs
-- (A) claim_next_outbox: SELECT FOR UPDATE SKIP LOCKED + UPDATE in single tx
-- (B) confirm_delivery_atomic: markSent + lifecycle transition + receipt in single tx
--
-- Prevents: race conditions on claim, double Discord posts after crash/retry.

-- (A) Atomic claim with row-level locking
create or replace function public.claim_next_outbox(
  p_target text,
  p_worker_id text
) returns jsonb
language plpgsql
as $$
declare
  v_row public.distribution_outbox;
begin
  select * into v_row
  from public.distribution_outbox
  where target = p_target
    and status = 'pending'
    and claimed_at is null
    and (next_attempt_at is null or next_attempt_at <= now())
  order by created_at asc
  limit 1
  for update skip locked;

  if v_row.id is null then
    return null;
  end if;

  update public.distribution_outbox
  set status = 'processing',
      claimed_at = timezone('utc', now()),
      claimed_by = p_worker_id,
      updated_at = timezone('utc', now())
  where id = v_row.id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- (B) Atomic post-delivery confirmation
-- Once Discord returns 200, this atomically: marks outbox sent, transitions
-- pick to posted, inserts receipt, inserts audit. If outbox is already 'sent',
-- returns idempotent success without duplicating any records.
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
  v_lce_row     public.pick_lifecycle;
  v_receipt_row public.distribution_receipts;
  v_already_sent boolean := false;
begin
  -- 1. Mark outbox as sent (only if still 'processing')
  update public.distribution_outbox
  set status = 'sent',
      updated_at = timezone('utc', now())
  where id = p_outbox_id
    and status = 'processing'
  returning * into v_outbox_row;

  if v_outbox_row.id is null then
    -- Already sent or status changed — check if it's an idempotent re-confirm
    select * into v_outbox_row
    from public.distribution_outbox
    where id = p_outbox_id;

    if v_outbox_row.status = 'sent' then
      v_already_sent := true;
    else
      -- Unexpected state — return error info
      return jsonb_build_object(
        'error', format('outbox %s is in unexpected state: %s', p_outbox_id, v_outbox_row.status),
        'alreadyConfirmed', false
      );
    end if;
  end if;

  -- If already sent, skip all writes and return idempotent success
  if v_already_sent then
    return jsonb_build_object(
      'outbox', to_jsonb(v_outbox_row),
      'alreadyConfirmed', true
    );
  end if;

  -- 2. Transition pick lifecycle (only if in expected state)
  update public.picks
  set status = p_lifecycle_to_state,
      posted_at = case when p_lifecycle_to_state = 'posted' then timezone('utc', now()) else posted_at end,
      updated_at = timezone('utc', now())
  where id = p_pick_id
    and status = p_lifecycle_from_state;

  insert into public.pick_lifecycle (
    pick_id, from_state, to_state, writer_role, reason, payload, created_at
  ) values (
    p_pick_id, p_lifecycle_from_state, p_lifecycle_to_state,
    p_lifecycle_writer_role, p_lifecycle_reason,
    '{}'::jsonb, timezone('utc', now())
  )
  returning * into v_lce_row;

  -- 3. Insert receipt (idempotent via unique key)
  insert into public.distribution_receipts (
    outbox_id, external_id, receipt_type, status, channel,
    idempotency_key, payload, recorded_at
  ) values (
    p_outbox_id, p_receipt_external_id, p_receipt_type, p_receipt_status,
    p_receipt_channel, p_receipt_idempotency_key,
    p_receipt_payload, timezone('utc', now())
  )
  on conflict (idempotency_key) where idempotency_key is not null
  do update set outbox_id = distribution_receipts.outbox_id -- no-op
  returning * into v_receipt_row;

  -- 4. Insert audit log
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
