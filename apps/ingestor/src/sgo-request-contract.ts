const SGO_EVENTS_ENDPOINT = 'https://api.sportsgameodds.com/v2/events';
const SGO_EVENTS_PAGE_LIMIT = '100';
const LIVE_ODDS_LOOKBACK_HOURS = 12;
const DEFAULT_RESULTS_LOOKBACK_HOURS = 48;
/** Forward window for the default game-line fetch (all markets). */
const GAME_LINE_STARTS_BEFORE_DAYS = 7;
/**
 * Forward window for the dedicated player-prop fetch (oddID-wildcard). This fetch
 * is high-volume on a full slate (e.g. MLB) because PLAYER_ID wildcards expand to
 * every player on every event; a 7-day window multiplies that across an entire
 * week of games and overwhelms pagination/payload. Player props are only actionable
 * near tip-off, so the player-prop fetch is bounded to the imminent slate.
 * Game-line markets keep the full 7-day window. (UTV2-1280)
 */
const PLAYER_PROP_STARTS_BEFORE_HOURS = 36;

/**
 * PLAYER_ID-wildcard oddID patterns confirmed working via live API test (2026-06-12).
 * Use the wildcard string 'PLAYER_ID' in the statEntityID position to match all players.
 * freeThrowsAttempted was tested and returned no data for NBA — omitted.
 */
export const SGO_PLAYER_PROP_ODD_ID_PATTERNS = {
  MLB: [
    'batting_hits-PLAYER_ID-game-ou-over',
    'batting_hits-PLAYER_ID-game-ou-under',
    'batting_totalBases-PLAYER_ID-game-ou-over',
    'batting_totalBases-PLAYER_ID-game-ou-under',
    'batting_homeRuns-PLAYER_ID-game-ou-over',
    'batting_homeRuns-PLAYER_ID-game-ou-under',
    'batting_RBI-PLAYER_ID-game-ou-over',
    'batting_RBI-PLAYER_ID-game-ou-under',
  ],
  NBA: [
    'points-PLAYER_ID-game-ou-over',
    'points-PLAYER_ID-game-ou-under',
    'rebounds-PLAYER_ID-game-ou-over',
    'rebounds-PLAYER_ID-game-ou-under',
    'assists-PLAYER_ID-game-ou-over',
    'assists-PLAYER_ID-game-ou-under',
    'threePointersMade-PLAYER_ID-game-ou-over',
    'threePointersMade-PLAYER_ID-game-ou-under',
  ],
} as const satisfies Record<string, readonly string[]>;

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
  /** When true, appends bookmakerID=pinnacle to the request URL.
   *  INVALID when playerPropOddIdPatterns is also set — Pinnacle carries no
   *  player-prop odds (verified 2026-06-12 live against MLB + NBA). */
  pinnacleOnly?: boolean;
  /**
   * When provided, appends oddID=<patterns> to restrict the response to
   * specific player-prop market patterns. Use PLAYER_ID as a wildcard for the
   * statEntityID position, e.g. 'batting_hits-PLAYER_ID-game-ou-over'.
   *
   * Confirmed working patterns (live-tested 2026-06-12):
   *   MLB: batting_hits, batting_totalBases, batting_homeRuns, batting_RBI
   *   NBA: points, rebounds, assists, threePointersMade
   *
   * Do NOT combine with pinnacleOnly — Pinnacle has no player-prop data.
   * When set, pinnacleOnly is silently ignored to prevent empty responses.
   *
   * Leave undefined to fall back to full-league fetch (all markets).
   */
  playerPropOddIdPatterns?: string[];
  /**
   * When true, requests SGO open/close bookmaker fields on a LIVE (non-historical)
   * fetch (historical mode always sets them). Safe to combine with
   * playerPropOddIdPatterns — used by the dedicated player-prop fetch so open/close
   * identity is available for forward-flow CLV (UTV2-1275 Wave 1).
   */
  includeOpenCloseOdds?: boolean;
}

export interface SGOResultsRequestOptions extends SGOBaseRequestOptions {
  lookbackHours?: number;
}

export function buildSgoOddsRequestUrl(options: SGOOddsRequestOptions): URL {
  const url = createBaseEventsUrl(options);
  url.searchParams.set('includeOpposingOdds', 'true');

  if (options.historical) {
    url.searchParams.set('finalized', 'true');
    url.searchParams.set('includeOpenCloseOdds', 'true');
  } else {
    url.searchParams.set('oddsAvailable', 'true');
    if (options.includeOpenCloseOdds) {
      url.searchParams.set('includeOpenCloseOdds', 'true');
    }
  }

  if (options.playerPropOddIdPatterns?.length) {
    // oddID filter: use PLAYER_ID wildcard patterns to reduce response payload.
    // Pinnacle is intentionally excluded — it carries no player-prop data.
    url.searchParams.set('oddID', options.playerPropOddIdPatterns.join(','));
  } else if (options.pinnacleOnly) {
    // pinnacleOnly only applies to game-level markets (ML/spread/total).
    url.searchParams.set('bookmakerID', 'pinnacle');
  }

  url.searchParams.set(
    'startsAfter',
    options.startsAfter ??
      subtractHoursFromIso(options.snapshotAt, LIVE_ODDS_LOOKBACK_HOURS),
  );
  // The player-prop fetch is bounded to the imminent slate to keep high-volume
  // PLAYER_ID-wildcard responses (and their pagination) within budget (UTV2-1280).
  // A caller-supplied startsBefore always wins; historical fetches keep 7 days.
  const isLivePlayerPropFetch =
    !options.historical && Boolean(options.playerPropOddIdPatterns?.length);
  url.searchParams.set(
    'startsBefore',
    options.startsBefore ??
      (isLivePlayerPropFetch
        ? addHoursToIso(options.snapshotAt, PLAYER_PROP_STARTS_BEFORE_HOURS)
        : addDaysToIso(options.snapshotAt, GAME_LINE_STARTS_BEFORE_DAYS)),
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

function addHoursToIso(iso: string, hours: number) {
  const date = new Date(iso);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function subtractHoursFromIso(iso: string, hours: number) {
  const date = new Date(iso);
  date.setUTCHours(date.getUTCHours() - hours);
  return date.toISOString();
}
