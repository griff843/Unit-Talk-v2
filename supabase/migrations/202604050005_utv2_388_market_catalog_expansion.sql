-- UTV2-388: Market catalog expansion — NHL/NFL player props + SGO game-line aliases
-- Adds: new market_types, sport_market_type_availability, provider_market_aliases

-- ── 1. New market_types ──────────────────────────────────────────────────────

-- NHL player props
INSERT INTO market_types (id, display_name, short_label, market_family_id, selection_type_id, requires_participant, requires_line, sort_order, metadata)
VALUES
  ('player_goals_ou',          'Player Goals',             'Goals',      'player_prop', 'over_under', true,  true,  110, '{}'),
  ('player_hockey_points_ou',  'Player Points (G+A)',      'Pts(G+A)',   'player_prop', 'over_under', true,  true,  111, '{}'),
  ('player_shots_ou',          'Player Shots on Goal',     'SOG',        'player_prop', 'over_under', true,  true,  112, '{}'),
  ('player_saves_ou',          'Goalie Saves',             'Saves',      'player_prop', 'over_under', true,  true,  113, '{}'),
  ('player_blocked_shots_ou',  'Player Blocked Shots',     'Blocks',     'player_prop', 'over_under', true,  true,  114, '{}')
ON CONFLICT (id) DO NOTHING;

-- NFL player props
INSERT INTO market_types (id, display_name, short_label, market_family_id, selection_type_id, requires_participant, requires_line, sort_order, metadata)
VALUES
  ('player_passing_yards_ou',   'Player Passing Yards',   'Pass Yds',   'player_prop', 'over_under', true,  true,  120, '{}'),
  ('player_rushing_yards_ou',   'Player Rushing Yards',   'Rush Yds',   'player_prop', 'over_under', true,  true,  121, '{}'),
  ('player_receiving_yards_ou', 'Player Receiving Yards', 'Rec Yds',    'player_prop', 'over_under', true,  true,  122, '{}'),
  ('player_receptions_ou',      'Player Receptions',      'Rec',        'player_prop', 'over_under', true,  true,  123, '{}'),
  ('player_passing_tds_ou',     'Player Passing TDs',     'Pass TDs',   'player_prop', 'over_under', true,  true,  124, '{}'),
  ('player_fantasy_score_ou',   'Player Fantasy Score',   'Fantasy',    'player_prop', 'over_under', true,  true,  125, '{}')
ON CONFLICT (id) DO NOTHING;

-- ── 2. sport_market_type_availability ────────────────────────────────────────

-- NHL player props
INSERT INTO sport_market_type_availability (sport_id, market_type_id)
VALUES
  ('NHL', 'player_goals_ou'),
  ('NHL', 'player_hockey_points_ou'),
  ('NHL', 'player_assists_ou'),
  ('NHL', 'player_shots_ou'),
  ('NHL', 'player_saves_ou'),
  ('NHL', 'player_blocked_shots_ou')
ON CONFLICT DO NOTHING;

-- NFL player props
INSERT INTO sport_market_type_availability (sport_id, market_type_id)
VALUES
  ('NFL', 'player_passing_yards_ou'),
  ('NFL', 'player_rushing_yards_ou'),
  ('NFL', 'player_receiving_yards_ou'),
  ('NFL', 'player_receptions_ou'),
  ('NFL', 'player_passing_tds_ou'),
  ('NFL', 'player_fantasy_score_ou')
ON CONFLICT DO NOTHING;

-- ── 3. SGO provider_market_aliases ───────────────────────────────────────────
-- Game-line aliases (sport-agnostic — match for any sport without a specific override)
-- NOTE: points-all-game-ou is intentionally omitted here to avoid conflict with
-- sport-specific player prop aliases below. Game totals surface via raw providerMarketKey
-- display until a participant-aware alias resolution is implemented (follow-on issue).
INSERT INTO provider_market_aliases (provider, provider_market_key, provider_display_name, market_type_id, sport_id, metadata)
VALUES
  ('sgo', 'points-all-game-ml', 'Moneyline',   'moneyline',    NULL, '{}'),
  ('sgo', 'points-all-game-sp', 'Spread',       'spread',       NULL, '{}')
ON CONFLICT DO NOTHING;

-- NHL player prop aliases
INSERT INTO provider_market_aliases (provider, provider_market_key, provider_display_name, market_type_id, sport_id, stat_type_id, metadata)
VALUES
  ('sgo', 'points-all-game-ou',        'Player Goals',           'player_goals_ou',         'NHL', '81979f63-86b0-4963-9e8c-b3521014d140', '{}'),
  ('sgo', 'goals+assists-all-game-ou', 'Player Points (G+A)',    'player_hockey_points_ou', 'NHL', 'b19ea690-ea51-4ae9-b9e4-a2348e5b35f4', '{}'),
  ('sgo', 'assists-all-game-ou',       'Player Assists',         'player_assists_ou',       'NHL', '0266b206-dfe2-4a90-bb48-cb1a51062fbc', '{}'),
  ('sgo', 'shots_onGoal-all-game-ou',  'Player Shots on Goal',   'player_shots_ou',         'NHL', 'ed88df3c-3c0a-47d1-89d2-a72463a6e5d0', '{}'),
  ('sgo', 'goalie_saves-all-game-ou',  'Goalie Saves',           'player_saves_ou',         'NHL', 'e7de3ad4-265c-45ed-946a-56b261108ce3', '{}'),
  ('sgo', 'blocks-all-game-ou',        'Player Blocked Shots',   'player_blocked_shots_ou', 'NHL', '621234a5-f215-43e6-a378-e41a3732fd1b', '{}')
ON CONFLICT DO NOTHING;

-- NFL player prop aliases
INSERT INTO provider_market_aliases (provider, provider_market_key, provider_display_name, market_type_id, sport_id, stat_type_id, metadata)
VALUES
  ('sgo', 'passing_yards-all-game-ou',   'Player Passing Yards',   'player_passing_yards_ou',   'NFL', 'dddd7a97-ad8c-4eaa-94f4-19db8616f512', '{}'),
  ('sgo', 'rushing_yards-all-game-ou',   'Player Rushing Yards',   'player_rushing_yards_ou',   'NFL', '97c6658e-0da6-4c00-b406-cb0270777cb3', '{}'),
  ('sgo', 'receiving_yards-all-game-ou', 'Player Receiving Yards', 'player_receiving_yards_ou', 'NFL', 'e242cf9e-468b-4a41-ad83-3f1dc944827d', '{}'),
  ('sgo', 'receiving_receptions-all-game-ou', 'Player Receptions', 'player_receptions_ou',      'NFL', 'dad733e2-d9b8-4965-932d-80dbcd1ee075', '{}'),
  ('sgo', 'passing_touchdowns-all-game-ou', 'Player Passing TDs',  'player_passing_tds_ou',     'NFL', NULL,                                   '{}'),
  ('sgo', 'fantasyScore-all-game-ou',    'Player Fantasy Score',   'player_fantasy_score_ou',   'NFL', NULL,                                   '{}')
ON CONFLICT DO NOTHING;
