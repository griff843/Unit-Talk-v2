-- Migration: 202604150001
-- Purpose: speed up closing-line lookup on provider_offers for started events.
--
-- markClosingLines queries by provider_event_id, filters to snapshot_at < commence,
-- excludes already-closed rows, and orders by snapshot_at descending. On a multi-
-- million-row append-heavy table that pattern must be indexed directly or the
-- lookup degrades into an expensive scan.

CREATE INDEX IF NOT EXISTS idx_provider_offers_unclosed_event_snapshot_desc
  ON public.provider_offers (provider_event_id, snapshot_at DESC)
  WHERE is_closing = false;
