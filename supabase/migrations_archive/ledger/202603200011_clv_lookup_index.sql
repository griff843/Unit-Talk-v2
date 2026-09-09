-- Migration 011: CLV closing line lookup index
-- Enables efficient lookup of the latest provider offer before event start time.
-- No new tables. No new columns. Index-only migration.

CREATE INDEX IF NOT EXISTS provider_offers_clv_lookup_idx
  ON provider_offers (
    provider_event_id,
    provider_market_key,
    provider_participant_id,
    snapshot_at DESC
  );
