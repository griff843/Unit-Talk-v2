-- Backfill Odds API canonical alias coverage for live browse.
-- Fixes:
--   1. normalizeOddsApiToOffers emits provider_market_key='moneyline', but the
--      canonical alias seed only registered Odds API 'h2h'.
--   2. Odds API team-side outcomes use full display names (e.g. "Los Angeles Lakers"),
--      so canonical team aliases need full-name coverage in addition to short names.

INSERT INTO public.provider_market_aliases (
  provider,
  provider_market_key,
  provider_display_name,
  market_type_id,
  sport_id,
  metadata
)
VALUES (
  'odds-api',
  'moneyline',
  'Moneyline',
  'moneyline',
  NULL,
  jsonb_build_object(
    'source', 'migration:202604020005_odds_api_alias_backfill',
    'reason', 'normalizeOddsApiToOffers emits moneyline'
  )
)
ON CONFLICT (provider, provider_market_key, sport_id) DO UPDATE
SET
  provider_display_name = EXCLUDED.provider_display_name,
  market_type_id = EXCLUDED.market_type_id,
  metadata = public.provider_market_aliases.metadata || EXCLUDED.metadata,
  updated_at = timezone('utc', now());

WITH canonical_team_aliases AS (
  SELECT DISTINCT ON (trim(concat_ws(' ', nullif(team.city, ''), nullif(team.short_name, ''))))
    'odds-api'::text AS provider,
    'team'::text AS entity_kind,
    trim(concat_ws(' ', nullif(team.city, ''), nullif(team.short_name, ''))) AS provider_entity_key,
    trim(concat_ws(' ', nullif(team.city, ''), nullif(team.short_name, ''))) AS provider_entity_id,
    trim(concat_ws(' ', nullif(team.city, ''), nullif(team.short_name, ''))) AS provider_display_name,
    participant.id AS participant_id,
    team.id AS team_id,
    jsonb_build_object(
      'source', 'migration:202604020005_odds_api_alias_backfill',
      'generated_from', 'teams.city+short_name'
    ) AS metadata
  FROM public.teams AS team
  INNER JOIN public.participants AS participant
    ON participant.participant_type = 'team'
    AND lower(coalesce(participant.league, participant.sport)) = team.league_id
    AND participant.display_name = team.display_name
  WHERE nullif(trim(concat_ws(' ', nullif(team.city, ''), nullif(team.short_name, ''))), '') IS NOT NULL
  ORDER BY trim(concat_ws(' ', nullif(team.city, ''), nullif(team.short_name, ''))), participant.created_at DESC
)
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
  provider,
  entity_kind,
  provider_entity_key,
  provider_entity_id,
  provider_display_name,
  participant_id,
  team_id,
  metadata
FROM canonical_team_aliases
ON CONFLICT (provider, entity_kind, provider_entity_key) DO UPDATE
SET
  provider_entity_id = EXCLUDED.provider_entity_id,
  provider_display_name = EXCLUDED.provider_display_name,
  participant_id = EXCLUDED.participant_id,
  team_id = EXCLUDED.team_id,
  metadata = public.provider_entity_aliases.metadata || EXCLUDED.metadata,
  updated_at = timezone('utc', now());
