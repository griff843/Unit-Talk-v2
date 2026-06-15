-- Migration: Reference Data Foundation
-- Description: Create canonical reference data tables (sports, sportsbooks, cappers,
--   stat_types, sport_market_types, events, event_participants) and seed with V1 data.
-- Rollback: DROP TABLE event_participants, events, stat_types, sport_market_types, cappers, sportsbooks, sports CASCADE;

-- ---------------------------------------------------------------------------
-- 1. sports
-- ---------------------------------------------------------------------------
CREATE TABLE public.sports (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- 2. sport_market_types
-- ---------------------------------------------------------------------------
CREATE TABLE public.sport_market_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id text NOT NULL REFERENCES public.sports(id) ON DELETE CASCADE,
  market_type text NOT NULL CHECK (market_type IN ('player-prop', 'moneyline', 'spread', 'total', 'team-total')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_sport_market_type UNIQUE (sport_id, market_type)
);

CREATE INDEX idx_sport_market_types_sport ON public.sport_market_types(sport_id);

-- ---------------------------------------------------------------------------
-- 3. stat_types
-- ---------------------------------------------------------------------------
CREATE TABLE public.stat_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id text NOT NULL REFERENCES public.sports(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_sport_stat_type UNIQUE (sport_id, name)
);

CREATE INDEX idx_stat_types_sport ON public.stat_types(sport_id);

-- ---------------------------------------------------------------------------
-- 4. sportsbooks
-- ---------------------------------------------------------------------------
CREATE TABLE public.sportsbooks (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- 5. cappers
-- ---------------------------------------------------------------------------
CREATE TABLE public.cappers (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- 6. events
-- ---------------------------------------------------------------------------
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id text NOT NULL REFERENCES public.sports(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  event_date date NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'postponed', 'cancelled')),
  external_id text UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_events_sport_date ON public.events(sport_id, event_date);

-- ---------------------------------------------------------------------------
-- 7. event_participants
-- ---------------------------------------------------------------------------
CREATE TABLE public.event_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('home', 'away', 'competitor')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_event_participant UNIQUE (event_id, participant_id)
);

CREATE INDEX idx_event_participants_event ON public.event_participants(event_id);
CREATE INDEX idx_event_participants_participant ON public.event_participants(participant_id);

-- ===========================================================================
-- SEED DATA
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Sports (9)
-- ---------------------------------------------------------------------------
INSERT INTO public.sports (id, display_name, sort_order) VALUES
  ('NBA',    'NBA',    1),
  ('NFL',    'NFL',    2),
  ('MLB',    'MLB',    3),
  ('NHL',    'NHL',    4),
  ('NCAAB',  'NCAAB',  5),
  ('NCAAF',  'NCAAF',  6),
  ('Soccer', 'Soccer', 7),
  ('MMA',    'MMA',    8),
  ('Tennis', 'Tennis', 9);

-- ---------------------------------------------------------------------------
-- Sport Market Types
-- ---------------------------------------------------------------------------
-- NBA: all 5
INSERT INTO public.sport_market_types (sport_id, market_type, sort_order) VALUES
  ('NBA', 'player-prop', 1),
  ('NBA', 'moneyline',   2),
  ('NBA', 'spread',      3),
  ('NBA', 'total',       4),
  ('NBA', 'team-total',  5);

-- NFL: all 5
INSERT INTO public.sport_market_types (sport_id, market_type, sort_order) VALUES
  ('NFL', 'player-prop', 1),
  ('NFL', 'moneyline',   2),
  ('NFL', 'spread',      3),
  ('NFL', 'total',       4),
  ('NFL', 'team-total',  5);

-- MLB: all 5
INSERT INTO public.sport_market_types (sport_id, market_type, sort_order) VALUES
  ('MLB', 'player-prop', 1),
  ('MLB', 'moneyline',   2),
  ('MLB', 'spread',      3),
  ('MLB', 'total',       4),
  ('MLB', 'team-total',  5);

-- NHL: all 5
INSERT INTO public.sport_market_types (sport_id, market_type, sort_order) VALUES
  ('NHL', 'player-prop', 1),
  ('NHL', 'moneyline',   2),
  ('NHL', 'spread',      3),
  ('NHL', 'total',       4),
  ('NHL', 'team-total',  5);

-- NCAAB: 3 (no player-prop, no team-total)
INSERT INTO public.sport_market_types (sport_id, market_type, sort_order) VALUES
  ('NCAAB', 'moneyline', 1),
  ('NCAAB', 'spread',    2),
  ('NCAAB', 'total',     3);

-- NCAAF: 3
INSERT INTO public.sport_market_types (sport_id, market_type, sort_order) VALUES
  ('NCAAF', 'moneyline', 1),
  ('NCAAF', 'spread',    2),
  ('NCAAF', 'total',     3);

-- Soccer: 3
INSERT INTO public.sport_market_types (sport_id, market_type, sort_order) VALUES
  ('Soccer', 'moneyline', 1),
  ('Soccer', 'spread',    2),
  ('Soccer', 'total',     3);

-- MMA: moneyline only
INSERT INTO public.sport_market_types (sport_id, market_type, sort_order) VALUES
  ('MMA', 'moneyline', 1);

-- Tennis: 3
INSERT INTO public.sport_market_types (sport_id, market_type, sort_order) VALUES
  ('Tennis', 'moneyline', 1),
  ('Tennis', 'spread',    2),
  ('Tennis', 'total',     3);

-- ---------------------------------------------------------------------------
-- Stat Types
-- ---------------------------------------------------------------------------
-- NBA (6)
INSERT INTO public.stat_types (sport_id, name, sort_order) VALUES
  ('NBA', 'Points',   1),
  ('NBA', 'Rebounds',  2),
  ('NBA', 'Assists',   3),
  ('NBA', 'Threes',    4),
  ('NBA', 'Steals',    5),
  ('NBA', 'Blocks',    6);

-- NFL (6)
INSERT INTO public.stat_types (sport_id, name, sort_order) VALUES
  ('NFL', 'Passing Yards',   1),
  ('NFL', 'Rushing Yards',   2),
  ('NFL', 'Receiving Yards', 3),
  ('NFL', 'Touchdowns',      4),
  ('NFL', 'Receptions',      5),
  ('NFL', 'Interceptions',   6);

-- MLB (7)
INSERT INTO public.stat_types (sport_id, name, sort_order) VALUES
  ('MLB', 'Strikeouts',  1),
  ('MLB', 'Hits',         2),
  ('MLB', 'Home Runs',    3),
  ('MLB', 'RBI',           4),
  ('MLB', 'Runs',          5),
  ('MLB', 'Walks',         6),
  ('MLB', 'Total Bases',  7);

-- NHL (6)
INSERT INTO public.stat_types (sport_id, name, sort_order) VALUES
  ('NHL', 'Shots on Goal',  1),
  ('NHL', 'Saves',           2),
  ('NHL', 'Goals',           3),
  ('NHL', 'Assists',         4),
  ('NHL', 'Points',          5),
  ('NHL', 'Blocked Shots',  6);

-- NCAAB (3)
INSERT INTO public.stat_types (sport_id, name, sort_order) VALUES
  ('NCAAB', 'Points',   1),
  ('NCAAB', 'Rebounds',  2),
  ('NCAAB', 'Assists',   3);

-- NCAAF (4)
INSERT INTO public.stat_types (sport_id, name, sort_order) VALUES
  ('NCAAF', 'Passing Yards',   1),
  ('NCAAF', 'Rushing Yards',   2),
  ('NCAAF', 'Receiving Yards', 3),
  ('NCAAF', 'Touchdowns',      4);

-- Soccer (3)
INSERT INTO public.stat_types (sport_id, name, sort_order) VALUES
  ('Soccer', 'Shots on Target', 1),
  ('Soccer', 'Goals',           2),
  ('Soccer', 'Assists',         3);

-- MMA: no stat types

-- Tennis (3)
INSERT INTO public.stat_types (sport_id, name, sort_order) VALUES
  ('Tennis', 'Aces',          1),
  ('Tennis', 'Double Faults', 2),
  ('Tennis', 'Games Won',     3);

-- ---------------------------------------------------------------------------
-- Sportsbooks (11)
-- ---------------------------------------------------------------------------
INSERT INTO public.sportsbooks (id, display_name, sort_order) VALUES
  ('pinnacle',    'Pinnacle',     1),
  ('circa',       'Circa',        2),
  ('draftkings',  'DraftKings',   3),
  ('fanduel',     'FanDuel',      4),
  ('betmgm',      'BetMGM',       5),
  ('caesars',      'Caesars',      6),
  ('pointsbet',   'PointsBet',    7),
  ('bovada',       'Bovada',       8),
  ('bet365',       'Bet365',       9),
  ('williamhill',  'William Hill', 10),
  ('sgo',          'SGO',         11);

-- ---------------------------------------------------------------------------
-- Cappers (1)
-- ---------------------------------------------------------------------------
INSERT INTO public.cappers (id, display_name) VALUES
  ('griff843', 'griff843');

-- ---------------------------------------------------------------------------
-- Teams as participants (124 total)
-- ON CONFLICT DO NOTHING — safe to re-run
-- ---------------------------------------------------------------------------

-- NBA (30)
INSERT INTO public.participants (external_id, participant_type, sport, display_name) VALUES
  ('team:NBA:Hawks',           'team', 'NBA', 'Hawks'),
  ('team:NBA:Celtics',         'team', 'NBA', 'Celtics'),
  ('team:NBA:Nets',            'team', 'NBA', 'Nets'),
  ('team:NBA:Hornets',         'team', 'NBA', 'Hornets'),
  ('team:NBA:Bulls',           'team', 'NBA', 'Bulls'),
  ('team:NBA:Cavaliers',       'team', 'NBA', 'Cavaliers'),
  ('team:NBA:Mavericks',       'team', 'NBA', 'Mavericks'),
  ('team:NBA:Nuggets',         'team', 'NBA', 'Nuggets'),
  ('team:NBA:Pistons',         'team', 'NBA', 'Pistons'),
  ('team:NBA:Warriors',        'team', 'NBA', 'Warriors'),
  ('team:NBA:Rockets',         'team', 'NBA', 'Rockets'),
  ('team:NBA:Pacers',          'team', 'NBA', 'Pacers'),
  ('team:NBA:Clippers',        'team', 'NBA', 'Clippers'),
  ('team:NBA:Lakers',          'team', 'NBA', 'Lakers'),
  ('team:NBA:Grizzlies',       'team', 'NBA', 'Grizzlies'),
  ('team:NBA:Heat',            'team', 'NBA', 'Heat'),
  ('team:NBA:Bucks',           'team', 'NBA', 'Bucks'),
  ('team:NBA:Timberwolves',    'team', 'NBA', 'Timberwolves'),
  ('team:NBA:Pelicans',        'team', 'NBA', 'Pelicans'),
  ('team:NBA:Knicks',          'team', 'NBA', 'Knicks'),
  ('team:NBA:Thunder',         'team', 'NBA', 'Thunder'),
  ('team:NBA:Magic',           'team', 'NBA', 'Magic'),
  ('team:NBA:Sixers',          'team', 'NBA', 'Sixers'),
  ('team:NBA:Suns',            'team', 'NBA', 'Suns'),
  ('team:NBA:Trail Blazers',   'team', 'NBA', 'Trail Blazers'),
  ('team:NBA:Kings',           'team', 'NBA', 'Kings'),
  ('team:NBA:Spurs',           'team', 'NBA', 'Spurs'),
  ('team:NBA:Raptors',         'team', 'NBA', 'Raptors'),
  ('team:NBA:Jazz',            'team', 'NBA', 'Jazz'),
  ('team:NBA:Wizards',         'team', 'NBA', 'Wizards')
ON CONFLICT (external_id) DO NOTHING;

-- NFL (32)
INSERT INTO public.participants (external_id, participant_type, sport, display_name) VALUES
  ('team:NFL:Cardinals',    'team', 'NFL', 'Cardinals'),
  ('team:NFL:Falcons',      'team', 'NFL', 'Falcons'),
  ('team:NFL:Ravens',       'team', 'NFL', 'Ravens'),
  ('team:NFL:Bills',        'team', 'NFL', 'Bills'),
  ('team:NFL:Panthers',     'team', 'NFL', 'Panthers'),
  ('team:NFL:Bears',        'team', 'NFL', 'Bears'),
  ('team:NFL:Bengals',      'team', 'NFL', 'Bengals'),
  ('team:NFL:Browns',       'team', 'NFL', 'Browns'),
  ('team:NFL:Cowboys',      'team', 'NFL', 'Cowboys'),
  ('team:NFL:Broncos',      'team', 'NFL', 'Broncos'),
  ('team:NFL:Lions',        'team', 'NFL', 'Lions'),
  ('team:NFL:Packers',      'team', 'NFL', 'Packers'),
  ('team:NFL:Texans',       'team', 'NFL', 'Texans'),
  ('team:NFL:Colts',        'team', 'NFL', 'Colts'),
  ('team:NFL:Jaguars',      'team', 'NFL', 'Jaguars'),
  ('team:NFL:Chiefs',       'team', 'NFL', 'Chiefs'),
  ('team:NFL:Raiders',      'team', 'NFL', 'Raiders'),
  ('team:NFL:Chargers',     'team', 'NFL', 'Chargers'),
  ('team:NFL:Rams',         'team', 'NFL', 'Rams'),
  ('team:NFL:Dolphins',     'team', 'NFL', 'Dolphins'),
  ('team:NFL:Vikings',      'team', 'NFL', 'Vikings'),
  ('team:NFL:Patriots',     'team', 'NFL', 'Patriots'),
  ('team:NFL:Saints',       'team', 'NFL', 'Saints'),
  ('team:NFL:Giants',       'team', 'NFL', 'Giants'),
  ('team:NFL:Jets',         'team', 'NFL', 'Jets'),
  ('team:NFL:Eagles',       'team', 'NFL', 'Eagles'),
  ('team:NFL:Steelers',     'team', 'NFL', 'Steelers'),
  ('team:NFL:49ers',        'team', 'NFL', '49ers'),
  ('team:NFL:Seahawks',     'team', 'NFL', 'Seahawks'),
  ('team:NFL:Buccaneers',   'team', 'NFL', 'Buccaneers'),
  ('team:NFL:Titans',       'team', 'NFL', 'Titans'),
  ('team:NFL:Commanders',   'team', 'NFL', 'Commanders')
ON CONFLICT (external_id) DO NOTHING;

-- MLB (30)
INSERT INTO public.participants (external_id, participant_type, sport, display_name) VALUES
  ('team:MLB:Diamondbacks', 'team', 'MLB', 'Diamondbacks'),
  ('team:MLB:Braves',       'team', 'MLB', 'Braves'),
  ('team:MLB:Orioles',      'team', 'MLB', 'Orioles'),
  ('team:MLB:Red Sox',      'team', 'MLB', 'Red Sox'),
  ('team:MLB:Cubs',         'team', 'MLB', 'Cubs'),
  ('team:MLB:White Sox',    'team', 'MLB', 'White Sox'),
  ('team:MLB:Reds',         'team', 'MLB', 'Reds'),
  ('team:MLB:Guardians',    'team', 'MLB', 'Guardians'),
  ('team:MLB:Rockies',      'team', 'MLB', 'Rockies'),
  ('team:MLB:Tigers',       'team', 'MLB', 'Tigers'),
  ('team:MLB:Astros',       'team', 'MLB', 'Astros'),
  ('team:MLB:Royals',       'team', 'MLB', 'Royals'),
  ('team:MLB:Angels',       'team', 'MLB', 'Angels'),
  ('team:MLB:Dodgers',      'team', 'MLB', 'Dodgers'),
  ('team:MLB:Marlins',      'team', 'MLB', 'Marlins'),
  ('team:MLB:Brewers',      'team', 'MLB', 'Brewers'),
  ('team:MLB:Twins',        'team', 'MLB', 'Twins'),
  ('team:MLB:Mets',         'team', 'MLB', 'Mets'),
  ('team:MLB:Yankees',      'team', 'MLB', 'Yankees'),
  ('team:MLB:Athletics',    'team', 'MLB', 'Athletics'),
  ('team:MLB:Phillies',     'team', 'MLB', 'Phillies'),
  ('team:MLB:Pirates',      'team', 'MLB', 'Pirates'),
  ('team:MLB:Padres',       'team', 'MLB', 'Padres'),
  ('team:MLB:Giants',       'team', 'MLB', 'Giants'),
  ('team:MLB:Mariners',     'team', 'MLB', 'Mariners'),
  ('team:MLB:Cardinals',    'team', 'MLB', 'Cardinals'),
  ('team:MLB:Rays',         'team', 'MLB', 'Rays'),
  ('team:MLB:Rangers',      'team', 'MLB', 'Rangers'),
  ('team:MLB:Blue Jays',    'team', 'MLB', 'Blue Jays'),
  ('team:MLB:Nationals',    'team', 'MLB', 'Nationals')
ON CONFLICT (external_id) DO NOTHING;

-- NHL (31)
INSERT INTO public.participants (external_id, participant_type, sport, display_name) VALUES
  ('team:NHL:Ducks',          'team', 'NHL', 'Ducks'),
  ('team:NHL:Coyotes',        'team', 'NHL', 'Coyotes'),
  ('team:NHL:Bruins',         'team', 'NHL', 'Bruins'),
  ('team:NHL:Sabres',         'team', 'NHL', 'Sabres'),
  ('team:NHL:Flames',         'team', 'NHL', 'Flames'),
  ('team:NHL:Hurricanes',     'team', 'NHL', 'Hurricanes'),
  ('team:NHL:Blackhawks',     'team', 'NHL', 'Blackhawks'),
  ('team:NHL:Avalanche',      'team', 'NHL', 'Avalanche'),
  ('team:NHL:Blue Jackets',   'team', 'NHL', 'Blue Jackets'),
  ('team:NHL:Stars',          'team', 'NHL', 'Stars'),
  ('team:NHL:Red Wings',      'team', 'NHL', 'Red Wings'),
  ('team:NHL:Oilers',         'team', 'NHL', 'Oilers'),
  ('team:NHL:Panthers',       'team', 'NHL', 'Panthers'),
  ('team:NHL:Kings',          'team', 'NHL', 'Kings'),
  ('team:NHL:Wild',           'team', 'NHL', 'Wild'),
  ('team:NHL:Canadiens',      'team', 'NHL', 'Canadiens'),
  ('team:NHL:Predators',      'team', 'NHL', 'Predators'),
  ('team:NHL:Devils',         'team', 'NHL', 'Devils'),
  ('team:NHL:Islanders',      'team', 'NHL', 'Islanders'),
  ('team:NHL:Rangers',        'team', 'NHL', 'Rangers'),
  ('team:NHL:Senators',       'team', 'NHL', 'Senators'),
  ('team:NHL:Flyers',         'team', 'NHL', 'Flyers'),
  ('team:NHL:Penguins',       'team', 'NHL', 'Penguins'),
  ('team:NHL:Sharks',         'team', 'NHL', 'Sharks'),
  ('team:NHL:Kraken',         'team', 'NHL', 'Kraken'),
  ('team:NHL:Blues',           'team', 'NHL', 'Blues'),
  ('team:NHL:Lightning',      'team', 'NHL', 'Lightning'),
  ('team:NHL:Maple Leafs',    'team', 'NHL', 'Maple Leafs'),
  ('team:NHL:Canucks',        'team', 'NHL', 'Canucks'),
  ('team:NHL:Golden Knights', 'team', 'NHL', 'Golden Knights'),
  ('team:NHL:Capitals',       'team', 'NHL', 'Capitals'),
  ('team:NHL:Jets',           'team', 'NHL', 'Jets')
ON CONFLICT (external_id) DO NOTHING;

-- No events seeded (dynamic/future)
