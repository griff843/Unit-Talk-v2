DO $$
DECLARE
  rows_updated integer;
BEGIN
  WITH latest_closing AS (
    SELECT DISTINCT ON (
      po.provider_key,
      po.provider_event_id,
      COALESCE(po.provider_participant_id, ''),
      po.provider_market_key
    )
      po.provider_key,
      po.provider_event_id,
      po.provider_participant_id,
      po.provider_market_key,
      po.line         AS closing_line,
      po.over_odds    AS closing_over_odds,
      po.under_odds   AS closing_under_odds
    FROM public.provider_offers po
    WHERE po.is_closing = true
      AND po.line       IS NOT NULL
      AND po.over_odds  IS NOT NULL
      AND po.under_odds IS NOT NULL
    ORDER BY
      po.provider_key,
      po.provider_event_id,
      COALESCE(po.provider_participant_id, ''),
      po.provider_market_key,
      po.snapshot_at DESC
  )
  UPDATE public.market_universe mu
  SET
    closing_line      = lc.closing_line,
    closing_over_odds = lc.closing_over_odds,
    closing_under_odds = lc.closing_under_odds,
    updated_at        = now()
  FROM latest_closing lc
  WHERE mu.provider_key        = lc.provider_key
    AND mu.provider_event_id   = lc.provider_event_id
    AND COALESCE(mu.provider_participant_id, '') = COALESCE(lc.provider_participant_id, '')
    AND mu.provider_market_key = lc.provider_market_key
    AND mu.closing_line       IS NULL
    AND mu.closing_over_odds  IS NULL
    AND mu.closing_under_odds IS NULL;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '[utv2_727] backfilled closing-line evidence into % market_universe row(s)', rows_updated;
END $$;;
