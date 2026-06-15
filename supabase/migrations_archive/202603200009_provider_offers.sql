-- Migration 009: provider_offers table
-- Description: Canonical storage for multi-provider odds snapshots.
--   Provider-agnostic design. Slice 1 wires SGO only.
--   FK to sportsbooks ensures only registered providers write here.
--   Idempotency key prevents duplicate rows on re-ingest.
-- Rollback: DROP TABLE public.provider_offers CASCADE;

CREATE TABLE public.provider_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key text NOT NULL REFERENCES public.sportsbooks(id),
  provider_event_id text NOT NULL,
  provider_market_key text NOT NULL,
  provider_participant_id text NULL,
  sport_key text NULL,
  line numeric NULL,
  over_odds integer NULL,
  under_odds integer NULL,
  devig_mode text NOT NULL CHECK (devig_mode IN ('PAIRED', 'FALLBACK_SINGLE_SIDED')),
  is_opening boolean NOT NULL DEFAULT false,
  is_closing boolean NOT NULL DEFAULT false,
  snapshot_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX provider_offers_idempotency_key_idx
  ON public.provider_offers (idempotency_key);

CREATE INDEX provider_offers_provider_event_idx
  ON public.provider_offers (provider_key, provider_event_id);

CREATE INDEX provider_offers_snapshot_at_idx
  ON public.provider_offers (snapshot_at DESC);
