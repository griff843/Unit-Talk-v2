-- Migration 015: hedge_opportunities
-- Description: Durable storage for hedge, middle, and arbitrage opportunities.
-- Rollback: DROP TABLE public.hedge_opportunities;

CREATE TABLE public.hedge_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  event_id uuid NULL REFERENCES public.events(id),
  participant_id uuid NULL REFERENCES public.participants(id),
  market_key text NOT NULL,
  type text NOT NULL CHECK (type IN ('arbitrage', 'middle', 'hedge')),
  priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  bookmaker_a text NOT NULL,
  line_a numeric NOT NULL,
  over_odds_a numeric NULL,
  bookmaker_b text NOT NULL,
  line_b numeric NOT NULL,
  under_odds_b numeric NULL,
  line_discrepancy numeric NOT NULL,
  implied_prob_a numeric NOT NULL,
  implied_prob_b numeric NOT NULL,
  total_implied_prob numeric NOT NULL,
  arbitrage_percentage numeric NOT NULL,
  profit_potential numeric NOT NULL,
  guaranteed_profit numeric NULL,
  middle_gap numeric NULL,
  win_probability numeric NULL,
  notified boolean NOT NULL DEFAULT false,
  notified_at timestamptz NULL,
  notified_channels text[] NULL,
  cooldown_expires_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX hedge_opportunities_event_market_idx
  ON public.hedge_opportunities (event_id, market_key, type, detected_at DESC);

CREATE INDEX hedge_opportunities_cooldown_idx
  ON public.hedge_opportunities (event_id, market_key, type, cooldown_expires_at)
  WHERE notified = true;
