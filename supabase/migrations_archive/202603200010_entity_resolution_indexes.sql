-- Migration 010: entity resolution indexes
-- Enables idempotent upsert-by-external-id for feed-resolved events and participants.
-- Rollback:
--   DROP INDEX IF EXISTS public.events_external_id_idx;
--   DROP INDEX IF EXISTS public.participants_external_id_idx;

CREATE UNIQUE INDEX IF NOT EXISTS events_external_id_idx
  ON public.events (external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS participants_external_id_idx
  ON public.participants (external_id)
  WHERE external_id IS NOT NULL;
