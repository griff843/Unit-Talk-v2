-- UTV2-803
-- Purpose: enforce a safer bounded retention policy on legacy provider_offers
-- by preserving unresolved-pick events while deleting only aged rows that are
-- no longer needed by active runtime paths.
-- Guardrails:
--   - keep retention bounded and batch-limited
--   - do not rewrite provider identity rules
--   - do not touch partitioned history/current rollout in this slice

CREATE OR REPLACE FUNCTION public.list_provider_offer_legacy_preserve_event_ids()
RETURNS TABLE (provider_event_id text)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT resolved.provider_event_id
  FROM public.picks pick
  LEFT JOIN public.events event_by_id
    ON event_by_id.id::text = nullif(pick.metadata->>'eventId', '')
  LEFT JOIN public.events event_by_external
    ON event_by_external.external_id = nullif(pick.metadata->>'eventId', '')
  LEFT JOIN public.events event_by_name
    ON event_by_name.event_name = nullif(pick.metadata->>'eventName', '')
  CROSS JOIN LATERAL (
    VALUES (
      COALESCE(
        event_by_id.external_id,
        event_by_external.external_id,
        event_by_name.external_id
      )
    )
  ) AS resolved(provider_event_id)
  WHERE pick.status NOT IN ('settled', 'voided')
    AND resolved.provider_event_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.prune_provider_offers_legacy_bounded(
  p_retention_days integer DEFAULT 7,
  p_batch_size integer DEFAULT 5000,
  p_max_batches integer DEFAULT 20
)
RETURNS TABLE (
  batches_run integer,
  deleted_rows bigint,
  cutoff timestamptz,
  remaining_deletable_rows bigint,
  preserved_old_rows bigint
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_cutoff timestamptz;
  v_deleted_this_batch integer;
  v_batches_run integer := 0;
  v_deleted_rows bigint := 0;
  v_remaining_deletable_rows bigint := 0;
  v_preserved_old_rows bigint := 0;
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

    WITH preserve_event_ids AS (
      SELECT provider_event_id
      FROM public.list_provider_offer_legacy_preserve_event_ids()
    ),
    doomed AS (
      SELECT offer.id
      FROM public.provider_offers offer
      LEFT JOIN preserve_event_ids preserve
        ON preserve.provider_event_id = offer.provider_event_id
      WHERE offer.created_at < v_cutoff
        AND preserve.provider_event_id IS NULL
      ORDER BY offer.created_at ASC, offer.id ASC
      LIMIT p_batch_size
    )
    DELETE FROM public.provider_offers
    WHERE id IN (SELECT id FROM doomed);

    GET DIAGNOSTICS v_deleted_this_batch = ROW_COUNT;
    EXIT WHEN v_deleted_this_batch = 0;

    v_batches_run := v_batches_run + 1;
    v_deleted_rows := v_deleted_rows + v_deleted_this_batch;
  END LOOP;

  WITH preserve_event_ids AS (
    SELECT provider_event_id
    FROM public.list_provider_offer_legacy_preserve_event_ids()
  )
  SELECT
    count(*) FILTER (WHERE preserve.provider_event_id IS NULL)::bigint,
    count(*) FILTER (WHERE preserve.provider_event_id IS NOT NULL)::bigint
  INTO v_remaining_deletable_rows, v_preserved_old_rows
  FROM public.provider_offers offer
  LEFT JOIN preserve_event_ids preserve
    ON preserve.provider_event_id = offer.provider_event_id
  WHERE offer.created_at < v_cutoff;

  RETURN QUERY
  SELECT
    v_batches_run,
    v_deleted_rows,
    v_cutoff,
    v_remaining_deletable_rows,
    v_preserved_old_rows;
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
    SELECT * FROM public.prune_provider_offers_legacy_bounded(7, 5000, 20);

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
