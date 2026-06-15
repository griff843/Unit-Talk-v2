-- Add provider_book_aliases for SGO books that are now covered by PRIORITY_BOOKMAKERS.
-- These rows allow the smart form's loadEventOffers to resolve byBookmaker keys to
-- canonical sportsbook IDs (fanatics, bet365, bovada).
--
-- SGO bookmaker slug convention: lowercase, no spaces (same as The Odds API).
-- Confirmed slugs: fanatics, bet365, bovada (standard industry keys on SGO Pro plan).

INSERT INTO public.provider_book_aliases (
  provider,
  provider_book_key,
  provider_display_name,
  sportsbook_id
) VALUES
  ('sgo', 'fanatics', 'Fanatics', 'fanatics'),
  ('sgo', 'bet365',   'Bet365',   'bet365'),
  ('sgo', 'bovada',   'Bovada',   'bovada')
ON CONFLICT (provider, provider_book_key) DO UPDATE
  SET provider_display_name = EXCLUDED.provider_display_name,
      sportsbook_id         = EXCLUDED.sportsbook_id;
