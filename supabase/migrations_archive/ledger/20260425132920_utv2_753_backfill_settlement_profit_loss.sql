UPDATE settlement_records sr
SET payload = sr.payload || jsonb_build_object(
  'profitLossUnits',
  CASE
    WHEN sr.result = 'push' THEN 0.0
    WHEN sr.result = 'loss' THEN -(COALESCE(sr.stake_units, 1.0))
    WHEN sr.result = 'win' AND p.odds IS NOT NULL AND p.odds > 0
      THEN ROUND(COALESCE(sr.stake_units, 1.0) * (p.odds::numeric / 100), 2)
    WHEN sr.result = 'win' AND p.odds IS NOT NULL AND p.odds < 0
      THEN ROUND(COALESCE(sr.stake_units, 1.0) * (100.0 / ABS(p.odds::numeric)), 2)
    WHEN sr.result = 'win'
      THEN COALESCE(sr.stake_units, 1.0)
  END
)
FROM picks p
WHERE p.id = sr.pick_id
  AND sr.result IN ('win', 'loss', 'push')
  AND (sr.payload->>'profitLossUnits') IS NULL
  AND sr.corrects_id IS NULL;;
