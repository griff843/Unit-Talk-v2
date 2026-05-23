-- Down script for 202605090003_utv2_871_provider_offers_quarantine_prune_fix
-- Reverts:
--   1. Removes the created_at/id index added for bounded prune performance.
--   2. Restores prune_provider_offers_bounded() to target public.provider_offers
--      (the view) rather than the quarantine base table.
--
-- Schema round-trip: apply up, apply this down, apply up again — hash must match.

DROP INDEX CONCURRENTLY IF EXISTS public.provider_offers_legacy_quarantine_created_at_id_idx;

-- Restore prior function body that targeted the view (pre-871 behavior).
-- The view public.provider_offers routes to provider_offers_legacy_quarantine
-- so semantics are equivalent; this down script restores the OLD targeting.
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
