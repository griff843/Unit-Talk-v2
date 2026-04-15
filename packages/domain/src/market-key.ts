export const MARKET_KEY_MAP: Record<string, string> = {
  moneyline: 'moneyline',
  spread: 'spread',
  game_spread: 'spread',
  'game-spread': 'spread',
  total: 'game_total_ou',
  game_total: 'game_total_ou',
  'game-total': 'game_total_ou',
  team_total: 'team_total_ou',
  'team-total': 'team_total_ou',
  'player.points': 'points-all-game-ou',
  'player.rebounds': 'rebounds-all-game-ou',
  'player.assists': 'assists-all-game-ou',
  'player.threes': 'threes-all-game-ou',
  'player.3pm': 'threes-all-game-ou',
  'player.steals': 'steals-all-game-ou',
  'player.blocks': 'blocks-all-game-ou',
  'player.turnovers': 'turnovers-all-game-ou',
  'player.points_rebounds_assists': 'pra-all-game-ou',
  'player.pra': 'pra-all-game-ou',
  'player.points_rebounds': 'pr-all-game-ou',
  'player.points_assists': 'pa-all-game-ou',
  'player.rebounds_assists': 'ra-all-game-ou',
  'player.hits': 'batting-hits-all-game-ou',
  'player.home_runs': 'batting-home-runs-all-game-ou',
  'player.rbi': 'batting-rbi-all-game-ou',
  'player.walks': 'batting-walks-all-game-ou',
  'player.total_bases': 'batting-total-bases-all-game-ou',
  'player.pitching_strikeouts': 'pitching-strikeouts-all-game-ou',
  'player.pitching_innings_pitched': 'pitching-innings-all-game-ou',
  'NBA points': 'points-all-game-ou',
  'NBA assists': 'assists-all-game-ou',
  'NBA rebounds': 'rebounds-all-game-ou',
  'NBA steals': 'steals-all-game-ou',
  'NBA blocks': 'blocks-all-game-ou',
  'NBA turnovers': 'turnovers-all-game-ou',
  'NBA PRA': 'pra-all-game-ou',
  'NBA PR': 'pr-all-game-ou',
  'NBA RA': 'ra-all-game-ou',
  'MLB batting hits': 'batting-hits-all-game-ou',
  'MLB batting home runs': 'batting-home-runs-all-game-ou',
  'MLB batting RBI': 'batting-rbi-all-game-ou',
  'MLB batting strikeouts': 'batting-strikeouts-all-game-ou',
  'MLB batting walks': 'batting-walks-all-game-ou',
  'MLB pitching strikeouts': 'pitching-strikeouts-all-game-ou',
  'MLB pitching innings': 'pitching-innings-all-game-ou',
};

export function normalizeMarketKey(market: string): string {
  const trimmed = market.trim();
  const normalizedLookup = MARKET_KEY_MAP[trimmed] ?? MARKET_KEY_MAP[trimmed.toLowerCase()];
  if (normalizedLookup) {
    return normalizedLookup;
  }

  if (/moneyline/i.test(market)) {
    return 'moneyline';
  }

  return MARKET_KEY_MAP[market] ?? market;
}
