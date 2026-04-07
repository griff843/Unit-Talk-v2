-- UTV2-392: Smart Form NBA/NCAAB taxonomy completion
--
-- Audit findings:
--   NBA gaps:
--     - Turnovers stat_type row missing (market_type player_turnovers_ou exists + SGO aliases,
--       but no underlying stat_types row was ever inserted)
--     - field_goals_made, free_throws_made, minutes_played, plus_minus not present
--     - double_double, triple_double market_types not present
--   NCAAB gaps:
--     - Only Points/Rebounds/Assists stat types exist (no Steals, Blocks, Turnovers, Threes)
--     - No player prop market_type_availability (only moneyline/spread/game_total_ou)
--     - No combo market types (PRA, P+R, P+A, R+A)
--
-- What already exists (not touched):
--   NBA: Points, Rebounds, Assists, Threes, Steals, Blocks, Points+Assists stat_types
--   NBA: moneyline/spread/game_total_ou/team_total_ou + full player_prop market_types
--   NBA: pra/pts_rebs/pts_asts/rebs_asts combo_stat_types
--   NCAAB: Points, Rebounds, Assists stat_types; moneyline/spread/game_total_ou
--
-- Schema reference (from database.types.ts generated from live Supabase):
--   stat_types: sport_id, name, canonical_key, display_name, short_label, sort_order, active
--   market_types: id, market_family_id, selection_type_id, display_name, short_label,
--                 requires_line, requires_participant, sort_order, active, metadata
--   sport_market_type_availability: sport_id, market_type_id, active, sort_order, metadata
--   combo_stat_types: id, sport_id, market_type_id, display_name, short_label, sort_order, active
--
-- All inserts are idempotent (ON CONFLICT DO NOTHING).

-- ── 1. NBA: missing stat_type rows ────────────────────────────────────────────

-- Turnovers: player_turnovers_ou market_type exists and has SGO aliases, but the
-- underlying stat_types row was never inserted in the foundation migration.
INSERT INTO public.stat_types (sport_id, name, canonical_key, display_name, short_label, sort_order, active)
VALUES
  ('NBA', 'Turnovers',         'turnovers',        'Turnovers',         'TO',  7,  true),
  ('NBA', 'Field Goals Made',  'field_goals_made', 'Field Goals Made',  'FGM', 8,  true),
  ('NBA', 'Free Throws Made',  'free_throws_made', 'Free Throws Made',  'FTM', 9,  true),
  ('NBA', 'Minutes Played',    'minutes_played',   'Minutes Played',    'MIN', 10, true),
  ('NBA', 'Plus Minus',        'plus_minus',       'Plus/Minus',        '+/-', 11, true)
ON CONFLICT (sport_id, name) DO NOTHING;

-- ── 2. NCAAB: missing stat_type rows ──────────────────────────────────────────

-- NCAAB shares all NBA player-prop stat categories in live sportsbook coverage.
INSERT INTO public.stat_types (sport_id, name, canonical_key, display_name, short_label, sort_order, active)
VALUES
  ('NCAAB', 'Steals',          'steals',           'Steals',            'STL', 4,  true),
  ('NCAAB', 'Blocks',          'blocks',           'Blocks',            'BLK', 5,  true),
  ('NCAAB', 'Turnovers',       'turnovers',        'Turnovers',         'TO',  6,  true),
  ('NCAAB', 'Threes',          'threes',           'Three Pointers Made','3PM', 7, true),
  ('NCAAB', 'Field Goals Made','field_goals_made', 'Field Goals Made',  'FGM', 8,  true),
  ('NCAAB', 'Free Throws Made','free_throws_made', 'Free Throws Made',  'FTM', 9,  true)
ON CONFLICT (sport_id, name) DO NOTHING;

-- ── 3. NBA + NCAAB: new market_types ──────────────────────────────────────────

-- double_double and triple_double are yes/no props (not over/under).
INSERT INTO public.market_types (
  id, market_family_id, selection_type_id, display_name, short_label,
  requires_line, requires_participant, sort_order, active
) VALUES
  ('player_fgm_ou',        'player_prop', 'over_under', 'Player Field Goals Made', 'FGM', true,  true, 21, true),
  ('player_ftm_ou',        'player_prop', 'over_under', 'Player Free Throws Made', 'FTM', true,  true, 22, true),
  ('player_minutes_ou',    'player_prop', 'over_under', 'Player Minutes Played',   'MIN', true,  true, 23, true),
  ('player_plus_minus_ou', 'player_prop', 'over_under', 'Player Plus/Minus',       '+/-', true,  true, 24, true),
  ('player_double_double', 'player_prop', 'yes_no',     'Double Double',           'DD',  false, true, 25, true),
  ('player_triple_double', 'player_prop', 'yes_no',     'Triple Double',           'TD',  false, true, 26, true)
ON CONFLICT (id) DO NOTHING;

-- ── 4. NBA: sport_market_type_availability for new market_types ───────────────

INSERT INTO public.sport_market_type_availability (sport_id, market_type_id, sort_order, active)
VALUES
  ('NBA', 'player_fgm_ou',        21, true),
  ('NBA', 'player_ftm_ou',        22, true),
  ('NBA', 'player_minutes_ou',    23, true),
  ('NBA', 'player_plus_minus_ou', 24, true),
  ('NBA', 'player_double_double', 25, true),
  ('NBA', 'player_triple_double', 26, true)
ON CONFLICT (sport_id, market_type_id) DO NOTHING;

-- ── 5. NCAAB: sport_market_type_availability ──────────────────────────────────
--
-- NCAAB previously had only moneyline/spread/game_total_ou.
-- Add all player prop market types matching live NCAAB sportsbook coverage.

INSERT INTO public.sport_market_type_availability (sport_id, market_type_id, sort_order, active)
VALUES
  ('NCAAB', 'team_total_ou',       4,  true),
  ('NCAAB', 'player_points_ou',    10, true),
  ('NCAAB', 'player_rebounds_ou',  11, true),
  ('NCAAB', 'player_assists_ou',   12, true),
  ('NCAAB', 'player_3pm_ou',       13, true),
  ('NCAAB', 'player_steals_ou',    14, true),
  ('NCAAB', 'player_blocks_ou',    15, true),
  ('NCAAB', 'player_turnovers_ou', 16, true),
  ('NCAAB', 'player_pra_ou',       17, true),
  ('NCAAB', 'player_pts_rebs_ou',  18, true),
  ('NCAAB', 'player_pts_asts_ou',  19, true),
  ('NCAAB', 'player_rebs_asts_ou', 20, true),
  ('NCAAB', 'player_double_double',25, true),
  ('NCAAB', 'player_triple_double',26, true)
ON CONFLICT (sport_id, market_type_id) DO NOTHING;

-- ── 6. NCAAB: combo_stat_types (mirror of NBA combos, scoped to NCAAB) ───────

INSERT INTO public.combo_stat_types (id, sport_id, market_type_id, display_name, short_label, sort_order, active)
VALUES
  ('ncaab_pra',       'NCAAB', 'player_pra_ou',       'Points + Rebounds + Assists', 'PRA', 1, true),
  ('ncaab_pts_rebs',  'NCAAB', 'player_pts_rebs_ou',  'Points + Rebounds',           'P+R', 2, true),
  ('ncaab_pts_asts',  'NCAAB', 'player_pts_asts_ou',  'Points + Assists',            'P+A', 3, true),
  ('ncaab_rebs_asts', 'NCAAB', 'player_rebs_asts_ou', 'Rebounds + Assists',          'R+A', 4, true)
ON CONFLICT (id) DO NOTHING;

-- Wire NCAAB combo components to their NCAAB stat_type rows.
INSERT INTO public.combo_stat_type_components (combo_stat_type_id, stat_type_id)
SELECT combo.id, stat.id
FROM public.combo_stat_types AS combo
JOIN public.stat_types AS stat ON stat.sport_id = combo.sport_id
WHERE combo.sport_id = 'NCAAB'
  AND (
    (combo.id = 'ncaab_pra'       AND stat.canonical_key IN ('points', 'rebounds', 'assists'))
    OR (combo.id = 'ncaab_pts_rebs'  AND stat.canonical_key IN ('points', 'rebounds'))
    OR (combo.id = 'ncaab_pts_asts'  AND stat.canonical_key IN ('points', 'assists'))
    OR (combo.id = 'ncaab_rebs_asts' AND stat.canonical_key IN ('rebounds', 'assists'))
  )
ON CONFLICT DO NOTHING;

-- ── 7. SGO provider_market_aliases for new NBA market_types ──────────────────

INSERT INTO public.provider_market_aliases (
  provider,
  provider_market_key,
  provider_display_name,
  market_type_id,
  sport_id
) VALUES
  ('sgo', 'fieldGoals-all-game-ou',   'Field Goals Made',  'player_fgm_ou',        'NBA'),
  ('sgo', 'freeThrows-all-game-ou',   'Free Throws Made',  'player_ftm_ou',        'NBA'),
  ('sgo', 'minutes-all-game-ou',      'Minutes Played',    'player_minutes_ou',    'NBA'),
  ('sgo', 'plusMinus-all-game-ou',    'Plus/Minus',        'player_plus_minus_ou', 'NBA'),
  ('sgo', 'doubleDouble-all-game-yn', 'Double Double',     'player_double_double', 'NBA'),
  ('sgo', 'tripleDouble-all-game-yn', 'Triple Double',     'player_triple_double', 'NBA')
ON CONFLICT (provider, provider_market_key, sport_id) DO NOTHING;
