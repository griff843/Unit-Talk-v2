-- Migration: Canonical market taxonomy and provider alias registry
-- Description: Extend stat types with canonical labels and add DB-backed market,
--   selection, combo-stat, and provider alias reference tables.
-- Rollback: DROP TABLE provider_book_aliases, provider_market_aliases, provider_entity_aliases,
--   combo_stat_type_components, combo_stat_types, sport_market_type_availability,
--   market_types, market_families, selection_types CASCADE;

ALTER TABLE public.stat_types
  ADD COLUMN canonical_key text,
  ADD COLUMN display_name text,
  ADD COLUMN short_label text;

UPDATE public.stat_types
SET canonical_key = CASE
  WHEN sport_id = 'NBA' AND name = 'Points' THEN 'points'
  WHEN sport_id = 'NBA' AND name = 'Rebounds' THEN 'rebounds'
  WHEN sport_id = 'NBA' AND name = 'Assists' THEN 'assists'
  WHEN sport_id = 'NBA' AND name = 'Threes' THEN 'threes'
  WHEN sport_id = 'NBA' AND name = 'Steals' THEN 'steals'
  WHEN sport_id = 'NBA' AND name = 'Blocks' THEN 'blocks'
  WHEN sport_id = 'NFL' AND name = 'Passing Yards' THEN 'passing_yards'
  WHEN sport_id = 'NFL' AND name = 'Rushing Yards' THEN 'rushing_yards'
  WHEN sport_id = 'NFL' AND name = 'Receiving Yards' THEN 'receiving_yards'
  WHEN sport_id = 'NFL' AND name = 'Touchdowns' THEN 'touchdowns'
  WHEN sport_id = 'NFL' AND name = 'Receptions' THEN 'receptions'
  WHEN sport_id = 'NFL' AND name = 'Interceptions' THEN 'interceptions'
  WHEN sport_id = 'MLB' AND name = 'Strikeouts' THEN 'strikeouts'
  WHEN sport_id = 'MLB' AND name = 'Hits' THEN 'hits'
  WHEN sport_id = 'MLB' AND name = 'Home Runs' THEN 'home_runs'
  WHEN sport_id = 'MLB' AND name = 'RBI' THEN 'rbi'
  WHEN sport_id = 'MLB' AND name = 'Runs' THEN 'runs'
  WHEN sport_id = 'MLB' AND name = 'Walks' THEN 'walks'
  WHEN sport_id = 'MLB' AND name = 'Total Bases' THEN 'total_bases'
  WHEN sport_id = 'NHL' AND name = 'Shots on Goal' THEN 'shots_on_goal'
  WHEN sport_id = 'NHL' AND name = 'Saves' THEN 'saves'
  WHEN sport_id = 'NHL' AND name = 'Goals' THEN 'goals'
  WHEN sport_id = 'NHL' AND name = 'Assists' THEN 'assists'
  WHEN sport_id = 'NHL' AND name = 'Points' THEN 'points'
  WHEN sport_id = 'NHL' AND name = 'Blocked Shots' THEN 'blocked_shots'
  WHEN sport_id = 'NCAAB' AND name = 'Points' THEN 'points'
  WHEN sport_id = 'NCAAB' AND name = 'Rebounds' THEN 'rebounds'
  WHEN sport_id = 'NCAAB' AND name = 'Assists' THEN 'assists'
  WHEN sport_id = 'NCAAF' AND name = 'Passing Yards' THEN 'passing_yards'
  WHEN sport_id = 'NCAAF' AND name = 'Rushing Yards' THEN 'rushing_yards'
  WHEN sport_id = 'NCAAF' AND name = 'Receiving Yards' THEN 'receiving_yards'
  WHEN sport_id = 'NCAAF' AND name = 'Touchdowns' THEN 'touchdowns'
  WHEN sport_id = 'Soccer' AND name = 'Shots on Target' THEN 'shots_on_target'
  WHEN sport_id = 'Soccer' AND name = 'Goals' THEN 'goals'
  WHEN sport_id = 'Soccer' AND name = 'Assists' THEN 'assists'
  WHEN sport_id = 'Tennis' AND name = 'Aces' THEN 'aces'
  WHEN sport_id = 'Tennis' AND name = 'Double Faults' THEN 'double_faults'
  WHEN sport_id = 'Tennis' AND name = 'Games Won' THEN 'games_won'
  ELSE lower(regexp_replace(name, '[^a-zA-Z0-9]+', '_', 'g'))
END,
display_name = name,
short_label = CASE
  WHEN name = 'Points' THEN 'PTS'
  WHEN name = 'Rebounds' THEN 'REB'
  WHEN name = 'Assists' THEN 'AST'
  WHEN name = 'Threes' THEN '3PM'
  WHEN name = 'Steals' THEN 'STL'
  WHEN name = 'Blocks' THEN 'BLK'
  WHEN name = 'Passing Yards' THEN 'PASS YDS'
  WHEN name = 'Rushing Yards' THEN 'RUSH YDS'
  WHEN name = 'Receiving Yards' THEN 'REC YDS'
  WHEN name = 'Touchdowns' THEN 'TD'
  WHEN name = 'Receptions' THEN 'REC'
  WHEN name = 'Interceptions' THEN 'INT'
  WHEN name = 'Strikeouts' THEN 'K'
  WHEN name = 'Hits' THEN 'H'
  WHEN name = 'Home Runs' THEN 'HR'
  WHEN name = 'RBI' THEN 'RBI'
  WHEN name = 'Runs' THEN 'R'
  WHEN name = 'Walks' THEN 'BB'
  WHEN name = 'Total Bases' THEN 'TB'
  WHEN name = 'Shots on Goal' THEN 'SOG'
  WHEN name = 'Saves' THEN 'SV'
  WHEN name = 'Goals' THEN 'G'
  WHEN name = 'Blocked Shots' THEN 'BS'
  WHEN name = 'Shots on Target' THEN 'SOT'
  WHEN name = 'Aces' THEN 'ACES'
  WHEN name = 'Double Faults' THEN 'DF'
  WHEN name = 'Games Won' THEN 'GW'
  ELSE upper(name)
END;

ALTER TABLE public.stat_types
  ALTER COLUMN canonical_key SET NOT NULL,
  ALTER COLUMN display_name SET NOT NULL,
  ALTER COLUMN short_label SET NOT NULL;

CREATE UNIQUE INDEX uq_stat_types_sport_canonical_key
  ON public.stat_types(sport_id, canonical_key);

CREATE TABLE public.selection_types (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE public.market_families (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE public.market_types (
  id text PRIMARY KEY,
  market_family_id text NOT NULL REFERENCES public.market_families(id) ON DELETE RESTRICT,
  selection_type_id text NOT NULL REFERENCES public.selection_types(id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  short_label text NOT NULL,
  requires_line boolean NOT NULL DEFAULT false,
  requires_participant boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE public.sport_market_type_availability (
  sport_id text NOT NULL REFERENCES public.sports(id) ON DELETE CASCADE,
  market_type_id text NOT NULL REFERENCES public.market_types(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (sport_id, market_type_id)
);

CREATE TABLE public.combo_stat_types (
  id text PRIMARY KEY,
  sport_id text NOT NULL REFERENCES public.sports(id) ON DELETE CASCADE,
  market_type_id text NOT NULL REFERENCES public.market_types(id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  short_label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_combo_stat_types_sport_display UNIQUE (sport_id, display_name)
);

CREATE TABLE public.combo_stat_type_components (
  combo_stat_type_id text NOT NULL REFERENCES public.combo_stat_types(id) ON DELETE CASCADE,
  stat_type_id uuid NOT NULL REFERENCES public.stat_types(id) ON DELETE CASCADE,
  weight numeric(10,4) NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (combo_stat_type_id, stat_type_id)
);

CREATE TABLE public.provider_entity_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  entity_kind text NOT NULL CHECK (entity_kind IN ('team', 'player', 'participant')),
  provider_entity_key text NOT NULL,
  provider_entity_id text,
  provider_display_name text NOT NULL,
  participant_id uuid REFERENCES public.participants(id) ON DELETE CASCADE,
  team_id text REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id uuid REFERENCES public.players(id) ON DELETE CASCADE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT ck_provider_entity_alias_target CHECK (
    participant_id IS NOT NULL OR team_id IS NOT NULL OR player_id IS NOT NULL
  ),
  CONSTRAINT uq_provider_entity_alias UNIQUE (provider, entity_kind, provider_entity_key)
);

CREATE TABLE public.provider_market_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_market_key text NOT NULL,
  provider_display_name text NOT NULL,
  market_type_id text NOT NULL REFERENCES public.market_types(id) ON DELETE CASCADE,
  sport_id text REFERENCES public.sports(id) ON DELETE CASCADE,
  stat_type_id uuid REFERENCES public.stat_types(id) ON DELETE SET NULL,
  combo_stat_type_id text REFERENCES public.combo_stat_types(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_provider_market_alias UNIQUE (provider, provider_market_key, sport_id)
);

CREATE TABLE public.provider_book_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_book_key text NOT NULL,
  provider_display_name text NOT NULL,
  sportsbook_id text NOT NULL REFERENCES public.sportsbooks(id) ON DELETE CASCADE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_provider_book_alias UNIQUE (provider, provider_book_key)
);

CREATE INDEX idx_market_types_family ON public.market_types(market_family_id, sort_order);
CREATE INDEX idx_sport_market_type_availability_active
  ON public.sport_market_type_availability(sport_id, active, sort_order);
CREATE INDEX idx_combo_stat_types_sport ON public.combo_stat_types(sport_id, active, sort_order);
CREATE INDEX idx_provider_entity_aliases_lookup
  ON public.provider_entity_aliases(provider, entity_kind, provider_entity_key);
CREATE INDEX idx_provider_market_aliases_lookup
  ON public.provider_market_aliases(provider, provider_market_key);
CREATE INDEX idx_provider_book_aliases_lookup
  ON public.provider_book_aliases(provider, provider_book_key);

CREATE TRIGGER set_selection_types_updated_at
  BEFORE UPDATE ON public.selection_types
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_market_families_updated_at
  BEFORE UPDATE ON public.market_families
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_market_types_updated_at
  BEFORE UPDATE ON public.market_types
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_sport_market_type_availability_updated_at
  BEFORE UPDATE ON public.sport_market_type_availability
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_combo_stat_types_updated_at
  BEFORE UPDATE ON public.combo_stat_types
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_provider_entity_aliases_updated_at
  BEFORE UPDATE ON public.provider_entity_aliases
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_provider_market_aliases_updated_at
  BEFORE UPDATE ON public.provider_market_aliases
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_provider_book_aliases_updated_at
  BEFORE UPDATE ON public.provider_book_aliases
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.selection_types (id, display_name, sort_order) VALUES
  ('over_under', 'Over / Under', 1),
  ('home_away', 'Home / Away', 2),
  ('yes_no', 'Yes / No', 3);

INSERT INTO public.market_families (id, display_name, sort_order) VALUES
  ('moneyline', 'Moneyline', 1),
  ('spread', 'Spread', 2),
  ('total', 'Total', 3),
  ('player_prop', 'Player Prop', 4),
  ('team_prop', 'Team Prop', 5),
  ('game_prop', 'Game Prop', 6);

INSERT INTO public.market_types (
  id,
  market_family_id,
  selection_type_id,
  display_name,
  short_label,
  requires_line,
  requires_participant,
  sort_order
) VALUES
  ('moneyline', 'moneyline', 'home_away', 'Moneyline', 'ML', false, false, 1),
  ('spread', 'spread', 'home_away', 'Spread', 'SPR', true, false, 2),
  ('game_total_ou', 'total', 'over_under', 'Game Total', 'TOTAL', true, false, 3),
  ('team_total_ou', 'team_prop', 'over_under', 'Team Total', 'TT', true, true, 4),
  ('player_points_ou', 'player_prop', 'over_under', 'Player Points', 'PTS', true, true, 10),
  ('player_rebounds_ou', 'player_prop', 'over_under', 'Player Rebounds', 'REB', true, true, 11),
  ('player_assists_ou', 'player_prop', 'over_under', 'Player Assists', 'AST', true, true, 12),
  ('player_3pm_ou', 'player_prop', 'over_under', 'Player Threes', '3PM', true, true, 13),
  ('player_steals_ou', 'player_prop', 'over_under', 'Player Steals', 'STL', true, true, 14),
  ('player_blocks_ou', 'player_prop', 'over_under', 'Player Blocks', 'BLK', true, true, 15),
  ('player_turnovers_ou', 'player_prop', 'over_under', 'Player Turnovers', 'TO', true, true, 16),
  ('player_pra_ou', 'player_prop', 'over_under', 'Player Points + Rebounds + Assists', 'PRA', true, true, 17),
  ('player_pts_rebs_ou', 'player_prop', 'over_under', 'Player Points + Rebounds', 'P+R', true, true, 18),
  ('player_pts_asts_ou', 'player_prop', 'over_under', 'Player Points + Assists', 'P+A', true, true, 19),
  ('player_rebs_asts_ou', 'player_prop', 'over_under', 'Player Rebounds + Assists', 'R+A', true, true, 20),
  ('player_batting_hits_ou', 'player_prop', 'over_under', 'Player Hits', 'HITS', true, true, 21),
  ('player_batting_home_runs_ou', 'player_prop', 'over_under', 'Player Home Runs', 'HR', true, true, 22),
  ('player_batting_rbi_ou', 'player_prop', 'over_under', 'Player RBI', 'RBI', true, true, 23),
  ('player_batting_walks_ou', 'player_prop', 'over_under', 'Player Walks', 'BB', true, true, 24),
  ('player_batting_total_bases_ou', 'player_prop', 'over_under', 'Player Total Bases', 'TB', true, true, 25),
  ('player_pitching_strikeouts_ou', 'player_prop', 'over_under', 'Pitcher Strikeouts', 'K', true, true, 26),
  ('player_pitching_innings_pitched_ou', 'player_prop', 'over_under', 'Pitcher Innings Pitched', 'IP', true, true, 27);

INSERT INTO public.sport_market_type_availability (sport_id, market_type_id, sort_order)
SELECT sport_id, market_type_id, sort_order
FROM (
  VALUES
    ('NBA', 'moneyline', 1),
    ('NBA', 'spread', 2),
    ('NBA', 'game_total_ou', 3),
    ('NBA', 'team_total_ou', 4),
    ('NBA', 'player_points_ou', 10),
    ('NBA', 'player_rebounds_ou', 11),
    ('NBA', 'player_assists_ou', 12),
    ('NBA', 'player_3pm_ou', 13),
    ('NBA', 'player_steals_ou', 14),
    ('NBA', 'player_blocks_ou', 15),
    ('NBA', 'player_turnovers_ou', 16),
    ('NBA', 'player_pra_ou', 17),
    ('NBA', 'player_pts_rebs_ou', 18),
    ('NBA', 'player_pts_asts_ou', 19),
    ('NBA', 'player_rebs_asts_ou', 20),
    ('NFL', 'moneyline', 1),
    ('NFL', 'spread', 2),
    ('NFL', 'game_total_ou', 3),
    ('NFL', 'team_total_ou', 4),
    ('MLB', 'moneyline', 1),
    ('MLB', 'spread', 2),
    ('MLB', 'game_total_ou', 3),
    ('MLB', 'team_total_ou', 4),
    ('MLB', 'player_batting_hits_ou', 10),
    ('MLB', 'player_batting_home_runs_ou', 11),
    ('MLB', 'player_batting_rbi_ou', 12),
    ('MLB', 'player_batting_walks_ou', 13),
    ('MLB', 'player_batting_total_bases_ou', 14),
    ('MLB', 'player_pitching_strikeouts_ou', 15),
    ('MLB', 'player_pitching_innings_pitched_ou', 16),
    ('NHL', 'moneyline', 1),
    ('NHL', 'spread', 2),
    ('NHL', 'game_total_ou', 3),
    ('NHL', 'team_total_ou', 4),
    ('NCAAB', 'moneyline', 1),
    ('NCAAB', 'spread', 2),
    ('NCAAB', 'game_total_ou', 3),
    ('NCAAF', 'moneyline', 1),
    ('NCAAF', 'spread', 2),
    ('NCAAF', 'game_total_ou', 3),
    ('Soccer', 'moneyline', 1),
    ('Soccer', 'spread', 2),
    ('Soccer', 'game_total_ou', 3),
    ('MMA', 'moneyline', 1),
    ('Tennis', 'moneyline', 1),
    ('Tennis', 'spread', 2),
    ('Tennis', 'game_total_ou', 3)
) AS availability(sport_id, market_type_id, sort_order);

INSERT INTO public.combo_stat_types (
  id,
  sport_id,
  market_type_id,
  display_name,
  short_label,
  sort_order
) VALUES
  ('pra', 'NBA', 'player_pra_ou', 'Points + Rebounds + Assists', 'PRA', 1),
  ('pts_rebs', 'NBA', 'player_pts_rebs_ou', 'Points + Rebounds', 'P+R', 2),
  ('pts_asts', 'NBA', 'player_pts_asts_ou', 'Points + Assists', 'P+A', 3),
  ('rebs_asts', 'NBA', 'player_rebs_asts_ou', 'Rebounds + Assists', 'R+A', 4);

INSERT INTO public.combo_stat_type_components (combo_stat_type_id, stat_type_id)
SELECT combo.id, stat.id
FROM public.combo_stat_types AS combo
JOIN public.stat_types AS stat
  ON stat.sport_id = combo.sport_id
WHERE
  (combo.id = 'pra' AND stat.canonical_key IN ('points', 'rebounds', 'assists'))
  OR (combo.id = 'pts_rebs' AND stat.canonical_key IN ('points', 'rebounds'))
  OR (combo.id = 'pts_asts' AND stat.canonical_key IN ('points', 'assists'))
  OR (combo.id = 'rebs_asts' AND stat.canonical_key IN ('rebounds', 'assists'));

INSERT INTO public.provider_market_aliases (
  provider,
  provider_market_key,
  provider_display_name,
  market_type_id,
  sport_id
) VALUES
  ('sgo', 'points-all-game-ou', 'Points', 'player_points_ou', 'NBA'),
  ('sgo', 'assists-all-game-ou', 'Assists', 'player_assists_ou', 'NBA'),
  ('sgo', 'rebounds-all-game-ou', 'Rebounds', 'player_rebounds_ou', 'NBA'),
  ('sgo', 'steals-all-game-ou', 'Steals', 'player_steals_ou', 'NBA'),
  ('sgo', 'blocks-all-game-ou', 'Blocks', 'player_blocks_ou', 'NBA'),
  ('sgo', 'turnovers-all-game-ou', 'Turnovers', 'player_turnovers_ou', 'NBA'),
  ('sgo', 'pra-all-game-ou', 'Points + Rebounds + Assists', 'player_pra_ou', 'NBA'),
  ('sgo', 'pts-rebs-all-game-ou', 'Points + Rebounds', 'player_pts_rebs_ou', 'NBA'),
  ('sgo', 'pts-asts-all-game-ou', 'Points + Assists', 'player_pts_asts_ou', 'NBA'),
  ('sgo', 'rebs-asts-all-game-ou', 'Rebounds + Assists', 'player_rebs_asts_ou', 'NBA'),
  ('sgo', 'batting-hits-all-game-ou', 'Hits', 'player_batting_hits_ou', 'MLB'),
  ('sgo', 'batting-home-runs-all-game-ou', 'Home Runs', 'player_batting_home_runs_ou', 'MLB'),
  ('sgo', 'batting-rbi-all-game-ou', 'RBI', 'player_batting_rbi_ou', 'MLB'),
  ('sgo', 'batting-walks-all-game-ou', 'Walks', 'player_batting_walks_ou', 'MLB'),
  ('sgo', 'batting-total-bases-all-game-ou', 'Total Bases', 'player_batting_total_bases_ou', 'MLB'),
  ('sgo', 'pitching-strikeouts-all-game-ou', 'Pitching Strikeouts', 'player_pitching_strikeouts_ou', 'MLB'),
  ('sgo', 'pitching-innings-pitched-all-game-ou', 'Pitching Innings Pitched', 'player_pitching_innings_pitched_ou', 'MLB'),
  ('odds-api', 'h2h', 'Moneyline', 'moneyline', NULL),
  ('odds-api', 'spreads', 'Spread', 'spread', NULL),
  ('odds-api', 'totals', 'Totals', 'game_total_ou', NULL);

UPDATE public.provider_market_aliases
SET stat_type_id = stat.id
FROM public.stat_types AS stat
WHERE provider_market_aliases.provider = 'sgo'
  AND provider_market_aliases.sport_id = stat.sport_id
  AND (
    (provider_market_aliases.provider_market_key = 'points-all-game-ou' AND stat.canonical_key = 'points')
    OR (provider_market_aliases.provider_market_key = 'assists-all-game-ou' AND stat.canonical_key = 'assists')
    OR (provider_market_aliases.provider_market_key = 'rebounds-all-game-ou' AND stat.canonical_key = 'rebounds')
    OR (provider_market_aliases.provider_market_key = 'steals-all-game-ou' AND stat.canonical_key = 'steals')
    OR (provider_market_aliases.provider_market_key = 'blocks-all-game-ou' AND stat.canonical_key = 'blocks')
    OR (provider_market_aliases.provider_market_key = 'turnovers-all-game-ou' AND stat.canonical_key = 'turnovers')
    OR (provider_market_aliases.provider_market_key = 'batting-hits-all-game-ou' AND stat.canonical_key = 'hits')
    OR (provider_market_aliases.provider_market_key = 'batting-home-runs-all-game-ou' AND stat.canonical_key = 'home_runs')
    OR (provider_market_aliases.provider_market_key = 'batting-rbi-all-game-ou' AND stat.canonical_key = 'rbi')
    OR (provider_market_aliases.provider_market_key = 'batting-walks-all-game-ou' AND stat.canonical_key = 'walks')
    OR (provider_market_aliases.provider_market_key = 'batting-total-bases-all-game-ou' AND stat.canonical_key = 'total_bases')
    OR (provider_market_aliases.provider_market_key = 'pitching-strikeouts-all-game-ou' AND stat.canonical_key = 'strikeouts')
  );

UPDATE public.provider_market_aliases
SET combo_stat_type_id = combo.id
FROM public.combo_stat_types AS combo
WHERE provider_market_aliases.provider = 'sgo'
  AND provider_market_aliases.sport_id = combo.sport_id
  AND (
    (provider_market_aliases.provider_market_key = 'pra-all-game-ou' AND combo.id = 'pra')
    OR (provider_market_aliases.provider_market_key = 'pts-rebs-all-game-ou' AND combo.id = 'pts_rebs')
    OR (provider_market_aliases.provider_market_key = 'pts-asts-all-game-ou' AND combo.id = 'pts_asts')
    OR (provider_market_aliases.provider_market_key = 'rebs-asts-all-game-ou' AND combo.id = 'rebs_asts')
  );

INSERT INTO public.provider_book_aliases (
  provider,
  provider_book_key,
  provider_display_name,
  sportsbook_id
) VALUES
  ('odds-api', 'pinnacle', 'Pinnacle', 'pinnacle'),
  ('odds-api', 'draftkings', 'DraftKings', 'draftkings'),
  ('odds-api', 'fanduel', 'FanDuel', 'fanduel'),
  ('odds-api', 'betmgm', 'BetMGM', 'betmgm'),
  ('sgo', 'sgo', 'SGO', 'sgo');
