-- UTV2-772
-- Purpose: shorten provider_offers raw retention to 7 days and make pruning
-- bounded so nightly cleanup never falls back to a single massive delete.

CREATE OR REPLACE FUNCTION public.prune_provider_offers_bounded(
  p_retention_days integer DEFAULT 7,
  p_batch_size integer DEFAULT 5000,
  p_max_batches integer DEFAULT 20
)
RETURNS TABLE (
  batches_run integer,
  deleted_rows bigint,
  cutoff timestamptz,
  remaining_rows bigint
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_cutoff timestamptz;
  v_deleted_this_batch integer;
  v_batches_run integer := 0;
  v_deleted_rows bigint := 0;
  v_remaining_rows bigint := 0;
BEGIN
  IF p_retention_days < 1 THEN
    RAISE EXCEPTION 'p_retention_days must be >= 1';
  END IF;

  IF p_batch_size < 1 THEN
    RAISE EXCEPTION 'p_batch_size must be >= 1';
  END IF;

  IF p_max_batches < 1 THEN
    RAISE EXCEPTION 'p_max_batches must be >= 1';
  END IF;

  v_cutoff := timezone('utc', now()) - make_interval(days => p_retention_days);

  LOOP
    EXIT WHEN v_batches_run >= p_max_batches;

    WITH doomed AS (
      SELECT id
      FROM public.provider_offers
      WHERE created_at < v_cutoff
      ORDER BY created_at ASC, id ASC
      LIMIT p_batch_size
    )
    DELETE FROM public.provider_offers
    WHERE id IN (SELECT id FROM doomed);

    GET DIAGNOSTICS v_deleted_this_batch = ROW_COUNT;
    EXIT WHEN v_deleted_this_batch = 0;

    v_batches_run := v_batches_run + 1;
    v_deleted_rows := v_deleted_rows + v_deleted_this_batch;
  END LOOP;

  SELECT count(*)::bigint
    INTO v_remaining_rows
  FROM public.provider_offers
  WHERE created_at < v_cutoff;

  RETURN QUERY
  SELECT
    v_batches_run,
    v_deleted_rows,
    v_cutoff,
    v_remaining_rows;
END;
$$;

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
  $$
);
