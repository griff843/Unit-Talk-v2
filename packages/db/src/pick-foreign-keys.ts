import type { CanonicalPick } from '@unit-talk/contracts';

const CANONICAL_SPORT_IDS = new Set([
  'NBA',
  'NFL',
  'MLB',
  'NHL',
  'NCAAB',
  'NCAAF',
  'Soccer',
  'Tennis',
]);

const CANONICAL_MARKET_TYPE_IDS = new Set([
  'moneyline',
  'spread',
  'game_total_ou',
  'team_total_ou',
  'player_points_ou',
  'player_rebounds_ou',
  'player_assists_ou',
  'player_3pm_ou',
  'player_steals_ou',
  'player_blocks_ou',
  'player_turnovers_ou',
  'player_pra_ou',
  'player_pts_rebs_ou',
  'player_pts_asts_ou',
  'player_rebs_asts_ou',
  'player_batting_hits_ou',
  'player_batting_home_runs_ou',
  'player_batting_rbi_ou',
  'player_batting_walks_ou',
  'player_batting_total_bases_ou',
  'player_pitching_strikeouts_ou',
  'player_pitching_innings_pitched_ou',
]);

export interface PickForeignKeyCandidates {
  capperCandidate: string | null;
  sportId: string | null;
  marketTypeId: string | null;
}

export function derivePickForeignKeyCandidates(
  pick: CanonicalPick,
): PickForeignKeyCandidates {
  const metadata = asRecord(pick.metadata);
  return {
    capperCandidate:
      readString(metadata, 'capper') ??
      readString(metadata, 'submittedBy') ??
      cleanString(pick.submittedBy),
    sportId: deriveSportId(pick),
    marketTypeId: deriveMarketTypeId(pick),
  };
}

export function deriveSportId(pick: CanonicalPick): string | null {
  const metadata = asRecord(pick.metadata);
  const directSport = normalizeSportId(readString(metadata, 'sport'));
  if (directSport) {
    return directSport;
  }

  const marketTypeId = deriveMarketTypeId(pick);
  if (!marketTypeId) {
    return null;
  }

  if (marketTypeId.startsWith('player_batting_') || marketTypeId.startsWith('player_pitching_')) {
    return 'MLB';
  }

  const normalizedMarket = cleanString(pick.market)?.toLowerCase() ?? '';
  if (normalizedMarket.startsWith('nba')) return 'NBA';
  if (normalizedMarket.startsWith('nfl')) return 'NFL';
  if (normalizedMarket.startsWith('mlb')) return 'MLB';
  if (normalizedMarket.startsWith('nhl')) return 'NHL';
  if (normalizedMarket.startsWith('ncaab')) return 'NCAAB';
  if (normalizedMarket.startsWith('ncaaf')) return 'NCAAF';

  return null;
}

export function deriveMarketTypeId(pick: CanonicalPick): string | null {
  const metadata = asRecord(pick.metadata);

  const metadataMarketTypeId = normalizeMarketTypeId(readString(metadata, 'marketTypeId'));
  if (metadataMarketTypeId) {
    return metadataMarketTypeId;
  }

  const pickMarketId = normalizeMarketTypeId(pick.market);
  if (pickMarketId) {
    return pickMarketId;
  }

  const metadataMarketType = cleanString(readString(metadata, 'marketType'))?.toLowerCase();
  const statType = cleanString(readString(metadata, 'statType'));

  if (metadataMarketType === 'moneyline') {
    return 'moneyline';
  }
  if (metadataMarketType === 'spread') {
    return 'spread';
  }
  if (metadataMarketType === 'total') {
    return 'game_total_ou';
  }
  if (metadataMarketType === 'team-total') {
    return 'team_total_ou';
  }
  if (metadataMarketType === 'player-prop') {
    return mapStatTypeToMarketTypeId(statType);
  }

  return mapStatTypeToMarketTypeId(statType);
}

function normalizeSportId(value: string | null): string | null {
  const cleaned = cleanString(value);
  if (!cleaned) {
    return null;
  }

  const canonical = cleaned.toUpperCase();
  return CANONICAL_SPORT_IDS.has(canonical) ? canonical : null;
}

function normalizeMarketTypeId(value: string | null | undefined): string | null {
  const cleaned = cleanString(value);
  if (!cleaned) {
    return null;
  }

  const key = cleaned.toLowerCase();
  const mapped =
    CANONICAL_MARKET_TYPE_IDS.has(cleaned)
      ? cleaned
      : ALTERNATE_MARKET_TYPE_IDS[key] ?? null;

  return mapped && CANONICAL_MARKET_TYPE_IDS.has(mapped) ? mapped : null;
}

function mapStatTypeToMarketTypeId(statType: string | null): string | null {
  const cleaned = cleanString(statType);
  if (!cleaned) {
    return null;
  }

  return STAT_TYPE_TO_MARKET_TYPE_ID[cleaned.toLowerCase()] ?? null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function cleanString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

const ALTERNATE_MARKET_TYPE_IDS: Record<string, string> = {
  moneyline: 'moneyline',
  spread: 'spread',
  game_spread: 'spread',
  total: 'game_total_ou',
  totals: 'game_total_ou',
  game_total: 'game_total_ou',
  'game-total': 'game_total_ou',
  game_total_ou: 'game_total_ou',
  'team-total': 'team_total_ou',
  team_total: 'team_total_ou',
  team_total_ou: 'team_total_ou',
  'player.points': 'player_points_ou',
  points: 'player_points_ou',
  'points-all-game-ou': 'player_points_ou',
  'player.rebounds': 'player_rebounds_ou',
  rebounds: 'player_rebounds_ou',
  'rebounds-all-game-ou': 'player_rebounds_ou',
  'player.assists': 'player_assists_ou',
  assists: 'player_assists_ou',
  'assists-all-game-ou': 'player_assists_ou',
  'player.threes': 'player_3pm_ou',
  'player.3pm': 'player_3pm_ou',
  threes: 'player_3pm_ou',
  'player_3pm_ou': 'player_3pm_ou',
  'player.steals': 'player_steals_ou',
  steals: 'player_steals_ou',
  'player.blocks': 'player_blocks_ou',
  blocks: 'player_blocks_ou',
  'player.turnovers': 'player_turnovers_ou',
  turnovers: 'player_turnovers_ou',
  'turnovers-all-game-ou': 'player_turnovers_ou',
  'player.pra': 'player_pra_ou',
  pra: 'player_pra_ou',
  'pra-all-game-ou': 'player_pra_ou',
  'player.points_rebounds': 'player_pts_rebs_ou',
  pr: 'player_pts_rebs_ou',
  'pr-all-game-ou': 'player_pts_rebs_ou',
  'player.points_assists': 'player_pts_asts_ou',
  pa: 'player_pts_asts_ou',
  'pa-all-game-ou': 'player_pts_asts_ou',
  'player.rebounds_assists': 'player_rebs_asts_ou',
  ra: 'player_rebs_asts_ou',
  'ra-all-game-ou': 'player_rebs_asts_ou',
  'batting-hits-all-game-ou': 'player_batting_hits_ou',
  'batting-home-runs-all-game-ou': 'player_batting_home_runs_ou',
  'batting-rbi-all-game-ou': 'player_batting_rbi_ou',
  'batting-walks-all-game-ou': 'player_batting_walks_ou',
  'pitching-strikeouts-all-game-ou': 'player_pitching_strikeouts_ou',
  'pitching-innings-all-game-ou': 'player_pitching_innings_pitched_ou',
};

const STAT_TYPE_TO_MARKET_TYPE_ID: Record<string, string> = {
  points: 'player_points_ou',
  rebounds: 'player_rebounds_ou',
  assists: 'player_assists_ou',
  threes: 'player_3pm_ou',
  steals: 'player_steals_ou',
  blocks: 'player_blocks_ou',
  turnovers: 'player_turnovers_ou',
  'points + rebounds + assists': 'player_pra_ou',
  'points + rebounds': 'player_pts_rebs_ou',
  'points + assists': 'player_pts_asts_ou',
  'rebounds + assists': 'player_rebs_asts_ou',
  hits: 'player_batting_hits_ou',
  'home runs': 'player_batting_home_runs_ou',
  rbi: 'player_batting_rbi_ou',
  walks: 'player_batting_walks_ou',
  'total bases': 'player_batting_total_bases_ou',
  'pitching strikeouts': 'player_pitching_strikeouts_ou',
  'pitching innings pitched': 'player_pitching_innings_pitched_ou',
};
