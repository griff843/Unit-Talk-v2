-- UTV2-750: Fix MLB CLV coverage gap — stale hyphen aliases + null market_type_id backfill
--
-- Root Cause 1: 77 MLB picks have market_type_id = NULL because pick.market is already
-- in canonical underscore format (e.g. 'player_batting_hits_ou') which the original
-- 202604050006 backfill didn't cover. Safe direct-assign: only updates picks where
-- market matches a known market_types.id.
--
-- Root Cause 2: provider_market_aliases has stale hyphen-format entries for 4 MLB markets
-- inserted in 202604020002. Since resolveProviderMarketKey uses LIMIT 1 without ORDER BY,
-- these stale entries resolve before the correct underscore entries added in 202604210003,
-- producing keys (e.g. 'batting-hits-all-game-ou') that return 0 rows from provider_offers
-- which stores 'batting_hits-all-game-ou'. Deleting the stale entries ensures the correct
-- underscore key is returned.

-- Step 1: Delete the 4 stale hyphen-format aliases (provider_offers uses underscore format)
DELETE FROM public.provider_market_aliases
WHERE provider = 'sgo'
  AND sport_id = 'MLB'
  AND provider_market_key IN (
    'batting-hits-all-game-ou',
    'batting-walks-all-game-ou',
    'batting-total-bases-all-game-ou',
    'pitching-strikeouts-all-game-ou'
  );

-- Step 2: Backfill market_type_id on MLB picks where pick.market IS the canonical key
-- (e.g. 'player_batting_hits_ou') but market_type_id was never set by the original backfill.
UPDATE public.picks p
SET market_type_id = p.market
WHERE p.market_type_id IS NULL
  AND p.market IN (SELECT id FROM public.market_types);
