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

INSERT INTO public.stat_types (sport_id, name, sort_order)
SELECT 'NFL', name, sort_order
FROM (VALUES
  ('Rushing Attempts',   7),
  ('Passing Attempts',   8),
  ('Passing Touchdowns', 9),
  ('Rush + Rec Yards',  10),
  ('Tackles',           11),
  ('Sacks',             12)
) AS v(name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.stat_types
  WHERE sport_id = 'NFL' AND name = v.name
);

-- Backfill canonical_key / display_name / short_label for new NFL stat types
UPDATE public.stat_types
SET
  canonical_key  = CASE name
    WHEN 'Rushing Attempts'   THEN 'rushing_attempts'
    WHEN 'Passing Attempts'   THEN 'passing_attempts'
    WHEN 'Passing Touchdowns' THEN 'passing_tds'
    WHEN 'Rush + Rec Yards'   THEN 'rush_rec_yards'
    WHEN 'Tackles'            THEN 'tackles'
    WHEN 'Sacks'              THEN 'sacks'
  END,
  display_name   = name,
  short_label    = CASE name
    WHEN 'Rushing Attempts'   THEN 'RUSH ATT'
    WHEN 'Passing Attempts'   THEN 'PASS ATT'
    WHEN 'Passing Touchdowns' THEN 'PASS TDS'
    WHEN 'Rush + Rec Yards'   THEN 'R+R YDS'
    WHEN 'Tackles'            THEN 'TCKL'
    WHEN 'Sacks'              THEN 'SACKS'
  END
WHERE sport_id = 'NFL'
  AND name IN ('Rushing Attempts', 'Passing Attempts', 'Passing Touchdowns',
               'Rush + Rec Yards', 'Tackles', 'Sacks')
  AND canonical_key IS NULL;

-- ── 2. NCAAF stat types (missing) ─────────────────────────────────────────────

INSERT INTO public.stat_types (sport_id, name, sort_order)
SELECT 'NCAAF', name, sort_order
FROM (VALUES
  ('Receptions',         5),
  ('Interceptions',      6),
  ('Rushing Attempts',   7),
  ('Passing Attempts',   8),
  ('Passing Touchdowns', 9),
  ('Rush + Rec Yards',  10)
) AS v(name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.stat_types
  WHERE sport_id = 'NCAAF' AND name = v.name
);

-- Backfill canonical_key / display_name / short_label for new NCAAF stat types
UPDATE public.stat_types
SET
  canonical_key  = CASE name
    WHEN 'Receptions'         THEN 'receptions'
    WHEN 'Interceptions'      THEN 'interceptions'
    WHEN 'Rushing Attempts'   THEN 'rushing_attempts'
    WHEN 'Passing Attempts'   THEN 'passing_attempts'
    WHEN 'Passing Touchdowns' THEN 'passing_tds'
    WHEN 'Rush + Rec Yards'   THEN 'rush_rec_yards'
  END,
  display_name   = name,
  short_label    = CASE name
    WHEN 'Receptions'         THEN 'REC'
    WHEN 'Interceptions'      THEN 'INT'
    WHEN 'Rushing Attempts'   THEN 'RUSH ATT'
    WHEN 'Passing Attempts'   THEN 'PASS ATT'
    WHEN 'Passing Touchdowns' THEN 'PASS TDS'
    WHEN 'Rush + Rec Yards'   THEN 'R+R YDS'
  END
WHERE sport_id = 'NCAAF'
  AND name IN ('Receptions', 'Interceptions', 'Rushing Attempts', 'Passing Attempts',
               'Passing Touchdowns', 'Rush + Rec Yards')
  AND canonical_key IS NULL;

-- ── 3. NHL stat types (missing) ───────────────────────────────────────────────

INSERT INTO public.stat_types (sport_id, name, sort_order)
SELECT 'NHL', name, sort_order
FROM (VALUES
  ('Goals Against',    7),
  ('Save Percentage',  8),
  ('Plus/Minus',       9)
) AS v(name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.stat_types
  WHERE sport_id = 'NHL' AND name = v.name
);

-- Backfill canonical_key / display_name / short_label for new NHL stat types
UPDATE public.stat_types
SET
  canonical_key  = CASE name
    WHEN 'Goals Against'    THEN 'goals_against'
    WHEN 'Save Percentage'  THEN 'save_percentage'
    WHEN 'Plus/Minus'       THEN 'plus_minus'
  END,
  display_name   = name,
  short_label    = CASE name
    WHEN 'Goals Against'    THEN 'GA'
    WHEN 'Save Percentage'  THEN 'SV%'
    WHEN 'Plus/Minus'       THEN '+/-'
  END
WHERE sport_id = 'NHL'
  AND name IN ('Goals Against', 'Save Percentage', 'Plus/Minus')
  AND canonical_key IS NULL;

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
