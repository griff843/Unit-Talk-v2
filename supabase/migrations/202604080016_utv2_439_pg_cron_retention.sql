-- UTV2-439: Enable pg_cron nightly retention job
--
-- Supabase Pro tier includes pg_cron. This migration:
--   1. Enables the pg_cron extension (no-op if already enabled)
--   2. Removes any stale job with the same name (idempotent)
--   3. Schedules a nightly 3am UTC retention sweep across all high-volume tables
--
-- Retention policy per DB_SCALING_STRATEGY.md:
--   provider_offers   — 30 days
--   audit_log         — 90 days (created_at index added in 202604080015)
--   alert_detections  — 30 days
--   submission_events — 90 days
--   distribution_outbox (delivered rows) — 7 days
--   distribution_receipts — 7 days

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Remove existing job if present (idempotent re-apply)
SELECT cron.unschedule('nightly-retention-prune')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'nightly-retention-prune'
);

SELECT cron.schedule(
  'nightly-retention-prune',
  '0 3 * * *',
  $$
    DELETE FROM public.provider_offers
      WHERE created_at < NOW() - INTERVAL '30 days';

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
