-- UTV2-725 Gap 1: backfill pick_id on pick_candidates from picks created via board-construction
-- The board-pick-writer embeds candidateId in picks.metadata for every pick it creates.
-- This migration links any candidates that were orphaned if the link step failed mid-run.

UPDATE public.pick_candidates pc
SET
  pick_id    = p.id,
  shadow_mode = false,
  updated_at  = now()
FROM public.picks p
WHERE
  p.source                      = 'board-construction'
  AND p.metadata->>'candidateId' = pc.id::text
  AND pc.pick_id                IS NULL;
