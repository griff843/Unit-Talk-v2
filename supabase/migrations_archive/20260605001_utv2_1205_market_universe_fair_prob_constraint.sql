-- UTV2-1205: Enforce that fair_over_prob and fair_under_prob are either both NULL or both non-NULL
-- This closes the DB-boundary gap identified in the Wave 3 P3 Decision Integrity plan.
-- The service-layer guard (UTV2-1202) already enforces this at scoring time; this constraint
-- enforces it at write time (ingestor) so stale or partial data cannot enter the table.
--
-- Pre-condition check: before adding, verify no existing rows violate the constraint:
--   SELECT COUNT(*) FROM market_universe
--   WHERE (fair_over_prob IS NULL) != (fair_under_prob IS NULL);
-- Expected result: 0. Migration will fail if any rows violate the constraint.
--
-- Rollback: DROP CONSTRAINT IF EXISTS chk_fair_prob_both_or_neither ON market_universe;
--   ALTER TABLE market_universe DROP CONSTRAINT IF EXISTS chk_fair_prob_both_or_neither;

ALTER TABLE market_universe
  ADD CONSTRAINT chk_fair_prob_both_or_neither
  CHECK (
    (fair_over_prob IS NULL AND fair_under_prob IS NULL)
    OR
    (fair_over_prob IS NOT NULL AND fair_under_prob IS NOT NULL)
  );
