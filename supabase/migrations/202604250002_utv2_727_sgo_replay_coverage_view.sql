-- Migration: 202604250002
-- Purpose: UTV2-727 — create sgo_replay_coverage proof view.
--
-- Read-only view over scored pick_candidates joined to market_universe and
-- provider_offers closing/opening evidence. Used for coverage reporting only.
-- This view is NEVER read by scoring inputs — it is an evaluation label only.

CREATE OR REPLACE VIEW public.sgo_replay_coverage AS
SELECT
  pc.id                 AS candidate_id,
  pc.model_score,
  pc.model_tier,
  pc.status,
  pc.is_board_candidate,
  pc.pick_id,
  mu.sport_key,
  mu.provider_key,
  mu.provider_event_id,
  mu.provider_market_key,

  -- Opening evidence from market_universe (set by materializer at ingest time)
  (
    mu.opening_line       IS NOT NULL
    AND mu.opening_over_odds  IS NOT NULL
    AND mu.opening_under_odds IS NOT NULL
  ) AS has_mu_opening,

  -- Closing evidence from market_universe (set after event closes)
  (
    mu.closing_line       IS NOT NULL
    AND mu.closing_over_odds  IS NOT NULL
    AND mu.closing_under_odds IS NOT NULL
  ) AS has_mu_closing,

  -- Opening evidence from provider_offers (lateral join)
  (po_open.id IS NOT NULL)  AS has_po_opening,

  -- Closing evidence from provider_offers (lateral join)
  (po_close.id IS NOT NULL) AS has_po_closing,

  -- Combined opening: either source counts
  (
    (
      mu.opening_line       IS NOT NULL
      AND mu.opening_over_odds  IS NOT NULL
      AND mu.opening_under_odds IS NOT NULL
    )
    OR (po_open.id IS NOT NULL)
  ) AS has_opening,

  -- Combined closing: either source counts
  (
    (
      mu.closing_line       IS NOT NULL
      AND mu.closing_over_odds  IS NOT NULL
      AND mu.closing_under_odds IS NOT NULL
    )
    OR (po_close.id IS NOT NULL)
  ) AS has_closing,

  -- Replay eligible: both opening and closing present from either source
  (
    (
      (
        mu.opening_line       IS NOT NULL
        AND mu.opening_over_odds  IS NOT NULL
        AND mu.opening_under_odds IS NOT NULL
      )
      OR (po_open.id IS NOT NULL)
    )
    AND (
      (
        mu.closing_line       IS NOT NULL
        AND mu.closing_over_odds  IS NOT NULL
        AND mu.closing_under_odds IS NOT NULL
      )
      OR (po_close.id IS NOT NULL)
    )
  ) AS replay_eligible

FROM public.pick_candidates pc
JOIN public.market_universe mu ON mu.id = pc.universe_id

-- Any single opening provider_offer for this market
LEFT JOIN LATERAL (
  SELECT po.id
  FROM public.provider_offers po
  WHERE po.provider_key        = mu.provider_key
    AND po.provider_event_id   = mu.provider_event_id
    AND COALESCE(po.provider_participant_id, '') = COALESCE(mu.provider_participant_id, '')
    AND po.provider_market_key = mu.provider_market_key
    AND po.is_opening = true
    AND po.line       IS NOT NULL
    AND po.over_odds  IS NOT NULL
    AND po.under_odds IS NOT NULL
  LIMIT 1
) po_open ON true

-- Any single closing provider_offer for this market
LEFT JOIN LATERAL (
  SELECT po.id
  FROM public.provider_offers po
  WHERE po.provider_key        = mu.provider_key
    AND po.provider_event_id   = mu.provider_event_id
    AND COALESCE(po.provider_participant_id, '') = COALESCE(mu.provider_participant_id, '')
    AND po.provider_market_key = mu.provider_market_key
    AND po.is_closing = true
    AND po.line       IS NOT NULL
    AND po.over_odds  IS NOT NULL
    AND po.under_odds IS NOT NULL
  LIMIT 1
) po_close ON true

WHERE pc.model_score IS NOT NULL;

COMMENT ON VIEW public.sgo_replay_coverage IS
  'UTV2-727: Proof view — scored candidates with opening/closing/replay coverage. '
  'Evaluation labels only; never read by scoring inputs.';
