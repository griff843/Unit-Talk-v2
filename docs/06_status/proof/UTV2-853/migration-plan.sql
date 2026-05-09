-- UTV2-853 Model Ownership Persistence migration plan
-- Planning artifact only. Do not apply without operator approval.
-- Historical picks remain UNKNOWN. No backfill is permitted.

BEGIN;

-- 1. Persist model ownership at candidate scoring time.
-- Columns are nullable initially so historical pick_candidates remain unchanged.
ALTER TABLE public.pick_candidates
  ADD COLUMN IF NOT EXISTS model_registry_id UUID REFERENCES public.model_registry(id),
  ADD COLUMN IF NOT EXISTS scoring_run_id UUID REFERENCES public.system_runs(id),
  ADD COLUMN IF NOT EXISTS ownership_timestamp TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS pick_candidates_model_registry_id_idx
  ON public.pick_candidates (model_registry_id)
  WHERE model_registry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pick_candidates_scoring_run_id_idx
  ON public.pick_candidates (scoring_run_id)
  WHERE scoring_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pick_candidates_ownership_timestamp_idx
  ON public.pick_candidates (ownership_timestamp)
  WHERE ownership_timestamp IS NOT NULL;

CREATE INDEX IF NOT EXISTS pick_candidates_pick_ownership_idx
  ON public.pick_candidates (pick_id, model_registry_id)
  WHERE pick_id IS NOT NULL;

-- 2. Add required registry metadata.
-- Current model_registry.status supports champion/challenger/staged/archived.
-- The implementation lane must decide whether active_state is additive or replaces status.
ALTER TABLE public.model_registry
  ADD COLUMN IF NOT EXISTS registry_entity_type TEXT,
  ADD COLUMN IF NOT EXISTS source_type_compatibility TEXT[],
  ADD COLUMN IF NOT EXISTS owner TEXT,
  ADD COLUMN IF NOT EXISTS training_window_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS training_window_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validation_metrics JSONB,
  ADD COLUMN IF NOT EXISTS calibration_metadata JSONB,
  ADD COLUMN IF NOT EXISTS promotion_approved_by TEXT,
  ADD COLUMN IF NOT EXISTS promotion_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS active_state TEXT;

CREATE INDEX IF NOT EXISTS model_registry_entity_scope_idx
  ON public.model_registry (registry_entity_type, sport, market_family);

CREATE INDEX IF NOT EXISTS model_registry_active_scope_idx
  ON public.model_registry (active_state, sport, market_family)
  WHERE active_state IS NOT NULL;

CREATE INDEX IF NOT EXISTS model_registry_source_type_compatibility_idx
  ON public.model_registry
  USING GIN (source_type_compatibility);

-- 3. Future enforcement constraints/triggers to add after runtime writes are deployed.
-- Do not add these in the nullable migration unless the application write path is already deployed.
--
-- A. Prevent scoring writes with model_score but no ownership after enforcement boundary.
-- B. Reject model_registry_id values whose registry row is disabled or retired at scoring time.
-- C. Prevent model_registry_id changes after pick_candidates.pick_id is non-null.
-- D. Quarantine post-enforcement candidate-linked picks with null ownership for analytics.

ROLLBACK;
