-- UTV2-921
-- Purpose: reschedule nightly retention without pruning audit_log. The table is
-- append-only and protected by trigger; retention must not attempt destructive
-- operations against it.

SELECT cron.unschedule('nightly-retention-prune')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'nightly-retention-prune'
);

SELECT cron.schedule(
  'nightly-retention-prune',
  '0 3 * * *',
  $$
    -- Summarize the partition that is about to age out before it gets dropped.
    -- Uses cutoff_day - 1 so data is captured before drop_old removes it.
    SELECT * FROM public.summarize_provider_offer_history_partition(
      (timezone('utc', now()) - INTERVAL '8 days')::date
    );

    -- Drop daily partitions older than the 7-day raw retention window.
    SELECT * FROM public.drop_old_provider_offer_history_partitions(7);

    -- Legacy provider_offers bounded prune (7-day window, max 100K rows/run).
    SELECT * FROM public.prune_provider_offers_bounded(7, 5000, 20);

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
