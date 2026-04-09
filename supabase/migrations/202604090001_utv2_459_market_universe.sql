-- UTV2-459: market_universe — Phase 2 canonical board-opportunity layer
-- Contract authority: docs/02_architecture/PHASE2_SCHEMA_CONTRACT.md
--
-- Creates the market_universe table: one row per canonical market opportunity,
-- upserted by materializer from provider_offers. No FK to provider_offers
-- (provider_offers is pruned by pg_cron; a live FK would cause cascade failures).
-- event_id and participant_id FKs are nullable (game-line markets have no participant).
--
-- Rollback: DROP TABLE IF EXISTS public.market_universe CASCADE;

CREATE TABLE market_universe (
  id                        uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sport_key                 text          NOT NULL,
  league_key                text          NOT NULL,
  event_id                  uuid          NULL      REFERENCES events(id),
  participant_id            uuid          NULL      REFERENCES participants(id),
  market_type_id            text          NULL,
  canonical_market_key      text          NOT NULL,
  provider_key              text          NOT NULL,
  provider_event_id         text          NOT NULL,
  provider_participant_id   text          NULL,
  provider_market_key       text          NOT NULL,
  current_line              numeric       NULL,
  current_over_odds         numeric       NULL,
  current_under_odds        numeric       NULL,
  opening_line              numeric       NULL,
  opening_over_odds         numeric       NULL,
  opening_under_odds        numeric       NULL,
  closing_line              numeric       NULL,
  closing_over_odds         numeric       NULL,
  closing_under_odds        numeric       NULL,
  fair_over_prob            numeric       NULL,
  fair_under_prob           numeric       NULL,
  is_stale                  boolean       NOT NULL DEFAULT false,
  last_offer_snapshot_at    timestamptz   NOT NULL,
  refreshed_at              timestamptz   NOT NULL DEFAULT now(),
  created_at                timestamptz   NOT NULL DEFAULT now(),
  updated_at                timestamptz   NOT NULL DEFAULT now()
);

-- Natural key: null-safe upsert path (COALESCE handles NULL provider_participant_id)
CREATE UNIQUE INDEX market_universe_natural_key
  ON market_universe (
    provider_key,
    provider_event_id,
    COALESCE(provider_participant_id, ''),
    provider_market_key
  );

-- Board scan reads by event
CREATE INDEX market_universe_event_id
  ON market_universe (event_id)
  WHERE event_id IS NOT NULL;

-- Board scan reads by participant + market type
CREATE INDEX market_universe_participant_market
  ON market_universe (participant_id, market_type_id)
  WHERE participant_id IS NOT NULL;

-- Staleness sweep
CREATE INDEX market_universe_stale_refresh
  ON market_universe (is_stale, refreshed_at);

-- Provider event batch reads
CREATE INDEX market_universe_provider_event
  ON market_universe (provider_key, provider_event_id);
