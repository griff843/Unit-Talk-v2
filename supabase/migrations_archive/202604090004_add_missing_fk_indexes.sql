-- Migration: 202604090004
-- Purpose: Add missing FK-support indexes flagged by Performance Advisor.
--
-- These indexes allow Postgres to avoid full-table scans when:
--   a) enforcing FK constraints on INSERT/UPDATE/DELETE
--   b) navigating FK joins in queries
--
-- All created with IF NOT EXISTS — safe to run on a DB that has some already.
-- NOT CONCURRENTLY: runs inside migration transaction (acceptable for current table sizes).

-- alert_detections → events
CREATE INDEX IF NOT EXISTS alert_detections_event_id_idx
  ON public.alert_detections (event_id);

-- combo_stat_type_components → combo_stat_types
CREATE INDEX IF NOT EXISTS combo_stat_type_components_combo_stat_type_id_idx
  ON public.combo_stat_type_components (combo_stat_type_id);

-- combo_stat_type_components → stat_types
CREATE INDEX IF NOT EXISTS combo_stat_type_components_stat_type_id_idx
  ON public.combo_stat_type_components (stat_type_id);

-- combo_stat_types → sports
CREATE INDEX IF NOT EXISTS combo_stat_types_sport_id_idx
  ON public.combo_stat_types (sport_id);

-- events → sports
CREATE INDEX IF NOT EXISTS events_sport_id_idx
  ON public.events (sport_id);

-- game_results → events
CREATE INDEX IF NOT EXISTS game_results_event_id_idx
  ON public.game_results (event_id);

-- game_results → participants
CREATE INDEX IF NOT EXISTS game_results_participant_id_idx
  ON public.game_results (participant_id);

-- hedge_opportunities → events
CREATE INDEX IF NOT EXISTS hedge_opportunities_event_id_idx
  ON public.hedge_opportunities (event_id);

-- market_types → market_families
CREATE INDEX IF NOT EXISTS market_types_market_family_id_idx
  ON public.market_types (market_family_id);

-- market_universe → participants (nullable FK — partial index on non-null values)
CREATE INDEX IF NOT EXISTS market_universe_participant_id_idx
  ON public.market_universe (participant_id)
  WHERE participant_id IS NOT NULL;

-- pick_promotion_history → picks
CREATE INDEX IF NOT EXISTS pick_promotion_history_pick_id_idx
  ON public.pick_promotion_history (pick_id);

-- provider_market_aliases → sports
CREATE INDEX IF NOT EXISTS provider_market_aliases_sport_id_idx
  ON public.provider_market_aliases (sport_id);

-- provider_offers → sportsbooks (provider_key FK)
-- Large table: index on provider_key alone; join queries already use composite indexes.
CREATE INDEX IF NOT EXISTS provider_offers_provider_key_idx
  ON public.provider_offers (provider_key);

-- sport_market_type_availability → market_types
CREATE INDEX IF NOT EXISTS sport_market_type_availability_market_type_id_idx
  ON public.sport_market_type_availability (market_type_id);

-- sport_market_type_availability → sports
CREATE INDEX IF NOT EXISTS sport_market_type_availability_sport_id_idx
  ON public.sport_market_type_availability (sport_id);
