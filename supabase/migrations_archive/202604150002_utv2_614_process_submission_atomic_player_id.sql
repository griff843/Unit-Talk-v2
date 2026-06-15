-- UTV2-614: preserve picks.player_id in the atomic submission RPC path.
--
-- Problem:
--   process_submission_atomic() was updated for FK columns earlier, but the
--   picks INSERT list never included player_id. Database-mode submissions
--   therefore persisted participant_id while silently dropping player_id.
--
-- Fix:
--   Recreate the RPC so p_pick.player_id is inserted into public.picks.

create or replace function public.process_submission_atomic(
  p_submission jsonb,
  p_event jsonb,
  p_pick jsonb,
  p_idempotency_key text default null,
  p_lifecycle_event jsonb default null
) returns jsonb
language plpgsql
as $$
declare
  v_sub_row  public.submissions;
  v_pick_row public.picks;
  v_lce_row  public.pick_lifecycle;
begin
  insert into public.submissions (
    id, source, submitted_by, payload, status, received_at, created_at, updated_at
  ) values (
    (p_submission->>'id')::uuid,
    p_submission->>'source',
    p_submission->>'submitted_by',
    (p_submission->'payload')::jsonb,
    coalesce(p_submission->>'status', 'validated'),
    (p_submission->>'received_at')::timestamptz,
    coalesce((p_submission->>'created_at')::timestamptz, timezone('utc', now())),
    coalesce((p_submission->>'updated_at')::timestamptz, timezone('utc', now()))
  )
  returning * into v_sub_row;

  insert into public.submission_events (
    submission_id, event_name, payload, created_at
  ) values (
    (p_event->>'submission_id')::uuid,
    p_event->>'event_name',
    (p_event->'payload')::jsonb,
    (p_event->>'created_at')::timestamptz
  );

  insert into public.picks (
    id, submission_id, participant_id, player_id, capper_id, sport_id, market_type_id, market, selection,
    line, odds, stake_units, confidence, source,
    approval_status, promotion_status, promotion_target,
    promotion_score, promotion_reason, promotion_version,
    promotion_decided_at, promotion_decided_by,
    status, posted_at, settled_at,
    idempotency_key, metadata, created_at, updated_at
  ) values (
    (p_pick->>'id')::uuid,
    (p_pick->>'submission_id')::uuid,
    (p_pick->>'participant_id')::uuid,
    (p_pick->>'player_id')::uuid,
    p_pick->>'capper_id',
    p_pick->>'sport_id',
    p_pick->>'market_type_id',
    p_pick->>'market',
    p_pick->>'selection',
    (p_pick->>'line')::numeric(10,2),
    (p_pick->>'odds')::integer,
    (p_pick->>'stake_units')::numeric(10,2),
    (p_pick->>'confidence')::numeric(5,2),
    p_pick->>'source',
    coalesce(p_pick->>'approval_status', 'approved'),
    coalesce(p_pick->>'promotion_status', 'not_eligible'),
    p_pick->>'promotion_target',
    (p_pick->>'promotion_score')::numeric(5,2),
    p_pick->>'promotion_reason',
    p_pick->>'promotion_version',
    (p_pick->>'promotion_decided_at')::timestamptz,
    p_pick->>'promotion_decided_by',
    coalesce(p_pick->>'status', 'validated'),
    (p_pick->>'posted_at')::timestamptz,
    (p_pick->>'settled_at')::timestamptz,
    p_idempotency_key,
    coalesce((p_pick->'metadata')::jsonb, '{}'::jsonb),
    coalesce((p_pick->>'created_at')::timestamptz, timezone('utc', now())),
    coalesce((p_pick->>'updated_at')::timestamptz, timezone('utc', now()))
  )
  on conflict (idempotency_key) where idempotency_key is not null
  do update set id = picks.id
  returning * into v_pick_row;

  if p_lifecycle_event is not null then
    insert into public.pick_lifecycle (
      pick_id, from_state, to_state, writer_role, reason, payload, created_at
    ) values (
      (p_lifecycle_event->>'pick_id')::uuid,
      p_lifecycle_event->>'from_state',
      p_lifecycle_event->>'to_state',
      p_lifecycle_event->>'writer_role',
      p_lifecycle_event->>'reason',
      coalesce((p_lifecycle_event->'payload')::jsonb, '{}'::jsonb),
      coalesce((p_lifecycle_event->>'created_at')::timestamptz, timezone('utc', now()))
    )
    returning * into v_lce_row;
  end if;

  return jsonb_build_object(
    'submission', to_jsonb(v_sub_row),
    'pick', to_jsonb(v_pick_row),
    'lifecycleEvent', case when v_lce_row.id is not null then to_jsonb(v_lce_row) else null end
  );
end;
$$;
