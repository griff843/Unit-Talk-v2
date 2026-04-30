-- UTV2-772 / UTV2-803
-- Purpose: promote provider_offer_current from a view to a writer-maintained
-- table, route new raw writes into provider_offer_history, and keep the
-- current-reader RPC on the hot table instead of provider_offers.
-- Guardrails:
--   - do not rewrite provider identity semantics
--   - do not drop legacy provider_offers in this mitigation slice
--   - keep history retention partition-friendly

DROP FUNCTION IF EXISTS public.list_provider_offer_current_opening(text, timestamptz, integer);
DROP VIEW IF EXISTS public.provider_offer_current;

CREATE TABLE IF NOT EXISTS public.provider_offer_current (
  identity_key text PRIMARY KEY,
  id uuid NOT NULL,
  provider_key text NOT NULL REFERENCES public.sportsbooks(id),
  provider_event_id text NOT NULL,
  provider_market_key text NOT NULL,
  provider_participant_id text NULL,
  sport_key text NULL,
  line numeric NULL,
  over_odds integer NULL,
  under_odds integer NULL,
  devig_mode text NOT NULL CHECK (devig_mode IN ('PAIRED', 'FALLBACK_SINGLE_SIDED')),
  is_opening boolean NOT NULL DEFAULT false,
  is_closing boolean NOT NULL DEFAULT false,
  snapshot_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  bookmaker_key text NULL,
  source_run_id uuid NULL REFERENCES public.system_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.provider_offer_current ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_offer_current FROM anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS provider_offer_current_id_idx
  ON public.provider_offer_current (id);

CREATE INDEX IF NOT EXISTS provider_offer_current_snapshot_idx
  ON public.provider_offer_current (snapshot_at DESC);

CREATE INDEX IF NOT EXISTS provider_offer_current_provider_snapshot_idx
  ON public.provider_offer_current (provider_key, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS provider_offer_current_opening_scan_idx
  ON public.provider_offer_current (
    provider_key,
    snapshot_at DESC,
    provider_market_key,
    provider_participant_id,
    bookmaker_key
  )
  WHERE is_opening = true
    AND over_odds IS NOT NULL
    AND under_odds IS NOT NULL
    AND line IS NOT NULL
    AND provider_participant_id IS NOT NULL;

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
SELECT
  concat_ws(
    ':',
    latest_offer.provider_key,
    latest_offer.provider_event_id,
    latest_offer.provider_market_key,
    COALESCE(latest_offer.provider_participant_id, ''),
    COALESCE(latest_offer.bookmaker_key, '')
  ) AS identity_key,
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
  NULL,
  latest_offer.created_at,
  timezone('utc', now())
FROM (
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
) AS latest_offer
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
  updated_at = EXCLUDED.updated_at;

CREATE OR REPLACE FUNCTION public.merge_provider_offer_staging_cycle(
  p_run_id uuid,
  p_max_rows integer,
  p_identity_strategy text
)
RETURNS TABLE (
  processed_count integer,
  merged_count integer,
  duplicate_count integer
)
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
      concat_ws(
        ':',
        provider_key,
        provider_event_id,
        provider_market_key,
        COALESCE(provider_participant_id, ''),
        COALESCE(bookmaker_key, '')
      ) AS identity_key,
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

REVOKE ALL ON FUNCTION public.merge_provider_offer_staging_cycle(uuid, integer, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.list_provider_offer_current_opening(text, timestamptz, integer) FROM anon, authenticated;
