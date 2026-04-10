-- UTV2-479 P6-01: Governed pick performance attribution view
-- Joins the full attribution chain:
--   picks (board-construction) → pick_candidates → syndicate_board → settlement_records
-- Used for downstream trust tuning and threshold adjustment (UTV2-480+).
-- Read-only view — no data mutation.

CREATE OR REPLACE VIEW public.v_governed_pick_performance AS
SELECT
  p.id                        AS pick_id,
  p.market,
  p.selection,
  p.odds,
  p.status                    AS pick_status,
  p.settled_at,
  p.created_at                AS pick_created_at,
  p.metadata,
  sb.board_run_id,
  sb.board_rank,
  sb.board_tier,
  sb.sport_key,
  sb.market_type_id,
  sb.model_score              AS board_model_score,
  pc.id                       AS candidate_id,
  pc.universe_id,
  pc.model_score              AS candidate_model_score,
  pc.model_confidence,
  pc.model_tier,
  pc.selection_rank,
  mu.provider_key,
  mu.provider_market_key,
  sr.id                       AS settlement_id,
  sr.result                   AS settlement_result,
  sr.status                   AS settlement_status,
  sr.settled_at               AS settlement_settled_at,
  sr.settled_by,
  sr.confidence               AS settlement_confidence
FROM public.picks p
JOIN public.pick_candidates pc ON pc.pick_id = p.id
JOIN public.syndicate_board sb ON sb.candidate_id = pc.id
JOIN public.market_universe mu ON mu.id = pc.universe_id
LEFT JOIN public.settlement_records sr
  ON sr.pick_id = p.id
  AND sr.corrects_id IS NULL
WHERE p.source = 'board-construction';

-- Grant read access to service role (anon access not needed — this is operator-only)
GRANT SELECT ON public.v_governed_pick_performance TO service_role;

COMMENT ON VIEW public.v_governed_pick_performance IS
  'UTV2-479: Attribution view linking governed board picks to candidate, board, and settlement outcome. '
  'One row per governed pick × settlement record. Unsettled picks have NULL settlement columns.';
