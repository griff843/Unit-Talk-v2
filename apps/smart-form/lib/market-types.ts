export const BASE_MARKET_TYPE_IDS = [
  'player-prop',
  'moneyline',
  'spread',
  'total',
  'team-total',
] as const;

export const PERIOD_MARKET_TYPE_IDS = [
  '1h_moneyline',
  '1h_spread',
  '1h_total_ou',
  '2h_moneyline',
  '2h_spread',
  '2h_total_ou',
  '1q_moneyline',
  '1q_spread',
  '1q_total_ou',
  '2q_moneyline',
  '2q_spread',
  '2q_total_ou',
  '3q_moneyline',
  '3q_spread',
  '3q_total_ou',
  '4q_moneyline',
  '4q_spread',
  '4q_total_ou',
  'f3_moneyline',
  'f3_spread',
  'f3_total_ou',
  'f5_moneyline',
  'f5_spread',
  'f5_total_ou',
  'f7_moneyline',
  'f7_spread',
  'f7_total_ou',
  '1p_moneyline',
  '1p_spread',
  '1p_total_ou',
] as const;

export const MARKET_TYPE_IDS = [...BASE_MARKET_TYPE_IDS, ...PERIOD_MARKET_TYPE_IDS] as const;

export type MarketTypeId = (typeof MARKET_TYPE_IDS)[number];
export type GameLineMarketTypeFamily = 'moneyline' | 'spread' | 'total';
export type MarketTypeFamily = 'player-prop' | GameLineMarketTypeFamily | 'team-total';

const PERIOD_MARKET_TYPE_SET = new Set<string>(PERIOD_MARKET_TYPE_IDS);
const MARKET_TYPE_SET = new Set<string>(MARKET_TYPE_IDS);

const PERIOD_LABEL_PREFIXES: Record<string, string> = {
  '1h': '1H - 1st Half',
  '2h': '2H - 2nd Half',
  '1q': '1Q - 1st Quarter',
  '2q': '2Q - 2nd Quarter',
  '3q': '3Q - 3rd Quarter',
  '4q': '4Q - 4th Quarter',
  f3: 'F3 - First 3 Innings',
  f5: 'F5 - First 5 Innings',
  f7: 'F7 - First 7 Innings',
  '1p': '1P - 1st Period',
};

const PERIOD_ABBREVIATIONS: Record<string, string> = {
  '1h': '1H',
  '2h': '2H',
  '1q': '1Q',
  '2q': '2Q',
  '3q': '3Q',
  '4q': '4Q',
  f3: 'F3',
  f5: 'F5',
  f7: 'F7',
  '1p': '1P',
};

const PERIOD_MARKETS_BY_SPORT: Record<string, readonly MarketTypeId[]> = {
  NBA: [
    '1h_moneyline',
    '1h_spread',
    '1h_total_ou',
    '2h_moneyline',
    '2h_spread',
    '2h_total_ou',
    '1q_moneyline',
    '1q_spread',
    '1q_total_ou',
    '2q_moneyline',
    '2q_spread',
    '2q_total_ou',
    '3q_moneyline',
    '3q_spread',
    '3q_total_ou',
    '4q_moneyline',
    '4q_spread',
    '4q_total_ou',
  ],
  WNBA: [
    '1h_moneyline',
    '1h_spread',
    '1h_total_ou',
    '2h_moneyline',
    '2h_spread',
    '2h_total_ou',
    '1q_moneyline',
    '1q_spread',
    '1q_total_ou',
    '2q_moneyline',
    '2q_spread',
    '2q_total_ou',
    '3q_moneyline',
    '3q_spread',
    '3q_total_ou',
    '4q_moneyline',
    '4q_spread',
    '4q_total_ou',
  ],
  MLB: [
    '1h_moneyline',
    '1h_spread',
    '1h_total_ou',
    'f3_moneyline',
    'f3_spread',
    'f3_total_ou',
    'f5_moneyline',
    'f5_spread',
    'f5_total_ou',
    'f7_moneyline',
    'f7_spread',
    'f7_total_ou',
  ],
  NHL: [
    '1p_moneyline',
    '1p_spread',
    '1p_total_ou',
  ],
  NCAAB: [
    '1h_moneyline',
    '1h_spread',
    '1h_total_ou',
    '2h_moneyline',
    '2h_spread',
    '2h_total_ou',
  ],
  NCAAF: [
    '1h_moneyline',
    '1h_spread',
    '1h_total_ou',
    '2h_moneyline',
    '2h_spread',
    '2h_total_ou',
  ],
} as const;

export const MARKET_TYPE_LABELS: Record<MarketTypeId, string> = {
  'player-prop': 'Player Prop',
  moneyline: 'Moneyline',
  spread: 'Spread',
  total: 'Total',
  'team-total': 'Team Total',
  '1h_moneyline': '1H - 1st Half Moneyline',
  '1h_spread': '1H - 1st Half Spread',
  '1h_total_ou': '1H - 1st Half Total',
  '2h_moneyline': '2H - 2nd Half Moneyline',
  '2h_spread': '2H - 2nd Half Spread',
  '2h_total_ou': '2H - 2nd Half Total',
  '1q_moneyline': '1Q - 1st Quarter Moneyline',
  '1q_spread': '1Q - 1st Quarter Spread',
  '1q_total_ou': '1Q - 1st Quarter Total',
  '2q_moneyline': '2Q - 2nd Quarter Moneyline',
  '2q_spread': '2Q - 2nd Quarter Spread',
  '2q_total_ou': '2Q - 2nd Quarter Total',
  '3q_moneyline': '3Q - 3rd Quarter Moneyline',
  '3q_spread': '3Q - 3rd Quarter Spread',
  '3q_total_ou': '3Q - 3rd Quarter Total',
  '4q_moneyline': '4Q - 4th Quarter Moneyline',
  '4q_spread': '4Q - 4th Quarter Spread',
  '4q_total_ou': '4Q - 4th Quarter Total',
  'f3_moneyline': 'F3 - First 3 Innings Moneyline',
  'f3_spread': 'F3 - First 3 Innings Spread',
  'f3_total_ou': 'F3 - First 3 Innings Total',
  'f5_moneyline': 'F5 - First 5 Innings Moneyline',
  'f5_spread': 'F5 - First 5 Innings Spread',
  'f5_total_ou': 'F5 - First 5 Innings Total',
  'f7_moneyline': 'F7 - First 7 Innings Moneyline',
  'f7_spread': 'F7 - First 7 Innings Spread',
  'f7_total_ou': 'F7 - First 7 Innings Total',
  '1p_moneyline': '1P - 1st Period Moneyline',
  '1p_spread': '1P - 1st Period Spread',
  '1p_total_ou': '1P - 1st Period Total',
};

export function isMarketTypeId(value: string | null | undefined): value is MarketTypeId {
  return value != null && MARKET_TYPE_SET.has(value);
}

export function isPeriodMarketType(marketType: MarketTypeId | null | undefined): boolean {
  return marketType != null && PERIOD_MARKET_TYPE_SET.has(marketType);
}

export function getMarketTypeFamily(marketType: MarketTypeId): MarketTypeFamily {
  if (marketType === 'player-prop' || marketType === 'team-total') {
    return marketType;
  }

  if (marketType === 'moneyline' || marketType.endsWith('_moneyline')) {
    return 'moneyline';
  }

  if (marketType === 'spread' || marketType.endsWith('_spread')) {
    return 'spread';
  }

  return 'total';
}

export function isMoneylineMarketType(marketType: MarketTypeId | null | undefined): boolean {
  return marketType != null && getMarketTypeFamily(marketType) === 'moneyline';
}

export function isSpreadMarketType(marketType: MarketTypeId | null | undefined): boolean {
  return marketType != null && getMarketTypeFamily(marketType) === 'spread';
}

export function isTotalMarketType(marketType: MarketTypeId | null | undefined): boolean {
  return marketType != null && getMarketTypeFamily(marketType) === 'total';
}

export function getMarketTypeLabel(marketType: MarketTypeId): string {
  return MARKET_TYPE_LABELS[marketType];
}

export function getMarketTypeAbbreviation(marketType: MarketTypeId): string {
  if (!isPeriodMarketType(marketType)) {
    if (marketType === 'player-prop') return 'PROP';
    if (marketType === 'moneyline') return 'ML';
    if (marketType === 'spread') return 'SPR';
    if (marketType === 'total') return 'TOT';
    return 'T-TOT';
  }

  const [period, family] = marketType.split('_', 2);
  const prefix = PERIOD_ABBREVIATIONS[period] ?? period.toUpperCase();
  if (family === 'moneyline') return `${prefix} ML`;
  if (family === 'spread') return `${prefix} SPR`;
  return `${prefix} TOT`;
}

export function buildFallbackMarketTypeLabel(marketType: string): string {
  if (!marketType.includes('_')) {
    return marketType;
  }

  const [period, family] = marketType.split('_', 2);
  const prefix = PERIOD_LABEL_PREFIXES[period];
  if (!prefix) {
    return marketType;
  }

  if (family === 'moneyline') return `${prefix} Moneyline`;
  if (family === 'spread') return `${prefix} Spread`;
  return `${prefix} Total`;
}

export function getSupportedMarketTypesForSport(
  sportId: string,
  catalogMarketTypes: readonly string[],
): MarketTypeId[] {
  const combined = [
    ...catalogMarketTypes.flatMap((marketType) => (isMarketTypeId(marketType) ? [marketType] : [])),
    ...(PERIOD_MARKETS_BY_SPORT[sportId] ?? []),
  ];

  return Array.from(new Set(combined));
}
