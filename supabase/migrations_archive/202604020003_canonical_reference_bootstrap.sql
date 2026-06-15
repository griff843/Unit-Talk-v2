-- Migration: Canonical reference bootstrap from governed participants + SGO-linked entities
-- Description: Backfill canonical teams, players, provider aliases, and player-team assignments
--   from the existing participants/events/event_participants source of truth.
-- Note: execution is intentionally decoupled from migration time. Run the
--   bootstrap function explicitly after schema deploy via a controlled script/job.
-- Rollback: DROP VIEW canonical_reference_bootstrap_summary;
--   DROP FUNCTION bootstrap_canonical_reference_data();

CREATE OR REPLACE FUNCTION public.bootstrap_canonical_reference_data()
RETURNS void
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
  SELECT DISTINCT
    'sgo',
    'team',
    CASE
      WHEN event_participant.role = 'home' THEN nullif(event.metadata->>'home_team_external_id', '')
      ELSE nullif(event.metadata->>'away_team_external_id', '')
    END,
    CASE
      WHEN event_participant.role = 'home' THEN nullif(event.metadata->>'home_team_external_id', '')
      ELSE nullif(event.metadata->>'away_team_external_id', '')
    END,
    participant.display_name,
    participant.id,
    lower(coalesce(participant.league, participant.sport)) || ':' ||
      trim(both '-' FROM regexp_replace(lower(participant.display_name), '[^a-z0-9]+', '-', 'g')),
    jsonb_build_object(
      'bootstrap', jsonb_build_object(
        'source', 'events.event_participants',
        'event_id', event.id,
        'role', event_participant.role,
        'bootstrapped_at', timezone('utc', now())
      )
    )
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

CREATE OR REPLACE VIEW public.canonical_reference_bootstrap_summary AS
SELECT
  league.id AS league_id,
  league.sport_id,
  COUNT(DISTINCT team.id) AS teams_count,
  COUNT(DISTINCT player.id) AS players_count,
  COUNT(DISTINCT assignment.player_id) AS assigned_players_count,
  GREATEST(COUNT(DISTINCT player.id) - COUNT(DISTINCT assignment.player_id), 0) AS unassigned_players_count
FROM public.leagues AS league
LEFT JOIN public.teams AS team
  ON team.league_id = league.id
LEFT JOIN public.player_team_assignments AS assignment
  ON assignment.league_id = league.id
 AND assignment.effective_until IS NULL
LEFT JOIN public.players AS player
  ON player.id = assignment.player_id
GROUP BY league.id, league.sport_id
ORDER BY league.id;
