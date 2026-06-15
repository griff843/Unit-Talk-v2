-- UTV2-854: persist model ownership at candidate scoring time
-- Historical UNKNOWN rows remain UNKNOWN. No ownership backfill is permitted.

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

UPDATE public.model_registry
SET
  registry_entity_type = COALESCE(
    registry_entity_type,
    CASE status
      WHEN 'champion' THEN 'champion_model'
      WHEN 'challenger' THEN 'challenger_model'
      WHEN 'archived' THEN 'retired_model'
      ELSE registry_entity_type
    END
  ),
  source_type_compatibility = COALESCE(
    source_type_compatibility,
    CASE
      WHEN status = 'champion' THEN ARRAY['board-construction']::TEXT[]
      ELSE source_type_compatibility
    END
  ),
  active_state = COALESCE(
    active_state,
    CASE status
      WHEN 'champion' THEN 'champion'
      WHEN 'challenger' THEN 'challenger'
      WHEN 'staged' THEN 'draft'
      WHEN 'archived' THEN 'retired'
      ELSE active_state
    END
  ),
  updated_at = NOW()
WHERE
  registry_entity_type IS NULL
  OR source_type_compatibility IS NULL
  OR active_state IS NULL;
