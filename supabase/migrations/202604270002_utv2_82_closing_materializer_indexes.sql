-- Migration: 202604270002
-- Purpose: UTV2-82 closing-offer materializer timeout guard support.
--
-- listClosingOffers now uses keyset pagination with:
--   WHERE is_closing = true AND snapshot_at >= :since
--   ORDER BY snapshot_at DESC, id DESC
--
-- Without a matching partial index, large provider_offers tables can still
-- degrade into slow scans and hit statement_timeout.

CREATE INDEX IF NOT EXISTS idx_provider_offers_closing_snapshot_id_desc
  ON public.provider_offers (snapshot_at DESC, id DESC)
  WHERE is_closing = true;

-- Market-universe immutability prefetch now fetches existing rows by provider_event_id
-- in chunks. Add a direct index to avoid broad scans on large tables.
CREATE INDEX IF NOT EXISTS idx_market_universe_provider_event_id
  ON public.market_universe (provider_event_id);
