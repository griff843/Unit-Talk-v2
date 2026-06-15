-- UTV2-870
-- Purpose: fix summarize_provider_offer_history_partition() so the upsert path
-- does not collide with the RETURNS TABLE OUT parameter named snapshot_date.
-- The original function body aliased p_date AS snapshot_date inside the agg CTE,
-- which made the later SELECT from agg ambiguous in PL/pgSQL.

CREATE OR REPLACE FUNCTION public.summarize_provider_offer_history_partition(
  p_date date
)
RETURNS TABLE (
  rows_summarized integer,
  snapshot_date   date
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_partition_name text;
  v_partition_exists boolean;
  v_rows_summarized integer;
  v_start timestamptz := p_date::timestamptz;
  v_end   timestamptz := (p_date + 1)::timestamptz;
BEGIN
  v_partition_name := format('provider_offer_history_p%s', to_char(p_date, 'YYYYMMDD'));

  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace ns ON c.relnamespace = ns.oid
    WHERE ns.nspname = 'public'
      AND c.relname  = v_partition_name
  )
  INTO v_partition_exists;

  IF NOT v_partition_exists THEN
    RETURN QUERY SELECT 0::integer, p_date;
    RETURN;
  END IF;

  WITH agg AS (
    SELECT
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      bookmaker_key,
      sport_key,
      p_date                                                          AS snap_dt,
      (array_agg(line ORDER BY snapshot_at ASC  NULLS LAST))[1]      AS opening_line,
      (array_agg(line ORDER BY snapshot_at DESC NULLS LAST))[1]      AS closing_line,
      max(line)                                                       AS high_line,
      min(line)                                                       AS low_line,
      count(*)::integer                                               AS snapshot_count
    FROM public.provider_offer_history
    WHERE snapshot_at >= v_start
      AND snapshot_at <  v_end
      AND line IS NOT NULL
    GROUP BY
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      bookmaker_key,
      sport_key
  ),
  upserted AS (
    INSERT INTO public.provider_offer_line_snapshots (
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      bookmaker_key,
      sport_key,
      snapshot_date,
      opening_line,
      closing_line,
      high_line,
      low_line,
      snapshot_count,
      updated_at
    )
    SELECT
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      bookmaker_key,
      sport_key,
      snap_dt,
      opening_line,
      closing_line,
      high_line,
      low_line,
      snapshot_count,
      timezone('utc', now())
    FROM agg
    ON CONFLICT (
      provider_key,
      provider_event_id,
      provider_market_key,
      COALESCE(provider_participant_id, ''),
      COALESCE(bookmaker_key, ''),
      snapshot_date
    ) DO UPDATE
    SET
      opening_line   = COALESCE(EXCLUDED.opening_line,   provider_offer_line_snapshots.opening_line),
      closing_line   = COALESCE(EXCLUDED.closing_line,   provider_offer_line_snapshots.closing_line),
      high_line      = GREATEST(EXCLUDED.high_line,      provider_offer_line_snapshots.high_line),
      low_line       = LEAST(EXCLUDED.low_line,          provider_offer_line_snapshots.low_line),
      snapshot_count = GREATEST(EXCLUDED.snapshot_count, provider_offer_line_snapshots.snapshot_count),
      updated_at     = EXCLUDED.updated_at
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_rows_summarized FROM upserted;

  RETURN QUERY SELECT v_rows_summarized, p_date;
END;
$$;

REVOKE ALL ON FUNCTION public.summarize_provider_offer_history_partition(date) FROM anon, authenticated;
