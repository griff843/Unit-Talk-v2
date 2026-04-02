-- Migration: Canonical reference backbone
-- Description: Add first-class canonical league/team/player tables while
-- preserving the existing participants-based runtime during transition.
-- Compatibility strategy:
--   - Existing participants and participant_memberships remain untouched.
--   - Current sports rows are already league-scoped in V2 runtime truth
--     (e.g. NBA, NFL, MLB). This migration references those existing sport ids
--     to avoid breaking current consumers; generic sport normalization can
--     happen in a later contracted slice.
-- Rollback:
--   DROP TABLE public.player_team_assignments, public.players, public.teams, public.leagues CASCADE;

-- ---------------------------------------------------------------------------
-- 1. leagues
-- ---------------------------------------------------------------------------
CREATE TABLE public.leagues (
  id text PRIMARY KEY,
  sport_id text NOT NULL REFERENCES public.sports(id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  country text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_leagues_sport_id ON public.leagues(sport_id);

-- ---------------------------------------------------------------------------
-- 2. teams
-- ---------------------------------------------------------------------------
CREATE TABLE public.teams (
  id text PRIMARY KEY,
  league_id text NOT NULL REFERENCES public.leagues(id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  short_name text NOT NULL,
  abbreviation text,
  city text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_teams_league_display_name UNIQUE (league_id, display_name),
  CONSTRAINT uq_teams_league_short_name UNIQUE (league_id, short_name)
);

CREATE INDEX idx_teams_league_id ON public.teams(league_id);

-- ---------------------------------------------------------------------------
-- 3. players
-- ---------------------------------------------------------------------------
CREATE TABLE public.players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  first_name text,
  last_name text,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_players_display_name ON public.players(display_name);

-- ---------------------------------------------------------------------------
-- 4. player_team_assignments
-- ---------------------------------------------------------------------------
CREATE TABLE public.player_team_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  league_id text NOT NULL REFERENCES public.leagues(id) ON DELETE RESTRICT,
  effective_from date,
  effective_until date,
  is_current boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'bootstrap',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT chk_player_team_assignment_window
    CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until >= effective_from)
);

CREATE INDEX idx_player_team_assignments_player_id
  ON public.player_team_assignments(player_id);

CREATE INDEX idx_player_team_assignments_team_id
  ON public.player_team_assignments(team_id);

CREATE INDEX idx_player_team_assignments_league_id
  ON public.player_team_assignments(league_id);

CREATE UNIQUE INDEX uq_player_team_assignments_current
  ON public.player_team_assignments(player_id)
  WHERE is_current = true;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER leagues_set_updated_at
  BEFORE UPDATE ON public.leagues
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER teams_set_updated_at
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER players_set_updated_at
  BEFORE UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER player_team_assignments_set_updated_at
  BEFORE UPDATE ON public.player_team_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- minimal bootstrap seed for empty environments
-- ---------------------------------------------------------------------------
INSERT INTO public.leagues (id, sport_id, display_name, sort_order)
VALUES
  ('nba', 'NBA', 'NBA', 1),
  ('nfl', 'NFL', 'NFL', 2),
  ('mlb', 'MLB', 'MLB', 3),
  ('nhl', 'NHL', 'NHL', 4),
  ('ncaab', 'NCAAB', 'NCAAB', 5),
  ('ncaaf', 'NCAAF', 'NCAAF', 6),
  ('soccer', 'Soccer', 'Soccer', 7),
  ('mma', 'MMA', 'MMA', 8),
  ('tennis', 'Tennis', 'Tennis', 9)
ON CONFLICT (id) DO UPDATE
SET
  sport_id = EXCLUDED.sport_id,
  display_name = EXCLUDED.display_name,
  sort_order = EXCLUDED.sort_order,
  active = true,
  updated_at = timezone('utc', now());
