ALTER TABLE market_universe
  ADD CONSTRAINT chk_fair_prob_both_or_neither
  CHECK (
    (fair_over_prob IS NULL AND fair_under_prob IS NULL)
    OR
    (fair_over_prob IS NOT NULL AND fair_under_prob IS NOT NULL)
  );;
