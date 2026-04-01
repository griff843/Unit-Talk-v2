/**
 * The Odds API Fetcher — multi-book consensus odds provider
 *
 * Fetches odds from The Odds API (the-odds-api.com) for multiple bookmakers
 * including Pinnacle (sharp line), DraftKings, FanDuel, and BetMGM.
 *
 * Used for: real edge calculation, CLV measurement against Pinnacle closing line,
 * multi-book consensus pricing, and historical odds for backtesting.
 *
 * Issue: UTV2-197 (Sprint D)
 */

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// Default bookmakers for consensus pricing
const DEFAULT_BOOKMAKERS = ['pinnacle', 'draftkings', 'fanduel', 'betmgm'];

// Sport key mapping: V2 league names → The Odds API sport keys
const LEAGUE_TO_SPORT_KEY: Record<string, string> = {
  NFL: 'americanfootball_nfl',
  NBA: 'basketball_nba',
  MLB: 'baseball_mlb',
  NHL: 'icehockey_nhl',
  NCAAF: 'americanfootball_ncaaf',
  NCAAB: 'basketball_ncaab',
  WNBA: 'basketball_wnba',
  MLS: 'soccer_usa_mls',
  EPL: 'soccer_epl',
  UFL: 'americanfootball_ufl',
};

export interface OddsApiFetchOptions {
  apiKey: string;
  league: string;
  markets?: string[];
  bookmakers?: string[];
  oddsFormat?: 'american' | 'decimal';
  fetchImpl?: typeof fetch;
}

export interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}

export interface OddsApiMarket {
  key: string;
  last_update: string;
  outcomes: OddsApiOutcome[];
}

export interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
  description?: string; // player name for player props
}

export interface OddsApiFetchResult {
  events: OddsApiEvent[];
  eventsCount: number;
  telemetry: OddsApiTelemetry;
}

export interface OddsApiTelemetry {
  provider: 'odds-api';
  endpoint: string;
  requestCount: number;
  creditsUsed: number;
  creditsRemaining: number | null;
  sportKey: string;
  bookmakerCount: number;
  marketCount: number;
}

export interface NormalizedOddsOffer {
  providerKey: string; // e.g., 'odds-api:pinnacle'
  providerEventId: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
  snapshotAt: string;
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  homeOdds: number | null;
  awayOdds: number | null;
  eventName: string;
  sport: string;
}

/**
 * Fetch odds from The Odds API for a given league.
 * Returns raw API response + telemetry.
 */
export async function fetchOddsApiOdds(
  options: OddsApiFetchOptions,
): Promise<OddsApiFetchResult> {
  const sportKey = LEAGUE_TO_SPORT_KEY[options.league.toUpperCase()];
  if (!sportKey) {
    return {
      events: [],
      eventsCount: 0,
      telemetry: {
        provider: 'odds-api',
        endpoint: 'odds',
        requestCount: 0,
        creditsUsed: 0,
        creditsRemaining: null,
        sportKey: options.league,
        bookmakerCount: 0,
        marketCount: 0,
      },
    };
  }

  const markets = options.markets ?? ['h2h', 'spreads', 'totals'];
  const bookmakers = options.bookmakers ?? DEFAULT_BOOKMAKERS;
  const oddsFormat = options.oddsFormat ?? 'american';
  const fetchFn = options.fetchImpl ?? fetch;

  const url = new URL(`${ODDS_API_BASE}/sports/${sportKey}/odds/`);
  url.searchParams.set('apiKey', options.apiKey);
  url.searchParams.set('markets', markets.join(','));
  url.searchParams.set('bookmakers', bookmakers.join(','));
  url.searchParams.set('oddsFormat', oddsFormat);

  const response = await fetchFn(url.toString());

  const creditsRemaining = response.headers.get('x-requests-remaining');
  const creditsLast = response.headers.get('x-requests-last');

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Odds API error ${response.status}: ${errorText}`);
  }

  const events = (await response.json()) as OddsApiEvent[];

  return {
    events,
    eventsCount: events.length,
    telemetry: {
      provider: 'odds-api',
      endpoint: 'odds',
      requestCount: 1,
      creditsUsed: creditsLast ? parseInt(creditsLast, 10) : markets.length,
      creditsRemaining: creditsRemaining ? parseInt(creditsRemaining, 10) : null,
      sportKey,
      bookmakerCount: bookmakers.length,
      marketCount: markets.length,
    },
  };
}

/**
 * Fetch historical odds snapshot from The Odds API.
 * Used for CLV computation (closing line at game start) and backtesting.
 */
export async function fetchOddsApiHistorical(
  options: OddsApiFetchOptions & { date: string },
): Promise<OddsApiFetchResult> {
  const sportKey = LEAGUE_TO_SPORT_KEY[options.league.toUpperCase()];
  if (!sportKey) {
    return {
      events: [],
      eventsCount: 0,
      telemetry: {
        provider: 'odds-api',
        endpoint: 'historical',
        requestCount: 0,
        creditsUsed: 0,
        creditsRemaining: null,
        sportKey: options.league,
        bookmakerCount: 0,
        marketCount: 0,
      },
    };
  }

  const markets = options.markets ?? ['h2h', 'spreads', 'totals'];
  const bookmakers = options.bookmakers ?? DEFAULT_BOOKMAKERS;
  const fetchFn = options.fetchImpl ?? fetch;

  const url = new URL(`${ODDS_API_BASE}/historical/sports/${sportKey}/odds/`);
  url.searchParams.set('apiKey', options.apiKey);
  url.searchParams.set('regions', 'us,eu');
  url.searchParams.set('markets', markets.join(','));
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('date', options.date);

  const response = await fetchFn(url.toString());

  const creditsRemaining = response.headers.get('x-requests-remaining');
  const creditsLast = response.headers.get('x-requests-last');

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Odds API historical error ${response.status}: ${errorText}`);
  }

  const body = (await response.json()) as { data?: OddsApiEvent[] };
  const events = body.data ?? (Array.isArray(body) ? body as OddsApiEvent[] : []);

  return {
    events,
    eventsCount: events.length,
    telemetry: {
      provider: 'odds-api',
      endpoint: 'historical',
      requestCount: 1,
      creditsUsed: creditsLast ? parseInt(creditsLast, 10) : 1,
      creditsRemaining: creditsRemaining ? parseInt(creditsRemaining, 10) : null,
      sportKey,
      bookmakerCount: bookmakers.length,
      marketCount: markets.length,
    },
  };
}

/**
 * Fetch scores from The Odds API.
 * Returns final scores for completed events (supplementary to SGO results).
 */
export async function fetchOddsApiScores(
  options: Pick<OddsApiFetchOptions, 'apiKey' | 'league' | 'fetchImpl'> & { daysFrom?: number },
): Promise<{ events: OddsApiEvent[]; eventsCount: number }> {
  const sportKey = LEAGUE_TO_SPORT_KEY[options.league.toUpperCase()];
  if (!sportKey) return { events: [], eventsCount: 0 };

  const fetchFn = options.fetchImpl ?? fetch;
  const url = new URL(`${ODDS_API_BASE}/sports/${sportKey}/scores/`);
  url.searchParams.set('apiKey', options.apiKey);
  if (options.daysFrom) url.searchParams.set('daysFrom', String(options.daysFrom));

  const response = await fetchFn(url.toString());
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Odds API scores error ${response.status}: ${errorText}`);
  }

  const events = (await response.json()) as OddsApiEvent[];
  return { events, eventsCount: events.length };
}

/**
 * Normalize The Odds API response into provider_offers-compatible records.
 *
 * Each bookmaker × market × outcome becomes a separate offer record,
 * keyed by provider like 'odds-api:pinnacle', 'odds-api:draftkings'.
 */
export function normalizeOddsApiToOffers(
  events: OddsApiEvent[],
  snapshotAt: string,
): NormalizedOddsOffer[] {
  const offers: NormalizedOddsOffer[] = [];

  for (const event of events) {
    const eventName = `${event.away_team} @ ${event.home_team}`;
    const sport = event.sport_key.split('_')[0] ?? '';

    for (const bookmaker of event.bookmakers) {
      const providerKey = `odds-api:${bookmaker.key}`;

      for (const market of bookmaker.markets) {
        // Group outcomes by point/line for over/under pairing
        const outcomesByPoint = new Map<string, OddsApiOutcome[]>();
        for (const outcome of market.outcomes) {
          const key = buildOutcomePairingKey(market.key, outcome);
          const group = outcomesByPoint.get(key) ?? [];
          group.push(outcome);
          outcomesByPoint.set(key, group);
        }

        if (market.key === 'h2h') {
          // Moneyline: home vs away
          const homeOutcome = market.outcomes.find((o) => o.name === event.home_team);
          const awayOutcome = market.outcomes.find((o) => o.name === event.away_team);
          offers.push({
            providerKey,
            providerEventId: event.id,
            providerMarketKey: `${market.key}`,
            providerParticipantId: null,
            snapshotAt: bookmaker.last_update || snapshotAt,
            line: null,
            overOdds: null,
            underOdds: null,
            homeOdds: homeOutcome?.price ?? null,
            awayOdds: awayOutcome?.price ?? null,
            eventName,
            sport,
          });
        } else if (market.key === 'spreads' || market.key === 'totals') {
          // Spreads/totals: paired over/under or home/away with point
          for (const [, outcomes] of outcomesByPoint) {
            const over = outcomes.find((o) => o.name === 'Over' || o.name === event.home_team);
            const under = outcomes.find((o) => o.name === 'Under' || o.name === event.away_team);
            const line = over?.point ?? under?.point ?? null;
            const participant = over?.description ?? under?.description ?? null;

            offers.push({
              providerKey,
              providerEventId: event.id,
              providerMarketKey: participant
                ? `${market.key}:${participant}`
                : market.key,
              providerParticipantId: participant,
              snapshotAt: bookmaker.last_update || snapshotAt,
              line,
              overOdds: over?.price ?? null,
              underOdds: under?.price ?? null,
              homeOdds: null,
              awayOdds: null,
              eventName,
              sport,
            });
          }
        } else {
          // Player props and other markets
          for (const [, outcomes] of outcomesByPoint) {
            const over = outcomes.find((o) => o.name === 'Over');
            const under = outcomes.find((o) => o.name === 'Under');
            const participant = over?.description ?? under?.description ?? null;
            const line = over?.point ?? under?.point ?? null;

            offers.push({
              providerKey,
              providerEventId: event.id,
              providerMarketKey: participant
                ? `${market.key}:${participant}`
                : market.key,
              providerParticipantId: participant,
              snapshotAt: bookmaker.last_update || snapshotAt,
              line,
              overOdds: over?.price ?? null,
              underOdds: under?.price ?? null,
              homeOdds: null,
              awayOdds: null,
              eventName,
              sport,
            });
          }
        }
      }
    }
  }

  return offers;
}

/**
 * Extract Pinnacle-only offers from a normalized set.
 * Used for CLV benchmark and real edge calculation.
 */
export function filterPinnacleOffers(offers: NormalizedOddsOffer[]): NormalizedOddsOffer[] {
  return offers.filter((o) => o.providerKey === 'odds-api:pinnacle');
}

/**
 * Build consensus odds from multiple bookmaker offers for the same market.
 * Returns the average devigged probability across all available books.
 */
export function buildConsensusFromOffers(
  offers: NormalizedOddsOffer[],
  marketKey: string,
): { consensusOverProb: number; consensusUnderProb: number; bookCount: number } | null {
  const matching = offers.filter((o) => o.providerMarketKey === marketKey);
  if (matching.length === 0) return null;

  let overSum = 0;
  let underSum = 0;
  let count = 0;

  for (const offer of matching) {
    if (offer.overOdds != null && offer.underOdds != null) {
      const overImplied = americanToImplied(offer.overOdds);
      const underImplied = americanToImplied(offer.underOdds);
      const total = overImplied + underImplied;
      if (total > 0) {
        // Proportional devig
        overSum += overImplied / total;
        underSum += underImplied / total;
        count++;
      }
    }
  }

  if (count === 0) return null;

  return {
    consensusOverProb: overSum / count,
    consensusUnderProb: underSum / count,
    bookCount: count,
  };
}

function americanToImplied(odds: number): number {
  if (odds >= 100) return 100 / (odds + 100);
  if (odds <= -100) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 0.5;
}

function buildOutcomePairingKey(marketKey: string, outcome: OddsApiOutcome): string {
  if (marketKey === 'spreads' || marketKey === 'totals') {
    return `${outcome.description ?? ''}:${outcome.point ?? ''}`;
  }

  return outcome.description
    ? `${outcome.description}:${outcome.point ?? ''}`
    : `${outcome.name}:${outcome.point ?? ''}`;
}
