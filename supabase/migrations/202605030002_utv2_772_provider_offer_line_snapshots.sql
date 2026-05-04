-- UTV2-772
-- Purpose: create provider_offer_line_snapshots as the 90–180 day summarised
-- line-movement store. High-resolution partition data (7–14 day window) is
-- dropped via drop_old_provider_offer_history_partitions(); this table absorbs
-- the aggregated daily opening/closing/high/low before that partition is gone.
-- Design notes:
--   - one row per (provider_key, provider_event_id, provider_market_key,
--     provider_participant_id, bookmaker_key, sport_key, snapshot_date) tuple
--   - upserted by summarize_provider_offer_history_partition() on conflict
--   - pruned separately at 180 days by the nightly-retention-prune cron job
--   - NOT a materialised view — plain writable table so history survives
--     after the partition it was built from is dropped

CREATE TABLE IF NOT EXISTS public.provider_offer_line_snapshots (
  id                      uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_key            text          NOT NULL REFERENCES public.sportsbooks(id),
  provider_event_id       text          NOT NULL,
  provider_market_key     text          NOT NULL,
  provider_participant_id text          NULL,
  bookmaker_key           text          NULL,
  sport_key               text          NULL,
  snapshot_date           date          NOT NULL,
  opening_line            numeric       NULL,
  closing_line            numeric       NULL,
  high_line               numeric       NULL,
  low_line                numeric       NULL,
  snapshot_count          integer       NOT NULL DEFAULT 0,
  created_at              timestamptz   NOT NULL DEFAULT timezone('utc', now()),
  updated_at              timestamptz   NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.provider_offer_line_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_offer_line_snapshots FROM anon, authenticated;

-- Natural business key used for upsert
CREATE UNIQUE INDEX IF NOT EXISTS provider_offer_line_snapshots_bk_idx
  ON public.provider_offer_line_snapshots (
    provider_key,
    provider_event_id,
    provider_market_key,
    COALESCE(provider_participant_id, ''),
    COALESCE(bookmaker_key, ''),
    snapshot_date
  );

-- Pruning and look-up scans
CREATE INDEX IF NOT EXISTS provider_offer_line_snapshots_date_idx
  ON public.provider_offer_line_snapshots (snapshot_date DESC);

CREATE INDEX IF NOT EXISTS provider_offer_line_snapshots_provider_date_idx
  ON public.provider_offer_line_snapshots (provider_key, snapshot_date DESC);

-- ---------------------------------------------------------------------------
-- summarize_provider_offer_history_partition
-- Aggregates one day's worth of provider_offer_history data into
-- provider_offer_line_snapshots before that partition is dropped.
-- Call this before drop_old_provider_offer_history_partitions().
-- ---------------------------------------------------------------------------

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

  -- Check partition exists
  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace ns ON c.relnamespace = ns.oid
    WHERE ns.nspname = 'public'
      AND c.relname  = v_partition_name
  )
  INTO v_partition_exists;

  IF NOT v_partition_exists THEN
    -- Nothing to summarise — return zero gracefully
    RETURN QUERY SELECT 0::integer, p_date;
    RETURN;
  END IF;

  -- Aggregate from the partition date range and upsert into line snapshots.
  -- ON CONFLICT keeps the most favourable aggregate across repeated calls
  -- (e.g. if a partition is summarised twice before being dropped).
  WITH agg AS (
    SELECT
      provider_key,
      provider_event_id,
      provider_market_key,
      provider_participant_id,
      bookmaker_key,
      sport_key,
      p_date                                                          AS snapshot_date,
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
      snapshot_date,
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

-- ---------------------------------------------------------------------------
-- Extend nightly cron to prune provider_offer_line_snapshots at 180 days
-- ---------------------------------------------------------------------------

SELECT cron.unschedule('nightly-retention-prune')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'nightly-retention-prune'
);

SELECT cron.schedule(
  'nightly-retention-prune',
  '0 3 * * *',
  $$
    SELECT * FROM public.prune_provider_offers_bounded(7, 5000, 20);

    DELETE FROM public.audit_log
      WHERE created_at < NOW() - INTERVAL '90 days';

    DELETE FROM public.alert_detections
      WHERE created_at < NOW() - INTERVAL '30 days';

    DELETE FROM public.submission_events
      WHERE created_at < NOW() - INTERVAL '90 days';

    DELETE FROM public.distribution_outbox
      WHERE status = 'delivered'
        AND updated_at < NOW() - INTERVAL '7 days';

    DELETE FROM public.distribution_receipts
      WHERE created_at < NOW() - INTERVAL '7 days';

    DELETE FROM public.provider_offer_line_snapshots
      WHERE snapshot_date < (timezone('utc', now()) - INTERVAL '180 days')::date;
  $$
);
