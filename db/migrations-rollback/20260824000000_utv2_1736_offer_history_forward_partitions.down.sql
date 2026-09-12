-- Rollback for 20260824000000_utv2_1736_offer_history_forward_partitions.sql
--
-- The forward migration creates one daily RANGE partition of
-- public.provider_offer_history for every day from 2026-07-01 through 2026-11-24
-- (147 partitions) and adds the read-only helper
-- public.list_provider_offer_history_partition_days().
--
-- This rollback reverses exactly that, and nothing else:
--
--   * It only considers days inside the 2026-07-01 .. 2026-11-24 range the forward
--     migration provisions. The 60 pre-existing partitions (2026-05-02 .. 2026-06-30)
--     are outside that range by construction and are never touched.
--   * It REFUSES to drop a partition that holds rows. A non-empty partition is data,
--     and destroying it to make a rollback tidy is not an acceptable trade. Such a
--     partition is left attached with its rows intact and a NOTICE is raised.
--   * It creates no DEFAULT partition and does not alter the parent table, so the
--     fail-closed behaviour of provider_offer_history is unchanged by running this.
--
-- On a scratch or parity database every partition in range is empty, so the reversal
-- is total and the schema returns byte-for-byte to its pre-migration state. On a
-- database that has taken writes, expect refusals — that is the intended behaviour,
-- not a failure of this script.

BEGIN;

DO $rollback$
DECLARE
  d        date;
  v_name   text;
  v_rows   bigint;
  v_dropped integer := 0;
  v_refused integer := 0;
BEGIN
  FOR d IN
    SELECT gs::date
    FROM generate_series(DATE '2026-07-01', DATE '2026-11-24', INTERVAL '1 day') gs
  LOOP
    v_name := format('provider_offer_history_p%s', to_char(d, 'YYYYMMDD'));

    -- Already absent: nothing to reverse for this day.
    IF to_regclass('public.' || v_name) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I', v_name) INTO v_rows;

    IF v_rows > 0 THEN
      RAISE NOTICE 'REFUSED: % holds % row(s); leaving attached', v_name, v_rows;
      v_refused := v_refused + 1;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.provider_offer_history DETACH PARTITION public.%I', v_name
    );
    EXECUTE format('DROP TABLE public.%I', v_name);  -- lint-override: drop-table
    v_dropped := v_dropped + 1;
  END LOOP;

  RAISE NOTICE 'rollback: dropped=% refused=%', v_dropped, v_refused;
END;
$rollback$;

-- The helper is created by the forward migration and did not exist before it.
DROP FUNCTION IF EXISTS public.list_provider_offer_history_partition_days();

COMMIT;
