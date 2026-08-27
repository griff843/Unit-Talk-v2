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
--   Per PM plan decision (2026-08-27): provision the LEAN shape, matching the 47 most recent partitions
--   and the parent's own index set. It is deliberately NOT calling
--   ensure_provider_offer_history_partitions(), because that would silently reintroduce
--   the 6 extra indexes (including the is_opening/is_closing partial indexes) and about
--   double storage growth. Restoring those partial indexes is a CLV/product decision,
--   and CLV is currently NO-GO; see the commented alternative at the bottom of this file.

-- FAIL-CLOSED-PRECONDITION: public.provider_offer_history_p20260701, public.provider_offer_history_p20261124
--
-- What the precondition guards, and why it is not merely drill-shaped.
--
-- This migration is idempotent: a day that already has an attached partition is
-- skipped, so a second apply mutates nothing. Idempotency is a required property
-- here. But "the name is already taken" and "the partition already exists" are NOT
-- the same condition, and conflating them is the actual hazard.
--
-- If `public.provider_offer_history_p20260701` exists as a STANDALONE relation --
-- a table someone created by hand, a leftover from a DETACH that was never dropped,
-- a view -- then a bare `to_regclass IS NOT NULL` skip would silently accept it and
-- report complete coverage. Rows for that day would then land nowhere, or in an
-- unmanaged table outside the partition tree, and the coverage assertion below
-- would pass while the invariant it exists to protect was already broken.
--
-- So the guard below runs BEFORE any DDL, walks the entire provisioned range, and
-- refuses with SQLSTATE 42P07 (duplicate_table) the moment a target name is
-- occupied by anything that is not an attached partition of provider_offer_history.
-- Skipping remains correct for genuine partitions; only the ambiguous case refuses.
--
-- The two declared relations are the first and last day of the provisioned range,
-- so the drill exercises both ends of the loop rather than only its first iteration.

BEGIN;

DO $precondition$
DECLARE
  d      date;
  v_name text;
  v_oid  oid;
BEGIN
  FOR d IN
    SELECT gs::date
    FROM generate_series(DATE '2026-07-01', DATE '2026-11-24', INTERVAL '1 day') gs
  LOOP
    v_name := format('provider_offer_history_p%s', to_char(d, 'YYYYMMDD'));
    v_oid  := to_regclass('public.' || v_name);

    -- Free name: this migration will create the partition below.
    IF v_oid IS NULL THEN
      CONTINUE;
    END IF;

    -- Name taken. Skipping is only safe when the occupant is genuinely an
    -- attached partition of provider_offer_history.
    IF NOT EXISTS (
      SELECT 1
      FROM pg_inherits i
      JOIN pg_class parent ON parent.oid = i.inhparent
      JOIN pg_namespace pns ON pns.oid = parent.relnamespace
      WHERE i.inhrelid = v_oid
        AND pns.nspname = 'public'
        AND parent.relname = 'provider_offer_history'
    ) THEN
      RAISE EXCEPTION
        USING ERRCODE = '42P07',
              MESSAGE = format(
                'UTV2-1736: relation public.%I already exists and is NOT an attached partition of public.provider_offer_history. Refusing before any DDL rather than skipping it and reporting coverage that does not exist.',
                v_name
              );
    END IF;
  END LOOP;
END;
$precondition$;


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

-- ---------------------------------------------------------------------------
-- 5. Read-only coverage listing used by scripts/ops/partition-provisioner.ts.
--    PostgREST cannot read pg_catalog directly, so the monitor needs a
--    SECURITY DEFINER reader. It returns days only — no DDL, no mutation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_provider_offer_history_partition_days()
RETURNS TABLE(partition_day date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
  SELECT to_date(right(child.relname, 8), 'YYYYMMDD')
  FROM pg_inherits i
  JOIN pg_class parent ON parent.oid = i.inhparent
  JOIN pg_class child  ON child.oid  = i.inhrelid
  JOIN pg_namespace ns ON ns.oid     = child.relnamespace
  WHERE ns.nspname = 'public'
    AND parent.relname = 'provider_offer_history'
    AND child.relname ~ '^provider_offer_history_p[0-9]{8}$'
  ORDER BY 1;
$fn$;

COMMENT ON FUNCTION public.list_provider_offer_history_partition_days() IS
  'UTV2-1736: read-only daily partition inventory for the coverage monitor.';

-- ---------------------------------------------------------------------------
-- Execute privilege on the reader.
--
-- Postgres grants EXECUTE on a newly created function to PUBLIC by default.
-- Combined with SECURITY DEFINER -- and with Supabase exposing public-schema
-- functions as PostgREST RPC -- that would leave this callable by `anon`. The
-- function returns partition dates only, so the exposure is low-sensitivity,
-- but a SECURITY DEFINER function should never carry an implicit PUBLIC grant:
-- least privilege is the property, not the payload's sensitivity.
--
-- The REVOKE is unconditional and valid on any Postgres. The GRANT is guarded
-- on role existence so this migration still applies cleanly to a scratch
-- Postgres in CI, which has none of Supabase's roles. Only the monitor needs to
-- call this, and it authenticates as service_role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.list_provider_offer_history_partition_days() FROM PUBLIC;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.list_provider_offer_history_partition_days()
      TO service_role;
  END IF;
END
$grant$;

DO $assert_grant$
DECLARE
  v_public_has_execute boolean;
BEGIN
  SELECT has_function_privilege('public', 'public.list_provider_offer_history_partition_days()', 'EXECUTE')
    INTO v_public_has_execute;
  IF v_public_has_execute THEN
    RAISE EXCEPTION
      'UTV2-1736: PUBLIC still holds EXECUTE on list_provider_offer_history_partition_days() after the REVOKE. Refusing to leave a SECURITY DEFINER function publicly callable.';
  END IF;
END
$assert_grant$;

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
