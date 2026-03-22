/**
 * Smart Form V1 — Canonical Reference Data
 *
 * Single source of truth for governed fields: sports, sportsbooks,
 * ticket types, cappers. All form selects and validation checks
 * derive from this catalog.
 *
 * V1: static data. Future: API-backed.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MarketTypeId =
  | 'player-prop'
  | 'moneyline'
  | 'spread'
  | 'total'
  | 'team-total';

export interface SportDefinition {
  id: string;
  name: string;
  marketTypes: MarketTypeId[];
  statTypes: string[];
  teams: string[];
}

export interface SportsbookDefinition {
  id: string;
  name: string;
}

export interface TicketTypeDefinition {
  id: string;
  name: string;
  enabled: boolean;
}

export interface ReferenceDataCatalog {
  sports: SportDefinition[];
  sportsbooks: SportsbookDefinition[];
  ticketTypes: TicketTypeDefinition[];
  cappers: string[];
}

// ---------------------------------------------------------------------------
// Static V1 Catalog
// ---------------------------------------------------------------------------

const ALL_MARKET_TYPES: MarketTypeId[] = [
  'player-prop',
  'moneyline',
  'spread',
  'total',
  'team-total',
];

export const V1_REFERENCE_DATA: ReferenceDataCatalog = {
  sports: [
    {
      id: 'NBA',
      name: 'NBA',
      marketTypes: ALL_MARKET_TYPES,
      statTypes: ['Points', 'Rebounds', 'Assists', 'Threes', 'Steals', 'Blocks'],
      teams: [
        'Hawks', 'Celtics', 'Nets', 'Hornets', 'Bulls', 'Cavaliers',
        'Mavericks', 'Nuggets', 'Pistons', 'Warriors', 'Rockets', 'Pacers',
        'Clippers', 'Lakers', 'Grizzlies', 'Heat', 'Bucks', 'Timberwolves',
        'Pelicans', 'Knicks', 'Thunder', 'Magic', 'Sixers', 'Suns',
        'Trail Blazers', 'Kings', 'Spurs', 'Raptors', 'Jazz', 'Wizards',
      ],
    },
    {
      id: 'NFL',
      name: 'NFL',
      marketTypes: ALL_MARKET_TYPES,
      statTypes: ['Passing Yards', 'Rushing Yards', 'Receiving Yards', 'Touchdowns', 'Receptions', 'Interceptions'],
      teams: [
        'Cardinals', 'Falcons', 'Ravens', 'Bills', 'Panthers', 'Bears',
        'Bengals', 'Browns', 'Cowboys', 'Broncos', 'Lions', 'Packers',
        'Texans', 'Colts', 'Jaguars', 'Chiefs', 'Raiders', 'Chargers',
        'Rams', 'Dolphins', 'Vikings', 'Patriots', 'Saints', 'Giants',
        'Jets', 'Eagles', 'Steelers', '49ers', 'Seahawks', 'Buccaneers',
        'Titans', 'Commanders',
      ],
    },
    {
      id: 'MLB',
      name: 'MLB',
      marketTypes: ALL_MARKET_TYPES,
      statTypes: ['Strikeouts', 'Hits', 'Home Runs', 'RBI', 'Runs', 'Walks', 'Total Bases'],
      teams: [
        'Diamondbacks', 'Braves', 'Orioles', 'Red Sox', 'Cubs', 'White Sox',
        'Reds', 'Guardians', 'Rockies', 'Tigers', 'Astros', 'Royals',
        'Angels', 'Dodgers', 'Marlins', 'Brewers', 'Twins', 'Mets',
        'Yankees', 'Athletics', 'Phillies', 'Pirates', 'Padres', 'Giants',
        'Mariners', 'Cardinals', 'Rays', 'Rangers', 'Blue Jays', 'Nationals',
      ],
    },
    {
      id: 'NHL',
      name: 'NHL',
      marketTypes: ALL_MARKET_TYPES,
      statTypes: ['Shots on Goal', 'Saves', 'Goals', 'Assists', 'Points', 'Blocked Shots'],
      teams: [
        'Ducks', 'Coyotes', 'Bruins', 'Sabres', 'Flames', 'Hurricanes',
        'Blackhawks', 'Avalanche', 'Blue Jackets', 'Stars', 'Red Wings',
        'Oilers', 'Panthers', 'Kings', 'Wild', 'Canadiens', 'Predators',
        'Devils', 'Islanders', 'Rangers', 'Senators', 'Flyers', 'Penguins',
        'Sharks', 'Kraken', 'Blues', 'Lightning', 'Maple Leafs', 'Canucks',
        'Golden Knights', 'Capitals', 'Jets',
      ],
    },
    {
      id: 'NCAAB',
      name: 'NCAAB',
      marketTypes: ['moneyline', 'spread', 'total'],
      statTypes: ['Points', 'Rebounds', 'Assists'],
      teams: [],
    },
    {
      id: 'NCAAF',
      name: 'NCAAF',
      marketTypes: ['moneyline', 'spread', 'total'],
      statTypes: ['Passing Yards', 'Rushing Yards', 'Receiving Yards', 'Touchdowns'],
      teams: [],
    },
    {
      id: 'Soccer',
      name: 'Soccer',
      marketTypes: ['moneyline', 'spread', 'total'] as MarketTypeId[],
      statTypes: ['Shots on Target', 'Goals', 'Assists'],
      teams: [],
    },
    {
      id: 'MMA',
      name: 'MMA',
      marketTypes: ['moneyline'] as MarketTypeId[],
      statTypes: [],
      teams: [],
    },
    {
      id: 'Tennis',
      name: 'Tennis',
      marketTypes: ['moneyline', 'spread', 'total'] as MarketTypeId[],
      statTypes: ['Aces', 'Double Faults', 'Games Won'],
      teams: [],
    },
  ],
  sportsbooks: [
    { id: 'pinnacle', name: 'Pinnacle' },
    { id: 'circa', name: 'Circa' },
    { id: 'draftkings', name: 'DraftKings' },
    { id: 'fanduel', name: 'FanDuel' },
    { id: 'betmgm', name: 'BetMGM' },
    { id: 'caesars', name: 'Caesars' },
    { id: 'pointsbet', name: 'PointsBet' },
    { id: 'bovada', name: 'Bovada' },
    { id: 'bet365', name: 'Bet365' },
    { id: 'williamhill', name: 'William Hill' },
    { id: 'sgo', name: 'SGO' },
  ],
  ticketTypes: [
    { id: 'single', name: 'Single', enabled: true },
    { id: 'parlay', name: 'Parlay', enabled: false },
    { id: 'teaser', name: 'Teaser', enabled: false },
    { id: 'round-robin', name: 'Round Robin', enabled: false },
    { id: 'future', name: 'Future', enabled: false },
  ],
  cappers: ['griff843'],
};

// ---------------------------------------------------------------------------
// Accessor Functions (pure, no I/O)
// ---------------------------------------------------------------------------

export function getSportById(
  catalog: ReferenceDataCatalog,
  id: string,
): SportDefinition | undefined {
  return catalog.sports.find((s) => s.id === id);
}

export function getStatTypesForSport(
  catalog: ReferenceDataCatalog,
  sportId: string,
): string[] {
  return getSportById(catalog, sportId)?.statTypes ?? [];
}

export function getTeamsForSport(
  catalog: ReferenceDataCatalog,
  sportId: string,
): string[] {
  return getSportById(catalog, sportId)?.teams ?? [];
}

export function getMarketTypesForSport(
  catalog: ReferenceDataCatalog,
  sportId: string,
): MarketTypeId[] {
  return getSportById(catalog, sportId)?.marketTypes ?? [];
}

export function getEnabledTicketTypes(
  catalog: ReferenceDataCatalog,
): TicketTypeDefinition[] {
  return catalog.ticketTypes.filter((t) => t.enabled);
}

export function isValidCapper(
  catalog: ReferenceDataCatalog,
  capper: string,
): boolean {
  return catalog.cappers.includes(capper);
}

export function isValidSportsbook(
  catalog: ReferenceDataCatalog,
  id: string,
): boolean {
  return catalog.sportsbooks.some((s) => s.id === id.toLowerCase());
}

export function isValidSportId(
  catalog: ReferenceDataCatalog,
  id: string,
): boolean {
  return catalog.sports.some((s) => s.id === id);
}

export function isValidTeamForSport(
  catalog: ReferenceDataCatalog,
  sportId: string,
  team: string,
): boolean {
  const sport = getSportById(catalog, sportId);
  if (!sport) return false;
  if (sport.teams.length === 0) return true; // no team registry → accept any
  return sport.teams.includes(team);
}

export function isValidStatTypeForSport(
  catalog: ReferenceDataCatalog,
  sportId: string,
  statType: string,
): boolean {
  const sport = getSportById(catalog, sportId);
  if (!sport) return false;
  if (sport.statTypes.length === 0) return true; // no stat registry → accept any
  return sport.statTypes.includes(statType);
}
