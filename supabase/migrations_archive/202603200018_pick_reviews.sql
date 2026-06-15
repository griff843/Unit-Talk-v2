-- Phase 2A: Pick review workflow
--
-- pick_reviews is the HUMAN DECISION LAYER.
-- approval_status on picks is the SYSTEM GATE.
--
-- pick_reviews drives approval_status, but they are conceptually separate:
--   approve → sets approval_status = 'approved'
--   deny    → sets approval_status = 'rejected'
--   hold    → approval_status stays 'pending' (pick remains in review)
--   return  → approval_status stays 'pending' (held pick returned to queue)
--
-- Decision values are deliberately different from approval_status values
-- to prevent conceptual conflation.

CREATE TABLE public.pick_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_id UUID NOT NULL REFERENCES public.picks(id),
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'deny', 'hold', 'return')),
  reason TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX pick_reviews_pick_id_idx ON public.pick_reviews(pick_id);
CREATE INDEX pick_reviews_decision_idx ON public.pick_reviews(decision);
CREATE INDEX pick_reviews_decided_at_idx ON public.pick_reviews(decided_at DESC);
