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
--
-- stat_type_id is resolved at apply time via a lookup on
-- (stat_types.sport_id, stat_types.name) rather than hardcoded UUIDs.
-- The original version of this migration hardcoded production-specific
-- UUIDs copied from a `SELECT id FROM stat_types` query, which worked on
-- production (where those UUIDs happened to exist) but failed on any
-- fresh database — including Supabase preview branches — because
-- `stat_types.id` defaults to `gen_random_uuid()` and produces different
-- values every time `202603200008_reference_data_foundation.sql` runs.
-- The (sport_id, name) pairs below are seeded by
-- `202603200008_reference_data_foundation.sql` lines 217-224 and are
-- stable across environments.
INSERT INTO provider_market_aliases (provider, provider_market_key, provider_display_name, market_type_id, sport_id, stat_type_id, metadata)
SELECT
  row_data.provider,
  row_data.provider_market_key,
  row_data.provider_display_name,
  row_data.market_type_id,
  row_data.sport_id,
  st.id,
  row_data.metadata
FROM (
  VALUES
    ('sgo', 'points-all-game-ou',        'Player Goals',         'player_goals_ou',         'NHL', 'Goals',         '{}'::jsonb),
    ('sgo', 'goals+assists-all-game-ou', 'Player Points (G+A)',  'player_hockey_points_ou', 'NHL', 'Points',        '{}'::jsonb),
    ('sgo', 'assists-all-game-ou',       'Player Assists',       'player_assists_ou',       'NHL', 'Assists',       '{}'::jsonb),
    ('sgo', 'shots_onGoal-all-game-ou',  'Player Shots on Goal', 'player_shots_ou',         'NHL', 'Shots on Goal', '{}'::jsonb),
    ('sgo', 'goalie_saves-all-game-ou',  'Goalie Saves',         'player_saves_ou',         'NHL', 'Saves',         '{}'::jsonb),
    ('sgo', 'blocks-all-game-ou',        'Player Blocked Shots', 'player_blocked_shots_ou', 'NHL', 'Blocked Shots', '{}'::jsonb)
) AS row_data(provider, provider_market_key, provider_display_name, market_type_id, sport_id, stat_type_name, metadata)
JOIN public.stat_types st
  ON st.sport_id = row_data.sport_id
 AND st.name     = row_data.stat_type_name
ON CONFLICT DO NOTHING;

-- NFL player prop aliases
--
-- Same environment-agnostic stat_type_id lookup pattern as the NHL block
-- above. NFL stat_type names are seeded by
-- `202603200008_reference_data_foundation.sql` lines 199-205.
-- Rows with NULL stat_type_id (passing_touchdowns, fantasyScore) are
-- inserted via a second, UNION-ed branch because they don't participate
-- in the join.
INSERT INTO provider_market_aliases (provider, provider_market_key, provider_display_name, market_type_id, sport_id, stat_type_id, metadata)
SELECT
  row_data.provider,
  row_data.provider_market_key,
  row_data.provider_display_name,
  row_data.market_type_id,
  row_data.sport_id,
  st.id,
  row_data.metadata
FROM (
  VALUES
    ('sgo', 'passing_yards-all-game-ou',        'Player Passing Yards',   'player_passing_yards_ou',   'NFL', 'Passing Yards',   '{}'::jsonb),
    ('sgo', 'rushing_yards-all-game-ou',        'Player Rushing Yards',   'player_rushing_yards_ou',   'NFL', 'Rushing Yards',   '{}'::jsonb),
    ('sgo', 'receiving_yards-all-game-ou',      'Player Receiving Yards', 'player_receiving_yards_ou', 'NFL', 'Receiving Yards', '{}'::jsonb),
    ('sgo', 'receiving_receptions-all-game-ou', 'Player Receptions',      'player_receptions_ou',      'NFL', 'Receptions',      '{}'::jsonb)
) AS row_data(provider, provider_market_key, provider_display_name, market_type_id, sport_id, stat_type_name, metadata)
JOIN public.stat_types st
  ON st.sport_id = row_data.sport_id
 AND st.name     = row_data.stat_type_name
ON CONFLICT DO NOTHING;

INSERT INTO provider_market_aliases (provider, provider_market_key, provider_display_name, market_type_id, sport_id, stat_type_id, metadata)
VALUES
  ('sgo', 'passing_touchdowns-all-game-ou', 'Player Passing TDs',   'player_passing_tds_ou',     'NFL', NULL, '{}'),
  ('sgo', 'fantasyScore-all-game-ou',       'Player Fantasy Score', 'player_fantasy_score_ou',   'NFL', NULL, '{}')
ON CONFLICT DO NOTHING;
