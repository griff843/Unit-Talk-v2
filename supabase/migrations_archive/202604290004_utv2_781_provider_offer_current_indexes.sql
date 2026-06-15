-- UTV2-781
-- Purpose: support provider_offer_current latest-row selection and scanner reads
-- without falling back to raw provider_offers.

CREATE INDEX IF NOT EXISTS provider_offers_current_identity_snapshot_idx
  ON public.provider_offers (
    provider_key,
    provider_event_id,
    provider_market_key,
    COALESCE(provider_participant_id, ''),
    COALESCE(bookmaker_key, ''),
    snapshot_at DESC,
    created_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS provider_offers_opening_scan_idx
  ON public.provider_offers (
    provider_key,
    snapshot_at DESC
  )
  WHERE is_opening = true
    AND over_odds IS NOT NULL
    AND under_odds IS NOT NULL
    AND line IS NOT NULL
    AND provider_participant_id IS NOT NULL;
