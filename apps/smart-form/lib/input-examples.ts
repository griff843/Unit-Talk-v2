/** Display hints only. These examples never become a selected line or market. */
export function lineInputExample(sport: string, marketType: string, statType = ''): string {
  const sportId = sport.toUpperCase();
  if (marketType.includes('spread')) return 'e.g. -3.5';
  const totals: Record<string, [string, string]> = {
    NBA: ['220.5', '112.5'], WNBA: ['164.5', '82.5'], NCAAB: ['144.5', '72.5'],
    NHL: ['6.5', '3.5'], MLB: ['8.5', '4.5'], NFL: ['45.5', '23.5'],
    NCAAF: ['52.5', '27.5'], SOCCER: ['2.5', '1.5'],
  };
  if (marketType === 'team-total' || marketType.includes('total')) {
    const total = totals[sportId]?.[marketType === 'team-total' ? 1 : 0];
    return total ? `e.g. ${total}` : 'Enter total';
  }
  const stat = statType.toLowerCase();
  if (!stat) return 'Enter line';
  if (sportId === 'NHL') {
    if (stat.includes('save')) return 'e.g. 27.5';
    if (stat.includes('shot')) return 'e.g. 3.5';
    if (stat.includes('point') || stat.includes('goal') || stat.includes('assist')) return 'e.g. 0.5';
  }
  if (sportId === 'NBA' || sportId === 'WNBA' || sportId === 'NCAAB') {
    if (stat.includes('three') || stat.includes('3-point') || stat.includes('3pt')) return 'e.g. 2.5';
    if (stat.includes('point')) return 'e.g. 24.5';
    if (stat.includes('rebound')) return 'e.g. 7.5';
    if (stat.includes('assist')) return 'e.g. 5.5';
    if (stat.includes('steal') || stat.includes('block')) return 'e.g. 1.5';
  }
  if (sportId === 'NFL' || sportId === 'NCAAF') {
    if (stat.includes('passing yard')) return 'e.g. 245.5';
    if (stat.includes('rushing yard') || stat.includes('receiving yard')) return 'e.g. 65.5';
    if (stat.includes('reception')) return 'e.g. 4.5';
    if (stat.includes('touchdown')) return 'e.g. 0.5';
  }
  if (sportId === 'MLB') {
    if (stat.includes('strikeout')) return 'e.g. 5.5';
    if (stat.includes('base')) return 'e.g. 1.5';
    if (stat.includes('hit') || stat.includes('run') || stat.includes('rbi')) return 'e.g. 0.5';
  }
  return 'Enter line';
}

export function matchupInputExample(sport: string): string {
  const examples: Record<string, string> = {
    NBA: 'Knicks @ Heat', WNBA: 'Liberty @ Aces', NCAAB: 'Duke @ UNC',
    NHL: 'Oilers @ Flames', MLB: 'Yankees @ Dodgers', NFL: 'Chiefs @ Bills',
    NCAAF: 'Georgia @ Alabama', SOCCER: 'Arsenal @ Chelsea',
  };
  const example = examples[sport.toUpperCase()];
  return example ? `e.g. ${example}` : 'Enter matchup';
}
