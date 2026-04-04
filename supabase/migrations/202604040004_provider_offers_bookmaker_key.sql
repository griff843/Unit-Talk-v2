-- Migration: add bookmaker_key to provider_offers for per-bookmaker SGO Pro data
--
-- provider_key = the data pipeline source (e.g. 'sgo')
-- bookmaker_key = the specific bookmaker from byBookmaker (e.g. 'pinnacle', 'draftkings')
--
-- NULL bookmaker_key = top-level consensus odds from SGO (existing rows, no change)
-- Non-null bookmaker_key = per-bookmaker odds extracted from byBookmaker
--
-- This enables Pinnacle-specific CLV without a separate Odds API call.

ALTER TABLE public.provider_offers
  ADD COLUMN bookmaker_key text NULL;

CREATE INDEX provider_offers_bookmaker_key_idx
  ON public.provider_offers (provider_key, provider_event_id, bookmaker_key)
  WHERE bookmaker_key IS NOT NULL;
