CREATE INDEX IF NOT EXISTS idx_provider_offer_history_event_snapshot
  ON public.provider_offer_history (provider_event_id, snapshot_at);;
