-- UTV2-781
-- Purpose: expose a current-only provider-offer surface for downstream scanners
-- with explicit health-state joins from provider_cycle_status.
-- Guardrails:
--   - no production cutover of all readers; this is a new read surface only
--   - provider/league join remains explicit and provisional for current SGO usage
--   - fail vs degraded semantics must be queryable, not inferred ad hoc downstream

CREATE OR REPLACE VIEW public.provider_offer_current AS
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
  ORDER BY provider_key, league, cycle_snapshot_at DESC, updated_at DESC
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
  FROM public.provider_offers
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
  latest_offer.*,
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
 AND latest_cycle.league = COALESCE(latest_offer.sport_key, '');

ALTER VIEW public.provider_offer_current SET (security_invoker = true);

REVOKE ALL ON public.provider_offer_current FROM anon, authenticated;
