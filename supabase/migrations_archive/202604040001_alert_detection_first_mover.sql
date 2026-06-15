-- Migration 040001: alert_detections first_mover_book
-- Description: Capture the earliest detected bookmaker for each event/market alert signal.
-- Rollback:
--   ALTER TABLE public.alert_detections DROP COLUMN IF EXISTS first_mover_book;

ALTER TABLE public.alert_detections
  ADD COLUMN first_mover_book text NULL;

CREATE INDEX alert_detections_first_mover_lookup_idx
  ON public.alert_detections (event_id, market_key, current_snapshot_at ASC, created_at ASC);
