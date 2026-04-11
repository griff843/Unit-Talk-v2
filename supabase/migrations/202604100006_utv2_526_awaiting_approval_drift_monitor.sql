-- UTV2-526: Awaiting approval stranded-row drift monitor
--
-- Adds:
--   1. Canonical drift-state query for picks parked in awaiting_approval
--   2. Scheduled pg_cron monitor that records threshold breaches to system_runs
--   3. Supporting partial index for stale awaiting_approval scans

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS picks_awaiting_approval_created_at_idx
  ON public.picks(created_at)
  WHERE status = 'awaiting_approval';

CREATE OR REPLACE FUNCTION public.awaiting_approval_drift_state(
  stale_threshold interval DEFAULT interval '4 hours'
)
RETURNS TABLE (
  pick_id uuid,
  created_at timestamptz,
  source text,
  market text,
  selection text,
  age_hours integer,
  has_validated_to_awaiting boolean,
  latest_lifecycle_to_state text,
  latest_lifecycle_at timestamptz,
  stale boolean
)
LANGUAGE sql
STABLE
AS $$
  WITH awaiting_picks AS (
    SELECT
      p.id,
      p.created_at,
      p.source,
      p.market,
      p.selection
    FROM public.picks p
    WHERE p.status = 'awaiting_approval'
  ),
  lifecycle_rollup AS (
    SELECT
      ap.id AS pick_id,
      COALESCE(
        BOOL_OR(pl.from_state = 'validated' AND pl.to_state = 'awaiting_approval'),
        false
      ) AS has_validated_to_awaiting,
      (ARRAY_AGG(pl.to_state ORDER BY pl.created_at DESC, pl.id DESC))[1] AS latest_lifecycle_to_state,
      MAX(pl.created_at) AS latest_lifecycle_at
    FROM awaiting_picks ap
    LEFT JOIN public.pick_lifecycle pl
      ON pl.pick_id = ap.id
    GROUP BY ap.id
  )
  SELECT
    ap.id AS pick_id,
    ap.created_at,
    ap.source,
    ap.market,
    ap.selection,
    FLOOR(EXTRACT(EPOCH FROM (timezone('utc', now()) - ap.created_at)) / 3600)::integer AS age_hours,
    lr.has_validated_to_awaiting,
    lr.latest_lifecycle_to_state,
    lr.latest_lifecycle_at,
    ap.created_at <= timezone('utc', now()) - stale_threshold AS stale
  FROM awaiting_picks ap
  LEFT JOIN lifecycle_rollup lr
    ON lr.pick_id = ap.id
  WHERE
    COALESCE(lr.has_validated_to_awaiting, false) = false
    OR COALESCE(lr.latest_lifecycle_to_state, '') <> 'awaiting_approval'
    OR ap.created_at <= timezone('utc', now()) - stale_threshold
  ORDER BY ap.created_at ASC, ap.id ASC;
$$;

CREATE OR REPLACE FUNCTION public.run_awaiting_approval_drift_monitor(
  stale_threshold interval DEFAULT interval '4 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_previous_drift_count integer := 0;
  v_drift_count integer := 0;
  v_stale_count integer := 0;
  v_status text := 'succeeded';
  v_details jsonb;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE stale)
  INTO
    v_drift_count,
    v_stale_count
  FROM public.awaiting_approval_drift_state(stale_threshold);

  SELECT
    COALESCE((sr.details ->> 'driftCount')::integer, 0)
  INTO v_previous_drift_count
  FROM public.system_runs sr
  WHERE sr.run_type = 'governance.awaiting-approval-drift'
  ORDER BY sr.started_at DESC, sr.id DESC
  LIMIT 1;

  IF v_stale_count > 0 OR v_drift_count > v_previous_drift_count THEN
    v_status := 'failed';
  END IF;

  SELECT jsonb_build_object(
    'driftCount', v_drift_count,
    'staleCount', v_stale_count,
    'previousDriftCount', v_previous_drift_count,
    'countIncreased', v_drift_count > v_previous_drift_count,
    'staleThresholdHours', FLOOR(EXTRACT(EPOCH FROM stale_threshold) / 3600)::integer,
    'samplePickIds',
      COALESCE(
        (
          SELECT jsonb_agg(d.pick_id ORDER BY d.created_at ASC)
          FROM (
            SELECT pick_id, created_at
            FROM public.awaiting_approval_drift_state(stale_threshold)
            ORDER BY created_at ASC, pick_id ASC
            LIMIT 10
          ) d
        ),
        '[]'::jsonb
      )
  )
  INTO v_details;

  INSERT INTO public.system_runs (
    run_type,
    status,
    started_at,
    finished_at,
    actor,
    details
  )
  VALUES (
    'governance.awaiting-approval-drift',
    v_status,
    timezone('utc', now()),
    timezone('utc', now()),
    'pg_cron',
    v_details
  );

  RETURN v_details || jsonb_build_object('status', v_status);
END;
$$;

SELECT cron.unschedule('awaiting-approval-drift-monitor')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'awaiting-approval-drift-monitor'
);

SELECT cron.schedule(
  'awaiting-approval-drift-monitor',
  '*/15 * * * *',
  $$
    SELECT public.run_awaiting_approval_drift_monitor(interval '4 hours');
  $$
);
