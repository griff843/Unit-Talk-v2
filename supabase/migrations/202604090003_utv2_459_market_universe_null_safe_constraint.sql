-- UTV2-459 amendment: replace expression-based unique index with NULLS NOT DISTINCT constraint
-- Contract authority: docs/02_architecture/PHASE2_SCHEMA_CONTRACT.md §4.2
--
-- Problem: The UNIQUE INDEX using COALESCE(provider_participant_id,'') is correct for
-- Postgres-native queries, but PostgREST (Supabase upsert) cannot reference expression
-- indexes in ON CONFLICT — it requires a plain column-list constraint.
--
-- Fix: Replace with UNIQUE NULLS NOT DISTINCT on the 4 raw columns.
-- NULLS NOT DISTINCT (Postgres 15+) treats NULL = NULL for uniqueness, which is
-- semantically equivalent to COALESCE(provider_participant_id,'') for this purpose:
-- two rows with NULL provider_participant_id for the same event/provider/market conflict.
--
-- Rollback:
--   ALTER TABLE market_universe DROP CONSTRAINT market_universe_natural_key;
--   CREATE UNIQUE INDEX market_universe_natural_key ON market_universe (
--     provider_key, provider_event_id,
--     COALESCE(provider_participant_id, ''), provider_market_key);

DROP INDEX IF EXISTS market_universe_natural_key;

ALTER TABLE market_universe
  ADD CONSTRAINT market_universe_natural_key
  UNIQUE NULLS NOT DISTINCT (
    provider_key,
    provider_event_id,
    provider_participant_id,
    provider_market_key
  );
