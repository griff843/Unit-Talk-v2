-- UTV2-750: Fix MLB CLV coverage gap from stale SGO aliases and null market_type_id.
--
-- Root Cause 1: historical MLB picks can have market_type_id = NULL even when
-- picks.market already stores the canonical market_type id, e.g.
-- player_batting_hits_ou. CLV alias lookup uses market_type_id, so those picks
-- cannot resolve provider closing lines.
--
-- Root Cause 2: provider_market_aliases includes stale MLB SGO aliases in
-- hyphen format. provider_offers stores the working underscore/camel SGO keys,
-- so resolving to a stale key returns no closing rows.

DELETE FROM public.provider_market_aliases
WHERE provider = 'sgo'
  AND sport_id = 'MLB'
  AND provider_market_key IN (
    'batting-doubles-all-game-ou',
    'batting-hits-all-game-ou',
    'batting-hits-runs-rbis-all-game-ou',
    'batting-home-runs-all-game-ou',
    'batting-rbi-all-game-ou',
    'batting-singles-all-game-ou',
    'batting-triples-all-game-ou',
    'batting-walks-all-game-ou',
    'batting-total-bases-all-game-ou',
    'pitching-earned-runs-all-game-ou',
    'pitching-hits-allowed-all-game-ou',
    'pitching-outs-all-game-ou',
    'pitching-strikeouts-all-game-ou'
  );

INSERT INTO public.provider_market_aliases (
  provider,
  provider_market_key,
  provider_display_name,
  sport_id,
  market_type_id
)
VALUES (
  'sgo',
  'points-all-game-ou',
  'MLB Game Total',
  'MLB',
  'game_total_ou'
)
ON CONFLICT (provider, provider_market_key, sport_id) DO UPDATE
SET market_type_id = EXCLUDED.market_type_id,
    provider_display_name = EXCLUDED.provider_display_name;

UPDATE public.picks AS p
SET market_type_id = p.market
WHERE p.market_type_id IS NULL
  AND p.sport_id = 'MLB'
  AND EXISTS (
    SELECT 1
    FROM public.market_types AS mt
    WHERE mt.id = p.market
  );
