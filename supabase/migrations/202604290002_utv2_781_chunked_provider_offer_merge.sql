-- UTV2-781
-- Purpose: allow provider-offer staging merges to execute in bounded chunks
-- instead of refusing the whole cycle when pending rows exceed max_rows.
-- Guardrails:
--   - keep merge cycle-scoped
--   - keep identity strategy explicit
--   - process no more than p_max_rows rows per invocation

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
    count(*)::integer,
    count(*) FILTER (WHERE merge_status = 'merged')::integer,
    count(*) FILTER (WHERE merge_status = 'duplicate')::integer
  FROM updated;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_provider_offer_staging_cycle(uuid, integer, text) FROM anon, authenticated;
