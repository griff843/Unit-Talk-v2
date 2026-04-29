-- UTV2-781
-- Purpose: provide a filtered current-offer reader for scanners so provider,
-- time window, and row cap are applied before latest-row collapse.

CREATE OR REPLACE FUNCTION public.list_provider_offer_current_opening(
  p_provider_key text,
  p_since timestamptz,
  p_limit integer
)
RETURNS TABLE (
  id uuid,
  provider_key text,
  provider_event_id text,
  provider_market_key text,
  provider_participant_id text,
  sport_key text,
  line numeric,
  over_odds integer,
  under_odds integer,
  devig_mode text,
  is_opening boolean,
  is_closing boolean,
  snapshot_at timestamptz,
  idempotency_key text,
  bookmaker_key text,
  created_at timestamptz,
  cycle_run_id uuid,
  cycle_stage_status text,
  cycle_freshness_status text,
  cycle_proof_status text,
  cycle_failure_category text,
  cycle_failure_scope text,
  cycle_affected_provider_key text,
  cycle_affected_sport_key text,
  cycle_affected_market_key text,
  cycle_updated_at timestamptz,
  provider_health_state text
)
LANGUAGE sql
STABLE
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
  ),
  filtered AS (
    SELECT *
    FROM public.provider_offers
    WHERE provider_key = p_provider_key
      AND is_opening = true
      AND snapshot_at >= p_since
      AND over_odds IS NOT NULL
      AND under_odds IS NOT NULL
      AND line IS NOT NULL
      AND provider_participant_id IS NOT NULL
  ),
  latest_offer AS (
    SELECT DISTINCT ON (
      provider_key,
      provider_event_id,
      provider_market_key,
      COALESCE(provider_participant_id, ''),
      COALESCE(bookmaker_key, '')
    )
      *
    FROM filtered
    ORDER BY
      provider_key,
      provider_event_id,
      provider_market_key,
      COALESCE(provider_participant_id, ''),
      COALESCE(bookmaker_key, ''),
      snapshot_at DESC,
      created_at DESC,
      id DESC
  )
  SELECT
    latest_offer.id,
    latest_offer.provider_key,
    latest_offer.provider_event_id,
    latest_offer.provider_market_key,
    latest_offer.provider_participant_id,
    latest_offer.sport_key,
    latest_offer.line,
    latest_offer.over_odds,
    latest_offer.under_odds,
    latest_offer.devig_mode,
    latest_offer.is_opening,
    latest_offer.is_closing,
    latest_offer.snapshot_at,
    latest_offer.idempotency_key,
    latest_offer.bookmaker_key,
    latest_offer.created_at,
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
  FROM latest_offer
  LEFT JOIN latest_cycle
    ON latest_cycle.provider_key = latest_offer.provider_key
   AND latest_cycle.league = COALESCE(latest_offer.sport_key, '')
  ORDER BY latest_offer.snapshot_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 500), 1);
$$;

REVOKE ALL ON FUNCTION public.list_provider_offer_current_opening(text, timestamptz, integer) FROM anon, authenticated;
