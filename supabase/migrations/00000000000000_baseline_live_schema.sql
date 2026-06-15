--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10 (Debian 17.10-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: certification_domain; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.certification_domain AS ENUM (
    'replay',
    'invariant',
    'divergence',
    'quarantine',
    'proof_lineage',
    'freshness',
    'cert_evidence'
);


--
-- Name: certification_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.certification_status AS ENUM (
    'pending',
    'active',
    'suspended',
    'revoked',
    'expired'
);


--
-- Name: revocation_trigger; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.revocation_trigger AS ENUM (
    'replay_nondeterminism',
    'invariant_gap',
    'proof_corruption',
    'divergence_leakage',
    'quarantine_bypass',
    'stale_replay_acceptance',
    'evidence_invalidation',
    'dependency_revoked',
    'manual_governance'
);


--
-- Name: awaiting_approval_drift_state(interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.awaiting_approval_drift_state(stale_threshold interval DEFAULT '04:00:00'::interval) RETURNS TABLE(pick_id uuid, created_at timestamp with time zone, source text, market text, selection text, age_hours integer, has_validated_to_awaiting boolean, latest_lifecycle_to_state text, latest_lifecycle_at timestamp with time zone, stale boolean)
    LANGUAGE sql STABLE
    AS $$
  WITH awaiting_picks AS (
    SELECT
      p.id,
      p.created_at,
      p.source,
      p.market,
      p.selection
    FROM public.picks p
    WHERE p.status = 'awaiting_approval'
  ),
  lifecycle_rollup AS (
    SELECT
      ap.id AS pick_id,
      COALESCE(
        BOOL_OR(pl.from_state = 'validated' AND pl.to_state = 'awaiting_approval'),
        false
      ) AS has_validated_to_awaiting,
      (ARRAY_AGG(pl.to_state ORDER BY pl.created_at DESC, pl.id DESC))[1] AS latest_lifecycle_to_state,
      MAX(pl.created_at) AS latest_lifecycle_at
    FROM awaiting_picks ap
    LEFT JOIN public.pick_lifecycle pl
      ON pl.pick_id = ap.id
    GROUP BY ap.id
  )
  SELECT
    ap.id AS pick_id,
    ap.created_at,
    ap.source,
    ap.market,
    ap.selection,
    FLOOR(EXTRACT(EPOCH FROM (timezone('utc', now()) - ap.created_at)) / 3600)::integer AS age_hours,
    lr.has_validated_to_awaiting,
    lr.latest_lifecycle_to_state,
    lr.latest_lifecycle_at,
    ap.created_at <= timezone('utc', now()) - stale_threshold AS stale
  FROM awaiting_picks ap
  LEFT JOIN lifecycle_rollup lr
    ON lr.pick_id = ap.id
  WHERE
    COALESCE(lr.has_validated_to_awaiting, false) = false
    OR COALESCE(lr.latest_lifecycle_to_state, '') <> 'awaiting_approval'
    OR ap.created_at <= timezone('utc', now()) - stale_threshold
  ORDER BY ap.created_at ASC, ap.id ASC;
$$;


--
-- Name: backfill_pick_awaiting_approval(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.backfill_pick_awaiting_approval(p_pick_id uuid, p_linear_issue text) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: FUNCTION backfill_pick_awaiting_approval(p_pick_id uuid, p_linear_issue text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.backfill_pick_awaiting_approval(p_pick_id uuid, p_linear_issue text) IS 'UTV2-539 / DEBT-002: atomic backfill RPC for stranded awaiting_approval picks left by the pre-UTV2-519 non-atomic transitionPickLifecycle bug. Locks picks row FOR UPDATE, validates current status is awaiting_approval (raises INVALID_BACKFILL_STATE / SQLSTATE P0001 on drift), validates no prior awaiting_approval lifecycle row exists (raises ALREADY_BACKFILLED / SQLSTATE P0001 if so), inserts the missing pick_lifecycle row + matching audit_log row in one transaction, and returns { pickId, lifecycleEventId, backfilledAt }. Does NOT mutate picks.status — the row is already in the correct state. Paired with apps/api/src/scripts/utv2-539-awaiting-approval-cleanup.ts.';


--
-- Name: bootstrap_canonical_reference_data(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bootstrap_canonical_reference_data() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO public.teams (
    id,
    league_id,
    display_name,
    short_name,
    abbreviation,
    city,
    metadata
  )
  SELECT
    lower(coalesce(participant.league, participant.sport)) || ':' ||
      trim(both '-' FROM regexp_replace(lower(participant.display_name), '[^a-z0-9]+', '-', 'g')),
    lower(coalesce(participant.league, participant.sport)),
    participant.display_name,
    participant.display_name,
    nullif(participant.metadata->>'abbreviation', ''),
    nullif(participant.metadata->>'city', ''),
    jsonb_strip_nulls(
      coalesce(participant.metadata, '{}'::jsonb) ||
      jsonb_build_object(
        'bootstrap', jsonb_build_object(
          'source', 'participants',
          'source_participant_id', participant.id,
          'source_external_id', participant.external_id,
          'bootstrapped_at', timezone('utc', now())
        )
      )
    )
  FROM public.participants AS participant
  INNER JOIN public.leagues AS league
    ON league.id = lower(coalesce(participant.league, participant.sport))
  WHERE participant.participant_type = 'team'
  ON CONFLICT (id) DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    short_name = EXCLUDED.short_name,
    abbreviation = coalesce(EXCLUDED.abbreviation, public.teams.abbreviation),
    city = coalesce(EXCLUDED.city, public.teams.city),
    metadata = public.teams.metadata || EXCLUDED.metadata,
    updated_at = timezone('utc', now());

  INSERT INTO public.players (
    id,
    display_name,
    first_name,
    last_name,
    metadata
  )
  SELECT
    participant.id,
    participant.display_name,
    split_part(trim(participant.display_name), ' ', 1),
    nullif(
      regexp_replace(trim(participant.display_name), '^[^ ]+\s*', ''),
      ''
    ),
    jsonb_strip_nulls(
      coalesce(participant.metadata, '{}'::jsonb) ||
      jsonb_build_object(
        'bootstrap', jsonb_build_object(
          'source', 'participants',
          'source_participant_id', participant.id,
          'source_external_id', participant.external_id,
          'source_sport', participant.sport,
          'source_league', participant.league,
          'bootstrapped_at', timezone('utc', now())
        )
      )
    )
  FROM public.participants AS participant
  INNER JOIN public.leagues AS league
    ON league.id = lower(coalesce(participant.league, participant.sport))
  WHERE participant.participant_type = 'player'
  ON CONFLICT (id) DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    metadata = public.players.metadata || EXCLUDED.metadata,
    updated_at = timezone('utc', now());

  INSERT INTO public.provider_entity_aliases (
    provider,
    entity_kind,
    provider_entity_key,
    provider_entity_id,
    provider_display_name,
    participant_id,
    player_id,
    metadata
  )
  SELECT
    'sgo',
    'player',
    participant.external_id,
    participant.external_id,
    participant.display_name,
    participant.id,
    participant.id,
    jsonb_build_object(
      'bootstrap', jsonb_build_object(
        'source', 'participants.external_id',
        'bootstrapped_at', timezone('utc', now())
      )
    )
  FROM public.participants AS participant
  WHERE participant.participant_type = 'player'
    AND participant.external_id IS NOT NULL
  ON CONFLICT (provider, entity_kind, provider_entity_key) DO UPDATE
  SET
    provider_display_name = EXCLUDED.provider_display_name,
    participant_id = EXCLUDED.participant_id,
    player_id = EXCLUDED.player_id,
    metadata = public.provider_entity_aliases.metadata || EXCLUDED.metadata,
    updated_at = timezone('utc', now());

  INSERT INTO public.provider_entity_aliases (
    provider,
    entity_kind,
    provider_entity_key,
    provider_entity_id,
    provider_display_name,
    participant_id,
    team_id,
    metadata
  )
  SELECT
    'sgo',
    'team',
    dedup.provider_entity_key,
    dedup.provider_entity_key,
    dedup.display_name,
    dedup.participant_id,
    dedup.team_id,
    dedup.metadata
  FROM (
    SELECT DISTINCT ON (source.provider_entity_key)
      source.provider_entity_key,
      source.display_name,
      source.participant_id,
      source.team_id,
      source.metadata
    FROM (
      SELECT
        CASE
          WHEN event_participant.role = 'home' THEN nullif(event.metadata->>'home_team_external_id', '')
          ELSE nullif(event.metadata->>'away_team_external_id', '')
        END AS provider_entity_key,
        participant.display_name,
        participant.id AS participant_id,
        lower(coalesce(participant.league, participant.sport)) || ':' ||
          trim(both '-' FROM regexp_replace(lower(participant.display_name), '[^a-z0-9]+', '-', 'g')) AS team_id,
        jsonb_build_object(
          'bootstrap', jsonb_build_object(
            'source', 'events.event_participants',
            'event_id', event.id,
            'role', event_participant.role,
            'bootstrapped_at', timezone('utc', now())
          )
        ) AS metadata,
        event.created_at
      FROM public.event_participants AS event_participant
      INNER JOIN public.events AS event
        ON event.id = event_participant.event_id
      INNER JOIN public.participants AS participant
        ON participant.id = event_participant.participant_id
      WHERE participant.participant_type = 'team'
        AND event_participant.role IN ('home', 'away')
        AND (
          (event_participant.role = 'home' AND nullif(event.metadata->>'home_team_external_id', '') IS NOT NULL)
          OR
          (event_participant.role = 'away' AND nullif(event.metadata->>'away_team_external_id', '') IS NOT NULL)
        )
    ) AS source
    ORDER BY source.provider_entity_key, source.created_at DESC, source.participant_id
  ) AS dedup
  ON CONFLICT (provider, entity_kind, provider_entity_key) DO UPDATE
  SET
    provider_display_name = EXCLUDED.provider_display_name,
    participant_id = EXCLUDED.participant_id,
    team_id = EXCLUDED.team_id,
    metadata = public.provider_entity_aliases.metadata || EXCLUDED.metadata,
    updated_at = timezone('utc', now());

  INSERT INTO public.player_team_assignments (
    id,
    player_id,
    team_id,
    league_id,
    effective_from,
    effective_until,
    source
  )
  SELECT
    gen_random_uuid(),
    participant.id,
    alias.team_id,
    team.league_id,
    participant.created_at::date,
    NULL,
    'bootstrap:sgo-participants'
  FROM public.participants AS participant
  INNER JOIN public.provider_entity_aliases AS alias
    ON alias.provider = 'sgo'
   AND alias.entity_kind = 'team'
   AND alias.provider_entity_key = nullif(participant.metadata->>'team_external_id', '')
  INNER JOIN public.teams AS team
    ON team.id = alias.team_id
  WHERE participant.participant_type = 'player'
    AND nullif(participant.metadata->>'team_external_id', '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.player_team_assignments AS existing
      WHERE existing.player_id = participant.id
        AND existing.team_id = alias.team_id
        AND existing.effective_until IS NULL
    );
END;
$$;


--
-- Name: certification_records_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.certification_records_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION
    'certification_records is append-only: % prohibited on row %',
    TG_OP, COALESCE(OLD.id::TEXT, '?');
END;
$$;


--
-- Name: certification_transition_events_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.certification_transition_events_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION
    'certification_transition_events is append-only: % prohibited on row %',
    TG_OP, COALESCE(OLD.id::TEXT, '?');
END;
$$;


--
-- Name: claim_next_outbox(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_next_outbox(p_target text, p_worker_id text) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: confirm_delivery_atomic(uuid, uuid, text, text, text, text, text, text, jsonb, text, text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_delivery_atomic(p_outbox_id uuid, p_pick_id uuid, p_worker_id text, p_receipt_type text, p_receipt_status text, p_receipt_channel text, p_receipt_external_id text, p_receipt_idempotency_key text, p_receipt_payload jsonb, p_lifecycle_from_state text, p_lifecycle_to_state text, p_lifecycle_writer_role text, p_lifecycle_reason text, p_audit_action text, p_audit_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: drop_old_provider_offer_history_partitions(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.drop_old_provider_offer_history_partitions(p_retention_days integer DEFAULT 7) RETURNS TABLE(partitions_dropped integer, cutoff_date date)
    LANGUAGE plpgsql
    AS $_$
DECLARE
  v_cutoff_date date;
  v_dropped_count integer := 0;
  part record;
  v_partition_day date;
BEGIN
  IF p_retention_days < 1 THEN
    RAISE EXCEPTION 'p_retention_days must be >= 1';
  END IF;

  v_cutoff_date := (timezone('utc', now()) - make_interval(days => p_retention_days))::date;

  FOR part IN
    SELECT child.relname AS partition_name
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child  ON pg_inherits.inhrelid  = child.oid
    JOIN pg_namespace ns ON child.relnamespace     = ns.oid
    WHERE ns.nspname    = 'public'
      AND parent.relname = 'provider_offer_history'
  LOOP
    IF part.partition_name ~ '^provider_offer_history_p[0-9]{8}$' THEN
      v_partition_day := to_date(right(part.partition_name, 8), 'YYYYMMDD');
      IF v_partition_day < v_cutoff_date THEN
        -- lint-override: drop-table
        EXECUTE format('DROP TABLE IF EXISTS public.%I', part.partition_name);
        v_dropped_count := v_dropped_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT
    v_dropped_count,
    v_cutoff_date;
END;
$_$;


--
-- Name: drop_provider_offer_history_partitions_before(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.drop_provider_offer_history_partitions_before(p_cutoff_day date) RETURNS TABLE(dropped_partition text, dropped boolean)
    LANGUAGE plpgsql
    AS $_$
DECLARE
  part record;
  v_partition_day date;
BEGIN
  FOR part IN
    SELECT child.relname AS partition_name
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    JOIN pg_namespace ns ON child.relnamespace = ns.oid
    WHERE ns.nspname = 'public'
      AND parent.relname = 'provider_offer_history'
  LOOP
    IF part.partition_name ~ '^provider_offer_history_p[0-9]{8}$' THEN
      v_partition_day := to_date(right(part.partition_name, 8), 'YYYYMMDD');
      IF v_partition_day < p_cutoff_day THEN
        -- lint-override: drop-table
        EXECUTE format('DROP TABLE IF EXISTS public.%I', part.partition_name);
        dropped_partition := part.partition_name;
        dropped := true;
        RETURN NEXT;
      END IF;
    END IF;
  END LOOP;
END;
$_$;


--
-- Name: enqueue_distribution_atomic(uuid, text, text, text, text, timestamp with time zone, text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_distribution_atomic(p_pick_id uuid, p_from_state text, p_to_state text, p_writer_role text, p_reason text, p_lifecycle_created_at timestamp with time zone, p_outbox_target text, p_outbox_payload jsonb, p_outbox_idempotency_key text) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: ensure_provider_offer_history_partition(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_provider_offer_history_partition(p_day date) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_start timestamptz := p_day::timestamptz;
  v_end timestamptz := (p_day + 1)::timestamptz;
  v_partition_name text := format(
    'provider_offer_history_p%s',
    to_char(p_day, 'YYYYMMDD')
  );
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.provider_offer_history
      FOR VALUES FROM (%L) TO (%L)',
    v_partition_name,
    v_start,
    v_end
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON public.%I (provider_key, snapshot_at DESC)',
    v_partition_name || '_provider_snapshot_idx',
    v_partition_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON public.%I (
      provider_key,
      provider_event_id,
      provider_market_key,
      COALESCE(provider_participant_id, ''''),
      COALESCE(bookmaker_key, ''''),
      snapshot_at DESC
    )',
    v_partition_name || '_identity_snapshot_idx',
    v_partition_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON public.%I (idempotency_key)',
    v_partition_name || '_idempotency_idx',
    v_partition_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON public.%I (
      provider_event_id,
      provider_market_key,
      COALESCE(provider_participant_id, ''''),
      COALESCE(bookmaker_key, ''''),
      snapshot_at DESC
    ) WHERE is_opening = true',
    v_partition_name || '_opening_idx',
    v_partition_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON public.%I (
      provider_event_id,
      provider_market_key,
      COALESCE(provider_participant_id, ''''),
      COALESCE(bookmaker_key, ''''),
      snapshot_at DESC
    ) WHERE is_closing = true',
    v_partition_name || '_closing_idx',
    v_partition_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON public.%I (created_at)',
    v_partition_name || '_created_at_idx',
    v_partition_name
  );

  RETURN v_partition_name;
END;
$$;


--
-- Name: ensure_provider_offer_history_partitions(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_provider_offer_history_partitions(p_start_day date, p_end_day date) RETURNS TABLE(partition_name text)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_day date;
BEGIN
  IF p_end_day < p_start_day THEN
    RAISE EXCEPTION 'p_end_day must be >= p_start_day';
  END IF;

  v_day := p_start_day;
  WHILE v_day <= p_end_day LOOP
    partition_name := public.ensure_provider_offer_history_partition(v_day);
    RETURN NEXT;
    v_day := v_day + 1;
  END LOOP;
END;
$$;


--
-- Name: execution_intents_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.execution_intents_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION
    'execution_intents is append-only: % prohibited on row %',
    TG_OP, COALESCE(OLD.id::TEXT, '?');
END;
$$;


--
-- Name: list_provider_offer_current_opening(text, timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_provider_offer_current_opening(p_provider_key text, p_since timestamp with time zone, p_limit integer) RETURNS TABLE(id uuid, provider_key text, provider_event_id text, provider_market_key text, provider_participant_id text, sport_key text, line numeric, over_odds integer, under_odds integer, devig_mode text, is_opening boolean, is_closing boolean, snapshot_at timestamp with time zone, idempotency_key text, bookmaker_key text, created_at timestamp with time zone, cycle_run_id uuid, cycle_stage_status text, cycle_freshness_status text, cycle_proof_status text, cycle_failure_category text, cycle_failure_scope text, cycle_affected_provider_key text, cycle_affected_sport_key text, cycle_affected_market_key text, cycle_updated_at timestamp with time zone, provider_health_state text)
    LANGUAGE sql STABLE
    AS $$
  WITH latest_cycle AS (
    SELECT DISTINCT ON (provider_key, league)
      run_id AS cycle_run_id,
      provider_key,
      league,
      stage_status,
      freshness_status,
      proof_status,
      failure_category,
      failure_scope,
      affected_provider_key,
      affected_sport_key,
      affected_market_key,
      updated_at AS cycle_updated_at,
      CASE
        WHEN stage_status = 'merged'
          AND freshness_status = 'fresh'
          AND proof_status IN ('verified', 'waived')
          AND failure_category IS NULL THEN 'healthy'
        WHEN stage_status = 'merged'
          AND freshness_status = 'fresh'
          AND proof_status IN ('verified', 'waived') THEN 'degraded'
        ELSE 'fail'
      END AS provider_health_state
    FROM public.provider_cycle_status
    WHERE provider_key = p_provider_key
    ORDER BY provider_key, league, cycle_snapshot_at DESC, updated_at DESC
  )
  SELECT
    current_offer.id,
    current_offer.provider_key,
    current_offer.provider_event_id,
    current_offer.provider_market_key,
    current_offer.provider_participant_id,
    current_offer.sport_key,
    current_offer.line,
    current_offer.over_odds,
    current_offer.under_odds,
    current_offer.devig_mode,
    current_offer.is_opening,
    current_offer.is_closing,
    current_offer.snapshot_at,
    current_offer.idempotency_key,
    current_offer.bookmaker_key,
    current_offer.created_at,
    latest_cycle.cycle_run_id,
    latest_cycle.stage_status AS cycle_stage_status,
    latest_cycle.freshness_status AS cycle_freshness_status,
    latest_cycle.proof_status AS cycle_proof_status,
    latest_cycle.failure_category AS cycle_failure_category,
    latest_cycle.failure_scope AS cycle_failure_scope,
    latest_cycle.affected_provider_key AS cycle_affected_provider_key,
    latest_cycle.affected_sport_key AS cycle_affected_sport_key,
    latest_cycle.affected_market_key AS cycle_affected_market_key,
    latest_cycle.cycle_updated_at,
    COALESCE(latest_cycle.provider_health_state, 'fail') AS provider_health_state
  FROM public.provider_offer_current current_offer
  LEFT JOIN latest_cycle
    ON latest_cycle.provider_key = current_offer.provider_key
   AND latest_cycle.league = COALESCE(current_offer.sport_key, '')
  WHERE current_offer.provider_key = p_provider_key
    AND current_offer.is_opening = true
    AND current_offer.snapshot_at >= p_since
    AND current_offer.over_odds IS NOT NULL
    AND current_offer.under_odds IS NOT NULL
    AND current_offer.line IS NOT NULL
    AND current_offer.provider_participant_id IS NOT NULL
  ORDER BY current_offer.snapshot_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 500), 1);
$$;


--
-- Name: merge_provider_offer_staging_cycle(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_provider_offer_staging_cycle(p_run_id uuid, p_max_rows integer, p_identity_strategy text) RETURNS TABLE(processed_count integer, merged_count integer, duplicate_count integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF p_max_rows IS NULL OR p_max_rows <= 0 THEN
    RAISE EXCEPTION 'p_max_rows must be > 0';
  END IF;

  IF p_identity_strategy <> 'provider_event_market_participant_book' THEN
    RAISE EXCEPTION
      'unsupported provider-offer identity strategy: % (line/sport/taxonomy semantics remain explicit decisions)',
      p_identity_strategy;
  END IF;

  PERFORM public.ensure_provider_offer_history_partitions(
    (
      SELECT min(snapshot_at)::date
      FROM public.provider_offer_staging
      WHERE run_id = p_run_id
        AND merge_status = 'pending'
    ),
    (
      SELECT max(snapshot_at)::date
      FROM public.provider_offer_staging
      WHERE run_id = p_run_id
        AND merge_status = 'pending'
    )
  );

  RETURN QUERY
  WITH candidates AS (
    SELECT *
    FROM public.provider_offer_staging
    WHERE run_id = p_run_id
      AND merge_status = 'pending'
    ORDER BY created_at ASC, id ASC
    LIMIT p_max_rows
  ),
  current_before AS (
    SELECT current_offer.*
    FROM public.provider_offer_current current_offer
    JOIN (
      SELECT DISTINCT identity_key
      FROM candidates
    ) candidate_keys
      ON candidate_keys.identity_key = current_offer.identity_key
  ),
  previous_compact AS (
    SELECT DISTINCT ON (identity_key)
      snapshot_id,
      identity_key
    FROM public.provider_offer_history_compact
    WHERE identity_key IN (SELECT identity_key FROM candidates)
    ORDER BY identity_key, snapshot_at DESC, observed_at DESC, created_at DESC
  ),
  inserted_history AS (
    INSERT INTO public.provider_offer_history (
      id,
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      sport_key,
      line,
      over_odds,
      under_odds,
      devig_mode,
      is_opening,
      is_closing,
      snapshot_at,
      idempotency_key,
      bookmaker_key,
      source_run_id,
      created_at
    )
    SELECT
      id,
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      sport_key,
      line,
      over_odds,
      under_odds,
      devig_mode,
      is_opening,
      is_closing,
      snapshot_at,
      idempotency_key,
      bookmaker_key,
      run_id,
      created_at
    FROM candidates
    ON CONFLICT (snapshot_at, idempotency_key) DO NOTHING
    RETURNING idempotency_key
  ),
  compact_candidates AS (
    SELECT
      candidates.identity_key,
      candidates.provider_key,
      candidates.provider_event_id,
      candidates.provider_market_key,
      candidates.provider_participant_id,
      candidates.sport_key,
      candidates.bookmaker_key,
      candidates.line,
      candidates.over_odds,
      candidates.under_odds,
      candidates.devig_mode,
      candidates.is_opening,
      candidates.is_closing,
      candidates.snapshot_at,
      candidates.run_id AS source_run_id,
      candidates.idempotency_key,
      candidates.created_at,
      previous_compact.snapshot_id AS previous_snapshot_id,
      CASE
        WHEN current_before.identity_key IS NULL THEN 'first_seen'
        WHEN candidates.line IS DISTINCT FROM current_before.line THEN 'line_change'
        WHEN candidates.over_odds IS DISTINCT FROM current_before.over_odds
          OR candidates.under_odds IS DISTINCT FROM current_before.under_odds THEN 'odds_change'
        WHEN candidates.is_opening = true AND COALESCE(current_before.is_opening, false) = false THEN 'opening_capture'
        WHEN candidates.is_closing = true AND COALESCE(current_before.is_closing, false) = false THEN 'closing_capture'
        ELSE NULL
      END AS change_reason,
      jsonb_strip_nulls(
        jsonb_build_object(
          'line', CASE
            WHEN current_before.identity_key IS NULL OR candidates.line IS DISTINCT FROM current_before.line
            THEN jsonb_build_object('previous', current_before.line, 'next', candidates.line)
            ELSE NULL
          END,
          'over_odds', CASE
            WHEN current_before.identity_key IS NULL OR candidates.over_odds IS DISTINCT FROM current_before.over_odds
            THEN jsonb_build_object('previous', current_before.over_odds, 'next', candidates.over_odds)
            ELSE NULL
          END,
          'under_odds', CASE
            WHEN current_before.identity_key IS NULL OR candidates.under_odds IS DISTINCT FROM current_before.under_odds
            THEN jsonb_build_object('previous', current_before.under_odds, 'next', candidates.under_odds)
            ELSE NULL
          END,
          'is_opening', CASE
            WHEN current_before.identity_key IS NULL OR candidates.is_opening IS DISTINCT FROM current_before.is_opening
            THEN jsonb_build_object('previous', current_before.is_opening, 'next', candidates.is_opening)
            ELSE NULL
          END,
          'is_closing', CASE
            WHEN current_before.identity_key IS NULL OR candidates.is_closing IS DISTINCT FROM current_before.is_closing
            THEN jsonb_build_object('previous', current_before.is_closing, 'next', candidates.is_closing)
            ELSE NULL
          END
        )
      ) AS changed_fields
    FROM candidates
    LEFT JOIN current_before
      ON current_before.identity_key = candidates.identity_key
    LEFT JOIN previous_compact
      ON previous_compact.identity_key = candidates.identity_key
  ),
  inserted_compact AS (
    INSERT INTO public.provider_offer_history_compact (
      identity_key,
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      sport_key,
      bookmaker_key,
      line,
      over_odds,
      under_odds,
      devig_mode,
      is_opening,
      is_closing,
      snapshot_at,
      observed_at,
      source_run_id,
      change_reason,
      previous_snapshot_id,
      changed_fields,
      idempotency_key,
      metadata,
      created_at
    )
    SELECT
      identity_key,
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      sport_key,
      bookmaker_key,
      line,
      over_odds,
      under_odds,
      devig_mode,
      is_opening,
      is_closing,
      snapshot_at,
      created_at,
      source_run_id,
      change_reason,
      previous_snapshot_id,
      changed_fields,
      idempotency_key,
      '{}'::jsonb,
      created_at
    FROM compact_candidates
    WHERE change_reason IS NOT NULL
    ON CONFLICT (snapshot_at, idempotency_key) DO NOTHING
    RETURNING snapshot_id
  ),
  current_upsert AS (
    INSERT INTO public.provider_offer_current (
      identity_key,
      id,
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      sport_key,
      line,
      over_odds,
      under_odds,
      devig_mode,
      is_opening,
      is_closing,
      snapshot_at,
      idempotency_key,
      bookmaker_key,
      source_run_id,
      created_at,
      updated_at
    )
    SELECT DISTINCT ON (
      provider_key,
      provider_event_id,
      provider_market_key,
      COALESCE(provider_participant_id, ''),
      COALESCE(bookmaker_key, '')
    )
      identity_key,
      id,
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      sport_key,
      line,
      over_odds,
      under_odds,
      devig_mode,
      is_opening,
      is_closing,
      snapshot_at,
      idempotency_key,
      bookmaker_key,
      run_id,
      created_at,
      timezone('utc', now())
    FROM candidates
    ORDER BY
      provider_key,
      provider_event_id,
      provider_market_key,
      COALESCE(provider_participant_id, ''),
      COALESCE(bookmaker_key, ''),
      snapshot_at DESC,
      created_at DESC,
      id DESC
    ON CONFLICT (identity_key) DO UPDATE
    SET
      id = EXCLUDED.id,
      provider_key = EXCLUDED.provider_key,
      provider_event_id = EXCLUDED.provider_event_id,
      provider_market_key = EXCLUDED.provider_market_key,
      provider_participant_id = EXCLUDED.provider_participant_id,
      sport_key = EXCLUDED.sport_key,
      line = EXCLUDED.line,
      over_odds = EXCLUDED.over_odds,
      under_odds = EXCLUDED.under_odds,
      devig_mode = EXCLUDED.devig_mode,
      is_opening = EXCLUDED.is_opening,
      is_closing = EXCLUDED.is_closing,
      snapshot_at = EXCLUDED.snapshot_at,
      idempotency_key = EXCLUDED.idempotency_key,
      bookmaker_key = EXCLUDED.bookmaker_key,
      source_run_id = EXCLUDED.source_run_id,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at
    WHERE (
      EXCLUDED.snapshot_at,
      EXCLUDED.created_at,
      EXCLUDED.id
    ) >= (
      public.provider_offer_current.snapshot_at,
      public.provider_offer_current.created_at,
      public.provider_offer_current.id
    )
    RETURNING identity_key
  ),
  updated AS (
    UPDATE public.provider_offer_staging staged
    SET
      merge_status = CASE
        WHEN EXISTS (
          SELECT 1
          FROM inserted_history
          WHERE inserted_history.idempotency_key = staged.idempotency_key
        ) THEN 'merged'
        ELSE 'duplicate'
      END,
      merged_at = timezone('utc', now()),
      merge_error = NULL
    FROM candidates
    WHERE staged.id = candidates.id
    RETURNING staged.merge_status
  )
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE merge_status = 'merged')::integer,
    count(*) FILTER (WHERE merge_status = 'duplicate')::integer
  FROM updated;
END;
$$;


--
-- Name: model_registry_artifact_sha_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.model_registry_artifact_sha_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.artifact_sha IS NOT NULL
     AND NEW.artifact_sha IS DISTINCT FROM OLD.artifact_sha THEN
    RAISE EXCEPTION
      'artifact_sha is immutable once set on model_registry (id=%). A changed artifact must be registered as a new model version.',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: odds_snapshots_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.odds_snapshots_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'odds_snapshots rows are immutable — no UPDATE or DELETE allowed (UTV2-1085)';
END;
$$;


--
-- Name: picks_fsm_transition_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.picks_fsm_transition_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  allowed TEXT[];
BEGIN
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

  IF NOT (NEW.status = ANY(allowed)) THEN
    RAISE EXCEPTION 'FSM_PICK_TRANSITION_REJECTED: % → % is not a valid pick lifecycle transition for pick %',
      OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'P0001',
            DETAIL  = format('pick_id=%s from_state=%s to_state=%s', OLD.id, OLD.status, NEW.status);
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION picks_fsm_transition_guard(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.picks_fsm_transition_guard() IS 'Enforces the canonical pick lifecycle FSM for every picks.status update, including service-role direct UPDATEs that bypass the TypeScript lifecycle layer.';


--
-- Name: process_submission_atomic(jsonb, jsonb, jsonb, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_submission_atomic(p_submission jsonb, p_event jsonb, p_pick jsonb, p_idempotency_key text DEFAULT NULL::text, p_lifecycle_event jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: prune_provider_offers_bounded(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prune_provider_offers_bounded(p_retention_days integer DEFAULT 7, p_batch_size integer DEFAULT 5000, p_max_batches integer DEFAULT 20) RETURNS TABLE(batches_run integer, deleted_rows bigint, cutoff timestamp with time zone, remaining_rows bigint)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_cutoff timestamptz;
  v_deleted_this_batch integer;
  v_batches_run integer := 0;
  v_deleted_rows bigint := 0;
  v_remaining_rows bigint := 0;
BEGIN
  IF p_retention_days < 1 THEN
    RAISE EXCEPTION 'p_retention_days must be >= 1';
  END IF;

  IF p_batch_size < 1 THEN
    RAISE EXCEPTION 'p_batch_size must be >= 1';
  END IF;

  IF p_max_batches < 1 THEN
    RAISE EXCEPTION 'p_max_batches must be >= 1';
  END IF;

  v_cutoff := timezone('utc', now()) - make_interval(days => p_retention_days);

  LOOP
    EXIT WHEN v_batches_run >= p_max_batches;

    WITH doomed AS (
      SELECT id
      FROM public.provider_offers_legacy_quarantine
      WHERE created_at < v_cutoff
      ORDER BY created_at ASC, id ASC
      LIMIT p_batch_size
    )
    DELETE FROM public.provider_offers_legacy_quarantine
    WHERE id IN (SELECT id FROM doomed);

    GET DIAGNOSTICS v_deleted_this_batch = ROW_COUNT;
    EXIT WHEN v_deleted_this_batch = 0;

    v_batches_run := v_batches_run + 1;
    v_deleted_rows := v_deleted_rows + v_deleted_this_batch;
  END LOOP;

  SELECT count(*)::bigint
    INTO v_remaining_rows
  FROM public.provider_offers_legacy_quarantine
  WHERE created_at < v_cutoff;

  RETURN QUERY
  SELECT
    v_batches_run,
    v_deleted_rows,
    v_cutoff,
    v_remaining_rows;
END;
$$;


--
-- Name: raw_payloads_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.raw_payloads_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'raw_payloads rows are immutable — no UPDATE or DELETE allowed (UTV2-1084)';
END;
$$;


--
-- Name: reject_audit_log_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_audit_log_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception
    'audit_log is immutable: UPDATE and DELETE are not permitted on this table. '
    'Create a new audit record instead.';
end;
$$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: run_awaiting_approval_drift_monitor(interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.run_awaiting_approval_drift_monitor(stale_threshold interval DEFAULT '04:00:00'::interval) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_previous_drift_count integer := 0;
  v_drift_count integer := 0;
  v_stale_count integer := 0;
  v_status text := 'succeeded';
  v_details jsonb;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE stale)
  INTO
    v_drift_count,
    v_stale_count
  FROM public.awaiting_approval_drift_state(stale_threshold);

  SELECT
    COALESCE((sr.details ->> 'driftCount')::integer, 0)
  INTO v_previous_drift_count
  FROM public.system_runs sr
  WHERE sr.run_type = 'governance.awaiting-approval-drift'
  ORDER BY sr.started_at DESC, sr.id DESC
  LIMIT 1;

  IF v_stale_count > 0 OR v_drift_count > v_previous_drift_count THEN
    v_status := 'failed';
  END IF;

  SELECT jsonb_build_object(
    'driftCount', v_drift_count,
    'staleCount', v_stale_count,
    'previousDriftCount', v_previous_drift_count,
    'countIncreased', v_drift_count > v_previous_drift_count,
    'staleThresholdHours', FLOOR(EXTRACT(EPOCH FROM stale_threshold) / 3600)::integer,
    'samplePickIds',
      COALESCE(
        (
          SELECT jsonb_agg(d.pick_id ORDER BY d.created_at ASC)
          FROM (
            SELECT pick_id, created_at
            FROM public.awaiting_approval_drift_state(stale_threshold)
            ORDER BY created_at ASC, pick_id ASC
            LIMIT 10
          ) d
        ),
        '[]'::jsonb
      )
  )
  INTO v_details;

  INSERT INTO public.system_runs (
    run_type,
    status,
    started_at,
    finished_at,
    actor,
    details
  )
  VALUES (
    'governance.awaiting-approval-drift',
    v_status,
    timezone('utc', now()),
    timezone('utc', now()),
    'pg_cron',
    v_details
  );

  RETURN v_details || jsonb_build_object('status', v_status);
END;
$$;


--
-- Name: set_provider_cycle_status_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_provider_cycle_status_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;


--
-- Name: set_system_run_finished_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_system_run_finished_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.status in ('succeeded', 'failed', 'cancelled')
     and old.status = 'running'
  then
    new.finished_at := now();
  end if;
  return new;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;


--
-- Name: settle_pick_atomic(uuid, jsonb, text, text, text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.settle_pick_atomic(p_pick_id uuid, p_settlement jsonb, p_lifecycle_from_state text, p_lifecycle_to_state text, p_lifecycle_writer_role text, p_lifecycle_reason text, p_audit_action text, p_audit_actor text, p_audit_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: settlement_corrections_validate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.settlement_corrections_validate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_corrects_id UUID;
BEGIN
  SELECT corrects_id INTO v_corrects_id
  FROM public.settlement_records
  WHERE id = NEW.settlement_record_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'SETTLEMENT_CORRECTION_RECORD_NOT_FOUND: settlement_record (id=%) does not exist.',
      NEW.settlement_record_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_corrects_id IS NULL THEN
    RAISE EXCEPTION
      'SETTLEMENT_CORRECTION_NOT_A_CORRECTION: settlement_record (id=%) has corrects_id=NULL. Only correction rows (corrects_id IS NOT NULL) may have a settlement_corrections record.',
      NEW.settlement_record_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_corrects_id != NEW.prior_record_id THEN
    RAISE EXCEPTION
      'SETTLEMENT_CORRECTION_LINEAGE_MISMATCH: settlement_record corrects_id (%) does not match prior_record_id (%).',
      v_corrects_id, NEW.prior_record_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION settlement_corrections_validate(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.settlement_corrections_validate() IS 'UTV2-1137: Validates that a settlement_corrections record references a real correction row and that prior_record_id matches corrects_id.';


--
-- Name: settlement_records_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.settlement_records_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'SETTLEMENT_RECORD_IMMUTABLE: settlement_records row (id=%) cannot be updated. Submit a correction INSERT with corrects_id instead.',
      OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'SETTLEMENT_RECORD_IMMUTABLE: settlement_records row (id=%) cannot be deleted. The settlement ledger is append-only.',
      OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: FUNCTION settlement_records_immutable(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.settlement_records_immutable() IS 'UTV2-1136: Enforces append-only semantics. Updates and deletes are rejected; corrections must be new rows with corrects_id set.';


--
-- Name: settlement_records_populate_stake_units(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.settlement_records_populate_stake_units() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.stake_units IS NULL THEN
    SELECT COALESCE(p.stake_units, (p.metadata->>'stakeUnits')::numeric)
      INTO NEW.stake_units
      FROM picks p
      WHERE p.id = NEW.pick_id;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: summarize_provider_offer_history_partition(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.summarize_provider_offer_history_partition(p_date date) RETURNS TABLE(rows_summarized integer, snapshot_date date)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_partition_name text;
  v_partition_exists boolean;
  v_rows_summarized integer;
  v_start timestamptz := p_date::timestamptz;
  v_end   timestamptz := (p_date + 1)::timestamptz;
BEGIN
  v_partition_name := format('provider_offer_history_p%s', to_char(p_date, 'YYYYMMDD'));

  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace ns ON c.relnamespace = ns.oid
    WHERE ns.nspname = 'public'
      AND c.relname  = v_partition_name
  )
  INTO v_partition_exists;

  IF NOT v_partition_exists THEN
    RETURN QUERY SELECT 0::integer, p_date;
    RETURN;
  END IF;

  WITH agg AS (
    SELECT
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      bookmaker_key,
      sport_key,
      p_date                                                          AS snap_dt,
      (array_agg(line ORDER BY snapshot_at ASC  NULLS LAST))[1]      AS opening_line,
      (array_agg(line ORDER BY snapshot_at DESC NULLS LAST))[1]      AS closing_line,
      max(line)                                                       AS high_line,
      min(line)                                                       AS low_line,
      count(*)::integer                                               AS snapshot_count
    FROM public.provider_offer_history
    WHERE snapshot_at >= v_start
      AND snapshot_at <  v_end
      AND line IS NOT NULL
    GROUP BY
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      bookmaker_key,
      sport_key
  ),
  upserted AS (
    INSERT INTO public.provider_offer_line_snapshots (
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      bookmaker_key,
      sport_key,
      snapshot_date,
      opening_line,
      closing_line,
      high_line,
      low_line,
      snapshot_count,
      updated_at
    )
    SELECT
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      bookmaker_key,
      sport_key,
      snap_dt,
      opening_line,
      closing_line,
      high_line,
      low_line,
      snapshot_count,
      timezone('utc', now())
    FROM agg
    ON CONFLICT (
      provider_key,
      provider_event_id,
      provider_market_key,
      COALESCE(provider_participant_id, ''),
      COALESCE(bookmaker_key, ''),
      snapshot_date
    ) DO UPDATE
    SET
      opening_line   = COALESCE(EXCLUDED.opening_line,   provider_offer_line_snapshots.opening_line),
      closing_line   = COALESCE(EXCLUDED.closing_line,   provider_offer_line_snapshots.closing_line),
      high_line      = GREATEST(EXCLUDED.high_line,      provider_offer_line_snapshots.high_line),
      low_line       = LEAST(EXCLUDED.low_line,          provider_offer_line_snapshots.low_line),
      snapshot_count = GREATEST(EXCLUDED.snapshot_count, provider_offer_line_snapshots.snapshot_count),
      updated_at     = EXCLUDED.updated_at
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_rows_summarized FROM upserted;

  RETURN QUERY SELECT v_rows_summarized, p_date;
END;
$$;


--
-- Name: transition_pick_lifecycle(uuid, text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transition_pick_lifecycle(p_pick_id uuid, p_from_state text, p_to_state text, p_writer_role text, p_reason text, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: FUNCTION transition_pick_lifecycle(p_pick_id uuid, p_from_state text, p_to_state text, p_writer_role text, p_reason text, p_payload jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.transition_pick_lifecycle(p_pick_id uuid, p_from_state text, p_to_state text, p_writer_role text, p_reason text, p_payload jsonb) IS 'UTV2-519: atomic pick lifecycle transition. Replaces the two-write pattern in lifecycle.ts. Locks picks row FOR UPDATE, validates from_state, updates picks.status and inserts pick_lifecycle event in one transaction. Raises PICK_NOT_FOUND or INVALID_LIFECYCLE_TRANSITION (SQLSTATE P0001) on guard failures; any other constraint error (e.g. pick_lifecycle_to_state_check) rolls both writes back.';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alert_detections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_detections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    idempotency_key text NOT NULL,
    event_id uuid NOT NULL,
    participant_id text,
    market_key text NOT NULL,
    bookmaker_key text NOT NULL,
    baseline_snapshot_at timestamp with time zone NOT NULL,
    current_snapshot_at timestamp with time zone NOT NULL,
    old_line numeric NOT NULL,
    new_line numeric NOT NULL,
    line_change numeric NOT NULL,
    line_change_abs numeric NOT NULL,
    velocity numeric,
    time_elapsed_minutes numeric NOT NULL,
    direction text NOT NULL,
    market_type text NOT NULL,
    tier text NOT NULL,
    notified boolean DEFAULT false NOT NULL,
    notified_at timestamp with time zone,
    notified_channels text[],
    cooldown_expires_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    first_mover_book text,
    steam_detected boolean DEFAULT false NOT NULL,
    CONSTRAINT alert_detections_direction_check CHECK ((direction = ANY (ARRAY['up'::text, 'down'::text]))),
    CONSTRAINT alert_detections_market_type_check CHECK ((market_type = ANY (ARRAY['spread'::text, 'total'::text, 'moneyline'::text, 'player_prop'::text]))),
    CONSTRAINT alert_detections_tier_check CHECK ((tier = ANY (ARRAY['watch'::text, 'notable'::text, 'alert-worthy'::text])))
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    action text NOT NULL,
    actor text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    entity_ref text
);


--
-- Name: leagues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leagues (
    id text NOT NULL,
    sport_id text NOT NULL,
    display_name text NOT NULL,
    country text,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: player_team_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_team_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    player_id uuid NOT NULL,
    team_id text NOT NULL,
    league_id text NOT NULL,
    effective_from date,
    effective_until date,
    is_current boolean DEFAULT true NOT NULL,
    source text DEFAULT 'bootstrap'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT chk_player_team_assignment_window CHECK (((effective_until IS NULL) OR (effective_from IS NULL) OR (effective_until >= effective_from)))
);


--
-- Name: players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.players (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    display_name text NOT NULL,
    first_name text,
    last_name text,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id text NOT NULL,
    league_id text NOT NULL,
    display_name text NOT NULL,
    short_name text NOT NULL,
    abbreviation text,
    city text,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: canonical_reference_bootstrap_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.canonical_reference_bootstrap_summary AS
 SELECT league.id AS league_id,
    league.sport_id,
    count(DISTINCT team.id) AS teams_count,
    count(DISTINCT player.id) AS players_count,
    count(DISTINCT assignment.player_id) AS assigned_players_count,
    GREATEST((count(DISTINCT player.id) - count(DISTINCT assignment.player_id)), (0)::bigint) AS unassigned_players_count
   FROM (((public.leagues league
     LEFT JOIN public.teams team ON ((team.league_id = league.id)))
     LEFT JOIN public.player_team_assignments assignment ON (((assignment.league_id = league.id) AND (assignment.effective_until IS NULL))))
     LEFT JOIN public.players player ON ((player.id = assignment.player_id)))
  GROUP BY league.id, league.sport_id
  ORDER BY league.id;


--
-- Name: cappers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cappers (
    id text NOT NULL,
    display_name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: certification_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.certification_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    program_id text NOT NULL,
    domain public.certification_domain NOT NULL,
    status public.certification_status NOT NULL,
    evidence_sha text NOT NULL,
    merge_sha text NOT NULL,
    transitioned_at timestamp with time zone DEFAULT now() NOT NULL,
    transitioned_by text NOT NULL,
    transition_reason text NOT NULL,
    expires_at timestamp with time zone,
    revocation_trigger public.revocation_trigger,
    predecessor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT certification_records_evidence_sha_check CHECK ((length(evidence_sha) = 64)),
    CONSTRAINT certification_records_merge_sha_check CHECK ((merge_sha ~ '^[0-9a-f]{40}$'::text)),
    CONSTRAINT certification_records_program_id_check CHECK ((program_id = ANY (ARRAY['P1'::text, 'P2'::text, 'P3'::text, 'P4'::text, 'P5'::text]))),
    CONSTRAINT certification_records_transition_reason_check CHECK ((length(transition_reason) > 0)),
    CONSTRAINT revoked_requires_trigger CHECK (((status = 'revoked'::public.certification_status) = (revocation_trigger IS NOT NULL)))
);


--
-- Name: TABLE certification_records; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.certification_records IS 'Append-only ledger of certification state transitions per domain per program. Current state = most recent row per (program_id, domain). Never mutate.';


--
-- Name: certification_transition_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.certification_transition_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cert_record_id uuid NOT NULL,
    program_id text NOT NULL,
    domain public.certification_domain NOT NULL,
    from_status public.certification_status,
    to_status public.certification_status NOT NULL,
    triggered_by text NOT NULL,
    trigger_reason text NOT NULL,
    evidence_sha text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    replay_safe boolean DEFAULT true NOT NULL,
    CONSTRAINT certification_transition_events_evidence_sha_check CHECK (((evidence_sha IS NULL) OR (length(evidence_sha) = 64))),
    CONSTRAINT certification_transition_events_trigger_reason_check CHECK ((length(trigger_reason) > 0))
);


--
-- Name: TABLE certification_transition_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.certification_transition_events IS 'Immutable audit trail for certification state transitions. Used for replay reconstruction of certification history. Never mutate.';


--
-- Name: combo_stat_type_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.combo_stat_type_components (
    combo_stat_type_id text NOT NULL,
    stat_type_id uuid NOT NULL,
    weight numeric(10,4) DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: combo_stat_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.combo_stat_types (
    id text NOT NULL,
    sport_id text NOT NULL,
    market_type_id text NOT NULL,
    display_name text NOT NULL,
    short_label text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: current_certification_state; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.current_certification_state AS
 SELECT DISTINCT ON (program_id, domain) id,
    program_id,
    domain,
    status,
    evidence_sha,
    merge_sha,
    transitioned_at,
    transitioned_by,
    transition_reason,
    expires_at,
    revocation_trigger,
    predecessor_id,
    created_at
   FROM public.certification_records
  ORDER BY program_id, domain, created_at DESC;


--
-- Name: VIEW current_certification_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.current_certification_state IS 'Live certification state: most recent record per (program_id, domain). Read-only.';


--
-- Name: distribution_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.distribution_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pick_id uuid NOT NULL,
    target text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone,
    last_error text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    claimed_at timestamp with time zone,
    claimed_by text,
    idempotency_key text,
    CONSTRAINT distribution_outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text, 'dead_letter'::text])))
);


--
-- Name: distribution_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.distribution_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    outbox_id uuid NOT NULL,
    external_id text,
    receipt_type text NOT NULL,
    status text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    recorded_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    channel text,
    idempotency_key text
);


--
-- Name: event_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT event_participants_role_check CHECK ((role = ANY (ARRAY['home'::text, 'away'::text, 'competitor'::text])))
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sport_id text NOT NULL,
    event_name text NOT NULL,
    event_date date NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    external_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT events_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'in_progress'::text, 'completed'::text, 'postponed'::text, 'cancelled'::text])))
);


--
-- Name: execution_intents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.execution_intents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    predecessor_id uuid,
    pick_id uuid NOT NULL,
    decision_record_id text NOT NULL,
    intent_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    idempotency_key text,
    inputs_hash text NOT NULL,
    provenance jsonb NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    issued_at_ms bigint NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT execution_intents_decision_record_id_check CHECK ((length(decision_record_id) > 0)),
    CONSTRAINT execution_intents_idempotency_key_check CHECK (((idempotency_key IS NULL) OR (length(idempotency_key) > 0))),
    CONSTRAINT execution_intents_inputs_hash_check CHECK ((inputs_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT execution_intents_intent_type_check CHECK ((intent_type = ANY (ARRAY['initial'::text, 're_confirm'::text, 'recovery'::text]))),
    CONSTRAINT execution_intents_issued_at_positive CHECK ((issued_at_ms > 0)),
    CONSTRAINT execution_intents_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'dead_letter'::text, 'recovered'::text])))
);


--
-- Name: experiment_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.experiment_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    run_type text NOT NULL,
    sport text NOT NULL,
    market_family text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    started_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    finished_at timestamp with time zone,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT experiment_ledger_run_type_check CHECK ((run_type = ANY (ARRAY['training'::text, 'eval'::text, 'backtest'::text, 'calibration'::text, 'shadow_comparison'::text]))),
    CONSTRAINT experiment_ledger_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: game_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    participant_id uuid,
    market_key text NOT NULL,
    actual_value numeric NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    sourced_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT game_results_actual_value_finite CHECK (((actual_value IS NOT NULL) AND (actual_value > ('-9999'::integer)::numeric) AND (actual_value < (99999)::numeric))),
    CONSTRAINT game_results_market_key_check CHECK ((char_length(market_key) > 0))
)
WITH (autovacuum_vacuum_scale_factor='0.05', autovacuum_analyze_scale_factor='0.02', autovacuum_vacuum_cost_delay='10');


--
-- Name: hedge_opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hedge_opportunities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    idempotency_key text NOT NULL,
    event_id uuid,
    participant_id uuid,
    market_key text NOT NULL,
    type text NOT NULL,
    priority text NOT NULL,
    bookmaker_a text NOT NULL,
    line_a numeric NOT NULL,
    over_odds_a numeric,
    bookmaker_b text NOT NULL,
    line_b numeric NOT NULL,
    under_odds_b numeric,
    line_discrepancy numeric NOT NULL,
    implied_prob_a numeric NOT NULL,
    implied_prob_b numeric NOT NULL,
    total_implied_prob numeric NOT NULL,
    arbitrage_percentage numeric NOT NULL,
    profit_potential numeric NOT NULL,
    guaranteed_profit numeric,
    middle_gap numeric,
    win_probability numeric,
    notified boolean DEFAULT false NOT NULL,
    notified_at timestamp with time zone,
    notified_channels text[],
    cooldown_expires_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    detected_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT hedge_opportunities_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT hedge_opportunities_type_check CHECK ((type = ANY (ARRAY['arbitrage'::text, 'middle'::text, 'hedge'::text])))
);


--
-- Name: market_families; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_families (
    id text NOT NULL,
    display_name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: market_family_trust; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_family_trust (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tuning_run_id uuid NOT NULL,
    market_type_id text NOT NULL,
    sport_key text,
    sample_size integer NOT NULL,
    win_count integer NOT NULL,
    loss_count integer NOT NULL,
    push_count integer NOT NULL,
    win_rate numeric,
    roi numeric,
    avg_model_score numeric,
    confidence_band text,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: TABLE market_family_trust; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.market_family_trust IS 'UTV2-480: Per-run tuning output. One row per market_type_id per tuning run. Read-only after insert.';


--
-- Name: market_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_types (
    id text NOT NULL,
    market_family_id text NOT NULL,
    selection_type_id text NOT NULL,
    display_name text NOT NULL,
    short_label text NOT NULL,
    requires_line boolean DEFAULT false NOT NULL,
    requires_participant boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: market_universe; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_universe (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sport_key text NOT NULL,
    league_key text NOT NULL,
    event_id uuid,
    participant_id uuid,
    market_type_id text,
    canonical_market_key text NOT NULL,
    provider_key text NOT NULL,
    provider_event_id text NOT NULL,
    provider_participant_id text,
    provider_market_key text NOT NULL,
    current_line numeric,
    current_over_odds numeric,
    current_under_odds numeric,
    opening_line numeric,
    opening_over_odds numeric,
    opening_under_odds numeric,
    closing_line numeric,
    closing_over_odds numeric,
    closing_under_odds numeric,
    fair_over_prob numeric,
    fair_under_prob numeric,
    is_stale boolean DEFAULT false NOT NULL,
    last_offer_snapshot_at timestamp with time zone NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_fair_prob_both_or_neither CHECK ((((fair_over_prob IS NULL) AND (fair_under_prob IS NULL)) OR ((fair_over_prob IS NOT NULL) AND (fair_under_prob IS NOT NULL))))
);


--
-- Name: member_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    discord_id text NOT NULL,
    discord_username text,
    tier text NOT NULL,
    effective_from timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    effective_until timestamp with time zone,
    source text NOT NULL,
    changed_by text,
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT member_tiers_source_check CHECK ((source = ANY (ARRAY['discord-role'::text, 'manual'::text, 'system'::text]))),
    CONSTRAINT member_tiers_tier_check CHECK ((tier = ANY (ARRAY['free'::text, 'trial'::text, 'vip'::text, 'vip-plus'::text, 'capper'::text, 'operator'::text])))
);


--
-- Name: model_health_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_health_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id uuid NOT NULL,
    sport text NOT NULL,
    market_family text NOT NULL,
    snapshot_at timestamp with time zone DEFAULT now() NOT NULL,
    win_rate numeric,
    roi numeric,
    sample_size integer DEFAULT 0 NOT NULL,
    drift_score numeric,
    calibration_score numeric,
    alert_level text DEFAULT 'none'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT model_health_snapshots_alert_level_check CHECK ((alert_level = ANY (ARRAY['none'::text, 'warning'::text, 'critical'::text])))
);


--
-- Name: model_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_registry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_name text NOT NULL,
    version text NOT NULL,
    sport text NOT NULL,
    market_family text NOT NULL,
    status text DEFAULT 'staged'::text NOT NULL,
    champion_since timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    registry_entity_type text,
    source_type_compatibility text[],
    owner text,
    training_window_start timestamp with time zone,
    training_window_end timestamp with time zone,
    validation_metrics jsonb,
    calibration_metadata jsonb,
    promotion_approved_by text,
    promotion_approved_at timestamp with time zone,
    active_state text,
    artifact_sha text,
    CONSTRAINT model_registry_status_check CHECK ((status = ANY (ARRAY['champion'::text, 'challenger'::text, 'staged'::text, 'archived'::text])))
);


--
-- Name: COLUMN model_registry.artifact_sha; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.model_registry.artifact_sha IS 'SHA-256 of the model artifact file. Immutable once set — a changed artifact is a new model version record.';


--
-- Name: odds_snapshot_corrections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.odds_snapshot_corrections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid NOT NULL,
    new_snapshot_id uuid NOT NULL,
    corrected_by text NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: odds_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.odds_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_key text NOT NULL,
    market_key text NOT NULL,
    league text NOT NULL,
    run_id uuid NOT NULL,
    raw_payload_id uuid,
    snapshot_at timestamp with time zone NOT NULL,
    price_blob jsonb NOT NULL,
    prior_snapshot_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: participant_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participant_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    participant_id uuid NOT NULL,
    parent_participant_id uuid NOT NULL,
    role text,
    valid_from timestamp with time zone,
    valid_to timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    external_id text,
    participant_type text NOT NULL,
    sport text,
    league text,
    display_name text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT participants_type_check CHECK ((participant_type = ANY (ARRAY['player'::text, 'team'::text, 'league'::text, 'event'::text])))
);


--
-- Name: pick_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pick_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    universe_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    rejection_reason text,
    filter_details jsonb,
    model_score numeric,
    model_tier text,
    model_confidence numeric,
    shadow_mode boolean DEFAULT true NOT NULL,
    pick_id uuid,
    scan_run_id text,
    provenance jsonb,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    selection_rank integer,
    is_board_candidate boolean DEFAULT false NOT NULL,
    sport_key text,
    model_registry_id uuid,
    scoring_run_id uuid,
    ownership_timestamp timestamp with time zone
);


--
-- Name: pick_lifecycle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pick_lifecycle (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pick_id uuid NOT NULL,
    to_state text NOT NULL,
    writer_role text NOT NULL,
    reason text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    from_state text,
    CONSTRAINT pick_lifecycle_to_state_check CHECK ((to_state = ANY (ARRAY['draft'::text, 'validated'::text, 'awaiting_approval'::text, 'queued'::text, 'posted'::text, 'settled'::text, 'voided'::text]))),
    CONSTRAINT pick_lifecycle_writer_role_check CHECK ((writer_role = ANY (ARRAY['submitter'::text, 'promoter'::text, 'poster'::text, 'settler'::text, 'operator_override'::text])))
);


--
-- Name: CONSTRAINT pick_lifecycle_to_state_check ON pick_lifecycle; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT pick_lifecycle_to_state_check ON public.pick_lifecycle IS 'UTV2-519: lifecycle event to_state allow-list. awaiting_approval added in Phase 7A corrective to close the UTV2-491 gap where picks_status_check allowed awaiting_approval but pick_lifecycle_to_state_check did not. See packages/db/src/lifecycle.ts for the canonical FSM.';


--
-- Name: pick_offer_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pick_offer_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pick_id uuid NOT NULL,
    settlement_record_id uuid,
    snapshot_kind text NOT NULL,
    provider_key text NOT NULL,
    provider_event_id text NOT NULL,
    provider_market_key text NOT NULL,
    provider_participant_id text,
    bookmaker_key text,
    identity_key text NOT NULL,
    line numeric,
    over_odds integer,
    under_odds integer,
    devig_mode text NOT NULL,
    source_snapshot_at timestamp with time zone,
    captured_at timestamp with time zone NOT NULL,
    source_run_id uuid,
    source_compact_snapshot_id uuid,
    source_current_identity_key text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT pick_offer_snapshots_devig_mode_check CHECK ((devig_mode = ANY (ARRAY['PAIRED'::text, 'FALLBACK_SINGLE_SIDED'::text]))),
    CONSTRAINT pick_offer_snapshots_snapshot_kind_check CHECK ((snapshot_kind = ANY (ARRAY['submission'::text, 'approval'::text, 'posting'::text, 'closing_for_clv'::text, 'settlement_proof'::text])))
);


--
-- Name: pick_promotion_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pick_promotion_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pick_id uuid NOT NULL,
    target text NOT NULL,
    status text NOT NULL,
    score numeric(5,2),
    reason text,
    version text NOT NULL,
    decided_at timestamp with time zone NOT NULL,
    decided_by text NOT NULL,
    override_action text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT pick_promotion_history_override_action_check CHECK (((override_action IS NULL) OR (override_action = ANY (ARRAY['force_promote'::text, 'suppress_from_best_bets'::text, 'suppress_from_trader_insights'::text])))),
    CONSTRAINT pick_promotion_history_status_check CHECK ((status = ANY (ARRAY['not_eligible'::text, 'eligible'::text, 'qualified'::text, 'promoted'::text, 'suppressed'::text, 'expired'::text]))),
    CONSTRAINT pick_promotion_history_target_check CHECK ((target = ANY (ARRAY['best-bets'::text, 'trader-insights'::text, 'exclusive-insights'::text])))
);


--
-- Name: pick_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pick_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pick_id uuid NOT NULL,
    decision text NOT NULL,
    reason text NOT NULL,
    decided_by text NOT NULL,
    decided_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT pick_reviews_decision_check CHECK ((decision = ANY (ARRAY['approve'::text, 'deny'::text, 'hold'::text, 'return'::text])))
);


--
-- Name: picks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.picks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid,
    participant_id uuid,
    market text NOT NULL,
    selection text NOT NULL,
    line numeric(10,2),
    odds integer,
    stake_units numeric(10,2),
    confidence numeric(5,2),
    source text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    posted_at timestamp with time zone,
    settled_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    approval_status text DEFAULT 'approved'::text NOT NULL,
    promotion_status text DEFAULT 'not_eligible'::text NOT NULL,
    promotion_target text,
    promotion_score numeric(5,2),
    promotion_reason text,
    promotion_version text,
    promotion_decided_at timestamp with time zone,
    promotion_decided_by text,
    idempotency_key text,
    capper_id text,
    sport_id text,
    market_type_id text,
    player_id uuid,
    CONSTRAINT picks_approval_status_check CHECK ((approval_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'voided'::text, 'expired'::text]))),
    CONSTRAINT picks_promotion_status_check CHECK ((promotion_status = ANY (ARRAY['not_eligible'::text, 'eligible'::text, 'qualified'::text, 'promoted'::text, 'suppressed'::text, 'expired'::text]))),
    CONSTRAINT picks_promotion_target_check CHECK (((promotion_target IS NULL) OR (promotion_target = ANY (ARRAY['best-bets'::text, 'trader-insights'::text, 'exclusive-insights'::text])))),
    CONSTRAINT picks_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'validated'::text, 'awaiting_approval'::text, 'queued'::text, 'posted'::text, 'settled'::text, 'voided'::text])))
);


--
-- Name: COLUMN picks.player_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.picks.player_id IS 'Canonical player FK (players table). Populated on new picks when player identity is known at submission time. participant_id (old system) preserved for backward compatibility during Phase 1 transition.';


--
-- Name: CONSTRAINT picks_status_check ON picks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT picks_status_check ON public.picks IS 'UTV2-491: lifecycle state allow-list. awaiting_approval added in Phase 7A for the governance brake. See packages/db/src/lifecycle.ts for the canonical FSM.';


--
-- Name: settlement_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settlement_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pick_id uuid NOT NULL,
    result text,
    source text NOT NULL,
    confidence text DEFAULT 'confirmed'::text NOT NULL,
    settled_by text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    settled_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    corrects_id uuid,
    status text DEFAULT 'settled'::text NOT NULL,
    evidence_ref text,
    notes text,
    review_reason text,
    stake_units numeric,
    CONSTRAINT settlement_records_confidence_check CHECK ((confidence = ANY (ARRAY['confirmed'::text, 'estimated'::text, 'pending'::text]))),
    CONSTRAINT settlement_records_result_check CHECK (((result IS NULL) OR (result = ANY (ARRAY['win'::text, 'loss'::text, 'push'::text, 'void'::text, 'cancelled'::text])))),
    CONSTRAINT settlement_records_shape_check CHECK ((((status = 'settled'::text) AND (result IS NOT NULL)) OR ((status = 'manual_review'::text) AND (result IS NULL) AND (review_reason IS NOT NULL)))),
    CONSTRAINT settlement_records_source_check CHECK ((source = ANY (ARRAY['operator'::text, 'api'::text, 'feed'::text, 'grading'::text]))),
    CONSTRAINT settlement_records_status_check CHECK ((status = ANY (ARRAY['settled'::text, 'manual_review'::text])))
);


--
-- Name: sports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sports (
    id text NOT NULL,
    display_name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: picks_current_state; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.picks_current_state AS
 SELECT p.id,
    p.submission_id,
    p.participant_id,
    p.market,
    p.selection,
    p.line,
    p.odds,
    p.stake_units,
    p.confidence,
    p.source,
    p.status,
    p.posted_at,
    p.settled_at,
    p.metadata,
    p.created_at,
    p.updated_at,
    p.approval_status,
    p.promotion_status,
    p.promotion_target,
    p.promotion_score,
    p.promotion_reason,
    p.promotion_version,
    p.promotion_decided_at,
    p.promotion_decided_by,
    p.idempotency_key,
    p.capper_id,
    p.sport_id,
    p.market_type_id,
    c.display_name AS capper_display_name,
    s.display_name AS sport_display_name,
    mt.display_name AS market_type_display_name,
    ph.status AS promotion_status_current,
    ph.target AS promotion_target_current,
    ph.score AS promotion_score_current,
    ph.decided_at AS promotion_decided_at_current,
    sr.result AS settlement_result,
    sr.status AS settlement_status,
    sr.source AS settlement_source,
    sr.created_at AS settlement_recorded_at,
    pr.decision AS review_decision,
    pr.decided_by AS review_decided_by,
    pr.decided_at AS review_decided_at
   FROM ((((((public.picks p
     LEFT JOIN public.cappers c ON ((c.id = p.capper_id)))
     LEFT JOIN public.sports s ON ((s.id = p.sport_id)))
     LEFT JOIN public.market_types mt ON ((mt.id = p.market_type_id)))
     LEFT JOIN LATERAL ( SELECT h.status,
            h.target,
            h.score,
            h.decided_at
           FROM public.pick_promotion_history h
          WHERE (h.pick_id = p.id)
          ORDER BY h.decided_at DESC, h.created_at DESC, h.id DESC
         LIMIT 1) ph ON (true))
     LEFT JOIN LATERAL ( SELECT sr_inner.result,
            sr_inner.status,
            sr_inner.source,
            sr_inner.created_at
           FROM public.settlement_records sr_inner
          WHERE (sr_inner.pick_id = p.id)
          ORDER BY sr_inner.created_at DESC, sr_inner.id DESC
         LIMIT 1) sr ON (true))
     LEFT JOIN LATERAL ( SELECT pr_inner.decision,
            pr_inner.decided_by,
            pr_inner.decided_at
           FROM public.pick_reviews pr_inner
          WHERE (pr_inner.pick_id = p.id)
          ORDER BY pr_inner.decided_at DESC, pr_inner.created_at DESC, pr_inner.id DESC
         LIMIT 1) pr ON (true));


--
-- Name: provider_book_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_book_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    provider_book_key text NOT NULL,
    provider_display_name text NOT NULL,
    sportsbook_id text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: provider_cycle_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_cycle_status (
    run_id uuid NOT NULL,
    provider_key text NOT NULL,
    league text NOT NULL,
    cycle_snapshot_at timestamp with time zone NOT NULL,
    stage_status text NOT NULL,
    freshness_status text DEFAULT 'unknown'::text NOT NULL,
    proof_status text DEFAULT 'required'::text NOT NULL,
    staged_count integer DEFAULT 0 NOT NULL,
    merged_count integer DEFAULT 0 NOT NULL,
    duplicate_count integer DEFAULT 0 NOT NULL,
    last_error text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    failure_category text,
    failure_scope text,
    affected_provider_key text,
    affected_sport_key text,
    affected_market_key text,
    CONSTRAINT provider_cycle_status_duplicate_count_check CHECK ((duplicate_count >= 0)),
    CONSTRAINT provider_cycle_status_failure_category_check CHECK ((failure_category = ANY (ARRAY['provider_api_failure'::text, 'parse_failure'::text, 'zero_offers'::text, 'db_statement_timeout'::text, 'db_lock_timeout'::text, 'db_deadlock'::text, 'partial_market_failure'::text, 'stale_after_cycle'::text, 'archive_failure'::text, 'unknown_failure'::text]))),
    CONSTRAINT provider_cycle_status_failure_scope_check CHECK ((failure_scope = ANY (ARRAY['cycle'::text, 'provider'::text, 'sport'::text, 'market'::text, 'archive'::text, 'db'::text]))),
    CONSTRAINT provider_cycle_status_freshness_status_check CHECK ((freshness_status = ANY (ARRAY['unknown'::text, 'fresh'::text, 'stale'::text, 'invalid_snapshot'::text]))),
    CONSTRAINT provider_cycle_status_merged_count_check CHECK ((merged_count >= 0)),
    CONSTRAINT provider_cycle_status_proof_status_check CHECK ((proof_status = ANY (ARRAY['required'::text, 'verified'::text, 'waived'::text]))),
    CONSTRAINT provider_cycle_status_stage_status_check CHECK ((stage_status = ANY (ARRAY['pending'::text, 'staged'::text, 'merge_blocked'::text, 'merged'::text, 'failed'::text]))),
    CONSTRAINT provider_cycle_status_staged_count_check CHECK ((staged_count >= 0))
);


--
-- Name: provider_entity_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_entity_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    entity_kind text NOT NULL,
    provider_entity_key text NOT NULL,
    provider_entity_id text,
    provider_display_name text NOT NULL,
    participant_id uuid,
    team_id text,
    player_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT ck_provider_entity_alias_target CHECK (((participant_id IS NOT NULL) OR (team_id IS NOT NULL) OR (player_id IS NOT NULL))),
    CONSTRAINT provider_entity_aliases_entity_kind_check CHECK ((entity_kind = ANY (ARRAY['team'::text, 'player'::text, 'participant'::text])))
);


--
-- Name: provider_market_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_market_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    provider_market_key text NOT NULL,
    provider_display_name text NOT NULL,
    market_type_id text NOT NULL,
    sport_id text,
    stat_type_id uuid,
    combo_stat_type_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: provider_offer_current; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_offer_current (
    identity_key text NOT NULL,
    id uuid NOT NULL,
    provider_key text NOT NULL,
    provider_event_id text NOT NULL,
    provider_market_key text NOT NULL,
    provider_participant_id text,
    sport_key text,
    line numeric,
    over_odds integer,
    under_odds integer,
    devig_mode text NOT NULL,
    is_opening boolean DEFAULT false NOT NULL,
    is_closing boolean DEFAULT false NOT NULL,
    snapshot_at timestamp with time zone NOT NULL,
    idempotency_key text NOT NULL,
    bookmaker_key text,
    source_run_id uuid,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT provider_offer_current_devig_mode_check CHECK ((devig_mode = ANY (ARRAY['PAIRED'::text, 'FALLBACK_SINGLE_SIDED'::text])))
);


--
-- Name: TABLE provider_offer_current; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.provider_offer_current IS 'DERIVED PROJECTION — not truth. Materialized hot-current view of provider odds, maintained for pick-pipeline operational reads. Canonical truth for point-in-time reconstruction is odds_snapshots (UTV2-1085). Do not treat this table as authoritative for historical market state. Demoted per INIT-1.1.3 / UTV2-1086.';


--
-- Name: provider_offer_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_offer_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_key text NOT NULL,
    provider_event_id text NOT NULL,
    provider_market_key text NOT NULL,
    provider_participant_id text,
    sport_key text,
    line numeric,
    over_odds integer,
    under_odds integer,
    devig_mode text NOT NULL,
    is_opening boolean DEFAULT false NOT NULL,
    is_closing boolean DEFAULT false NOT NULL,
    snapshot_at timestamp with time zone NOT NULL,
    idempotency_key text NOT NULL,
    bookmaker_key text,
    source_run_id uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT provider_offer_history_devig_mode_check CHECK ((devig_mode = ANY (ARRAY['PAIRED'::text, 'FALLBACK_SINGLE_SIDED'::text])))
)
PARTITION BY RANGE (snapshot_at);


--
-- Name: provider_offer_history_compact; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_offer_history_compact (
    snapshot_id uuid DEFAULT gen_random_uuid() NOT NULL,
    identity_key text NOT NULL,
    provider_key text NOT NULL,
    provider_event_id text NOT NULL,
    provider_market_key text NOT NULL,
    provider_participant_id text,
    sport_key text,
    bookmaker_key text,
    line numeric,
    over_odds integer,
    under_odds integer,
    devig_mode text NOT NULL,
    is_opening boolean DEFAULT false NOT NULL,
    is_closing boolean DEFAULT false NOT NULL,
    snapshot_at timestamp with time zone NOT NULL,
    observed_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    source_run_id uuid,
    change_reason text NOT NULL,
    previous_snapshot_id uuid,
    changed_fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    idempotency_key text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT provider_offer_history_compact_change_reason_check CHECK ((change_reason = ANY (ARRAY['first_seen'::text, 'line_change'::text, 'odds_change'::text, 'opening_capture'::text, 'closing_capture'::text, 'proof_capture'::text, 'replay_capture'::text]))),
    CONSTRAINT provider_offer_history_compact_devig_mode_check CHECK ((devig_mode = ANY (ARRAY['PAIRED'::text, 'FALLBACK_SINGLE_SIDED'::text])))
);


--
-- Name: provider_offer_line_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_offer_line_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_key text NOT NULL,
    provider_event_id text NOT NULL,
    provider_market_key text NOT NULL,
    provider_participant_id text,
    bookmaker_key text,
    sport_key text,
    snapshot_date date NOT NULL,
    opening_line numeric,
    closing_line numeric,
    high_line numeric,
    low_line numeric,
    snapshot_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: provider_offer_staging; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_offer_staging (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    provider_key text NOT NULL,
    league text NOT NULL,
    provider_event_id text NOT NULL,
    provider_market_key text NOT NULL,
    provider_participant_id text,
    sport_key text,
    line numeric,
    over_odds integer,
    under_odds integer,
    devig_mode text NOT NULL,
    is_opening boolean DEFAULT false NOT NULL,
    is_closing boolean DEFAULT false NOT NULL,
    snapshot_at timestamp with time zone NOT NULL,
    idempotency_key text NOT NULL,
    bookmaker_key text,
    identity_key text NOT NULL,
    merge_status text DEFAULT 'pending'::text NOT NULL,
    merge_error text,
    merged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT provider_offer_staging_devig_mode_check CHECK ((devig_mode = ANY (ARRAY['PAIRED'::text, 'FALLBACK_SINGLE_SIDED'::text]))),
    CONSTRAINT provider_offer_staging_merge_status_check CHECK ((merge_status = ANY (ARRAY['pending'::text, 'merged'::text, 'duplicate'::text, 'stale_blocked'::text, 'failed'::text])))
);


--
-- Name: provider_offers_legacy_quarantine; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_offers_legacy_quarantine (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_key text NOT NULL,
    provider_event_id text NOT NULL,
    provider_market_key text NOT NULL,
    provider_participant_id text,
    sport_key text,
    line numeric,
    over_odds integer,
    under_odds integer,
    devig_mode text NOT NULL,
    is_opening boolean DEFAULT false NOT NULL,
    is_closing boolean DEFAULT false NOT NULL,
    snapshot_at timestamp with time zone NOT NULL,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    bookmaker_key text,
    CONSTRAINT provider_offers_devig_mode_check CHECK ((devig_mode = ANY (ARRAY['PAIRED'::text, 'FALLBACK_SINGLE_SIDED'::text])))
)
WITH (autovacuum_vacuum_cost_delay='2', autovacuum_vacuum_scale_factor='0.02', autovacuum_vacuum_threshold='5000', autovacuum_analyze_scale_factor='0.01', autovacuum_analyze_threshold='5000');


--
-- Name: provider_offers; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.provider_offers AS
 SELECT id,
    provider_key,
    provider_event_id,
    provider_market_key,
    provider_participant_id,
    sport_key,
    line,
    over_odds,
    under_odds,
    devig_mode,
    is_opening,
    is_closing,
    snapshot_at,
    idempotency_key,
    created_at,
    bookmaker_key
   FROM public.provider_offers_legacy_quarantine;


--
-- Name: raw_payloads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.raw_payloads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_key text NOT NULL,
    league text NOT NULL,
    run_id uuid NOT NULL,
    kind text NOT NULL,
    payload_hash text NOT NULL,
    payload jsonb NOT NULL,
    snapshot_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT raw_payloads_kind_check CHECK ((kind = ANY (ARRAY['odds'::text, 'results'::text])))
);


--
-- Name: selection_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.selection_types (
    id text NOT NULL,
    display_name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: settlement_corrections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settlement_corrections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    settlement_record_id uuid NOT NULL,
    prior_record_id uuid NOT NULL,
    authorizer_1 text NOT NULL,
    authorizer_2 text NOT NULL,
    justification text NOT NULL,
    correction_at timestamp with time zone DEFAULT now() NOT NULL,
    audit_event_id uuid,
    CONSTRAINT settlement_corrections_distinct_authorizers CHECK ((authorizer_1 <> authorizer_2))
);


--
-- Name: TABLE settlement_corrections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.settlement_corrections IS 'UTV2-1137: Dual-authorization records for settlement corrections. authorizer_1 and authorizer_2 must be distinct identities.';


--
-- Name: COLUMN settlement_corrections.settlement_record_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.settlement_corrections.settlement_record_id IS 'The new settlement_records row (with corrects_id set) created by this correction.';


--
-- Name: COLUMN settlement_corrections.prior_record_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.settlement_corrections.prior_record_id IS 'The settlement_records row being corrected — must match settlement_record.corrects_id.';


--
-- Name: COLUMN settlement_corrections.audit_event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.settlement_corrections.audit_event_id IS 'Populated after the AuditEvent is emitted for this correction.';


--
-- Name: sgo_replay_coverage; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.sgo_replay_coverage AS
 SELECT pc.id AS candidate_id,
    pc.model_score,
    pc.model_tier,
    pc.status,
    pc.is_board_candidate,
    pc.pick_id,
    mu.sport_key,
    mu.provider_key,
    mu.provider_event_id,
    mu.provider_market_key,
    ((mu.opening_line IS NOT NULL) AND (mu.opening_over_odds IS NOT NULL) AND (mu.opening_under_odds IS NOT NULL)) AS has_mu_opening,
    ((mu.closing_line IS NOT NULL) AND (mu.closing_over_odds IS NOT NULL) AND (mu.closing_under_odds IS NOT NULL)) AS has_mu_closing,
    (po_open.id IS NOT NULL) AS has_po_opening,
    (po_close.id IS NOT NULL) AS has_po_closing,
    (((mu.opening_line IS NOT NULL) AND (mu.opening_over_odds IS NOT NULL) AND (mu.opening_under_odds IS NOT NULL)) OR (po_open.id IS NOT NULL)) AS has_opening,
    (((mu.closing_line IS NOT NULL) AND (mu.closing_over_odds IS NOT NULL) AND (mu.closing_under_odds IS NOT NULL)) OR (po_close.id IS NOT NULL)) AS has_closing,
    ((((mu.opening_line IS NOT NULL) AND (mu.opening_over_odds IS NOT NULL) AND (mu.opening_under_odds IS NOT NULL)) OR (po_open.id IS NOT NULL)) AND (((mu.closing_line IS NOT NULL) AND (mu.closing_over_odds IS NOT NULL) AND (mu.closing_under_odds IS NOT NULL)) OR (po_close.id IS NOT NULL))) AS replay_eligible
   FROM (((public.pick_candidates pc
     JOIN public.market_universe mu ON ((mu.id = pc.universe_id)))
     LEFT JOIN LATERAL ( SELECT po.id
           FROM public.provider_offers_legacy_quarantine po
          WHERE ((po.provider_key = mu.provider_key) AND (po.provider_event_id = mu.provider_event_id) AND (COALESCE(po.provider_participant_id, ''::text) = COALESCE(mu.provider_participant_id, ''::text)) AND (po.provider_market_key = mu.provider_market_key) AND (po.is_opening = true) AND (po.line IS NOT NULL) AND (po.over_odds IS NOT NULL) AND (po.under_odds IS NOT NULL))
         LIMIT 1) po_open ON (true))
     LEFT JOIN LATERAL ( SELECT po.id
           FROM public.provider_offers_legacy_quarantine po
          WHERE ((po.provider_key = mu.provider_key) AND (po.provider_event_id = mu.provider_event_id) AND (COALESCE(po.provider_participant_id, ''::text) = COALESCE(mu.provider_participant_id, ''::text)) AND (po.provider_market_key = mu.provider_market_key) AND (po.is_closing = true) AND (po.line IS NOT NULL) AND (po.over_odds IS NOT NULL) AND (po.under_odds IS NOT NULL))
         LIMIT 1) po_close ON (true))
  WHERE (pc.model_score IS NOT NULL);


--
-- Name: VIEW sgo_replay_coverage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.sgo_replay_coverage IS 'UTV2-727: Proof view — scored candidates with opening/closing/replay coverage. Evaluation labels only; never read by scoring inputs.';


--
-- Name: sport_market_type_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sport_market_type_availability (
    sport_id text NOT NULL,
    market_type_id text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: sportsbooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sportsbooks (
    id text NOT NULL,
    display_name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: stat_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stat_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sport_id text NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    canonical_key text NOT NULL,
    display_name text NOT NULL,
    short_label text NOT NULL
);


--
-- Name: submission_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.submission_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    event_name text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    external_id text,
    source text NOT NULL,
    submitted_by text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'received'::text NOT NULL,
    received_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT submissions_status_check CHECK ((status = ANY (ARRAY['received'::text, 'validated'::text, 'rejected'::text, 'materialized'::text])))
);


--
-- Name: syndicate_board; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.syndicate_board (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_id uuid NOT NULL,
    board_rank integer NOT NULL,
    board_tier text NOT NULL,
    sport_key text NOT NULL,
    market_type_id text,
    model_score numeric NOT NULL,
    board_run_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_type text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    started_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    finished_at timestamp with time zone,
    actor text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    idempotency_key text,
    CONSTRAINT system_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text])))
)
WITH (autovacuum_vacuum_scale_factor='0.05', autovacuum_analyze_scale_factor='0.05', autovacuum_vacuum_threshold='100', autovacuum_vacuum_cost_delay='10');


--
-- Name: v_governed_pick_performance; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_governed_pick_performance AS
 SELECT p.id AS pick_id,
    p.market,
    p.selection,
    p.odds,
    p.status AS pick_status,
    p.settled_at,
    p.created_at AS pick_created_at,
    p.metadata,
    sb.board_run_id,
    sb.board_rank,
    sb.board_tier,
    sb.sport_key,
    sb.market_type_id,
    sb.model_score AS board_model_score,
    pc.id AS candidate_id,
    pc.universe_id,
    pc.model_score AS candidate_model_score,
    pc.model_confidence,
    pc.model_tier,
    pc.selection_rank,
    mu.provider_key,
    mu.provider_market_key,
    sr.id AS settlement_id,
    sr.result AS settlement_result,
    sr.status AS settlement_status,
    sr.settled_at AS settlement_settled_at,
    sr.settled_by,
    sr.confidence AS settlement_confidence
   FROM ((((public.picks p
     JOIN public.pick_candidates pc ON ((pc.pick_id = p.id)))
     JOIN public.syndicate_board sb ON ((sb.candidate_id = pc.id)))
     JOIN public.market_universe mu ON ((mu.id = pc.universe_id)))
     LEFT JOIN public.settlement_records sr ON (((sr.pick_id = p.id) AND (sr.corrects_id IS NULL))))
  WHERE (p.source = 'board-construction'::text);


--
-- Name: VIEW v_governed_pick_performance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_governed_pick_performance IS 'UTV2-479: Attribution view linking governed board picks to candidate, board, and settlement outcome. One row per governed pick × settlement record. Unsettled picks have NULL settlement columns.';


--
-- Name: alert_detections alert_detections_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_detections
    ADD CONSTRAINT alert_detections_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: alert_detections alert_detections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_detections
    ADD CONSTRAINT alert_detections_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: cappers cappers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cappers
    ADD CONSTRAINT cappers_pkey PRIMARY KEY (id);


--
-- Name: certification_records certification_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certification_records
    ADD CONSTRAINT certification_records_pkey PRIMARY KEY (id);


--
-- Name: certification_transition_events certification_transition_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certification_transition_events
    ADD CONSTRAINT certification_transition_events_pkey PRIMARY KEY (id);


--
-- Name: combo_stat_type_components combo_stat_type_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_stat_type_components
    ADD CONSTRAINT combo_stat_type_components_pkey PRIMARY KEY (combo_stat_type_id, stat_type_id);


--
-- Name: combo_stat_types combo_stat_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_stat_types
    ADD CONSTRAINT combo_stat_types_pkey PRIMARY KEY (id);


--
-- Name: distribution_outbox distribution_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distribution_outbox
    ADD CONSTRAINT distribution_outbox_pkey PRIMARY KEY (id);


--
-- Name: distribution_receipts distribution_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distribution_receipts
    ADD CONSTRAINT distribution_receipts_pkey PRIMARY KEY (id);


--
-- Name: event_participants event_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_participants
    ADD CONSTRAINT event_participants_pkey PRIMARY KEY (id);


--
-- Name: events events_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_external_id_key UNIQUE (external_id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: execution_intents execution_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_intents
    ADD CONSTRAINT execution_intents_pkey PRIMARY KEY (id);


--
-- Name: experiment_ledger experiment_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiment_ledger
    ADD CONSTRAINT experiment_ledger_pkey PRIMARY KEY (id);


--
-- Name: game_results game_results_event_id_participant_id_market_key_source_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_results
    ADD CONSTRAINT game_results_event_id_participant_id_market_key_source_key UNIQUE (event_id, participant_id, market_key, source);


--
-- Name: game_results game_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_results
    ADD CONSTRAINT game_results_pkey PRIMARY KEY (id);


--
-- Name: hedge_opportunities hedge_opportunities_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hedge_opportunities
    ADD CONSTRAINT hedge_opportunities_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: hedge_opportunities hedge_opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hedge_opportunities
    ADD CONSTRAINT hedge_opportunities_pkey PRIMARY KEY (id);


--
-- Name: leagues leagues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_pkey PRIMARY KEY (id);


--
-- Name: market_families market_families_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_families
    ADD CONSTRAINT market_families_pkey PRIMARY KEY (id);


--
-- Name: market_family_trust market_family_trust_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_family_trust
    ADD CONSTRAINT market_family_trust_pkey PRIMARY KEY (id);


--
-- Name: market_types market_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_types
    ADD CONSTRAINT market_types_pkey PRIMARY KEY (id);


--
-- Name: market_universe market_universe_natural_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_universe
    ADD CONSTRAINT market_universe_natural_key UNIQUE NULLS NOT DISTINCT (provider_key, provider_event_id, provider_participant_id, provider_market_key);


--
-- Name: market_universe market_universe_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_universe
    ADD CONSTRAINT market_universe_pkey PRIMARY KEY (id);


--
-- Name: member_tiers member_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_tiers
    ADD CONSTRAINT member_tiers_pkey PRIMARY KEY (id);


--
-- Name: model_health_snapshots model_health_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_health_snapshots
    ADD CONSTRAINT model_health_snapshots_pkey PRIMARY KEY (id);


--
-- Name: model_registry model_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_registry
    ADD CONSTRAINT model_registry_pkey PRIMARY KEY (id);


--
-- Name: odds_snapshot_corrections odds_snapshot_corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.odds_snapshot_corrections
    ADD CONSTRAINT odds_snapshot_corrections_pkey PRIMARY KEY (id);


--
-- Name: odds_snapshots odds_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.odds_snapshots
    ADD CONSTRAINT odds_snapshots_pkey PRIMARY KEY (id);


--
-- Name: participant_memberships participant_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_memberships
    ADD CONSTRAINT participant_memberships_pkey PRIMARY KEY (id);


--
-- Name: participants participants_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_external_id_key UNIQUE (external_id);


--
-- Name: participants participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_pkey PRIMARY KEY (id);


--
-- Name: pick_candidates pick_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_candidates
    ADD CONSTRAINT pick_candidates_pkey PRIMARY KEY (id);


--
-- Name: pick_lifecycle pick_lifecycle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_lifecycle
    ADD CONSTRAINT pick_lifecycle_pkey PRIMARY KEY (id);


--
-- Name: pick_offer_snapshots pick_offer_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_offer_snapshots
    ADD CONSTRAINT pick_offer_snapshots_pkey PRIMARY KEY (id);


--
-- Name: pick_promotion_history pick_promotion_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_promotion_history
    ADD CONSTRAINT pick_promotion_history_pkey PRIMARY KEY (id);


--
-- Name: pick_reviews pick_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_reviews
    ADD CONSTRAINT pick_reviews_pkey PRIMARY KEY (id);


--
-- Name: picks picks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picks
    ADD CONSTRAINT picks_pkey PRIMARY KEY (id);


--
-- Name: picks picks_stake_units_canonical_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.picks
    ADD CONSTRAINT picks_stake_units_canonical_check CHECK (((stake_units IS NOT NULL) AND (stake_units > (0)::numeric))) NOT VALID;


--
-- Name: player_team_assignments player_team_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_team_assignments
    ADD CONSTRAINT player_team_assignments_pkey PRIMARY KEY (id);


--
-- Name: players players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_pkey PRIMARY KEY (id);


--
-- Name: provider_book_aliases provider_book_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_book_aliases
    ADD CONSTRAINT provider_book_aliases_pkey PRIMARY KEY (id);


--
-- Name: provider_cycle_status provider_cycle_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_cycle_status
    ADD CONSTRAINT provider_cycle_status_pkey PRIMARY KEY (run_id);


--
-- Name: provider_entity_aliases provider_entity_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_entity_aliases
    ADD CONSTRAINT provider_entity_aliases_pkey PRIMARY KEY (id);


--
-- Name: provider_market_aliases provider_market_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_market_aliases
    ADD CONSTRAINT provider_market_aliases_pkey PRIMARY KEY (id);


--
-- Name: provider_offer_current provider_offer_current_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_offer_current
    ADD CONSTRAINT provider_offer_current_pkey PRIMARY KEY (identity_key);


--
-- Name: provider_offer_history_compact provider_offer_history_compact_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_offer_history_compact
    ADD CONSTRAINT provider_offer_history_compact_pkey PRIMARY KEY (snapshot_id);


--
-- Name: provider_offer_history provider_offer_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_offer_history
    ADD CONSTRAINT provider_offer_history_pkey PRIMARY KEY (snapshot_at, id);


--
-- Name: provider_offer_history provider_offer_history_snapshot_idempotency_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_offer_history
    ADD CONSTRAINT provider_offer_history_snapshot_idempotency_key UNIQUE (snapshot_at, idempotency_key);


--
-- Name: provider_offer_line_snapshots provider_offer_line_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_offer_line_snapshots
    ADD CONSTRAINT provider_offer_line_snapshots_pkey PRIMARY KEY (id);


--
-- Name: provider_offer_staging provider_offer_staging_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_offer_staging
    ADD CONSTRAINT provider_offer_staging_pkey PRIMARY KEY (id);


--
-- Name: provider_offers_legacy_quarantine provider_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_offers_legacy_quarantine
    ADD CONSTRAINT provider_offers_pkey PRIMARY KEY (id);


--
-- Name: raw_payloads raw_payloads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raw_payloads
    ADD CONSTRAINT raw_payloads_pkey PRIMARY KEY (id);


--
-- Name: selection_types selection_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_types
    ADD CONSTRAINT selection_types_pkey PRIMARY KEY (id);


--
-- Name: settlement_corrections settlement_corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_corrections
    ADD CONSTRAINT settlement_corrections_pkey PRIMARY KEY (id);


--
-- Name: settlement_records settlement_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_records
    ADD CONSTRAINT settlement_records_pkey PRIMARY KEY (id);


--
-- Name: sport_market_type_availability sport_market_type_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sport_market_type_availability
    ADD CONSTRAINT sport_market_type_availability_pkey PRIMARY KEY (sport_id, market_type_id);


--
-- Name: sports sports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sports
    ADD CONSTRAINT sports_pkey PRIMARY KEY (id);


--
-- Name: sportsbooks sportsbooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sportsbooks
    ADD CONSTRAINT sportsbooks_pkey PRIMARY KEY (id);


--
-- Name: stat_types stat_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stat_types
    ADD CONSTRAINT stat_types_pkey PRIMARY KEY (id);


--
-- Name: submission_events submission_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_events
    ADD CONSTRAINT submission_events_pkey PRIMARY KEY (id);


--
-- Name: submissions submissions_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_external_id_key UNIQUE (external_id);


--
-- Name: submissions submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_pkey PRIMARY KEY (id);


--
-- Name: syndicate_board syndicate_board_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.syndicate_board
    ADD CONSTRAINT syndicate_board_pkey PRIMARY KEY (id);


--
-- Name: system_runs system_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_runs
    ADD CONSTRAINT system_runs_pkey PRIMARY KEY (id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: combo_stat_types uq_combo_stat_types_sport_display; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_stat_types
    ADD CONSTRAINT uq_combo_stat_types_sport_display UNIQUE (sport_id, display_name);


--
-- Name: event_participants uq_event_participant; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_participants
    ADD CONSTRAINT uq_event_participant UNIQUE (event_id, participant_id);


--
-- Name: provider_book_aliases uq_provider_book_alias; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_book_aliases
    ADD CONSTRAINT uq_provider_book_alias UNIQUE (provider, provider_book_key);


--
-- Name: provider_entity_aliases uq_provider_entity_alias; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_entity_aliases
    ADD CONSTRAINT uq_provider_entity_alias UNIQUE (provider, entity_kind, provider_entity_key);


--
-- Name: provider_market_aliases uq_provider_market_alias; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_market_aliases
    ADD CONSTRAINT uq_provider_market_alias UNIQUE (provider, provider_market_key, sport_id);


--
-- Name: stat_types uq_sport_stat_type; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stat_types
    ADD CONSTRAINT uq_sport_stat_type UNIQUE (sport_id, name);


--
-- Name: teams uq_teams_league_display_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT uq_teams_league_display_name UNIQUE (league_id, display_name);


--
-- Name: teams uq_teams_league_short_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT uq_teams_league_short_name UNIQUE (league_id, short_name);


--
-- Name: alert_detections_cooldown_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX alert_detections_cooldown_idx ON public.alert_detections USING btree (event_id, market_key, bookmaker_key, tier, cooldown_expires_at) WHERE (notified = true);


--
-- Name: alert_detections_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX alert_detections_created_at_idx ON public.alert_detections USING btree (created_at DESC);


--
-- Name: alert_detections_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX alert_detections_event_id_idx ON public.alert_detections USING btree (event_id);


--
-- Name: alert_detections_event_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX alert_detections_event_market_idx ON public.alert_detections USING btree (event_id, market_key, bookmaker_key, tier, notified_at DESC);


--
-- Name: alert_detections_first_mover_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX alert_detections_first_mover_lookup_idx ON public.alert_detections USING btree (event_id, market_key, current_snapshot_at, created_at);


--
-- Name: alert_detections_steam_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX alert_detections_steam_lookup_idx ON public.alert_detections USING btree (event_id, market_key, direction, current_snapshot_at DESC, steam_detected);


--
-- Name: audit_log_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_created_at_idx ON public.audit_log USING btree (created_at DESC);


--
-- Name: audit_log_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_entity_idx ON public.audit_log USING btree (entity_type, entity_id);


--
-- Name: audit_log_entity_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_entity_ref_idx ON public.audit_log USING btree (entity_ref) WHERE (entity_ref IS NOT NULL);


--
-- Name: combo_stat_type_components_combo_stat_type_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX combo_stat_type_components_combo_stat_type_id_idx ON public.combo_stat_type_components USING btree (combo_stat_type_id);


--
-- Name: combo_stat_type_components_stat_type_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX combo_stat_type_components_stat_type_id_idx ON public.combo_stat_type_components USING btree (stat_type_id);


--
-- Name: combo_stat_types_sport_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX combo_stat_types_sport_id_idx ON public.combo_stat_types USING btree (sport_id);


--
-- Name: distribution_outbox_claimed_at_processing_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX distribution_outbox_claimed_at_processing_idx ON public.distribution_outbox USING btree (claimed_at) WHERE (status = 'processing'::text);


--
-- Name: distribution_outbox_idempotency_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX distribution_outbox_idempotency_key_idx ON public.distribution_outbox USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: distribution_outbox_pick_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX distribution_outbox_pick_id_idx ON public.distribution_outbox USING btree (pick_id);


--
-- Name: distribution_outbox_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX distribution_outbox_status_idx ON public.distribution_outbox USING btree (status);


--
-- Name: distribution_receipts_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX distribution_receipts_channel_idx ON public.distribution_receipts USING btree (channel) WHERE (channel IS NOT NULL);


--
-- Name: distribution_receipts_idempotency_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX distribution_receipts_idempotency_key_idx ON public.distribution_receipts USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: distribution_receipts_outbox_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX distribution_receipts_outbox_id_idx ON public.distribution_receipts USING btree (outbox_id);


--
-- Name: events_external_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX events_external_id_idx ON public.events USING btree (external_id) WHERE (external_id IS NOT NULL);


--
-- Name: events_sport_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_sport_id_idx ON public.events USING btree (sport_id);


--
-- Name: experiment_ledger_model_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX experiment_ledger_model_id_idx ON public.experiment_ledger USING btree (model_id);


--
-- Name: game_results_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_results_event_id_idx ON public.game_results USING btree (event_id);


--
-- Name: game_results_event_participant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_results_event_participant_idx ON public.game_results USING btree (event_id, participant_id, market_key);


--
-- Name: game_results_game_line_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX game_results_game_line_unique_idx ON public.game_results USING btree (event_id, market_key, source) WHERE (participant_id IS NULL);


--
-- Name: game_results_participant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_results_participant_id_idx ON public.game_results USING btree (participant_id);


--
-- Name: hedge_opportunities_cooldown_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hedge_opportunities_cooldown_idx ON public.hedge_opportunities USING btree (event_id, market_key, type, cooldown_expires_at) WHERE (notified = true);


--
-- Name: hedge_opportunities_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hedge_opportunities_event_id_idx ON public.hedge_opportunities USING btree (event_id);


--
-- Name: hedge_opportunities_event_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hedge_opportunities_event_market_idx ON public.hedge_opportunities USING btree (event_id, market_key, type, detected_at DESC);


--
-- Name: idx_cert_events_domain_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cert_events_domain_occurred ON public.certification_transition_events USING btree (program_id, domain, occurred_at DESC);


--
-- Name: idx_cert_records_predecessor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cert_records_predecessor ON public.certification_records USING btree (predecessor_id) WHERE (predecessor_id IS NOT NULL);


--
-- Name: idx_cert_records_program_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cert_records_program_domain ON public.certification_records USING btree (program_id, domain, created_at DESC);


--
-- Name: idx_cert_records_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cert_records_status ON public.certification_records USING btree (status) WHERE (status = ANY (ARRAY['active'::public.certification_status, 'suspended'::public.certification_status, 'pending'::public.certification_status]));


--
-- Name: idx_combo_stat_types_sport; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_combo_stat_types_sport ON public.combo_stat_types USING btree (sport_id, active, sort_order);


--
-- Name: idx_event_participants_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_participants_event ON public.event_participants USING btree (event_id);


--
-- Name: idx_event_participants_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_participants_participant ON public.event_participants USING btree (participant_id);


--
-- Name: idx_events_sport_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_sport_date ON public.events USING btree (sport_id, event_date);


--
-- Name: idx_execution_intents_decision_record_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_intents_decision_record_id ON public.execution_intents USING btree (decision_record_id);


--
-- Name: idx_execution_intents_pick_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_intents_pick_id ON public.execution_intents USING btree (pick_id, created_at DESC);


--
-- Name: idx_execution_intents_predecessor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_intents_predecessor_id ON public.execution_intents USING btree (predecessor_id) WHERE (predecessor_id IS NOT NULL);


--
-- Name: idx_execution_intents_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_execution_intents_status ON public.execution_intents USING btree (status) WHERE (status = ANY (ARRAY['pending'::text, 'dead_letter'::text]));


--
-- Name: idx_leagues_sport_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leagues_sport_id ON public.leagues USING btree (sport_id);


--
-- Name: idx_market_types_family; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_types_family ON public.market_types USING btree (market_family_id, sort_order);


--
-- Name: idx_market_universe_provider_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_universe_provider_event_id ON public.market_universe USING btree (provider_event_id);


--
-- Name: idx_model_health_snapshots_alerted_snapshot_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_model_health_snapshots_alerted_snapshot_at ON public.model_health_snapshots USING btree (alert_level, snapshot_at) WHERE (alert_level <> 'none'::text);


--
-- Name: idx_model_health_snapshots_model_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_model_health_snapshots_model_id ON public.model_health_snapshots USING btree (model_id);


--
-- Name: idx_model_health_snapshots_sport_market_family; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_model_health_snapshots_sport_market_family ON public.model_health_snapshots USING btree (sport, market_family);


--
-- Name: idx_odds_snapshots_prior_snapshot_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_odds_snapshots_prior_snapshot_id ON public.odds_snapshots USING btree (prior_snapshot_id) WHERE (prior_snapshot_id IS NOT NULL);


--
-- Name: idx_odds_snapshots_provider_league_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_odds_snapshots_provider_league_run ON public.odds_snapshots USING btree (provider_key, league, run_id);


--
-- Name: idx_odds_snapshots_raw_payload_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_odds_snapshots_raw_payload_id ON public.odds_snapshots USING btree (raw_payload_id) WHERE (raw_payload_id IS NOT NULL);


--
-- Name: idx_odds_snapshots_snapshot_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_odds_snapshots_snapshot_at ON public.odds_snapshots USING btree (snapshot_at DESC);


--
-- Name: idx_pick_candidates_board_rank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pick_candidates_board_rank ON public.pick_candidates USING btree (selection_rank) WHERE (is_board_candidate = true);


--
-- Name: idx_pick_candidates_sport_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pick_candidates_sport_key ON public.pick_candidates USING btree (sport_key);


--
-- Name: idx_picks_capper_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_picks_capper_id ON public.picks USING btree (capper_id);


--
-- Name: idx_picks_market_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_picks_market_type_id ON public.picks USING btree (market_type_id);


--
-- Name: idx_picks_sport_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_picks_sport_id ON public.picks USING btree (sport_id);


--
-- Name: idx_player_team_assignments_league_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_team_assignments_league_id ON public.player_team_assignments USING btree (league_id);


--
-- Name: idx_player_team_assignments_player_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_team_assignments_player_id ON public.player_team_assignments USING btree (player_id);


--
-- Name: idx_player_team_assignments_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_team_assignments_team_id ON public.player_team_assignments USING btree (team_id);


--
-- Name: idx_players_display_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_players_display_name ON public.players USING btree (display_name);


--
-- Name: idx_provider_book_aliases_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_book_aliases_lookup ON public.provider_book_aliases USING btree (provider, provider_book_key);


--
-- Name: idx_provider_entity_aliases_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_entity_aliases_lookup ON public.provider_entity_aliases USING btree (provider, entity_kind, provider_entity_key);


--
-- Name: idx_provider_market_aliases_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_market_aliases_lookup ON public.provider_market_aliases USING btree (provider, provider_market_key);


--
-- Name: idx_provider_offer_history_event_snapshot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_offer_history_event_snapshot ON ONLY public.provider_offer_history USING btree (provider_event_id, snapshot_at);


--
-- Name: idx_provider_offers_closing_recent_snapshot_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_offers_closing_recent_snapshot_desc ON public.provider_offers_legacy_quarantine USING btree (snapshot_at DESC) WHERE ((is_closing = true) AND (snapshot_at >= '2026-03-01 00:00:00+00'::timestamp with time zone));


--
-- Name: idx_provider_offers_closing_snapshot_brin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_offers_closing_snapshot_brin ON public.provider_offers_legacy_quarantine USING brin (snapshot_at) WHERE (is_closing = true);


--
-- Name: idx_provider_offers_closing_snapshot_id_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_offers_closing_snapshot_id_desc ON public.provider_offers_legacy_quarantine USING btree (snapshot_at DESC, id DESC) WHERE (is_closing = true);


--
-- Name: idx_provider_offers_is_closing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_offers_is_closing ON public.provider_offers_legacy_quarantine USING btree (is_closing);


--
-- Name: idx_provider_offers_snapshot_brin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_offers_snapshot_brin ON public.provider_offers_legacy_quarantine USING brin (snapshot_at) WITH (pages_per_range='128');


--
-- Name: idx_provider_offers_unclosed_event_snapshot_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_offers_unclosed_event_snapshot_desc ON public.provider_offers_legacy_quarantine USING btree (provider_event_id, snapshot_at DESC) WHERE (is_closing = false);


--
-- Name: idx_sport_market_type_availability_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sport_market_type_availability_active ON public.sport_market_type_availability USING btree (sport_id, active, sort_order);


--
-- Name: idx_stat_types_sport; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stat_types_sport ON public.stat_types USING btree (sport_id);


--
-- Name: idx_teams_league_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_league_id ON public.teams USING btree (league_id);


--
-- Name: market_family_trust_market_type_id_computed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_family_trust_market_type_id_computed_at_idx ON public.market_family_trust USING btree (market_type_id, computed_at DESC);


--
-- Name: market_family_trust_tuning_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_family_trust_tuning_run_id_idx ON public.market_family_trust USING btree (tuning_run_id);


--
-- Name: market_types_market_family_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_types_market_family_id_idx ON public.market_types USING btree (market_family_id);


--
-- Name: market_universe_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_universe_event_id ON public.market_universe USING btree (event_id) WHERE (event_id IS NOT NULL);


--
-- Name: market_universe_participant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_universe_participant_id_idx ON public.market_universe USING btree (participant_id) WHERE (participant_id IS NOT NULL);


--
-- Name: market_universe_participant_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_universe_participant_market ON public.market_universe USING btree (participant_id, market_type_id) WHERE (participant_id IS NOT NULL);


--
-- Name: market_universe_provider_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_universe_provider_event ON public.market_universe USING btree (provider_key, provider_event_id);


--
-- Name: market_universe_stale_refresh; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_universe_stale_refresh ON public.market_universe USING btree (is_stale, refreshed_at);


--
-- Name: member_tiers_discord_id_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_tiers_discord_id_active_idx ON public.member_tiers USING btree (discord_id) WHERE (effective_until IS NULL);


--
-- Name: member_tiers_discord_id_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_tiers_discord_id_created_idx ON public.member_tiers USING btree (discord_id, created_at);


--
-- Name: member_tiers_tier_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_tiers_tier_active_idx ON public.member_tiers USING btree (tier) WHERE (effective_until IS NULL);


--
-- Name: model_registry_active_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_registry_active_scope_idx ON public.model_registry USING btree (active_state, sport, market_family) WHERE (active_state IS NOT NULL);


--
-- Name: model_registry_entity_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_registry_entity_scope_idx ON public.model_registry USING btree (registry_entity_type, sport, market_family);


--
-- Name: model_registry_source_type_compatibility_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_registry_source_type_compatibility_idx ON public.model_registry USING gin (source_type_compatibility);


--
-- Name: model_registry_sport_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_registry_sport_market_idx ON public.model_registry USING btree (sport, market_family);


--
-- Name: model_registry_unique_champion_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX model_registry_unique_champion_idx ON public.model_registry USING btree (sport, market_family) WHERE (status = 'champion'::text);


--
-- Name: participants_external_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX participants_external_id_idx ON public.participants USING btree (external_id) WHERE (external_id IS NOT NULL);


--
-- Name: pick_candidates_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pick_candidates_expires ON public.pick_candidates USING btree (expires_at) WHERE (expires_at IS NOT NULL);


--
-- Name: pick_candidates_model_registry_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pick_candidates_model_registry_id_idx ON public.pick_candidates USING btree (model_registry_id) WHERE (model_registry_id IS NOT NULL);


--
-- Name: pick_candidates_ownership_timestamp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pick_candidates_ownership_timestamp_idx ON public.pick_candidates USING btree (ownership_timestamp) WHERE (ownership_timestamp IS NOT NULL);


--
-- Name: pick_candidates_pick_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pick_candidates_pick_id ON public.pick_candidates USING btree (pick_id) WHERE (pick_id IS NOT NULL);


--
-- Name: pick_candidates_pick_ownership_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pick_candidates_pick_ownership_idx ON public.pick_candidates USING btree (pick_id, model_registry_id) WHERE (pick_id IS NOT NULL);


--
-- Name: pick_candidates_scoring_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pick_candidates_scoring_run_id_idx ON public.pick_candidates USING btree (scoring_run_id) WHERE (scoring_run_id IS NOT NULL);


--
-- Name: pick_candidates_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pick_candidates_status ON public.pick_candidates USING btree (status);


--
-- Name: pick_candidates_universe_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pick_candidates_universe_id ON public.pick_candidates USING btree (universe_id);


--
-- Name: pick_lifecycle_pick_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pick_lifecycle_pick_id_idx ON public.pick_lifecycle USING btree (pick_id);


--
-- Name: pick_lifecycle_pick_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pick_lifecycle_pick_state_idx ON public.pick_lifecycle USING btree (pick_id, to_state);


--
-- Name: pick_offer_snapshots_event_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pick_offer_snapshots_event_market_idx ON public.pick_offer_snapshots USING btree (provider_event_id, provider_market_key, provider_participant_id, bookmaker_key);


--
-- Name: pick_offer_snapshots_pick_captured_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pick_offer_snapshots_pick_captured_idx ON public.pick_offer_snapshots USING btree (pick_id, captured_at DESC);


--
-- Name: pick_offer_snapshots_pick_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pick_offer_snapshots_pick_kind_idx ON public.pick_offer_snapshots USING btree (pick_id, snapshot_kind);


--
-- Name: pick_promotion_history_pick_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pick_promotion_history_pick_id_idx ON public.pick_promotion_history USING btree (pick_id, created_at DESC);


--
-- Name: pick_promotion_history_target_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pick_promotion_history_target_status_idx ON public.pick_promotion_history USING btree (target, status, decided_at DESC);


--
-- Name: pick_reviews_decided_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pick_reviews_decided_at_idx ON public.pick_reviews USING btree (decided_at DESC);


--
-- Name: pick_reviews_decision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pick_reviews_decision_idx ON public.pick_reviews USING btree (decision);


--
-- Name: pick_reviews_pick_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pick_reviews_pick_id_idx ON public.pick_reviews USING btree (pick_id);


--
-- Name: picks_awaiting_approval_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX picks_awaiting_approval_created_at_idx ON public.picks USING btree (created_at) WHERE (status = 'awaiting_approval'::text);


--
-- Name: picks_idempotency_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX picks_idempotency_key_idx ON public.picks USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: picks_promotion_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX picks_promotion_status_idx ON public.picks USING btree (promotion_status);


--
-- Name: picks_promotion_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX picks_promotion_target_idx ON public.picks USING btree (promotion_target) WHERE (promotion_target IS NOT NULL);


--
-- Name: picks_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX picks_status_idx ON public.picks USING btree (status);


--
-- Name: picks_submission_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX picks_submission_id_idx ON public.picks USING btree (submission_id);


--
-- Name: provider_cycle_status_failure_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_cycle_status_failure_category_idx ON public.provider_cycle_status USING btree (failure_category, updated_at DESC) WHERE (failure_category IS NOT NULL);


--
-- Name: provider_cycle_status_failure_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_cycle_status_failure_scope_idx ON public.provider_cycle_status USING btree (failure_scope, updated_at DESC) WHERE (failure_scope IS NOT NULL);


--
-- Name: provider_cycle_status_provider_snapshot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_cycle_status_provider_snapshot_idx ON public.provider_cycle_status USING btree (provider_key, league, cycle_snapshot_at DESC);


--
-- Name: provider_market_aliases_sport_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_market_aliases_sport_id_idx ON public.provider_market_aliases USING btree (sport_id);


--
-- Name: provider_offer_current_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX provider_offer_current_id_idx ON public.provider_offer_current USING btree (id);


--
-- Name: provider_offer_current_opening_scan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offer_current_opening_scan_idx ON public.provider_offer_current USING btree (provider_key, snapshot_at DESC, provider_market_key, provider_participant_id, bookmaker_key) WHERE ((is_opening = true) AND (over_odds IS NOT NULL) AND (under_odds IS NOT NULL) AND (line IS NOT NULL) AND (provider_participant_id IS NOT NULL));


--
-- Name: provider_offer_current_provider_snapshot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offer_current_provider_snapshot_idx ON public.provider_offer_current USING btree (provider_key, snapshot_at DESC);


--
-- Name: provider_offer_current_snapshot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offer_current_snapshot_idx ON public.provider_offer_current USING btree (snapshot_at DESC);


--
-- Name: provider_offer_history_compact_closing_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offer_history_compact_closing_idx ON public.provider_offer_history_compact USING btree (provider_key, snapshot_at DESC) WHERE (is_closing = true);


--
-- Name: provider_offer_history_compact_event_market_snapshot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offer_history_compact_event_market_snapshot_idx ON public.provider_offer_history_compact USING btree (provider_event_id, provider_market_key, provider_participant_id, bookmaker_key, snapshot_at DESC);


--
-- Name: provider_offer_history_compact_identity_snapshot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offer_history_compact_identity_snapshot_idx ON public.provider_offer_history_compact USING btree (identity_key, snapshot_at DESC);


--
-- Name: provider_offer_history_compact_opening_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offer_history_compact_opening_idx ON public.provider_offer_history_compact USING btree (provider_key, snapshot_at DESC) WHERE (is_opening = true);


--
-- Name: provider_offer_history_compact_snapshot_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX provider_offer_history_compact_snapshot_idempotency_idx ON public.provider_offer_history_compact USING btree (snapshot_at, idempotency_key);


--
-- Name: provider_offer_line_snapshots_bk_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX provider_offer_line_snapshots_bk_idx ON public.provider_offer_line_snapshots USING btree (provider_key, provider_event_id, provider_market_key, COALESCE(provider_participant_id, ''::text), COALESCE(bookmaker_key, ''::text), snapshot_date);


--
-- Name: provider_offer_line_snapshots_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offer_line_snapshots_date_idx ON public.provider_offer_line_snapshots USING btree (snapshot_date DESC);


--
-- Name: provider_offer_line_snapshots_provider_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offer_line_snapshots_provider_date_idx ON public.provider_offer_line_snapshots USING btree (provider_key, snapshot_date DESC);


--
-- Name: provider_offer_staging_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offer_staging_identity_idx ON public.provider_offer_staging USING btree (identity_key, snapshot_at DESC);


--
-- Name: provider_offer_staging_run_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX provider_offer_staging_run_idempotency_idx ON public.provider_offer_staging USING btree (run_id, idempotency_key);


--
-- Name: provider_offer_staging_run_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offer_staging_run_status_idx ON public.provider_offer_staging USING btree (run_id, merge_status, created_at);


--
-- Name: provider_offers_bookmaker_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offers_bookmaker_key_idx ON public.provider_offers_legacy_quarantine USING btree (provider_key, provider_event_id, bookmaker_key) WHERE (bookmaker_key IS NOT NULL);


--
-- Name: provider_offers_clv_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offers_clv_lookup_idx ON public.provider_offers_legacy_quarantine USING btree (provider_event_id, provider_market_key, provider_participant_id, snapshot_at DESC);


--
-- Name: provider_offers_current_identity_snapshot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offers_current_identity_snapshot_idx ON public.provider_offers_legacy_quarantine USING btree (provider_key, provider_event_id, provider_market_key, COALESCE(provider_participant_id, ''::text), COALESCE(bookmaker_key, ''::text), snapshot_at DESC, created_at DESC, id DESC);


--
-- Name: provider_offers_idempotency_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX provider_offers_idempotency_key_idx ON public.provider_offers_legacy_quarantine USING btree (idempotency_key);


--
-- Name: provider_offers_legacy_quarantine_created_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offers_legacy_quarantine_created_at_id_idx ON public.provider_offers_legacy_quarantine USING btree (created_at, id);


--
-- Name: provider_offers_opening_scan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offers_opening_scan_idx ON public.provider_offers_legacy_quarantine USING btree (provider_key, snapshot_at DESC) WHERE ((is_opening = true) AND (over_odds IS NOT NULL) AND (under_odds IS NOT NULL) AND (line IS NOT NULL) AND (provider_participant_id IS NOT NULL));


--
-- Name: provider_offers_provider_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offers_provider_event_idx ON public.provider_offers_legacy_quarantine USING btree (provider_key, provider_event_id);


--
-- Name: provider_offers_provider_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offers_provider_key_idx ON public.provider_offers_legacy_quarantine USING btree (provider_key);


--
-- Name: provider_offers_snapshot_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_offers_snapshot_at_idx ON public.provider_offers_legacy_quarantine USING btree (snapshot_at DESC);


--
-- Name: raw_payloads_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX raw_payloads_hash_idx ON public.raw_payloads USING btree (payload_hash);


--
-- Name: raw_payloads_provider_league_snapshot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX raw_payloads_provider_league_snapshot_idx ON public.raw_payloads USING btree (provider_key, league, snapshot_at DESC);


--
-- Name: raw_payloads_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX raw_payloads_run_id_idx ON public.raw_payloads USING btree (run_id);


--
-- Name: settlement_corrections_record_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX settlement_corrections_record_idx ON public.settlement_corrections USING btree (settlement_record_id);


--
-- Name: settlement_records_corrects_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX settlement_records_corrects_id_idx ON public.settlement_records USING btree (corrects_id) WHERE (corrects_id IS NOT NULL);


--
-- Name: settlement_records_pick_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX settlement_records_pick_created_idx ON public.settlement_records USING btree (pick_id, created_at DESC);


--
-- Name: settlement_records_pick_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX settlement_records_pick_id_idx ON public.settlement_records USING btree (pick_id);


--
-- Name: settlement_records_pick_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX settlement_records_pick_source_idx ON public.settlement_records USING btree (pick_id, source) WHERE (corrects_id IS NULL);


--
-- Name: settlement_records_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX settlement_records_status_idx ON public.settlement_records USING btree (status);


--
-- Name: sport_market_type_availability_market_type_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sport_market_type_availability_market_type_id_idx ON public.sport_market_type_availability USING btree (market_type_id);


--
-- Name: sport_market_type_availability_sport_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sport_market_type_availability_sport_id_idx ON public.sport_market_type_availability USING btree (sport_id);


--
-- Name: submission_events_submission_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX submission_events_submission_id_idx ON public.submission_events USING btree (submission_id);


--
-- Name: submissions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX submissions_status_idx ON public.submissions USING btree (status);


--
-- Name: syndicate_board_board_run_id_board_rank_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX syndicate_board_board_run_id_board_rank_idx ON public.syndicate_board USING btree (board_run_id, board_rank);


--
-- Name: syndicate_board_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX syndicate_board_created_at_idx ON public.syndicate_board USING btree (created_at DESC);


--
-- Name: system_runs_heartbeat_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_runs_heartbeat_recent_idx ON public.system_runs USING btree (started_at DESC) WHERE ((run_type = 'worker.heartbeat'::text) AND (started_at > '2026-04-25 00:00:00+00'::timestamp with time zone));


--
-- Name: system_runs_idempotency_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX system_runs_idempotency_key_idx ON public.system_runs USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: system_runs_run_type_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_runs_run_type_started_at_idx ON public.system_runs USING btree (run_type, started_at DESC);


--
-- Name: system_runs_run_type_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_runs_run_type_status_idx ON public.system_runs USING btree (run_type, status);


--
-- Name: system_runs_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_runs_status_idx ON public.system_runs USING btree (status);


--
-- Name: uidx_execution_intents_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uidx_execution_intents_idempotency_key ON public.execution_intents USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: uq_player_team_assignments_current; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_player_team_assignments_current ON public.player_team_assignments USING btree (player_id) WHERE (is_current = true);


--
-- Name: uq_stat_types_sport_canonical_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_stat_types_sport_canonical_key ON public.stat_types USING btree (sport_id, canonical_key);


--
-- Name: certification_transition_events cert_events_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cert_events_no_delete BEFORE DELETE ON public.certification_transition_events FOR EACH ROW EXECUTE FUNCTION public.certification_transition_events_immutable();


--
-- Name: certification_transition_events cert_events_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cert_events_no_update BEFORE UPDATE ON public.certification_transition_events FOR EACH ROW EXECUTE FUNCTION public.certification_transition_events_immutable();


--
-- Name: certification_records certification_records_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER certification_records_no_delete BEFORE DELETE ON public.certification_records FOR EACH ROW EXECUTE FUNCTION public.certification_records_immutable();


--
-- Name: certification_records certification_records_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER certification_records_no_update BEFORE UPDATE ON public.certification_records FOR EACH ROW EXECUTE FUNCTION public.certification_records_immutable();


--
-- Name: distribution_outbox distribution_outbox_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER distribution_outbox_set_updated_at BEFORE UPDATE ON public.distribution_outbox FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: execution_intents execution_intents_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER execution_intents_no_delete BEFORE DELETE ON public.execution_intents FOR EACH ROW EXECUTE FUNCTION public.execution_intents_immutable();


--
-- Name: execution_intents execution_intents_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER execution_intents_no_update BEFORE UPDATE ON public.execution_intents FOR EACH ROW EXECUTE FUNCTION public.execution_intents_immutable();


--
-- Name: audit_log guard_audit_log_immutability; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_audit_log_immutability BEFORE DELETE OR UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.reject_audit_log_mutation();


--
-- Name: leagues leagues_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER leagues_set_updated_at BEFORE UPDATE ON public.leagues FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: participant_memberships participant_memberships_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER participant_memberships_set_updated_at BEFORE UPDATE ON public.participant_memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: participants participants_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER participants_set_updated_at BEFORE UPDATE ON public.participants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: picks picks_fsm_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER picks_fsm_guard BEFORE UPDATE ON public.picks FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION public.picks_fsm_transition_guard();


--
-- Name: TRIGGER picks_fsm_guard ON picks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER picks_fsm_guard ON public.picks IS 'DB-level FSM guard (UTV2-1107). Fires only when status changes. Raises SQLSTATE P0001 / FSM_PICK_TRANSITION_REJECTED on invalid transitions.';


--
-- Name: picks picks_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER picks_set_updated_at BEFORE UPDATE ON public.picks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: player_team_assignments player_team_assignments_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER player_team_assignments_set_updated_at BEFORE UPDATE ON public.player_team_assignments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: players players_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER players_set_updated_at BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: raw_payloads raw_payloads_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER raw_payloads_no_delete BEFORE DELETE ON public.raw_payloads FOR EACH ROW EXECUTE FUNCTION public.raw_payloads_immutable();


--
-- Name: raw_payloads raw_payloads_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER raw_payloads_no_update BEFORE UPDATE ON public.raw_payloads FOR EACH ROW EXECUTE FUNCTION public.raw_payloads_immutable();


--
-- Name: combo_stat_types set_combo_stat_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_combo_stat_types_updated_at BEFORE UPDATE ON public.combo_stat_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: market_families set_market_families_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_market_families_updated_at BEFORE UPDATE ON public.market_families FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: market_types set_market_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_market_types_updated_at BEFORE UPDATE ON public.market_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: provider_book_aliases set_provider_book_aliases_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_provider_book_aliases_updated_at BEFORE UPDATE ON public.provider_book_aliases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: provider_entity_aliases set_provider_entity_aliases_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_provider_entity_aliases_updated_at BEFORE UPDATE ON public.provider_entity_aliases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: provider_market_aliases set_provider_market_aliases_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_provider_market_aliases_updated_at BEFORE UPDATE ON public.provider_market_aliases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: selection_types set_selection_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_selection_types_updated_at BEFORE UPDATE ON public.selection_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sport_market_type_availability set_sport_market_type_availability_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_sport_market_type_availability_updated_at BEFORE UPDATE ON public.sport_market_type_availability FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: submissions submissions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER submissions_set_updated_at BEFORE UPDATE ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: system_runs system_runs_set_finished_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER system_runs_set_finished_at BEFORE UPDATE ON public.system_runs FOR EACH ROW EXECUTE FUNCTION public.set_system_run_finished_at();


--
-- Name: teams teams_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER teams_set_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: model_registry trg_model_registry_artifact_sha_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_model_registry_artifact_sha_immutable BEFORE UPDATE ON public.model_registry FOR EACH ROW EXECUTE FUNCTION public.model_registry_artifact_sha_immutable();


--
-- Name: odds_snapshots trg_odds_snapshots_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_odds_snapshots_immutable BEFORE DELETE OR UPDATE ON public.odds_snapshots FOR EACH ROW EXECUTE FUNCTION public.odds_snapshots_immutable();


--
-- Name: provider_cycle_status trg_provider_cycle_status_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_provider_cycle_status_updated_at BEFORE UPDATE ON public.provider_cycle_status FOR EACH ROW EXECUTE FUNCTION public.set_provider_cycle_status_updated_at();


--
-- Name: settlement_corrections trg_settlement_corrections_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_settlement_corrections_validate BEFORE INSERT ON public.settlement_corrections FOR EACH ROW EXECUTE FUNCTION public.settlement_corrections_validate();


--
-- Name: settlement_records trg_settlement_records_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_settlement_records_immutable BEFORE DELETE OR UPDATE ON public.settlement_records FOR EACH ROW EXECUTE FUNCTION public.settlement_records_immutable();


--
-- Name: settlement_records trg_settlement_records_stake_units; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_settlement_records_stake_units BEFORE INSERT ON public.settlement_records FOR EACH ROW EXECUTE FUNCTION public.settlement_records_populate_stake_units();


--
-- Name: alert_detections alert_detections_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_detections
    ADD CONSTRAINT alert_detections_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);


--
-- Name: certification_records certification_records_predecessor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certification_records
    ADD CONSTRAINT certification_records_predecessor_id_fkey FOREIGN KEY (predecessor_id) REFERENCES public.certification_records(id);


--
-- Name: certification_transition_events certification_transition_events_cert_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certification_transition_events
    ADD CONSTRAINT certification_transition_events_cert_record_id_fkey FOREIGN KEY (cert_record_id) REFERENCES public.certification_records(id);


--
-- Name: combo_stat_type_components combo_stat_type_components_combo_stat_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_stat_type_components
    ADD CONSTRAINT combo_stat_type_components_combo_stat_type_id_fkey FOREIGN KEY (combo_stat_type_id) REFERENCES public.combo_stat_types(id) ON DELETE CASCADE;


--
-- Name: combo_stat_type_components combo_stat_type_components_stat_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_stat_type_components
    ADD CONSTRAINT combo_stat_type_components_stat_type_id_fkey FOREIGN KEY (stat_type_id) REFERENCES public.stat_types(id) ON DELETE CASCADE;


--
-- Name: combo_stat_types combo_stat_types_market_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_stat_types
    ADD CONSTRAINT combo_stat_types_market_type_id_fkey FOREIGN KEY (market_type_id) REFERENCES public.market_types(id) ON DELETE RESTRICT;


--
-- Name: combo_stat_types combo_stat_types_sport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_stat_types
    ADD CONSTRAINT combo_stat_types_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES public.sports(id) ON DELETE CASCADE;


--
-- Name: distribution_outbox distribution_outbox_pick_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distribution_outbox
    ADD CONSTRAINT distribution_outbox_pick_id_fkey FOREIGN KEY (pick_id) REFERENCES public.picks(id) ON DELETE CASCADE;


--
-- Name: distribution_receipts distribution_receipts_outbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distribution_receipts
    ADD CONSTRAINT distribution_receipts_outbox_id_fkey FOREIGN KEY (outbox_id) REFERENCES public.distribution_outbox(id) ON DELETE CASCADE;


--
-- Name: event_participants event_participants_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_participants
    ADD CONSTRAINT event_participants_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_participants event_participants_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_participants
    ADD CONSTRAINT event_participants_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: events events_sport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES public.sports(id) ON DELETE CASCADE;


--
-- Name: execution_intents execution_intents_predecessor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_intents
    ADD CONSTRAINT execution_intents_predecessor_id_fkey FOREIGN KEY (predecessor_id) REFERENCES public.execution_intents(id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: experiment_ledger experiment_ledger_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiment_ledger
    ADD CONSTRAINT experiment_ledger_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.model_registry(id);


--
-- Name: game_results game_results_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_results
    ADD CONSTRAINT game_results_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);


--
-- Name: game_results game_results_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_results
    ADD CONSTRAINT game_results_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id);


--
-- Name: hedge_opportunities hedge_opportunities_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hedge_opportunities
    ADD CONSTRAINT hedge_opportunities_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);


--
-- Name: hedge_opportunities hedge_opportunities_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hedge_opportunities
    ADD CONSTRAINT hedge_opportunities_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id);


--
-- Name: leagues leagues_sport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES public.sports(id) ON DELETE RESTRICT;


--
-- Name: market_types market_types_market_family_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_types
    ADD CONSTRAINT market_types_market_family_id_fkey FOREIGN KEY (market_family_id) REFERENCES public.market_families(id) ON DELETE RESTRICT;


--
-- Name: market_types market_types_selection_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_types
    ADD CONSTRAINT market_types_selection_type_id_fkey FOREIGN KEY (selection_type_id) REFERENCES public.selection_types(id) ON DELETE RESTRICT;


--
-- Name: market_universe market_universe_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_universe
    ADD CONSTRAINT market_universe_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);


--
-- Name: market_universe market_universe_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_universe
    ADD CONSTRAINT market_universe_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id);


--
-- Name: model_health_snapshots model_health_snapshots_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_health_snapshots
    ADD CONSTRAINT model_health_snapshots_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.model_registry(id);


--
-- Name: odds_snapshot_corrections odds_snapshot_corrections_new_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.odds_snapshot_corrections
    ADD CONSTRAINT odds_snapshot_corrections_new_snapshot_id_fkey FOREIGN KEY (new_snapshot_id) REFERENCES public.odds_snapshots(id);


--
-- Name: odds_snapshot_corrections odds_snapshot_corrections_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.odds_snapshot_corrections
    ADD CONSTRAINT odds_snapshot_corrections_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.odds_snapshots(id);


--
-- Name: odds_snapshots odds_snapshots_prior_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.odds_snapshots
    ADD CONSTRAINT odds_snapshots_prior_snapshot_id_fkey FOREIGN KEY (prior_snapshot_id) REFERENCES public.odds_snapshots(id);


--
-- Name: odds_snapshots odds_snapshots_raw_payload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.odds_snapshots
    ADD CONSTRAINT odds_snapshots_raw_payload_id_fkey FOREIGN KEY (raw_payload_id) REFERENCES public.raw_payloads(id);


--
-- Name: participant_memberships participant_memberships_parent_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_memberships
    ADD CONSTRAINT participant_memberships_parent_participant_id_fkey FOREIGN KEY (parent_participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: participant_memberships participant_memberships_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participant_memberships
    ADD CONSTRAINT participant_memberships_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: pick_candidates pick_candidates_model_registry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_candidates
    ADD CONSTRAINT pick_candidates_model_registry_id_fkey FOREIGN KEY (model_registry_id) REFERENCES public.model_registry(id);


--
-- Name: pick_candidates pick_candidates_scoring_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_candidates
    ADD CONSTRAINT pick_candidates_scoring_run_id_fkey FOREIGN KEY (scoring_run_id) REFERENCES public.system_runs(id);


--
-- Name: pick_candidates pick_candidates_universe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_candidates
    ADD CONSTRAINT pick_candidates_universe_id_fkey FOREIGN KEY (universe_id) REFERENCES public.market_universe(id);


--
-- Name: pick_lifecycle pick_lifecycle_pick_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_lifecycle
    ADD CONSTRAINT pick_lifecycle_pick_id_fkey FOREIGN KEY (pick_id) REFERENCES public.picks(id) ON DELETE CASCADE;


--
-- Name: pick_offer_snapshots pick_offer_snapshots_pick_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_offer_snapshots
    ADD CONSTRAINT pick_offer_snapshots_pick_id_fkey FOREIGN KEY (pick_id) REFERENCES public.picks(id) ON DELETE CASCADE;


--
-- Name: pick_offer_snapshots pick_offer_snapshots_provider_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_offer_snapshots
    ADD CONSTRAINT pick_offer_snapshots_provider_key_fkey FOREIGN KEY (provider_key) REFERENCES public.sportsbooks(id);


--
-- Name: pick_offer_snapshots pick_offer_snapshots_settlement_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_offer_snapshots
    ADD CONSTRAINT pick_offer_snapshots_settlement_record_id_fkey FOREIGN KEY (settlement_record_id) REFERENCES public.settlement_records(id) ON DELETE SET NULL;


--
-- Name: pick_offer_snapshots pick_offer_snapshots_source_compact_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_offer_snapshots
    ADD CONSTRAINT pick_offer_snapshots_source_compact_snapshot_id_fkey FOREIGN KEY (source_compact_snapshot_id) REFERENCES public.provider_offer_history_compact(snapshot_id) ON DELETE SET NULL;


--
-- Name: pick_offer_snapshots pick_offer_snapshots_source_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_offer_snapshots
    ADD CONSTRAINT pick_offer_snapshots_source_run_id_fkey FOREIGN KEY (source_run_id) REFERENCES public.system_runs(id) ON DELETE SET NULL;


--
-- Name: pick_promotion_history pick_promotion_history_pick_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_promotion_history
    ADD CONSTRAINT pick_promotion_history_pick_id_fkey FOREIGN KEY (pick_id) REFERENCES public.picks(id) ON DELETE CASCADE;


--
-- Name: pick_reviews pick_reviews_pick_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pick_reviews
    ADD CONSTRAINT pick_reviews_pick_id_fkey FOREIGN KEY (pick_id) REFERENCES public.picks(id);


--
-- Name: picks picks_capper_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picks
    ADD CONSTRAINT picks_capper_id_fkey FOREIGN KEY (capper_id) REFERENCES public.cappers(id) ON DELETE SET NULL;


--
-- Name: picks picks_market_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picks
    ADD CONSTRAINT picks_market_type_id_fkey FOREIGN KEY (market_type_id) REFERENCES public.market_types(id) ON DELETE SET NULL;


--
-- Name: picks picks_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picks
    ADD CONSTRAINT picks_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE SET NULL;


--
-- Name: picks picks_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picks
    ADD CONSTRAINT picks_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: picks picks_sport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picks
    ADD CONSTRAINT picks_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES public.sports(id) ON DELETE SET NULL;


--
-- Name: picks picks_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picks
    ADD CONSTRAINT picks_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id) ON DELETE SET NULL;


--
-- Name: player_team_assignments player_team_assignments_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_team_assignments
    ADD CONSTRAINT player_team_assignments_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE RESTRICT;


--
-- Name: player_team_assignments player_team_assignments_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_team_assignments
    ADD CONSTRAINT player_team_assignments_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;


--
-- Name: player_team_assignments player_team_assignments_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_team_assignments
    ADD CONSTRAINT player_team_assignments_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: provider_book_aliases provider_book_aliases_sportsbook_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_book_aliases
    ADD CONSTRAINT provider_book_aliases_sportsbook_id_fkey FOREIGN KEY (sportsbook_id) REFERENCES public.sportsbooks(id) ON DELETE CASCADE;


--
-- Name: provider_cycle_status provider_cycle_status_provider_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_cycle_status
    ADD CONSTRAINT provider_cycle_status_provider_key_fkey FOREIGN KEY (provider_key) REFERENCES public.sportsbooks(id);


--
-- Name: provider_cycle_status provider_cycle_status_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_cycle_status
    ADD CONSTRAINT provider_cycle_status_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.system_runs(id) ON DELETE CASCADE;


--
-- Name: provider_entity_aliases provider_entity_aliases_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_entity_aliases
    ADD CONSTRAINT provider_entity_aliases_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: provider_entity_aliases provider_entity_aliases_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_entity_aliases
    ADD CONSTRAINT provider_entity_aliases_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;


--
-- Name: provider_entity_aliases provider_entity_aliases_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_entity_aliases
    ADD CONSTRAINT provider_entity_aliases_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: provider_market_aliases provider_market_aliases_combo_stat_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_market_aliases
    ADD CONSTRAINT provider_market_aliases_combo_stat_type_id_fkey FOREIGN KEY (combo_stat_type_id) REFERENCES public.combo_stat_types(id) ON DELETE SET NULL;


--
-- Name: provider_market_aliases provider_market_aliases_market_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_market_aliases
    ADD CONSTRAINT provider_market_aliases_market_type_id_fkey FOREIGN KEY (market_type_id) REFERENCES public.market_types(id) ON DELETE CASCADE;


--
-- Name: provider_market_aliases provider_market_aliases_sport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_market_aliases
    ADD CONSTRAINT provider_market_aliases_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES public.sports(id) ON DELETE CASCADE;


--
-- Name: provider_market_aliases provider_market_aliases_stat_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_market_aliases
    ADD CONSTRAINT provider_market_aliases_stat_type_id_fkey FOREIGN KEY (stat_type_id) REFERENCES public.stat_types(id) ON DELETE SET NULL;


--
-- Name: provider_offer_current provider_offer_current_provider_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_offer_current
    ADD CONSTRAINT provider_offer_current_provider_key_fkey FOREIGN KEY (provider_key) REFERENCES public.sportsbooks(id);


--
-- Name: provider_offer_current provider_offer_current_source_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_offer_current
    ADD CONSTRAINT provider_offer_current_source_run_id_fkey FOREIGN KEY (source_run_id) REFERENCES public.system_runs(id) ON DELETE SET NULL;


--
-- Name: provider_offer_history_compact provider_offer_history_compact_previous_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_offer_history_compact
    ADD CONSTRAINT provider_offer_history_compact_previous_snapshot_id_fkey FOREIGN KEY (previous_snapshot_id) REFERENCES public.provider_offer_history_compact(snapshot_id) ON DELETE SET NULL;


--
-- Name: provider_offer_history_compact provider_offer_history_compact_provider_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_offer_history_compact
    ADD CONSTRAINT provider_offer_history_compact_provider_key_fkey FOREIGN KEY (provider_key) REFERENCES public.sportsbooks(id);


--
-- Name: provider_offer_history_compact provider_offer_history_compact_source_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_offer_history_compact
    ADD CONSTRAINT provider_offer_history_compact_source_run_id_fkey FOREIGN KEY (source_run_id) REFERENCES public.system_runs(id) ON DELETE SET NULL;


--
-- Name: provider_offer_history provider_offer_history_provider_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.provider_offer_history
    ADD CONSTRAINT provider_offer_history_provider_key_fkey FOREIGN KEY (provider_key) REFERENCES public.sportsbooks(id);


--
-- Name: provider_offer_history provider_offer_history_source_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.provider_offer_history
    ADD CONSTRAINT provider_offer_history_source_run_id_fkey FOREIGN KEY (source_run_id) REFERENCES public.system_runs(id) ON DELETE SET NULL;


--
-- Name: provider_offer_line_snapshots provider_offer_line_snapshots_provider_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_offer_line_snapshots
    ADD CONSTRAINT provider_offer_line_snapshots_provider_key_fkey FOREIGN KEY (provider_key) REFERENCES public.sportsbooks(id);


--
-- Name: provider_offer_staging provider_offer_staging_provider_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_offer_staging
    ADD CONSTRAINT provider_offer_staging_provider_key_fkey FOREIGN KEY (provider_key) REFERENCES public.sportsbooks(id);


--
-- Name: provider_offer_staging provider_offer_staging_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_offer_staging
    ADD CONSTRAINT provider_offer_staging_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.system_runs(id) ON DELETE CASCADE;


--
-- Name: provider_offers_legacy_quarantine provider_offers_provider_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_offers_legacy_quarantine
    ADD CONSTRAINT provider_offers_provider_key_fkey FOREIGN KEY (provider_key) REFERENCES public.sportsbooks(id);


--
-- Name: settlement_corrections settlement_corrections_prior_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_corrections
    ADD CONSTRAINT settlement_corrections_prior_record_id_fkey FOREIGN KEY (prior_record_id) REFERENCES public.settlement_records(id);


--
-- Name: settlement_corrections settlement_corrections_settlement_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_corrections
    ADD CONSTRAINT settlement_corrections_settlement_record_id_fkey FOREIGN KEY (settlement_record_id) REFERENCES public.settlement_records(id);


--
-- Name: settlement_records settlement_records_corrects_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_records
    ADD CONSTRAINT settlement_records_corrects_id_fkey FOREIGN KEY (corrects_id) REFERENCES public.settlement_records(id) ON DELETE RESTRICT;


--
-- Name: settlement_records settlement_records_pick_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_records
    ADD CONSTRAINT settlement_records_pick_id_fkey FOREIGN KEY (pick_id) REFERENCES public.picks(id) ON DELETE CASCADE;


--
-- Name: sport_market_type_availability sport_market_type_availability_market_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sport_market_type_availability
    ADD CONSTRAINT sport_market_type_availability_market_type_id_fkey FOREIGN KEY (market_type_id) REFERENCES public.market_types(id) ON DELETE CASCADE;


--
-- Name: sport_market_type_availability sport_market_type_availability_sport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sport_market_type_availability
    ADD CONSTRAINT sport_market_type_availability_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES public.sports(id) ON DELETE CASCADE;


--
-- Name: stat_types stat_types_sport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stat_types
    ADD CONSTRAINT stat_types_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES public.sports(id) ON DELETE CASCADE;


--
-- Name: submission_events submission_events_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_events
    ADD CONSTRAINT submission_events_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id) ON DELETE CASCADE;


--
-- Name: syndicate_board syndicate_board_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.syndicate_board
    ADD CONSTRAINT syndicate_board_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.pick_candidates(id);


--
-- Name: teams teams_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE RESTRICT;


--
-- Name: alert_detections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.alert_detections ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: cappers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cappers ENABLE ROW LEVEL SECURITY;

--
-- Name: certification_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.certification_records ENABLE ROW LEVEL SECURITY;

--
-- Name: certification_transition_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.certification_transition_events ENABLE ROW LEVEL SECURITY;

--
-- Name: combo_stat_type_components; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.combo_stat_type_components ENABLE ROW LEVEL SECURITY;

--
-- Name: combo_stat_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.combo_stat_types ENABLE ROW LEVEL SECURITY;

--
-- Name: distribution_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.distribution_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: distribution_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.distribution_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: event_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: execution_intents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.execution_intents ENABLE ROW LEVEL SECURITY;

--
-- Name: experiment_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.experiment_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: game_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_results ENABLE ROW LEVEL SECURITY;

--
-- Name: hedge_opportunities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hedge_opportunities ENABLE ROW LEVEL SECURITY;

--
-- Name: leagues; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;

--
-- Name: market_families; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_families ENABLE ROW LEVEL SECURITY;

--
-- Name: market_family_trust; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_family_trust ENABLE ROW LEVEL SECURITY;

--
-- Name: market_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_types ENABLE ROW LEVEL SECURITY;

--
-- Name: market_universe; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_universe ENABLE ROW LEVEL SECURITY;

--
-- Name: member_tiers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_tiers ENABLE ROW LEVEL SECURITY;

--
-- Name: model_health_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.model_health_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: model_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.model_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: odds_snapshot_corrections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.odds_snapshot_corrections ENABLE ROW LEVEL SECURITY;

--
-- Name: odds_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.odds_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: participant_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.participant_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

--
-- Name: pick_candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pick_candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: pick_lifecycle; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pick_lifecycle ENABLE ROW LEVEL SECURITY;

--
-- Name: pick_offer_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pick_offer_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: pick_promotion_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pick_promotion_history ENABLE ROW LEVEL SECURITY;

--
-- Name: pick_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pick_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: picks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.picks ENABLE ROW LEVEL SECURITY;

--
-- Name: player_team_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.player_team_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: players; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_book_aliases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_book_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_cycle_status; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_cycle_status ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_entity_aliases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_entity_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_market_aliases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_market_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_offer_current; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_offer_current ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_offer_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_offer_history ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_offer_history_compact; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_offer_history_compact ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_offer_line_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_offer_line_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_offer_staging; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_offer_staging ENABLE ROW LEVEL SECURITY;

--
-- Name: provider_offers_legacy_quarantine; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_offers_legacy_quarantine ENABLE ROW LEVEL SECURITY;

--
-- Name: raw_payloads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.raw_payloads ENABLE ROW LEVEL SECURITY;

--
-- Name: raw_payloads raw_payloads_insert_service; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY raw_payloads_insert_service ON public.raw_payloads FOR INSERT WITH CHECK (true);


--
-- Name: raw_payloads raw_payloads_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY raw_payloads_select ON public.raw_payloads FOR SELECT USING (true);


--
-- Name: selection_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.selection_types ENABLE ROW LEVEL SECURITY;

--
-- Name: odds_snapshot_corrections service role full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access" ON public.odds_snapshot_corrections TO service_role USING (true) WITH CHECK (true);


--
-- Name: odds_snapshots service role full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access" ON public.odds_snapshots TO service_role USING (true) WITH CHECK (true);


--
-- Name: settlement_corrections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settlement_corrections ENABLE ROW LEVEL SECURITY;

--
-- Name: settlement_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settlement_records ENABLE ROW LEVEL SECURITY;

--
-- Name: sport_market_type_availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sport_market_type_availability ENABLE ROW LEVEL SECURITY;

--
-- Name: sports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sports ENABLE ROW LEVEL SECURITY;

--
-- Name: sportsbooks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sportsbooks ENABLE ROW LEVEL SECURITY;

--
-- Name: stat_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stat_types ENABLE ROW LEVEL SECURITY;

--
-- Name: submission_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.submission_events ENABLE ROW LEVEL SECURITY;

--
-- Name: submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: syndicate_board; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.syndicate_board ENABLE ROW LEVEL SECURITY;

--
-- Name: system_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


