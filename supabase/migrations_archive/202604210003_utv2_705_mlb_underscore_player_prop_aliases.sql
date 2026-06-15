-- UTV2-705: Alias underscore-format SGO MLB player prop keys
-- SGO introduced a new key format using underscores instead of hyphens for
-- MLB player props (e.g. batting_hits-all-game-ou vs batting-hits-all-game-ou).
-- 3,000+ offers were invisible in provider_offers. This migration:
--   1. Adds 4 missing market_types (stolen bases, batter Ks, pitcher walks, pitches thrown)
--   2. Adds MLB availability rows for new types
--   3. Aliases all 17 underscore-format keys to canonical market_type_ids

-- Step 1: New market_types
INSERT INTO public.market_types (id, market_family_id, selection_type_id, display_name, short_label, requires_line, requires_participant, active, sort_order)
VALUES
  ('player_batting_stolen_bases_ou',   'player_prop', 'over_under', 'Player Stolen Bases',     'SB',    true, true, true, 35),
  ('player_batting_strikeouts_ou',     'player_prop', 'over_under', 'Player Strikeouts',       'K',     true, true, true, 36),
  ('player_pitching_walks_ou',         'player_prop', 'over_under', 'Pitcher Walks',           'P BB',  true, true, true, 37),
  ('player_pitching_pitches_thrown_ou','player_prop', 'over_under', 'Pitcher Pitches Thrown',  'P Pit', true, true, true, 38)
ON CONFLICT (id) DO NOTHING;

-- Step 2: MLB availability for new types
INSERT INTO public.sport_market_type_availability (sport_id, market_type_id)
VALUES
  ('MLB', 'player_batting_stolen_bases_ou'),
  ('MLB', 'player_batting_strikeouts_ou'),
  ('MLB', 'player_pitching_walks_ou'),
  ('MLB', 'player_pitching_pitches_thrown_ou')
ON CONFLICT (sport_id, market_type_id) DO NOTHING;

-- Step 3: Aliases for all 17 underscore-format SGO MLB player prop keys
INSERT INTO public.provider_market_aliases (provider, provider_market_key, provider_display_name, sport_id, market_type_id)
VALUES
  -- Batting props
  ('sgo', 'batting_hits-all-game-ou',          'Hits',                'MLB', 'player_batting_hits_ou'),
  ('sgo', 'batting_homeRuns-all-game-ou',       'Home Runs',           'MLB', 'player_batting_home_runs_ou'),
  ('sgo', 'batting_totalBases-all-game-ou',     'Total Bases',         'MLB', 'player_batting_total_bases_ou'),
  ('sgo', 'batting_RBI-all-game-ou',            'RBI',                 'MLB', 'player_batting_rbi_ou'),
  ('sgo', 'batting_stolenBases-all-game-ou',    'Stolen Bases',        'MLB', 'player_batting_stolen_bases_ou'),
  ('sgo', 'batting_singles-all-game-ou',        'Singles',             'MLB', 'player_batting_singles_ou'),
  ('sgo', 'batting_doubles-all-game-ou',        'Doubles',             'MLB', 'player_batting_doubles_ou'),
  ('sgo', 'batting_basesOnBalls-all-game-ou',   'Walks',               'MLB', 'player_batting_walks_ou'),
  ('sgo', 'batting_hits+runs+rbi-all-game-ou',  'Hits + Runs + RBIs',  'MLB', 'player_batting_hrr_ou'),
  ('sgo', 'batting_strikeouts-all-game-ou',     'Batter Strikeouts',   'MLB', 'player_batting_strikeouts_ou'),
  ('sgo', 'batting_triples-all-game-ou',        'Triples',             'MLB', 'player_batting_triples_ou'),
  -- Pitching props
  ('sgo', 'pitching_outs-all-game-ou',          'Pitching Outs',       'MLB', 'player_pitching_outs_ou'),
  ('sgo', 'pitching_strikeouts-all-game-ou',    'Pitcher Strikeouts',  'MLB', 'player_pitching_strikeouts_ou'),
  ('sgo', 'pitching_hits-all-game-ou',          'Pitcher Hits Allowed','MLB', 'player_pitching_hits_allowed_ou'),
  ('sgo', 'pitching_earnedRuns-all-game-ou',    'Earned Runs',         'MLB', 'player_pitching_earned_runs_ou'),
  ('sgo', 'pitching_basesOnBalls-all-game-ou',  'Pitcher Walks',       'MLB', 'player_pitching_walks_ou'),
  ('sgo', 'pitching_pitchesThrown-all-game-ou', 'Pitches Thrown',      'MLB', 'player_pitching_pitches_thrown_ou')
ON CONFLICT (provider, provider_market_key, sport_id) DO NOTHING;
