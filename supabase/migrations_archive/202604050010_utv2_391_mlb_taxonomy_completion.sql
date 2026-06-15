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
--
-- Originally this INSERT used a non-existent `abbreviation` column on
-- `public.stat_types` and also omitted the NOT NULL columns
-- `canonical_key`, `display_name`, and `short_label` that were added and
-- locked NOT NULL by `202604020002_canonical_market_taxonomy.sql`. The
-- migration failed to apply on any fresh database at this statement.
-- Fixed by writing the correct column set directly, matching the shape
-- that UTV2-436 (`202604070014_utv2_436_mlb_stat_types_column_fix.sql`)
-- later adopted as the compensating migration. UTV2-436 remains in the
-- chain as a belt-and-suspenders backstop; its `WHERE NOT EXISTS` guard
-- makes it a safe no-op on fresh DBs once this section inserts the rows
-- first.
INSERT INTO public.stat_types (sport_id, name, display_name, short_label, canonical_key, sort_order)
SELECT 'MLB', v.name, v.display_name, v.short_label, v.canonical_key, v.sort_order
FROM (VALUES
  ('Singles',       'Singles',       '1B', 'singles',      40),
  ('Doubles',       'Doubles',       '2B', 'doubles',      41),
  ('Triples',       'Triples',       '3B', 'triples',      42),
  ('Earned Runs',   'Earned Runs',   'ER', 'earned_runs',  50),
  ('Hits Allowed',  'Hits Allowed',  'HA', 'hits_allowed', 51),
  ('Pitcher Outs',  'Pitcher Outs',  'PO', 'pitcher_outs', 52)
) AS v(name, display_name, short_label, canonical_key, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.stat_types
  WHERE sport_id = 'MLB' AND canonical_key = v.canonical_key
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

-- ── 2. Market types ───────────────────────────────────────────────────────────
--
-- Original column list used `family_id` / `structure` / `abbreviation` /
-- `canonical` — none of which exist on `public.market_types`. The correct
-- column names per `202604020002_canonical_market_taxonomy.sql` lines
-- 115-128 are `market_family_id` / `selection_type_id` / `short_label`,
-- and there is no `canonical` column. Fixed in place. Also reordered to
-- come BEFORE the combo_stat_types block below because
-- `combo_stat_types.market_type_id` is a NOT NULL FK to `market_types(id)`
-- (202604020002 line 144) — the FK would fail if the combo were inserted
-- first.
INSERT INTO public.market_types (id, market_family_id, selection_type_id, display_name, short_label, active, sort_order)
VALUES
  ('player_batting_singles_ou',        'player_prop', 'over_under', 'Player Singles',           '1B',      true, 28),
  ('player_batting_doubles_ou',        'player_prop', 'over_under', 'Player Doubles',           '2B',      true, 29),
  ('player_batting_triples_ou',        'player_prop', 'over_under', 'Player Triples',           '3B',      true, 30),
  ('player_batting_hrr_ou',            'player_prop', 'over_under', 'Player Hits + Runs + RBIs', 'H+R+RBI', true, 31),
  ('player_pitching_earned_runs_ou',   'player_prop', 'over_under', 'Pitcher Earned Runs',      'ER',      true, 32),
  ('player_pitching_hits_allowed_ou',  'player_prop', 'over_under', 'Pitcher Hits Allowed',     'HA',      true, 33),
  ('player_pitching_outs_ou',          'player_prop', 'over_under', 'Pitcher Outs',             'PO',      true, 34)
ON CONFLICT (id) DO NOTHING;

-- ── 3. Combo stat type: Hits + Runs + RBIs ────────────────────────────────────
--
-- Original INSERT used `abbreviation` (should be `short_label`) and omitted
-- the NOT NULL FK column `market_type_id`. Fixed both: rename the column
-- and point the combo at `player_batting_hrr_ou` which was just created
-- above. The combo FK now resolves cleanly on fresh DBs.
INSERT INTO public.combo_stat_types (id, sport_id, market_type_id, display_name, short_label, sort_order, active)
VALUES ('mlb_hrr', 'MLB', 'player_batting_hrr_ou', 'Hits + Runs + RBIs', 'H+R+RBI', 60, true)
ON CONFLICT (id) DO NOTHING;

-- Link combo to its component stat types.
-- Original INSERT used `sort_order` which does not exist on
-- `combo_stat_type_components`. The correct column is `weight` (NOT NULL
-- numeric per 202604020002 line 158). Renamed to `weight` with the same
-- integer values, which Postgres implicitly casts to numeric(10,4).
INSERT INTO public.combo_stat_type_components (combo_stat_type_id, stat_type_id, weight)
SELECT 'mlb_hrr', st.id, ord.weight
FROM public.stat_types st
JOIN (VALUES
  ('hits',  1),
  ('runs',  2),
  ('rbi',   3)
) AS ord(canonical_key, weight) ON st.canonical_key = ord.canonical_key
WHERE st.sport_id = 'MLB'
ON CONFLICT DO NOTHING;

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
ON CONFLICT (provider, provider_market_key, sport_id) DO NOTHING;
