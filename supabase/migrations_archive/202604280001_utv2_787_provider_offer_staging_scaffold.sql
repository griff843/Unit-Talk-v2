-- UTV2-787
-- Purpose: scaffold provider-offer staging + cycle-status tables and a bounded
-- merge path without cutting production reads/writes over from provider_offers.
-- Guardrails:
--   - no provider_offers table drop or rewrite
--   - no silent identity broadening beyond provisional UTV2-771 approval
--   - merge must remain cycle-scoped and row-bounded

CREATE TABLE IF NOT EXISTS public.provider_offer_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.system_runs(id) ON DELETE CASCADE,
  provider_key text NOT NULL REFERENCES public.sportsbooks(id),
  league text NOT NULL,
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
  identity_key text NOT NULL,
  merge_status text NOT NULL DEFAULT 'pending' CHECK (
    merge_status IN ('pending', 'merged', 'duplicate', 'stale_blocked', 'failed')
  ),
  merge_error text NULL,
  merged_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_offer_staging_run_idempotency_idx
  ON public.provider_offer_staging (run_id, idempotency_key);

CREATE INDEX IF NOT EXISTS provider_offer_staging_run_status_idx
  ON public.provider_offer_staging (run_id, merge_status, created_at);

CREATE INDEX IF NOT EXISTS provider_offer_staging_identity_idx
  ON public.provider_offer_staging (identity_key, snapshot_at DESC);

CREATE TABLE IF NOT EXISTS public.provider_cycle_status (
  run_id uuid PRIMARY KEY REFERENCES public.system_runs(id) ON DELETE CASCADE,
  provider_key text NOT NULL REFERENCES public.sportsbooks(id),
  league text NOT NULL,
  cycle_snapshot_at timestamptz NOT NULL,
  stage_status text NOT NULL CHECK (
    stage_status IN ('pending', 'staged', 'merge_blocked', 'merged', 'failed')
  ),
  freshness_status text NOT NULL DEFAULT 'unknown' CHECK (
    freshness_status IN ('unknown', 'fresh', 'stale', 'invalid_snapshot')
  ),
  proof_status text NOT NULL DEFAULT 'required' CHECK (
    proof_status IN ('required', 'verified', 'waived')
  ),
  staged_count integer NOT NULL DEFAULT 0 CHECK (staged_count >= 0),
  merged_count integer NOT NULL DEFAULT 0 CHECK (merged_count >= 0),
  duplicate_count integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  last_error text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS provider_cycle_status_provider_snapshot_idx
  ON public.provider_cycle_status (provider_key, league, cycle_snapshot_at DESC);

CREATE OR REPLACE FUNCTION public.set_provider_cycle_status_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_provider_cycle_status_updated_at ON public.provider_cycle_status;
CREATE TRIGGER trg_provider_cycle_status_updated_at
  BEFORE UPDATE ON public.provider_cycle_status
  FOR EACH ROW
  EXECUTE FUNCTION public.set_provider_cycle_status_updated_at();

ALTER TABLE public.provider_offer_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_cycle_status ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.provider_offer_staging FROM anon, authenticated;
REVOKE ALL ON TABLE public.provider_cycle_status FROM anon, authenticated;

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
DECLARE
  pending_count integer;
BEGIN
  IF p_max_rows IS NULL OR p_max_rows <= 0 THEN
    RAISE EXCEPTION 'p_max_rows must be > 0';
  END IF;

  IF p_identity_strategy <> 'provider_event_market_participant_book' THEN
    RAISE EXCEPTION
      'unsupported provider-offer identity strategy: % (line/sport/taxonomy semantics remain explicit decisions)',
      p_identity_strategy;
  END IF;

  SELECT count(*)
    INTO pending_count
  FROM public.provider_offer_staging
  WHERE run_id = p_run_id
    AND merge_status = 'pending';

  IF pending_count > p_max_rows THEN
    RAISE EXCEPTION
      'bounded merge refused for run %: % pending rows exceeds max_rows %',
      p_run_id,
      pending_count,
      p_max_rows;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT *
    FROM public.provider_offer_staging
    WHERE run_id = p_run_id
      AND merge_status = 'pending'
    ORDER BY created_at ASC, id ASC
    LIMIT p_max_rows
  ),
  inserted AS (
    INSERT INTO public.provider_offers (
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
      bookmaker_key
    )
    SELECT
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
      bookmaker_key
    FROM candidates
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING idempotency_key
  ),
  updated AS (
    UPDATE public.provider_offer_staging staged
    SET
      merge_status = CASE
        WHEN EXISTS (
          SELECT 1
          FROM inserted
          WHERE inserted.idempotency_key = staged.idempotency_key
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
    pending_count,
    count(*) FILTER (WHERE merge_status = 'merged')::integer,
    count(*) FILTER (WHERE merge_status = 'duplicate')::integer
  FROM updated;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_provider_offer_staging_cycle(uuid, integer, text) FROM anon, authenticated;
