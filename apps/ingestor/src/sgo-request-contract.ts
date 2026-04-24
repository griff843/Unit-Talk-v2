const SGO_EVENTS_ENDPOINT = 'https://api.sportsgameodds.com/v2/events';
const SGO_EVENTS_PAGE_LIMIT = '100';
const LIVE_ODDS_LOOKBACK_HOURS = 12;
const DEFAULT_RESULTS_LOOKBACK_HOURS = 48;

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
