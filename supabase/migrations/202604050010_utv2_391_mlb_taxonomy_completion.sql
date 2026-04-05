-- UTV2-391: Smart Form MLB taxonomy completion
--
-- Adds missing MLB stat types, market types, sport_market_type_availability entries,
-- and SGO provider_market_aliases for:
--   Singles (1B), Doubles (2B), Triples (3B), Hits+Runs+RBIs (combo),
--   Earned Runs, Hits Allowed, Pitcher Outs
--
-- The smart form form-utils.ts already handles label inference for all these
-- market type IDs. This migration wires the canonical DB layer.

-- ── 1. Stat types ──────────────────────────────────────────────────────────────

INSERT INTO public.stat_types (sport_id, name, abbreviation, sort_order)
SELECT 'MLB', name, abbreviation, sort_order
FROM (VALUES
  ('Singles',       '1B', 40),
  ('Doubles',       '2B', 41),
  ('Triples',       '3B', 42),
  ('Earned Runs',   'ER', 50),
  ('Hits Allowed',  'HA', 51),
  ('Pitcher Outs',  'PO', 52)
) AS v(name, abbreviation, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.stat_types
  WHERE sport_id = 'MLB' AND name = v.name
);

-- Backfill canonical_key for newly inserted and any existing rows missing it
UPDATE public.stat_types SET canonical_key = CASE
  WHEN sport_id = 'MLB' AND name = 'Singles'       THEN 'singles'
  WHEN sport_id = 'MLB' AND name = 'Doubles'       THEN 'doubles'
  WHEN sport_id = 'MLB' AND name = 'Triples'       THEN 'triples'
  WHEN sport_id = 'MLB' AND name = 'Earned Runs'   THEN 'earned_runs'
  WHEN sport_id = 'MLB' AND name = 'Hits Allowed'  THEN 'hits_allowed'
  WHEN sport_id = 'MLB' AND name = 'Pitcher Outs'  THEN 'pitcher_outs'
  ELSE canonical_key
END
WHERE sport_id = 'MLB'
  AND name IN ('Singles', 'Doubles', 'Triples', 'Earned Runs', 'Hits Allowed', 'Pitcher Outs')
  AND (canonical_key IS NULL OR canonical_key != CASE
    WHEN name = 'Singles'       THEN 'singles'
    WHEN name = 'Doubles'       THEN 'doubles'
    WHEN name = 'Triples'       THEN 'triples'
    WHEN name = 'Earned Runs'   THEN 'earned_runs'
    WHEN name = 'Hits Allowed'  THEN 'hits_allowed'
    WHEN name = 'Pitcher Outs'  THEN 'pitcher_outs'
  END);

-- ── 2. Combo stat type: Hits + Runs + RBIs ────────────────────────────────────

INSERT INTO public.combo_stat_types (id, sport_id, display_name, abbreviation, sort_order, active)
VALUES ('mlb_hrr', 'MLB', 'Hits + Runs + RBIs', 'H+R+RBI', 60, true)
ON CONFLICT (id) DO NOTHING;

-- Link combo to its component stat types
INSERT INTO public.combo_stat_type_components (combo_stat_type_id, stat_type_id, sort_order)
SELECT 'mlb_hrr', st.id, ord.sort_order
FROM public.stat_types st
JOIN (VALUES
  ('hits',  1),
  ('runs',  2),
  ('rbi',   3)
) AS ord(canonical_key, sort_order) ON st.canonical_key = ord.canonical_key
WHERE st.sport_id = 'MLB'
ON CONFLICT DO NOTHING;

-- ── 3. Market types ───────────────────────────────────────────────────────────

INSERT INTO public.market_types (id, family_id, structure, display_name, abbreviation, active, canonical, sort_order)
VALUES
  ('player_batting_singles_ou',        'player_prop', 'over_under', 'Player Singles',           '1B',     true, true, 28),
  ('player_batting_doubles_ou',        'player_prop', 'over_under', 'Player Doubles',           '2B',     true, true, 29),
  ('player_batting_triples_ou',        'player_prop', 'over_under', 'Player Triples',           '3B',     true, true, 30),
  ('player_batting_hrr_ou',            'player_prop', 'over_under', 'Player Hits + Runs + RBIs', 'H+R+RBI', true, true, 31),
  ('player_pitching_earned_runs_ou',   'player_prop', 'over_under', 'Pitcher Earned Runs',      'ER',     true, true, 32),
  ('player_pitching_hits_allowed_ou',  'player_prop', 'over_under', 'Pitcher Hits Allowed',     'HA',     true, true, 33),
  ('player_pitching_outs_ou',          'player_prop', 'over_under', 'Pitcher Outs',             'PO',     true, true, 34)
ON CONFLICT (id) DO NOTHING;

-- ── 4. Sport market type availability for MLB ─────────────────────────────────

INSERT INTO public.sport_market_type_availability (sport_id, market_type_id, active, sort_order)
VALUES
  ('MLB', 'player_batting_singles_ou',       true, 17),
  ('MLB', 'player_batting_doubles_ou',       true, 18),
  ('MLB', 'player_batting_triples_ou',       true, 19),
  ('MLB', 'player_batting_hrr_ou',           true, 20),
  ('MLB', 'player_pitching_earned_runs_ou',  true, 21),
  ('MLB', 'player_pitching_hits_allowed_ou', true, 22),
  ('MLB', 'player_pitching_outs_ou',         true, 23)
ON CONFLICT (sport_id, market_type_id) DO NOTHING;

-- ── 5. SGO provider_market_aliases ────────────────────────────────────────────

INSERT INTO public.provider_market_aliases (
  provider,
  provider_market_key,
  provider_display_name,
  market_type_id,
  sport_id
) VALUES
  ('sgo', 'batting-singles-all-game-ou',        'Singles',             'player_batting_singles_ou',        'MLB'),
  ('sgo', 'batting-singles-all-1h-ou',          'Singles (1H)',        'player_batting_singles_ou',        'MLB'),
  ('sgo', 'batting-doubles-all-game-ou',        'Doubles',             'player_batting_doubles_ou',        'MLB'),
  ('sgo', 'batting-doubles-all-1h-ou',          'Doubles (1H)',        'player_batting_doubles_ou',        'MLB'),
  ('sgo', 'batting-triples-all-game-ou',        'Triples',             'player_batting_triples_ou',        'MLB'),
  ('sgo', 'batting-hits-runs-rbis-all-game-ou', 'Hits + Runs + RBIs',  'player_batting_hrr_ou',            'MLB'),
  ('sgo', 'pitching-earned-runs-all-game-ou',   'Earned Runs',         'player_pitching_earned_runs_ou',   'MLB'),
  ('sgo', 'pitching-hits-allowed-all-game-ou',  'Hits Allowed',        'player_pitching_hits_allowed_ou',  'MLB'),
  ('sgo', 'pitching-outs-all-game-ou',          'Pitcher Outs',        'player_pitching_outs_ou',          'MLB')
ON CONFLICT (provider, provider_market_key) DO NOTHING;
