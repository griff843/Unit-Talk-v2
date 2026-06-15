-- UTV2-393: Smart Form NFL/NCAAF + NHL taxonomy completion
--
-- Adds missing stat types, market types, sport_market_type_availability entries,
-- and SGO provider_market_aliases for NFL, NCAAF, and NHL.
--
-- What already existed (do not re-add):
--   NFL stat types:  Passing Yards, Rushing Yards, Receiving Yards, Touchdowns, Receptions, Interceptions
--   NFL market types: player_passing_yards_ou, player_rushing_yards_ou, player_receiving_yards_ou,
--                     player_receptions_ou, player_passing_tds_ou, player_fantasy_score_ou
--   NHL stat types:  Shots on Goal, Saves, Goals, Assists, Points, Blocked Shots
--   NHL market types: player_goals_ou, player_hockey_points_ou, player_shots_ou, player_saves_ou,
--                     player_blocked_shots_ou, player_assists_ou (shared)
--   NCAAF stat types: Passing Yards, Rushing Yards, Receiving Yards, Touchdowns
--
-- Rollback (reverse order):
--   DELETE FROM provider_market_aliases WHERE sport_id IN ('NFL','NCAAF','NHL') AND provider = 'sgo'
--     AND provider_market_key IN ('rushing_attempts-all-game-ou', 'passing_attempts-all-game-ou',
--       'passing_touchdowns-all-game-ou', 'rushing_receiving_yards-all-game-ou',
--       'tackles-all-game-ou', 'sacks-all-game-ou', 'goalie_goals_against-all-game-ou',
--       'save_percentage-all-game-ou', 'plus_minus-all-game-ou');
--   DELETE FROM sport_market_type_availability WHERE (sport_id, market_type_id) IN ((...));
--   DELETE FROM market_types WHERE id IN ('player_rushing_attempts_ou', 'player_passing_attempts_ou',
--     'player_passing_tds_nfl_ou', 'player_rush_rec_yards_ou', 'player_tackles_ou', 'player_sacks_ou',
--     'player_goals_against_ou', 'player_save_pct_ou', 'player_plus_minus_ou');
--   DELETE FROM stat_types WHERE sport_id IN ('NFL','NCAAF','NHL')
--     AND name IN ('Rushing Attempts', 'Passing Attempts', 'Passing Touchdowns', 'Rush + Rec Yards',
--       'Tackles', 'Sacks', 'Goals Against', 'Save Percentage', 'Plus/Minus');

-- ── 1. NFL stat types (missing) ───────────────────────────────────────────────
-- Original INSERT used (sport_id, name, sort_order) but omitted the NOT NULL
-- columns canonical_key, display_name, short_label added by 202604020002.
-- Fixed: include all NOT NULL columns inline.

INSERT INTO public.stat_types (sport_id, name, display_name, short_label, canonical_key, sort_order)
SELECT 'NFL', v.name, v.display_name, v.short_label, v.canonical_key, v.sort_order
FROM (VALUES
  ('Rushing Attempts',   'Rushing Attempts',   'RUSH ATT', 'rushing_attempts',   7),
  ('Passing Attempts',   'Passing Attempts',   'PASS ATT', 'passing_attempts',   8),
  ('Passing Touchdowns', 'Passing Touchdowns', 'PASS TDS', 'passing_tds',        9),
  ('Rush + Rec Yards',   'Rush + Rec Yards',   'R+R YDS',  'rush_rec_yards',    10),
  ('Tackles',            'Tackles',            'TCKL',     'tackles',            11),
  ('Sacks',              'Sacks',              'SACKS',    'sacks',              12)
) AS v(name, display_name, short_label, canonical_key, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.stat_types
  WHERE sport_id = 'NFL' AND canonical_key = v.canonical_key
);

-- ── 2. NCAAF stat types (missing) ─────────────────────────────────────────────
-- Same fix as NFL above: include all NOT NULL columns inline.

INSERT INTO public.stat_types (sport_id, name, display_name, short_label, canonical_key, sort_order)
SELECT 'NCAAF', v.name, v.display_name, v.short_label, v.canonical_key, v.sort_order
FROM (VALUES
  ('Receptions',         'Receptions',         'REC',      'receptions',         5),
  ('Interceptions',      'Interceptions',      'INT',      'interceptions',      6),
  ('Rushing Attempts',   'Rushing Attempts',   'RUSH ATT', 'rushing_attempts',   7),
  ('Passing Attempts',   'Passing Attempts',   'PASS ATT', 'passing_attempts',   8),
  ('Passing Touchdowns', 'Passing Touchdowns', 'PASS TDS', 'passing_tds',        9),
  ('Rush + Rec Yards',   'Rush + Rec Yards',   'R+R YDS',  'rush_rec_yards',    10)
) AS v(name, display_name, short_label, canonical_key, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.stat_types
  WHERE sport_id = 'NCAAF' AND canonical_key = v.canonical_key
);

-- ── 3. NHL stat types (missing) ───────────────────────────────────────────────
-- Same fix: include all NOT NULL columns inline.

INSERT INTO public.stat_types (sport_id, name, display_name, short_label, canonical_key, sort_order)
SELECT 'NHL', v.name, v.display_name, v.short_label, v.canonical_key, v.sort_order
FROM (VALUES
  ('Goals Against',    'Goals Against',    'GA',  'goals_against',    7),
  ('Save Percentage',  'Save Percentage',  'SV%', 'save_percentage',  8),
  ('Plus/Minus',       'Plus/Minus',       '+/-', 'plus_minus',       9)
) AS v(name, display_name, short_label, canonical_key, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.stat_types
  WHERE sport_id = 'NHL' AND canonical_key = v.canonical_key
);

-- ── 4. New market types ───────────────────────────────────────────────────────

-- NFL player props (new)
INSERT INTO public.market_types (
  id, market_family_id, selection_type_id, display_name, short_label,
  requires_line, requires_participant, sort_order
)
VALUES
  ('player_rushing_attempts_ou',  'player_prop', 'over_under', 'Player Rushing Attempts', 'Rush Att',  true, true, 126),
  ('player_passing_attempts_ou',  'player_prop', 'over_under', 'Player Passing Attempts', 'Pass Att',  true, true, 127),
  ('player_rush_rec_yards_ou',    'player_prop', 'over_under', 'Player Rush + Rec Yards', 'R+R Yds',   true, true, 128),
  ('player_tackles_ou',           'player_prop', 'over_under', 'Player Tackles',          'Tackles',   true, true, 129),
  ('player_sacks_ou',             'player_prop', 'over_under', 'Player Sacks',            'Sacks',     true, true, 130)
ON CONFLICT (id) DO NOTHING;

-- NHL player props (new)
INSERT INTO public.market_types (
  id, market_family_id, selection_type_id, display_name, short_label,
  requires_line, requires_participant, sort_order
)
VALUES
  ('player_goals_against_ou',  'player_prop', 'over_under', 'Goalie Goals Against', 'GA',   true, true, 115),
  ('player_save_pct_ou',       'player_prop', 'over_under', 'Goalie Save Pct',      'SV%',  true, true, 116),
  ('player_plus_minus_ou',     'player_prop', 'over_under', 'Player Plus/Minus',    '+/-',  true, true, 117)
ON CONFLICT (id) DO NOTHING;

-- ── 5. sport_market_type_availability ─────────────────────────────────────────

-- NFL: new player prop market types
INSERT INTO public.sport_market_type_availability (sport_id, market_type_id, sort_order)
VALUES
  ('NFL', 'player_rushing_attempts_ou',  126),
  ('NFL', 'player_passing_attempts_ou',  127),
  ('NFL', 'player_rush_rec_yards_ou',    128),
  ('NFL', 'player_tackles_ou',           129),
  ('NFL', 'player_sacks_ou',             130)
ON CONFLICT DO NOTHING;

-- NCAAF: enable player props (subset of NFL)
-- Uses existing NFL market type ids where sport-agnostic
INSERT INTO public.sport_market_type_availability (sport_id, market_type_id, sort_order)
VALUES
  ('NCAAF', 'player_passing_yards_ou',   10),
  ('NCAAF', 'player_rushing_yards_ou',   11),
  ('NCAAF', 'player_receiving_yards_ou', 12),
  ('NCAAF', 'player_receptions_ou',      13),
  ('NCAAF', 'player_passing_tds_ou',     14),
  ('NCAAF', 'player_rushing_attempts_ou', 15),
  ('NCAAF', 'player_passing_attempts_ou', 16),
  ('NCAAF', 'player_rush_rec_yards_ou',   17),
  ('NCAAF', 'player_tackles_ou',          18)
ON CONFLICT DO NOTHING;

-- NHL: new player prop market types
INSERT INTO public.sport_market_type_availability (sport_id, market_type_id, sort_order)
VALUES
  ('NHL', 'player_goals_against_ou',  115),
  ('NHL', 'player_save_pct_ou',       116),
  ('NHL', 'player_plus_minus_ou',     117)
ON CONFLICT DO NOTHING;

-- ── 6. SGO provider_market_aliases ────────────────────────────────────────────

-- NFL player prop aliases (new market types)
INSERT INTO public.provider_market_aliases (
  provider, provider_market_key, provider_display_name, market_type_id, sport_id, metadata
)
VALUES
  ('sgo', 'rushing_attempts-all-game-ou',          'Player Rushing Attempts', 'player_rushing_attempts_ou',  'NFL', '{}'),
  ('sgo', 'passing_attempts-all-game-ou',          'Player Passing Attempts', 'player_passing_attempts_ou',  'NFL', '{}'),
  ('sgo', 'rushing_receiving_yards-all-game-ou',   'Player Rush + Rec Yards', 'player_rush_rec_yards_ou',    'NFL', '{}'),
  ('sgo', 'tackles-all-game-ou',                   'Player Tackles',          'player_tackles_ou',           'NFL', '{}'),
  ('sgo', 'sacks-all-game-ou',                     'Player Sacks',            'player_sacks_ou',             'NFL', '{}')
ON CONFLICT (provider, provider_market_key, sport_id) DO NOTHING;

-- NHL player prop aliases (new market types)
INSERT INTO public.provider_market_aliases (
  provider, provider_market_key, provider_display_name, market_type_id, sport_id, metadata
)
VALUES
  ('sgo', 'goalie_goals_against-all-game-ou',  'Goalie Goals Against', 'player_goals_against_ou',  'NHL', '{}'),
  ('sgo', 'save_percentage-all-game-ou',       'Goalie Save Pct',      'player_save_pct_ou',       'NHL', '{}'),
  ('sgo', 'plus_minus-all-game-ou',            'Player Plus/Minus',    'player_plus_minus_ou',     'NHL', '{}')
ON CONFLICT (provider, provider_market_key, sport_id) DO NOTHING;

-- Backfill stat_type_id for new NFL provider_market_aliases
UPDATE public.provider_market_aliases pma
SET stat_type_id = st.id
FROM public.stat_types st
WHERE pma.provider = 'sgo'
  AND pma.sport_id = 'NFL'
  AND st.sport_id = 'NFL'
  AND (
    (pma.provider_market_key = 'rushing_attempts-all-game-ou'       AND st.canonical_key = 'rushing_attempts')
    OR (pma.provider_market_key = 'passing_attempts-all-game-ou'    AND st.canonical_key = 'passing_attempts')
    OR (pma.provider_market_key = 'rushing_receiving_yards-all-game-ou' AND st.canonical_key = 'rush_rec_yards')
    OR (pma.provider_market_key = 'tackles-all-game-ou'             AND st.canonical_key = 'tackles')
    OR (pma.provider_market_key = 'sacks-all-game-ou'               AND st.canonical_key = 'sacks')
  )
  AND pma.stat_type_id IS NULL;

-- Backfill stat_type_id for new NHL provider_market_aliases
UPDATE public.provider_market_aliases pma
SET stat_type_id = st.id
FROM public.stat_types st
WHERE pma.provider = 'sgo'
  AND pma.sport_id = 'NHL'
  AND st.sport_id = 'NHL'
  AND (
    (pma.provider_market_key = 'goalie_goals_against-all-game-ou'  AND st.canonical_key = 'goals_against')
    OR (pma.provider_market_key = 'save_percentage-all-game-ou'    AND st.canonical_key = 'save_percentage')
    OR (pma.provider_market_key = 'plus_minus-all-game-ou'         AND st.canonical_key = 'plus_minus')
  )
  AND pma.stat_type_id IS NULL;
