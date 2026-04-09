-- Migration: 202604090008_utv2_474_syndicate_board
-- Phase 4 UTV2-474: Scarcity / portfolio-aware top-N board construction
-- Creates syndicate_board table to store the output of the board construction service.

CREATE TABLE public.syndicate_board (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  candidate_id     uuid        NOT NULL REFERENCES public.pick_candidates(id),
  board_rank       integer     NOT NULL,
  board_tier       text        NOT NULL,
  sport_key        text        NOT NULL,
  market_type_id   text        NULL,
  model_score      numeric     NOT NULL,
  board_run_id     uuid        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.syndicate_board (board_run_id, board_rank);
CREATE INDEX ON public.syndicate_board (created_at DESC);
