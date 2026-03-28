-- Migration 014: alert_detections
-- Description: Durable storage for classified AlertAgent line movement signals.
-- Rollback: DROP TABLE public.alert_detections;

CREATE TABLE public.alert_detections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  event_id uuid NOT NULL REFERENCES public.events(id),
  market_key text NOT NULL,
  bookmaker_key text NOT NULL,
  baseline_snapshot_at timestamptz NOT NULL,
  current_snapshot_at timestamptz NOT NULL,
  old_line numeric NOT NULL,
  new_line numeric NOT NULL,
  line_change numeric NOT NULL,
  line_change_abs numeric NOT NULL,
  velocity numeric NULL,
  time_elapsed_minutes numeric NOT NULL,
  direction text NOT NULL CHECK (direction IN ('up', 'down')),
  market_type text NOT NULL CHECK (market_type IN ('spread', 'total', 'moneyline', 'player_prop')),
  tier text NOT NULL CHECK (tier IN ('watch', 'notable', 'alert-worthy')),
  notified boolean NOT NULL DEFAULT false,
  notified_at timestamptz NULL,
  notified_channels text[] NULL,
  cooldown_expires_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX alert_detections_event_market_idx
  ON public.alert_detections (event_id, market_key, bookmaker_key, tier, notified_at DESC);

CREATE INDEX alert_detections_created_at_idx
  ON public.alert_detections (created_at DESC);

CREATE INDEX alert_detections_cooldown_idx
  ON public.alert_detections (event_id, market_key, bookmaker_key, tier, cooldown_expires_at)
  WHERE notified = true;
