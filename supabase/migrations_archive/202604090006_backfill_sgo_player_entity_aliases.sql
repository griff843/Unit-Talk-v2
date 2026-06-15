-- Migration: 202604090006
-- Purpose: Backfill players + provider_entity_aliases for SGO participants that exist
--          in the participants table but are missing from players/provider_entity_aliases.
--
-- Root cause: The original bootstrap (202604020003) seeded players and aliases at a point
-- in time. New players added to participants since then (via ingestor/enrichment) were
-- never promoted to players or aliased. This leaves market_universe.participant_id = NULL
-- for ~196 currently-active SGO player markets.
--
-- Two-step (order matters — provider_entity_aliases.player_id FKs to players):
--   Step 1: Insert missing players rows (participant.id used as players.id, same as bootstrap)
--   Step 2: Insert/update provider_entity_aliases for the same players
--
-- Idempotent: both steps use ON CONFLICT DO UPDATE. Safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1: Seed missing players from participants
-- ─────────────────────────────────────────────────────────────────────────────
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
        'migration', '202604090006',
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
  AND participant.external_id IS NOT NULL
ON CONFLICT (id) DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    metadata     = public.players.metadata || EXCLUDED.metadata,
    updated_at   = timezone('utc', now());

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2: Seed provider_entity_aliases for SGO players
-- ─────────────────────────────────────────────────────────────────────────────
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
      'migration', '202604090006',
      'bootstrapped_at', timezone('utc', now())
    )
  )
FROM public.participants AS participant
INNER JOIN public.leagues AS league
  ON league.id = lower(coalesce(participant.league, participant.sport))
WHERE participant.participant_type = 'player'
  AND participant.external_id IS NOT NULL
ON CONFLICT (provider, entity_kind, provider_entity_key) DO UPDATE
  SET
    provider_display_name = EXCLUDED.provider_display_name,
    participant_id        = EXCLUDED.participant_id,
    player_id             = EXCLUDED.player_id,
    metadata              = public.provider_entity_aliases.metadata || EXCLUDED.metadata,
    updated_at            = timezone('utc', now());
