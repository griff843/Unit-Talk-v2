
DO $$
DECLARE
  rows_updated integer;
BEGIN
  WITH best_aliases AS (
    SELECT DISTINCT ON (pma.provider, pma.provider_market_key, sport_context)
      pma.provider,
      pma.provider_market_key,
      pma.market_type_id,
      pma.sport_id                AS alias_sport_id,
      COALESCE(pma.sport_id, '')  AS sport_context
    FROM public.provider_market_aliases pma
    WHERE pma.market_type_id IS NOT NULL
    ORDER BY
      pma.provider,
      pma.provider_market_key,
      sport_context,
      CASE WHEN pma.sport_id IS NOT NULL THEN 0 ELSE 1 END
  ),
  resolved AS (
    SELECT
      mu.id,
      COALESCE(
        (SELECT ba.market_type_id
         FROM best_aliases ba
         WHERE ba.provider = mu.provider_key
           AND ba.provider_market_key = mu.provider_market_key
           AND ba.alias_sport_id = mu.sport_key
         LIMIT 1),
        (SELECT ba.market_type_id
         FROM best_aliases ba
         WHERE ba.provider = mu.provider_key
           AND ba.provider_market_key = mu.provider_market_key
           AND ba.alias_sport_id IS NULL
         LIMIT 1)
      ) AS resolved_market_type_id
    FROM public.market_universe mu
    WHERE (
      mu.market_type_id IS NULL
      OR mu.canonical_market_key = mu.provider_market_key
    )
  )
  UPDATE public.market_universe mu
  SET
    market_type_id       = r.resolved_market_type_id,
    canonical_market_key = r.resolved_market_type_id,
    updated_at           = now()
  FROM resolved r
  WHERE mu.id = r.id
    AND r.resolved_market_type_id IS NOT NULL;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '[utv2_752] backfilled canonical_market_key in % market_universe row(s)', rows_updated;
END $$;
;
