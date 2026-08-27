-- UTV2-1736: continuous partition coverage for public.provider_offer_history.
--
-- LIVE PRODUCTION TRUTH (project ref zfzdnfwdarxucxtaojxm, read 2026-08-26):
--   * provider_offer_history is RANGE-partitioned on snapshot_at, one partition per UTC day.
--   * 60 partitions exist, covering 2026-05-02 00:00 .. 2026-07-01 00:00 (exclusive).
--   * There is NO DEFAULT partition (deliberate: fail closed rather than silently misfile
--     an out-of-range row into a catch-all).
--   * Any INSERT with snapshot_at >= 2026-07-01 therefore fails outright with
--     "no partition of relation ... found for row". Latent only because provider
--     ingestion has been stopped since 2026-06-30 12:41 UTC.
--   * 8,106 MB / 14,456,685 rows across those 60 partitions.
--
-- INDEX SHAPE (measured, and the one decision in this file that is not mechanical):
--   Partitions 2026-05-02..2026-05-14 (13) carry 9 indexes: the 3 inherited from the
--   parent plus the 6 created by public.ensure_provider_offer_history_partition().
--   Partitions 2026-05-15..2026-06-30 (47) carry only the 3 inherited indexes — i.e.
--   the provisioning path stopped using the ensure_ function on 2026-05-15.
--   Measured index:heap ratio — lean 3-index shape 0.90 (p20260624, p20260630);
--   full 9-index shape 2.93 (p20260513). Restoring the full shape roughly doubles
--   bytes-per-ingested-day.
--
--   This migration provisions the LEAN shape, matching the 47 most recent partitions
--   and the parent's own index set. It is deliberately NOT calling
--   ensure_provider_offer_history_partitions(), because that would silently reintroduce
--   the 6 extra indexes (including the is_opening/is_closing partial indexes) and about
--   double storage growth. Restoring those partial indexes is a CLV/product decision,
--   and CLV is currently NO-GO; see the commented alternative at the bottom of this file.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 + 2. Provision every missing day from the first gap day through an
--        evidence-justified forward horizon.
--
--   Backfill window : 2026-07-01 .. 2026-08-26  (57 days — first missing day
--                     through the day this migration was authored)
--   Forward horizon : 2026-08-27 .. 2026-11-24  (90 days)
--
--   Why 90 days, and not a smaller number:
--     a. Nothing provisions partitions on a schedule. pg_cron job 5 (03:00 UTC daily)
--        only SUMMARIZES and DROPS; no job, and no workflow in .github/workflows,
--        creates forward partitions. Coverage is only ever as deep as the last
--        manual provisioning run.
--     b. pg_cron job 5 has failed 109 of 109 runs since 2026-05-10 — every row in
--        cron.job_run_details for that job has status 'failed', aborting on
--        "audit_log is immutable: UPDATE and DELETE are not permitted on this table"
--        before ANY step in the job commits. Retention is therefore also not running,
--        which is why 60 partitions survive a nominal 7-day retention policy.
--     c. Given (a) and (b), 90 days is the shortest horizon that survives a full
--        quarter with no manual intervention.
--   Shorten this horizon only together with a working scheduled provisioner.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  d date;
  v_name text;
BEGIN
  FOR d IN
    SELECT gs::date
    FROM generate_series(DATE '2026-07-01', DATE '2026-11-24', INTERVAL '1 day') gs
  LOOP
    v_name := format('provider_offer_history_p%s', to_char(d, 'YYYYMMDD'));

    -- Idempotent: a day that already has an attached partition is skipped, so
    -- re-running this migration is a no-op and never touches existing data.
    IF to_regclass('public.' || v_name) IS NOT NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.provider_offer_history
         FOR VALUES FROM (%L) TO (%L)',
      v_name, d::timestamptz, (d + 1)::timestamptz
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Fail-closed coverage assertion.
--    Fires on exactly the condition it names — a day inside the intended window
--    with no attached partition — and on nothing else.
--    Verified read-only against live production before this migration was written:
--      * window 2026-07-01..2026-11-24  -> 147 missing days (assertion WOULD fire)
--      * window 2026-05-02..2026-06-30  ->   0 missing days (assertion would NOT fire)
--      * single day 2026-07-01          ->   1 missing day  (fires at the exact edge)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(to_char(d, 'YYYY-MM-DD') ORDER BY d)
    INTO v_missing
  FROM generate_series(DATE '2026-07-01', DATE '2026-11-24', INTERVAL '1 day') AS d
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_inherits i
    JOIN pg_class parent ON parent.oid = i.inhparent
    JOIN pg_class child  ON child.oid  = i.inhrelid
    JOIN pg_namespace ns ON ns.oid     = child.relnamespace
    WHERE ns.nspname = 'public'
      AND parent.relname = 'provider_offer_history'
      AND child.relname  = format('provider_offer_history_p%s', to_char(d, 'YYYYMMDD'))
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'UTV2-1736: provider_offer_history partition coverage incomplete; % day(s) missing: %',
      array_length(v_missing, 1), array_to_string(v_missing, ', ');
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Assert the no-DEFAULT-partition invariant still holds.
--    A DEFAULT partition converts a loud, fail-closed insert error into a silent
--    misfile, which invariant 10 (fail closed) forbids.
--    Verified read-only against live production: 0 DEFAULT partitions today.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_inherits i
    JOIN pg_class parent ON parent.oid = i.inhparent
    JOIN pg_class child  ON child.oid  = i.inhrelid
    WHERE parent.relname = 'provider_offer_history'
      AND pg_get_expr(child.relpartbound, child.oid) = 'DEFAULT'
  ) THEN
    RAISE EXCEPTION
      'UTV2-1736: a DEFAULT partition exists on provider_offer_history; forbidden (fail-closed invariant).';
  END IF;
END;
$$;

COMMIT;

-- ===========================================================================
-- ALTERNATIVE INDEX SHAPE (NOT APPLIED — requires an explicit PM decision)
--
-- To provision with the full 9-index shape instead of the lean 3-index shape,
-- replace section 1+2 above with the single call below. It is idempotent
-- (CREATE TABLE IF NOT EXISTS PARTITION OF + CREATE INDEX IF NOT EXISTS) and
-- restores the is_opening / is_closing partial indexes that a CLV resolver
-- would need. Measured cost: index:heap ratio 2.93 vs 0.90, i.e. roughly double
-- the bytes per ingested day.
--
--   SELECT public.ensure_provider_offer_history_partitions(DATE '2026-07-01', DATE '2026-11-24');
--
-- ===========================================================================
-- ROLLBACK (manual, not auto-applied)
--
-- Drops ONLY the partitions this migration provisions, and ONLY while they are
-- empty. An occupied partition is data; the rollback refuses rather than destroys.
--
--   DO $rollback$
--   DECLARE
--     d date; v_name text; v_rows bigint;
--   BEGIN
--     FOR d IN SELECT gs::date
--              FROM generate_series(DATE '2026-07-01', DATE '2026-11-24', INTERVAL '1 day') gs
--     LOOP
--       v_name := format('provider_offer_history_p%s', to_char(d, 'YYYYMMDD'));
--       IF to_regclass('public.' || v_name) IS NULL THEN CONTINUE; END IF;
--       EXECUTE format('SELECT count(*) FROM public.%I', v_name) INTO v_rows;
--       IF v_rows > 0 THEN
--         RAISE NOTICE 'REFUSED: % holds % row(s); leaving attached', v_name, v_rows;
--         CONTINUE;
--       END IF;
--       EXECUTE format('ALTER TABLE public.provider_offer_history DETACH PARTITION public.%I', v_name);
--       EXECUTE format('DROP TABLE public.%I', v_name);  -- lint-override: drop-table
--     END LOOP;
--   END;
--   $rollback$;
-- ===========================================================================
