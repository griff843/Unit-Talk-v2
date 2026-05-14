-- UTV2-912: market_type_id alias backfill
-- Adds missing market_types and provider_market_aliases to resolve 8,558 null
-- market_type_id rows in market_universe. 671 rows remain intentionally null
-- (MLB game_total_ou rows where provider_participant_id IS NOT NULL — participant-forbidden).

-- Step 1: Add missing market_types
INSERT INTO market_types (id, market_family_id, selection_type_id, display_name, short_label, requires_line, requires_participant, active)
VALUES
  -- NHL 2nd/3rd period
  ('2p_moneyline', 'moneyline', 'home_away',  '2nd Period Moneyline', '2P ML',    false, false, true),
  ('2p_spread',    'spread',    'home_away',  '2nd Period Spread',    '2P SPR',   true,  false, true),
  ('2p_total_ou',  'total',     'over_under', '2nd Period Total',     '2P TOTAL', true,  false, true),
  ('3p_moneyline', 'moneyline', 'home_away',  '3rd Period Moneyline', '3P ML',    false, false, true),
  ('3p_spread',    'spread',    'home_away',  '3rd Period Spread',    '3P SPR',   true,  false, true),
  ('3p_total_ou',  'total',     'over_under', '3rd Period Total',     '3P TOTAL', true,  false, true),
  -- Regulation-time markets
  ('game_reg_moneyline', 'moneyline', 'home_away',  'Regulation Moneyline',       'Reg ML',    false, false, true),
  ('game_reg_spread',    'spread',    'home_away',  'Regulation Spread',          'Reg SPR',   true,  false, true),
  ('game_reg_total_ou',  'total',     'over_under', 'Regulation Total',           'Reg TOTAL', true,  false, true),
  ('game_reg_ml3way',    'moneyline', 'home_away',  'Regulation 3-Way Moneyline', 'Reg 3ML',   false, false, true),
  -- MLB inning markets 2i–8i
  ('2i_moneyline', 'moneyline', 'home_away',  '2nd Inning Moneyline', '2I ML',    false, false, true),
  ('2i_spread',    'spread',    'home_away',  '2nd Inning Spread',    '2I SPR',   true,  false, true),
  ('2i_total_ou',  'total',     'over_under', '2nd Inning Total',     '2I TOTAL', true,  false, true),
  ('3i_moneyline', 'moneyline', 'home_away',  '3rd Inning Moneyline', '3I ML',    false, false, true),
  ('3i_spread',    'spread',    'home_away',  '3rd Inning Spread',    '3I SPR',   true,  false, true),
  ('3i_total_ou',  'total',     'over_under', '3rd Inning Total',     '3I TOTAL', true,  false, true),
  ('4i_moneyline', 'moneyline', 'home_away',  '4th Inning Moneyline', '4I ML',    false, false, true),
  ('4i_spread',    'spread',    'home_away',  '4th Inning Spread',    '4I SPR',   true,  false, true),
  ('4i_total_ou',  'total',     'over_under', '4th Inning Total',     '4I TOTAL', true,  false, true),
  ('5i_moneyline', 'moneyline', 'home_away',  '5th Inning Moneyline', '5I ML',    false, false, true),
  ('5i_spread',    'spread',    'home_away',  '5th Inning Spread',    '5I SPR',   true,  false, true),
  ('5i_total_ou',  'total',     'over_under', '5th Inning Total',     '5I TOTAL', true,  false, true),
  ('6i_moneyline', 'moneyline', 'home_away',  '6th Inning Moneyline', '6I ML',    false, false, true),
  ('6i_spread',    'spread',    'home_away',  '6th Inning Spread',    '6I SPR',   true,  false, true),
  ('6i_total_ou',  'total',     'over_under', '6th Inning Total',     '6I TOTAL', true,  false, true),
  ('7i_moneyline', 'moneyline', 'home_away',  '7th Inning Moneyline', '7I ML',    false, false, true),
  ('7i_spread',    'spread',    'home_away',  '7th Inning Spread',    '7I SPR',   true,  false, true),
  ('7i_total_ou',  'total',     'over_under', '7th Inning Total',     '7I TOTAL', true,  false, true),
  ('8i_moneyline', 'moneyline', 'home_away',  '8th Inning Moneyline', '8I ML',    false, false, true),
  ('8i_spread',    'spread',    'home_away',  '8th Inning Spread',    '8I SPR',   true,  false, true),
  ('8i_total_ou',  'total',     'over_under', '8th Inning Total',     '8I TOTAL', true,  false, true),
  -- Novelty game markets
  ('game_first_to_score_ml', 'game_prop', 'home_away', 'First to Score',     '1st Score', false, false, true),
  ('game_last_to_score_ml',  'game_prop', 'home_away', 'Last to Score',      'Last Score', false, false, true),
  ('game_first_to_x_ml',     'game_prop', 'home_away', 'First to X Points',  '1st to X',  false, false, true),
  -- New player props
  ('player_fga_ou',           'player_prop', 'over_under', 'Player Field Goals Attempted',  'FGA',     true, true, true),
  ('player_2pm_ou',           'player_prop', 'over_under', 'Player Two Pointers Made',      '2PM',     true, true, true),
  ('player_2pa_ou',           'player_prop', 'over_under', 'Player Two Pointers Attempted', '2PA',     true, true, true),
  ('player_3pa_ou',           'player_prop', 'over_under', 'Player Three Pointers Att',     '3PA',     true, true, true),
  ('player_fta_ou',           'player_prop', 'over_under', 'Player Free Throws Attempted',  'FTA',     true, true, true),
  ('player_blocks_steals_ou', 'player_prop', 'over_under', 'Player Blocks + Steals',        'BLK+STL', true, true, true),
  ('player_pp_points_ou',     'player_prop', 'over_under', 'Player Power Play Points',      'PP Pts',  true, true, true),
  ('player_hits_ou',          'player_prop', 'over_under', 'Player Hits',                   'Hits',    true, true, true),
  ('player_faceoffs_won_ou',  'player_prop', 'over_under', 'Player Faceoffs Won',           'FOW',     true, true, true)
ON CONFLICT (id) DO NOTHING;

-- Step 2: Add provider_market_aliases
INSERT INTO provider_market_aliases (provider, provider_market_key, provider_display_name, market_type_id, sport_id)
VALUES
  -- MLB
  ('sgo', 'batting_hits-all-1i-ml3way', 'Batting Hits 1st Inning 3W',  'player_batting_hits_ou',  'MLB'),
  ('sgo', 'batting_hits-all-1i-ou',     'Batting Hits 1st Inning',      'player_batting_hits_ou',  'MLB'),
  ('sgo', 'fantasyScore-all-game-ou',   'Fantasy Score',                'player_fantasy_score_ou', 'MLB'),
  ('sgo', 'firstToScore-all-game-ml',   'First to Score',               'game_first_to_score_ml',  'MLB'),
  ('sgo', 'lastToScore-all-game-ml',    'Last to Score',                'game_last_to_score_ml',   'MLB'),
  ('sgo', 'points-all-2i-ml3way',       '2nd Inning Moneyline',         '2i_moneyline',            'MLB'),
  ('sgo', 'points-all-2i-ou',           '2nd Inning Total',             '2i_total_ou',             'MLB'),
  ('sgo', 'points-all-2i-sp',           '2nd Inning Spread',            '2i_spread',               'MLB'),
  ('sgo', 'points-all-3i-ml3way',       '3rd Inning Moneyline',         '3i_moneyline',            'MLB'),
  ('sgo', 'points-all-3i-ou',           '3rd Inning Total',             '3i_total_ou',             'MLB'),
  ('sgo', 'points-all-3i-sp',           '3rd Inning Spread',            '3i_spread',               'MLB'),
  ('sgo', 'points-all-4i-ml3way',       '4th Inning Moneyline',         '4i_moneyline',            'MLB'),
  ('sgo', 'points-all-4i-ou',           '4th Inning Total',             '4i_total_ou',             'MLB'),
  ('sgo', 'points-all-4i-sp',           '4th Inning Spread',            '4i_spread',               'MLB'),
  ('sgo', 'points-all-5i-ml3way',       '5th Inning Moneyline',         '5i_moneyline',            'MLB'),
  ('sgo', 'points-all-5i-ou',           '5th Inning Total',             '5i_total_ou',             'MLB'),
  ('sgo', 'points-all-5i-sp',           '5th Inning Spread',            '5i_spread',               'MLB'),
  ('sgo', 'points-all-6i-ml3way',       '6th Inning Moneyline',         '6i_moneyline',            'MLB'),
  ('sgo', 'points-all-6i-ou',           '6th Inning Total',             '6i_total_ou',             'MLB'),
  ('sgo', 'points-all-6i-sp',           '6th Inning Spread',            '6i_spread',               'MLB'),
  ('sgo', 'points-all-7i-ml3way',       '7th Inning Moneyline',         '7i_moneyline',            'MLB'),
  ('sgo', 'points-all-7i-ou',           '7th Inning Total',             '7i_total_ou',             'MLB'),
  ('sgo', 'points-all-7i-sp',           '7th Inning Spread',            '7i_spread',               'MLB'),
  ('sgo', 'points-all-8i-ml3way',       '8th Inning Moneyline',         '8i_moneyline',            'MLB'),
  ('sgo', 'points-all-8i-ou',           '8th Inning Total',             '8i_total_ou',             'MLB'),
  ('sgo', 'points-all-8i-sp',           '8th Inning Spread',            '8i_spread',               'MLB'),
  ('sgo', 'points-all-reg-ml3way',      'Full Game 3-Way Moneyline',    'game_reg_ml3way',         'MLB'),
  -- NBA
  ('sgo', 'assists-all-1q-ou',                  'Assists 1st Quarter',       'player_assists_ou',       'NBA'),
  ('sgo', 'blocks+steals-all-game-ou',          'Blocks + Steals',           'player_blocks_steals_ou', 'NBA'),
  ('sgo', 'fantasyScore-all-1h-ou',             'Fantasy Score 1st Half',    'player_fantasy_score_ou', 'NBA'),
  ('sgo', 'fantasyScore-all-game-ou',           'Fantasy Score',             'player_fantasy_score_ou', 'NBA'),
  ('sgo', 'fieldGoalsAttempted-all-game-ou',    'Field Goals Attempted',     'player_fga_ou',           'NBA'),
  ('sgo', 'fieldGoalsMade-all-game-ou',         'Field Goals Made',          'player_fgm_ou',           'NBA'),
  ('sgo', 'firstTo15-all-game-ml',              'First to 15 Points',        'game_first_to_x_ml',      'NBA'),
  ('sgo', 'firstTo20-all-game-ml',              'First to 20 Points',        'game_first_to_x_ml',      'NBA'),
  ('sgo', 'freeThrowsAttempted-all-game-ou',    'Free Throws Attempted',     'player_fta_ou',           'NBA'),
  ('sgo', 'freeThrowsMade-all-game-ou',         'Free Throws Made',          'player_ftm_ou',           'NBA'),
  ('sgo', 'points-all-reg-ml3way',              'Full Game 3-Way Moneyline', 'game_reg_ml3way',         'NBA'),
  ('sgo', 'rebounds-all-1h-ou',                 'Rebounds 1st Half',         'player_rebounds_ou',      'NBA'),
  ('sgo', 'rebounds-all-1q-ou',                 'Rebounds 1st Quarter',      'player_rebounds_ou',      'NBA'),
  ('sgo', 'threePointersAttempted-all-game-ou', 'Three Pointers Attempted',  'player_3pa_ou',           'NBA'),
  ('sgo', 'twoPointersAttempted-all-game-ou',   'Two Pointers Attempted',    'player_2pa_ou',           'NBA'),
  ('sgo', 'twoPointersMade-all-game-ou',        'Two Pointers Made',         'player_2pm_ou',           'NBA'),
  -- NHL
  ('sgo', 'faceOffs_won-all-game-ou',             'Faceoffs Won',            'player_faceoffs_won_ou',  'NHL'),
  ('sgo', 'firstToScore-all-game-ml',             'First to Score',          'game_first_to_score_ml',  'NHL'),
  ('sgo', 'goalie_goalsAgainst-all-game-ou',      'Goalie Goals Against',    'player_goals_against_ou', 'NHL'),
  ('sgo', 'goalie_saves-all-1p-ou',               'Goalie Saves 1st Period', 'player_saves_ou',         'NHL'),
  ('sgo', 'hits-all-game-ou',                     'Hits',                    'player_hits_ou',          'NHL'),
  ('sgo', 'minutesPlayed-all-game-ou',            'Minutes Played (TOI)',     'player_minutes_ou',       'NHL'),
  ('sgo', 'points-all-1p-ml',                     '1st Period Moneyline',    '1p_moneyline',            'NHL'),
  ('sgo', 'points-all-1p-ml3way',                 '1st Period 3-Way ML',     '1p_moneyline',            'NHL'),
  ('sgo', 'points-all-1p-ou',                     '1st Period Total',        '1p_total_ou',             'NHL'),
  ('sgo', 'points-all-1p-sp',                     '1st Period Spread',       '1p_spread',               'NHL'),
  ('sgo', 'points-all-2p-ml',                     '2nd Period Moneyline',    '2p_moneyline',            'NHL'),
  ('sgo', 'points-all-2p-ou',                     '2nd Period Total',        '2p_total_ou',             'NHL'),
  ('sgo', 'points-all-2p-sp',                     '2nd Period Spread',       '2p_spread',               'NHL'),
  ('sgo', 'points-all-3p-ml',                     '3rd Period Moneyline',    '3p_moneyline',            'NHL'),
  ('sgo', 'points-all-3p-ou',                     '3rd Period Total',        '3p_total_ou',             'NHL'),
  ('sgo', 'points-all-3p-sp',                     '3rd Period Spread',       '3p_spread',               'NHL'),
  ('sgo', 'points-all-reg-ml',                    'Regulation Moneyline',    'game_reg_moneyline',      'NHL'),
  ('sgo', 'points-all-reg-ml3way',                'Regulation 3-Way ML',     'game_reg_ml3way',         'NHL'),
  ('sgo', 'points-all-reg-ou',                    'Regulation Total',        'game_reg_total_ou',       'NHL'),
  ('sgo', 'points-all-reg-sp',                    'Regulation Spread',       'game_reg_spread',         'NHL'),
  ('sgo', 'powerPlay_goals+assists-all-game-ou',  'Power Play Points',       'player_pp_points_ou',     'NHL')
ON CONFLICT DO NOTHING;

-- Step 3: Backfill market_universe rows that had no alias match.
-- Participant-forbidden guard: do not apply game-level market types to player rows.
UPDATE market_universe mu
SET market_type_id = COALESCE(
  (SELECT pma.market_type_id
   FROM provider_market_aliases pma
   WHERE pma.provider = mu.provider
     AND pma.provider_market_key = mu.provider_market_key
     AND pma.sport_id = mu.sport_id
   LIMIT 1),
  (SELECT pma.market_type_id
   FROM provider_market_aliases pma
   WHERE pma.provider = mu.provider
     AND pma.provider_market_key = mu.provider_market_key
     AND pma.sport_id IS NULL
   LIMIT 1)
)
WHERE mu.market_type_id IS NULL
  AND EXISTS (
    SELECT 1 FROM provider_market_aliases pma
    WHERE pma.provider = mu.provider
      AND pma.provider_market_key = mu.provider_market_key
      AND (pma.sport_id = mu.sport_id OR pma.sport_id IS NULL)
      AND NOT (
        mu.provider_participant_id IS NOT NULL
        AND pma.market_type_id IN ('game_total_ou', '1h_total_ou', '2h_total_ou')
      )
  );