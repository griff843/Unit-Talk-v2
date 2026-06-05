-- Rollback for UTV2-1205: remove the both-or-neither fair_prob constraint
-- This reverses supabase/migrations/20260605001_utv2_1205_market_universe_fair_prob_constraint.sql

ALTER TABLE market_universe
  DROP CONSTRAINT IF EXISTS chk_fair_prob_both_or_neither;
