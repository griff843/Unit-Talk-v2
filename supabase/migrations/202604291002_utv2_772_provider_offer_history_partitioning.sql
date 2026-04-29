-- UTV2-772
-- Purpose: introduce a partitioned provider_offer_history surface for bounded
-- raw snapshot history, separate from hot provider_offers reads.
-- Design notes:
--   - partition by snapshot_at day to make retention a partition-drop operation
--   - keep provider_offers as the current raw ingest sink for now; history
--     population / cutover follows in a later slice
--   - use per-partition indexes for current read patterns and cleanup paths

CREATE TABLE IF NOT EXISTS public.provider_offer_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
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
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (snapshot_at, id)
) PARTITION BY RANGE (snapshot_at);

ALTER TABLE public.provider_offer_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_offer_history FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.ensure_provider_offer_history_partition(
  p_day date
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_start timestamptz := p_day::timestamptz;
  v_end timestamptz := (p_day + 1)::timestamptz;
  v_partition_name text := format(
    'provider_offer_history_p%s',
    to_char(p_day, 'YYYYMMDD')
  );
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.provider_offer_history
      FOR VALUES FROM (%L) TO (%L)',
    v_partition_name,
    v_start,
    v_end
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON public.%I (provider_key, snapshot_at DESC)',
    v_partition_name || '_provider_snapshot_idx',
    v_partition_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON public.%I (provider_event_id, provider_market_key, snapshot_at DESC)',
    v_partition_name || '_event_market_snapshot_idx',
    v_partition_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON public.%I (idempotency_key)',
    v_partition_name || '_idempotency_idx',
    v_partition_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON public.%I (created_at)',
    v_partition_name || '_created_at_idx',
    v_partition_name
  );

  RETURN v_partition_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_provider_offer_history_partitions(
  p_start_day date,
  p_end_day date
)
RETURNS TABLE (partition_name text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_day date;
BEGIN
  IF p_end_day < p_start_day THEN
    RAISE EXCEPTION 'p_end_day must be >= p_start_day';
  END IF;

  v_day := p_start_day;
  WHILE v_day <= p_end_day LOOP
    partition_name := public.ensure_provider_offer_history_partition(v_day);
    RETURN NEXT;
    v_day := v_day + 1;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.drop_provider_offer_history_partitions_before(
  p_cutoff_day date
)
RETURNS TABLE (
  dropped_partition text,
  dropped boolean
)
LANGUAGE plpgsql
AS $$
DECLARE
  part record;
  v_partition_day date;
BEGIN
  FOR part IN
    SELECT child.relname AS partition_name
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    JOIN pg_namespace ns ON child.relnamespace = ns.oid
    WHERE ns.nspname = 'public'
      AND parent.relname = 'provider_offer_history'
  LOOP
    IF part.partition_name ~ '^provider_offer_history_p[0-9]{8}$' THEN
      v_partition_day := to_date(right(part.partition_name, 8), 'YYYYMMDD');
      IF v_partition_day < p_cutoff_day THEN
        -- lint-override: drop-table
        EXECUTE format('DROP TABLE IF EXISTS public.%I', part.partition_name);
        dropped_partition := part.partition_name;
        dropped := true;
        RETURN NEXT;
      END IF;
    END IF;
  END LOOP;
END;
$$;

SELECT public.ensure_provider_offer_history_partitions(
  timezone('utc', now())::date - 1,
  timezone('utc', now())::date + 14
);
