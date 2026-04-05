-- UTV2-394: NBA canonical prop alias completion for model-readiness
--
-- Alias gap report (scripts/utv2-320-nba-alias-gap-report.ts) found 50 unmapped SGO market
-- keys for NBA props. Root cause: existing aliases (202604020002) used hyphen-separator keys
-- (pra-all-game-ou, pts-rebs-all-game-ou, etc.) but live SGO data uses plus-sign keys
-- (points+rebounds+assists-all-game-ou, threePointersMade-all-game-ou, etc.).
--
-- This migration maps the high-priority live key formats to canonical market_type_id values.

INSERT INTO public.provider_market_aliases (
  provider,
  provider_market_key,
  provider_display_name,
  market_type_id,
  sport_id
) VALUES
  -- Threes / 3-pointers made (live SGO camelCase key)
  ('sgo', 'threePointersMade-all-game-ou',       'Three Pointers Made',           'player_3pm_ou',      'NBA'),
  ('sgo', 'threePointersMade-all-1h-ou',          'Three Pointers Made (1H)',       'player_3pm_ou',      'NBA'),
  ('sgo', 'threePointersMade-all-1q-ou',          'Three Pointers Made (1Q)',       'player_3pm_ou',      'NBA'),

  -- Combo props using plus-sign separator format (live SGO key format)
  ('sgo', 'points+rebounds+assists-all-game-ou',  'Points + Rebounds + Assists',   'player_pra_ou',      'NBA'),
  ('sgo', 'points+rebounds+assists-all-1h-ou',    'Points + Rebounds + Assists (1H)', 'player_pra_ou',   'NBA'),
  ('sgo', 'points+rebounds+assists-all-1q-ou',    'Points + Rebounds + Assists (1Q)', 'player_pra_ou',   'NBA'),
  ('sgo', 'points+rebounds-all-game-ou',          'Points + Rebounds',             'player_pts_rebs_ou', 'NBA'),
  ('sgo', 'points+assists-all-game-ou',           'Points + Assists',              'player_pts_asts_ou', 'NBA'),
  ('sgo', 'rebounds+assists-all-game-ou',         'Rebounds + Assists',            'player_rebs_asts_ou', 'NBA')
ON CONFLICT (provider, provider_market_key) DO NOTHING;
