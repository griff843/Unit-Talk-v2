-- Migration: UTV2-698 — Remove SGO from sportsbooks catalog
--
-- SGO is a data provider (Sports Game Odds API), not a sportsbook cappers bet with.
-- The sgo:sgo provider_book_alias caused null-bookmaker consensus offers to surface
-- as "SGO" in the sportsbook dropdown. This migration:
--   1. Deactivates the 'sgo' sportsbook row (keeps FK integrity, hides from catalog)
--   2. Removes the sgo:sgo alias (null-bookmaker offers will display as "Consensus")
--   3. Removes any odds-api:* entries that may exist from legacy data

-- 1. Deactivate sgo sportsbook
UPDATE public.sportsbooks SET active = false WHERE id = 'sgo';

-- 2. Remove the sgo:sgo provider_book_alias
DELETE FROM public.provider_book_aliases
WHERE provider = 'sgo' AND provider_book_key = 'sgo';

-- 3. Remove any odds-api:* sportsbook entries (data-source labels, not real books)
UPDATE public.sportsbooks SET active = false WHERE id LIKE 'odds-api:%';
DELETE FROM public.provider_book_aliases WHERE provider = 'odds-api';
