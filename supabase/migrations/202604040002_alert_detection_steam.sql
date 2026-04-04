-- Migration 040002: alert_detections steam detection
-- Description: Mark rapid same-direction cross-book alert clusters as steam.
-- Rollback:
--   ALTER TABLE public.alert_detections DROP COLUMN IF EXISTS steam_detected;

ALTER TABLE public.alert_detections
  ADD COLUMN steam_detected boolean NOT NULL DEFAULT false;

CREATE INDEX alert_detections_steam_lookup_idx
  ON public.alert_detections (event_id, market_key, direction, current_snapshot_at DESC, steam_detected);
