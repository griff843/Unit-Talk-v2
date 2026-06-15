-- UTV2-725 Gap 2: add sport_key to pick_candidates
-- Enables per-sport shadow coverage reports.
-- Populated from market_universe.sport_key at candidate insert time.

ALTER TABLE public.pick_candidates
  ADD COLUMN IF NOT EXISTS sport_key text NULL;

CREATE INDEX IF NOT EXISTS idx_pick_candidates_sport_key
  ON public.pick_candidates (sport_key);
