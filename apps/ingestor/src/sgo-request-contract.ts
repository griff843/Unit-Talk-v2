const SGO_EVENTS_ENDPOINT = 'https://api.sportsgameodds.com/v2/events';
const SGO_EVENTS_PAGE_LIMIT = '100';
const LIVE_ODDS_LOOKBACK_HOURS = 12;
const DEFAULT_RESULTS_LOOKBACK_HOURS = 48;

export type SGOStatEntityKind = 'all' | 'team' | 'player';

export interface SGOOddIdParts {
  rawOddId: string;
  baseOddId: string;
  statId: string;
  statEntityId: string;
  statEntityKind: SGOStatEntityKind;
  periodId: string;
  betTypeId: string;
  sideId: string | null;
  normalizedMarketKey: string;
  supported: boolean;
}

const SIDE_SUFFIX_PATTERN =
  /-(over|under|home|away|yes|no|home\+draw|away\+draw)$/i;
const SUPPORTED_PERIOD_PATTERN = /^(game|reg|[1-4]q|[12]h|[1-3]p|1ix[357])$/i;
const SUPPORTED_NON_GAME_PLAYER_MARKET_KEYS = new Set([
  'threePointersMade-all-1h-ou',
  'threePointersMade-all-1q-ou',
  'points+rebounds+assists-all-1h-ou',
  'points+rebounds+assists-all-1q-ou',
  'batting-singles-all-1h-ou',
  'batting-doubles-all-1h-ou',
]);

export interface SGOBaseRequestOptions {
  apiKey: string;
  league: string;
  snapshotAt: string;
  startsAfter?: string;
  startsBefore?: string;
  providerEventIds?: string[];
}

export interface SGOOddsRequestOptions extends SGOBaseRequestOptions {
  historical?: boolean;
}

export interface SGOResultsRequestOptions extends SGOBaseRequestOptions {
  lookbackHours?: number;
}

export function buildSgoOddsRequestUrl(options: SGOOddsRequestOptions): URL {
  const url = createBaseEventsUrl(options);
  url.searchParams.set('includeOpposingOdds', 'true');

  if (options.historical) {
    url.searchParams.set('finalized', 'true');
    url.searchParams.set('includeAltLines', 'true');
    url.searchParams.set('includeOpenCloseOdds', 'true');
  } else {
    url.searchParams.set('oddsAvailable', 'true');
  }

  url.searchParams.set(
    'startsAfter',
    options.startsAfter ??
      subtractHoursFromIso(options.snapshotAt, LIVE_ODDS_LOOKBACK_HOURS),
  );
  url.searchParams.set(
    'startsBefore',
    options.startsBefore ?? addDaysToIso(options.snapshotAt, 7),
  );

  return url;
}

export function buildSgoResultsRequestUrl(
  options: SGOResultsRequestOptions,
): URL {
  const url = createBaseEventsUrl(options);
  url.searchParams.set('finalized', 'true');
  url.searchParams.set(
    'startsBefore',
    options.startsBefore ?? options.snapshotAt,
  );
  url.searchParams.set(
    'startsAfter',
    options.startsAfter ??
      subtractHoursFromIso(
        options.snapshotAt,
        options.lookbackHours ?? DEFAULT_RESULTS_LOOKBACK_HOURS,
      ),
  );
  return url;
}

export function parseSgoOddId(oddId: string): SGOOddIdParts | null {
  const sideMatch = oddId.match(SIDE_SUFFIX_PATTERN);
  const sideId = sideMatch?.[1] ?? null;
  const baseOddId = stripSgoSideSuffix(oddId);
  const segments = baseOddId.split('-');
  if (segments.length < 4) {
    return null;
  }

  let statIdSegments = segments.slice(0, -3);
  let statEntityId = segments[segments.length - 3];
  const periodId = segments[segments.length - 2];
  const betTypeId = segments[segments.length - 1];
  if (
    statEntityId &&
    classifySgoStatEntityId(statEntityId) === 'player' &&
    statIdSegments[statIdSegments.length - 1]?.toLowerCase() === 'player'
  ) {
    if (!statEntityId.includes('_')) {
      statEntityId = `player-${statEntityId}`;
    }
    statIdSegments = statIdSegments.slice(0, -1);
  }
  if (statIdSegments.length === 0 || !statEntityId || !periodId || !betTypeId) {
    return null;
  }

  const statId = statIdSegments.join('-');
  const statEntityKind = classifySgoStatEntityId(statEntityId);
  const normalizedMarketKey = `${statId}-all-${periodId}-${betTypeId}`;

  return {
    rawOddId: oddId,
    baseOddId,
    statId,
    statEntityId,
    statEntityKind,
    periodId,
    betTypeId,
    sideId,
    normalizedMarketKey,
    supported: isSupportedSgoMarketKey({
      statEntityKind,
      periodId,
      normalizedMarketKey,
    }),
  };
}

export function normalizeSgoProviderMarketKey(
  marketKey: string,
  options: { statEntityId?: string | null } = {},
): string | null {
  const parts = parseSgoOddId(marketKey);
  if (!parts) {
    return stripSgoSideSuffix(marketKey);
  }
  const statEntityKind =
    options.statEntityId &&
    classifySgoStatEntityId(options.statEntityId) === 'player'
      ? 'player'
      : parts.statEntityKind;
  return isSupportedSgoMarketKey({
    statEntityKind,
    periodId: parts.periodId,
    normalizedMarketKey: parts.normalizedMarketKey,
  })
    ? parts.normalizedMarketKey
    : null;
}

export function inferSgoParticipantId(
  marketKey: string,
  options: { statEntityId?: string | null } = {},
): string | null {
  if (
    options.statEntityId &&
    classifySgoStatEntityId(options.statEntityId) === 'player'
  ) {
    return options.statEntityId;
  }
  const parts = parseSgoOddId(marketKey);
  if (!parts || parts.statEntityKind !== 'player') {
    return null;
  }
  return parts.statEntityId;
}

export function stripSgoSideSuffix(marketKey: string) {
  return marketKey.replace(SIDE_SUFFIX_PATTERN, '');
}

function classifySgoStatEntityId(value: string): SGOStatEntityKind {
  const normalized = value.toLowerCase();
  if (normalized === 'all') {
    return 'all';
  }
  if (normalized === 'home' || normalized === 'away') {
    return 'team';
  }
  return 'player';
}

function isSupportedSgoMarketKey(input: {
  statEntityKind: SGOStatEntityKind;
  periodId: string;
  normalizedMarketKey: string;
}) {
  if (!SUPPORTED_PERIOD_PATTERN.test(input.periodId)) {
    return false;
  }

  if (input.statEntityKind !== 'player') {
    return true;
  }

  if (input.periodId.toLowerCase() === 'game') {
    return true;
  }

  return SUPPORTED_NON_GAME_PLAYER_MARKET_KEYS.has(input.normalizedMarketKey);
}

function createBaseEventsUrl(options: SGOBaseRequestOptions): URL {
  const url = new URL(SGO_EVENTS_ENDPOINT);
  url.searchParams.set('apiKey', options.apiKey);
  url.searchParams.set('leagueID', options.league);
  url.searchParams.set('limit', SGO_EVENTS_PAGE_LIMIT);
  if (options.providerEventIds && options.providerEventIds.length > 0) {
    url.searchParams.set('eventID', options.providerEventIds.join(','));
  }
  return url;
}

function addDaysToIso(iso: string, days: number) {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function subtractHoursFromIso(iso: string, hours: number) {
  const date = new Date(iso);
  date.setUTCHours(date.getUTCHours() - hours);
  return date.toISOString();
}
