export const MARKET_KEY_MAP: Record<string, string> = {
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
  return MARKET_KEY_MAP[market] ?? market;
}
