-- Down script for 202605130001_utv2_921_audit_log_retention_immutability
-- Reverts: restores the pre-921 nightly-retention-prune cron job body,
-- which included a DELETE FROM public.audit_log (the protected append-only table).
--
-- WARNING: Applying this down script re-enables a cron job that will attempt
-- to delete from audit_log. The append-only trigger will reject those deletes
-- with an exception, causing the cron job to error nightly until the schema is
-- brought forward again. This down script is provided for round-trip drill
-- verification only; do not apply it in production.

SELECT cron.unschedule('nightly-retention-prune')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'nightly-retention-prune'
);

-- Restore pre-921 schedule body (included audit_log pruning — will error at runtime).
SELECT cron.schedule(
  'nightly-retention-prune',
  '0 3 * * *',
  $$
    SELECT * FROM public.summarize_provider_offer_history_partition(
      (timezone('utc', now()) - INTERVAL '8 days')::date
    );

    SELECT * FROM public.drop_old_provider_offer_history_partitions(7);

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

    -- Pre-921 included audit_log prune (now correctly removed in 921).
    DELETE FROM public.audit_log
      WHERE created_at < NOW() - INTERVAL '90 days';
  $$
);
