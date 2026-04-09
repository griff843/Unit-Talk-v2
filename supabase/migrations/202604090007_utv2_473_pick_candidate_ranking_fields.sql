-- Migration: 202604090007
-- Purpose: Add ranked selection fields to pick_candidates for Phase 4 UTV2-473.
-- Idempotent: ADD COLUMN IF NOT EXISTS is safe to re-run.

ALTER TABLE public.pick_candidates
  ADD COLUMN IF NOT EXISTS selection_rank     integer NULL,
  ADD COLUMN IF NOT EXISTS is_board_candidate boolean NOT NULL DEFAULT false;

-- Partial index: fast lookup of the ranked board pool
CREATE INDEX IF NOT EXISTS idx_pick_candidates_board_rank
  ON public.pick_candidates (selection_rank)
  WHERE is_board_candidate = true;
