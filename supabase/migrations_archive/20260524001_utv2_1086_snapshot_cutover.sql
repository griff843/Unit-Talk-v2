-- INIT-1.1.3: Snapshot Cutover and Point-in-Time Reconstruction (UTV2-1086)
--
-- Demotes provider_offer_current to a labeled derived projection.
-- Truth authority has moved to odds_snapshots (UTV2-1085, immutable append-only).
-- Point-in-time reconstruction must use odds_snapshots; do not treat this
-- projection as canonical truth.

COMMENT ON TABLE public.provider_offer_current IS
  'DERIVED PROJECTION — not truth. Materialized hot-current view of provider odds, '
  'maintained for pick-pipeline operational reads. '
  'Canonical truth for point-in-time reconstruction is odds_snapshots (UTV2-1085). '
  'Do not treat this table as authoritative for historical market state. '
  'Demoted per INIT-1.1.3 / UTV2-1086.';
