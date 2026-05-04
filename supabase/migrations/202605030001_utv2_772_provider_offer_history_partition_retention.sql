-- UTV2-772
-- Purpose: add a bounded partition-drop function for provider_offer_history so
-- that old daily partitions can be pruned without row-by-row deletes.
-- Design notes:
--   - partition-drop is the designed retention mechanism (see migration 202604291002)
--   - summarize_provider_offer_history_partition() must be called before drop
--     to preserve aggregated line-movement data in provider_offer_line_snapshots
--   - this function only drops; callers are responsible for summarising first
--   - returns a summary row so callers / cron jobs can log the outcome

CREATE OR REPLACE FUNCTION public.drop_old_provider_offer_history_partitions(
  p_retention_days integer DEFAULT 7
)
RETURNS TABLE (
  partitions_dropped integer,
  cutoff_date date
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_cutoff_date date;
  v_dropped_count integer := 0;
  part record;
  v_partition_day date;
BEGIN
  IF p_retention_days < 1 THEN
    RAISE EXCEPTION 'p_retention_days must be >= 1';
  END IF;

  v_cutoff_date := (timezone('utc', now()) - make_interval(days => p_retention_days))::date;

  FOR part IN
    SELECT child.relname AS partition_name
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child  ON pg_inherits.inhrelid  = child.oid
    JOIN pg_namespace ns ON child.relnamespace     = ns.oid
    WHERE ns.nspname    = 'public'
      AND parent.relname = 'provider_offer_history'
  LOOP
    IF part.partition_name ~ '^provider_offer_history_p[0-9]{8}$' THEN
      v_partition_day := to_date(right(part.partition_name, 8), 'YYYYMMDD');
      IF v_partition_day < v_cutoff_date THEN
        -- lint-override: drop-table
        EXECUTE format('DROP TABLE IF EXISTS public.%I', part.partition_name);
        v_dropped_count := v_dropped_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT
    v_dropped_count,
    v_cutoff_date;
END;
$$;

REVOKE ALL ON FUNCTION public.drop_old_provider_offer_history_partitions(integer) FROM anon, authenticated;
