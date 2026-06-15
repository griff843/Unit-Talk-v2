-- Migration: 202604270001
-- Purpose: UTV2-752 — backfill market_universe.canonical_market_key and market_type_id
-- for rows where they currently store the raw provider_market_key instead of the
-- canonical market type ID.
--
-- Root Cause: The materializer computes canonical_market_key as:
--   alias?.market_type_id ?? provider_market_key
-- Rows materialized before the correct alias was added carry
-- canonical_market_key = provider_market_key (e.g. "points-all-game-ou")
-- instead of the canonical ID (e.g. "game_total_ou").
--
-- This breaks the verification join:
--   settlement_records → picks (via market_type_id)
--       → market_universe (via canonical_market_key)
-- because picks.market_type_id = "game_total_ou" doesn't match
-- market_universe.canonical_market_key = "points-all-game-ou".
--
-- Fix: Update canonical_market_key and market_type_id using the current
-- provider_market_aliases table, mirroring the materializer's alias resolution:
--   sport-specific alias takes precedence over sport-agnostic.
--
-- Scope: Only updates rows where:
--   (a) market_type_id IS NULL, OR
--   (b) canonical_market_key = provider_market_key (no alias was resolved at materialisation)
-- Does NOT overwrite rows that already carry a correct canonical key.
-- Writes only to market_universe — no other table touched.

DO $$
DECLARE
  rows_updated integer;
BEGIN
  WITH best_aliases AS (
    -- For each (provider, provider_market_key) pick the best alias:
    -- sport-specific alias (sport_id matches) wins over sport-agnostic (sport_id IS NULL).
    SELECT DISTINCT ON (pma.provider, pma.provider_market_key, sport_context)
      pma.provider,
      pma.provider_market_key,
      pma.market_type_id,
      pma.sport_id                AS alias_sport_id,
      COALESCE(pma.sport_id, '')  AS sport_context
    FROM public.provider_market_aliases pma
    WHERE pma.market_type_id IS NOT NULL
    ORDER BY
      pma.provider,
      pma.provider_market_key,
      sport_context,
      -- Within the same sport context prefer sport-specific over NULL
      CASE WHEN pma.sport_id IS NOT NULL THEN 0 ELSE 1 END
  ),
  -- Resolve the best alias per market_universe row:
  -- try sport-specific match first, fall back to sport-agnostic.
  resolved AS (
    SELECT
      mu.id,
      COALESCE(
        (SELECT ba.market_type_id
         FROM best_aliases ba
         WHERE ba.provider = mu.provider_key
           AND ba.provider_market_key = mu.provider_market_key
           AND ba.alias_sport_id = mu.sport_key
         LIMIT 1),
        (SELECT ba.market_type_id
         FROM best_aliases ba
         WHERE ba.provider = mu.provider_key
           AND ba.provider_market_key = mu.provider_market_key
           AND ba.alias_sport_id IS NULL
         LIMIT 1)
      ) AS resolved_market_type_id
    FROM public.market_universe mu
    WHERE (
      mu.market_type_id IS NULL
      OR mu.canonical_market_key = mu.provider_market_key
    )
  )
  UPDATE public.market_universe mu
  SET
    market_type_id       = r.resolved_market_type_id,
    canonical_market_key = r.resolved_market_type_id,
    updated_at           = now()
  FROM resolved r
  WHERE mu.id = r.id
    AND r.resolved_market_type_id IS NOT NULL;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '[utv2_752] backfilled canonical_market_key in % market_universe row(s)', rows_updated;
END $$;
