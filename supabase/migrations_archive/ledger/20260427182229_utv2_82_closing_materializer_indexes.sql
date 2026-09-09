CREATE INDEX IF NOT EXISTS idx_provider_offers_closing_snapshot_id_desc
  ON public.provider_offers (snapshot_at DESC, id DESC)
  WHERE is_closing = true;

CREATE INDEX IF NOT EXISTS idx_market_universe_provider_event_id
  ON public.market_universe (provider_event_id);;
