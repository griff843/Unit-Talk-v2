import type { SGOPairedProp } from './sgo-normalizer.js';
import {
  buildSgoOddsRequestUrl,
  buildSgoResultsRequestUrl,
} from './sgo-request-contract.js';

const SGO_USAGE_ENDPOINT = 'https://api.sportsgameodds.com/v2/account/usage';
const MAX_SGO_PAGINATION_PAGES = 100;

export interface SGOFetchOptions {
  apiKey: string;
  league: string;
  snapshotAt: string;
  startsAfter?: string;
  startsBefore?: string;
  providerEventIds?: string[];
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /**
   * When true, switches from live-odds mode (oddsAvailable=true) to historical
   * mode (finalized=true + includeAltLines=true + includeOpenCloseOdds=true).
   * Use for backfill of completed events.
   * Historical events have oddsAvailable=false so they are excluded by the live filter.
   */
  historical?: boolean;
}

export interface SGOFetchResult {
  eventsCount: number;
  events: SGOResolvedEvent[];
  pairedProps: SGOPairedProp[];
  requestTelemetry: SGORequestTelemetry;
}

export interface SGOResultsFetchOptions {
  apiKey: string;
  league: string;
  snapshotAt: string;
  startsAfter?: string;
  startsBefore?: string;
  providerEventIds?: string[];
  lookbackHours?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface SGORequestTelemetry {
  provider: 'sgo';
  endpoint: 'odds' | 'results';
  requestCount: number;
  successfulRequests: number;
  creditsUsed: number;
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  lastStatus: number | null;
  rateLimitHitCount: number;
  backoffCount: number;
  backoffMs: number;
  retryAfterMs: number | null;
  throttled: boolean;
  headersSeen: boolean;
}

export interface SGOResolvedTeam {
  teamId: string | null;
  displayName: string;
  abbreviation: string | null;
  city: string | null;
}

export interface SGOResolvedPlayer {
  playerId: string;
  teamId: string | null;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
}

export interface SGOEventStatus {
  started: boolean;
  /** Not reliably set by SGO — use `finalized` as the authoritative completion gate. */
  completed: boolean;
  cancelled: boolean;
  /** Game has ended (scores available but not yet finalized). Acceptable for early scoring with correction risk. */
  ended: boolean;
  live: boolean;
  delayed: boolean;
  /** Authoritative completion signal from SGO. Use this to mark events completed and trigger settlement. */
  finalized: boolean;
  oddsAvailable: boolean;
}

export interface SGOPlayerStatRow {
  providerParticipantId: string;
  stats: Record<string, number>;
}

export interface SGOMarketScore {
  oddId: string;
  baseMarketKey: string;
  providerParticipantId: string | null;
  score: number;
  scoringSupported: boolean;
}

export interface SGOEventResult {
  providerEventId: string;
  status: SGOEventStatus | null;
  playerStats: SGOPlayerStatRow[];
  scoredMarkets: SGOMarketScore[];
  resolvedEvent: SGOResolvedEvent | null;
}

export interface SGOResolvedEvent {
  providerEventId: string;
  leagueKey: string | null;
  sportKey: string | null;
  eventName: string;
  startsAt: string | null;
  status: SGOEventStatus | null;
  venue: string | null;
  broadcast: string | null;
  teams: {
    home: SGOResolvedTeam | null;
    away: SGOResolvedTeam | null;
  };
  players: SGOResolvedPlayer[];
  providerParticipantIds: string[];
}

interface FlatSGOOddsRow {
  providerEventId: string;
  marketKey: string;
  providerParticipantId: string | null;
  sportKey: string | null;
  line: number | string | null;
  odds: number | null;
  side: 'over' | 'under';
  byBookmaker?: Record<string, unknown>;
}

/** Priority bookmakers to extract from byBookmaker (in preference order for CLV). */
const PRIORITY_BOOKMAKERS = [
  'pinnacle',
  'draftkings',
  'fanduel',
  'betmgm',
  'fanatics',
  'bet365',
  'bovada',
] as const;

export async function fetchAndPairSGOProps(
  options: SGOFetchOptions,
): Promise<SGOFetchResult> {
  const url = buildSgoOddsRequestUrl(options);

  const { payloads, telemetry } = await fetchSgoPages({
    endpoint: 'odds',
    url,
    fetchImpl: options.fetchImpl ?? fetch,
    ...(options.sleep ? { sleep: options.sleep } : {}),
  });
  const rawEvents = payloads.flatMap(extractEvents);
  const events = rawEvents
    .map(extractResolvedEvent)
    .filter((event): event is SGOResolvedEvent => event !== null);
  const pairedProps: SGOPairedProp[] = [];

  for (const event of rawEvents) {
    pairedProps.push(...pairEventOdds(event, options.snapshotAt));
  }

  return {
    eventsCount: rawEvents.length,
    events,
    pairedProps,
    requestTelemetry: telemetry,
  };
}

function extractResolvedEvent(
  event: Record<string, unknown>,
): SGOResolvedEvent | null {
  const providerEventId = firstString(event.eventID, event.eventId, event.id);
  if (!providerEventId) {
    return null;
  }

  const teams = extractTeams(event.teams);
  const awayName = teams.away?.displayName;
  const homeName = teams.home?.displayName;
  const eventName =
    awayName && homeName ? `${awayName} vs. ${homeName}` : providerEventId;

  const players = extractPlayers(event.players);
  const providerParticipantIds = new Set<string>(
    players.map((player) => player.playerId),
  );
  const pairedProps = pairEventOdds(event, new Date().toISOString());
  for (const prop of pairedProps) {
    if (prop.providerParticipantId) {
      providerParticipantIds.add(prop.providerParticipantId);
    }
  }

  return {
    providerEventId,
    leagueKey: firstString(event.leagueID, event.leagueId) ?? null,
    sportKey: firstString(event.sportID, event.sportId, event.sportKey) ?? null,
    eventName,
    startsAt: getNestedString(event, ['status', 'startsAt']) ?? null,
    status: extractStatus(event.status),
    venue: getNestedString(event, ['info', 'venue', 'name']) ?? null,
    broadcast: getNestedString(event, ['info', 'broadcast']) ?? null,
    teams,
    players,
    providerParticipantIds: Array.from(providerParticipantIds).sort(),
  };
}

export async function fetchSGOResults(
  options: SGOResultsFetchOptions,
): Promise<SGOEventResult[]> {
  const { results } = await fetchSGOResultsWithTelemetry(options);
  return results;
}

export async function fetchSGOResultsWithTelemetry(
  options: SGOResultsFetchOptions,
): Promise<{
  results: SGOEventResult[];
  requestTelemetry: SGORequestTelemetry;
}> {
  const url = buildSgoResultsRequestUrl(options);

  const { payloads, telemetry } = await fetchSgoPages({
    endpoint: 'results',
    url,
    fetchImpl: options.fetchImpl ?? fetch,
    ...(options.sleep ? { sleep: options.sleep } : {}),
  });
  const rawEvents = payloads.flatMap(extractEvents);

  return {
    results: rawEvents
      .map(extractEventResult)
      .filter((event): event is SGOEventResult => event !== null),
    requestTelemetry: telemetry,
  };
}

const MAX_RATE_LIMIT_RETRIES = 1;
const DEFAULT_BACKOFF_MS = 60_000;

async function fetchSgoPages(input: {
  endpoint: 'odds' | 'results';
  url: URL;
  fetchImpl: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}) {
  const telemetry = createEmptyTelemetry(input.endpoint);
  const payloads: unknown[] = [];
  const seenCursors = new Set<string>();
  let nextCursor: string | null = null;

  for (let page = 0; page < MAX_SGO_PAGINATION_PAGES; page += 1) {
    const pageUrl = new URL(input.url.toString());
    if (nextCursor) {
      pageUrl.searchParams.set('cursor', nextCursor);
    }

    const result = await fetchSgoJson({
      ...input,
      url: pageUrl,
    });
    mergeTelemetry(telemetry, result.telemetry);
    if (result.endOfResults) {
      return { payloads, telemetry };
    }
    payloads.push(result.payload);

    nextCursor = extractNextCursor(result.payload);
    if (!nextCursor) {
      return { payloads, telemetry };
    }
    if (seenCursors.has(nextCursor)) {
      throw new Error(
        `SGO ${input.endpoint} pagination repeated cursor: ${nextCursor}`,
      );
    }
    seenCursors.add(nextCursor);
  }

  throw new Error(
    `SGO ${input.endpoint} pagination exceeded ${MAX_SGO_PAGINATION_PAGES} pages`,
  );
}

async function fetchSgoJson(input: {
  endpoint: 'odds' | 'results';
  url: URL;
  fetchImpl: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}) {
  const telemetry = createEmptyTelemetry(input.endpoint);
  let lastStatusText = 'unknown';

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    const response = await input.fetchImpl(input.url.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    });

    telemetry.requestCount += 1;
    telemetry.lastStatus = response.status;
    lastStatusText = response.statusText;
    applyTelemetryHeaders(telemetry, response.headers);

    if (response.ok) {
      telemetry.successfulRequests += 1;
      return {
        payload: (await response.json()) as unknown,
        telemetry,
        endOfResults: false,
      };
    }

    if (response.status === 404) {
      return {
        payload: { data: [] },
        telemetry,
        endOfResults: true,
      };
    }

    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const backoffMs =
        resolveRetryAfterMs(response.headers) ?? DEFAULT_BACKOFF_MS;
      telemetry.rateLimitHitCount += 1;
      telemetry.backoffCount += 1;
      telemetry.backoffMs += backoffMs;
      telemetry.retryAfterMs = backoffMs;
      telemetry.throttled = true;
      await (input.sleep ?? defaultSleep)(backoffMs);
      continue;
    }

    throw new Error(
      `SGO ${input.endpoint} fetch failed: ${response.status} ${lastStatusText}`,
    );
  }

  throw new Error(
    `SGO ${input.endpoint} fetch failed: ${telemetry.lastStatus ?? 0} ${lastStatusText}`,
  );
}

function mergeTelemetry(
  target: SGORequestTelemetry,
  source: SGORequestTelemetry,
) {
  target.requestCount += source.requestCount;
  target.successfulRequests += source.successfulRequests;
  target.creditsUsed += source.creditsUsed;
  target.lastStatus = source.lastStatus ?? target.lastStatus;
  target.rateLimitHitCount += source.rateLimitHitCount;
  target.backoffCount += source.backoffCount;
  target.backoffMs += source.backoffMs;
  target.retryAfterMs = source.retryAfterMs ?? target.retryAfterMs;
  target.throttled = target.throttled || source.throttled;
  target.headersSeen = target.headersSeen || source.headersSeen;
  target.limit = source.limit ?? target.limit;
  target.remaining = source.remaining ?? target.remaining;
  target.resetAt = source.resetAt ?? target.resetAt;
}

function extractNextCursor(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  return (
    firstString(payload.nextCursor, payload.next_cursor) ??
    getNestedString(payload, ['pagination', 'nextCursor']) ??
    getNestedString(payload, ['pagination', 'next_cursor']) ??
    getNestedString(payload, ['meta', 'nextCursor']) ??
    getNestedString(payload, ['meta', 'next_cursor']) ??
    null
  );
}

function createEmptyTelemetry(
  endpoint: 'odds' | 'results',
): SGORequestTelemetry {
  return {
    provider: 'sgo',
    endpoint,
    requestCount: 0,
    successfulRequests: 0,
    creditsUsed: 0,
    limit: null,
    remaining: null,
    resetAt: null,
    lastStatus: null,
    rateLimitHitCount: 0,
    backoffCount: 0,
    backoffMs: 0,
    retryAfterMs: null,
    throttled: false,
    headersSeen: false,
  };
}

function applyTelemetryHeaders(
  telemetry: SGORequestTelemetry,
  headers: Headers,
) {
  const limit = readHeaderNumber(headers, [
    'x-ratelimit-limit',
    'ratelimit-limit',
  ]);
  const remaining = readHeaderNumber(headers, [
    'x-ratelimit-remaining',
    'ratelimit-remaining',
  ]);
  const retryAfterMs = resolveRetryAfterMs(headers);
  const creditsUsed = readHeaderNumber(headers, [
    'x-api-credits-used',
    'x-credits-used',
    'x-ratelimit-cost',
  ]);
  const resetAt = resolveResetAt(headers);

  if (limit !== null) {
    telemetry.limit = limit;
    telemetry.headersSeen = true;
  }
  if (remaining !== null) {
    telemetry.remaining = remaining;
    telemetry.headersSeen = true;
  }
  if (creditsUsed !== null) {
    telemetry.creditsUsed += creditsUsed;
    telemetry.headersSeen = true;
  }
  if (retryAfterMs !== null) {
    telemetry.retryAfterMs = retryAfterMs;
    telemetry.headersSeen = true;
  }
  if (resetAt !== null) {
    telemetry.resetAt = resetAt;
    telemetry.headersSeen = true;
  }
}

function readHeaderNumber(headers: Headers, names: string[]) {
  for (const name of names) {
    const raw = headers.get(name);
    if (!raw) {
      continue;
    }
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function resolveRetryAfterMs(headers: Headers) {
  const retryAfter = headers.get('retry-after');
  if (!retryAfter) {
    return null;
  }

  const seconds = Number.parseFloat(retryAfter);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1000));
  }

  const retryAt = Date.parse(retryAfter);
  if (!Number.isFinite(retryAt)) {
    return null;
  }

  return Math.max(0, retryAt - Date.now());
}

function resolveResetAt(headers: Headers) {
  const raw =
    headers.get('x-ratelimit-reset') ??
    headers.get('ratelimit-reset') ??
    headers.get('x-ratelimit-reset-after');
  if (!raw) {
    return null;
  }

  const numeric = Number.parseFloat(raw);
  if (!Number.isFinite(numeric)) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }

  if (numeric > 1_000_000_000_000) {
    return new Date(numeric).toISOString();
  }
  if (numeric > 1_000_000_000) {
    return new Date(numeric * 1000).toISOString();
  }
  return new Date(Date.now() + numeric * 1000).toISOString();
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function pairEventOdds(event: Record<string, unknown>, snapshotAt: string) {
  const providerEventId = firstString(event.eventID, event.eventId, event.id);
  if (!providerEventId) {
    return [];
  }

  const sportKey =
    firstString(event.leagueID, event.leagueId, event.sportKey) ?? null;
  const rows: FlatSGOOddsRow[] = [];
  collectOddsRows(event.odds, providerEventId, sportKey, rows);

  // Top-level paired props (consensus SGO odds)
  const grouped = new Map<string, SGOPairedProp>();
  // Per-bookmaker paired props, including explicit historical open/close prices.
  const bookmakerProps = new Map<string, SGOPairedProp>();

  for (const row of rows) {
    const baseMarketKey = stripSideSuffix(row.marketKey);
    const lineStr = formatLine(row.line);
    const participantKey = row.providerParticipantId ?? '_';
    const groupKey = [
      providerEventId,
      participantKey,
      baseMarketKey,
      lineStr,
    ].join(':');
    const existing = grouped.get(groupKey) ?? {
      providerEventId,
      marketKey: baseMarketKey,
      providerParticipantId: row.providerParticipantId,
      sportKey,
      line: row.line,
      overOdds: null,
      underOdds: null,
      snapshotAt,
    };

    if (row.side === 'over') {
      existing.overOdds = row.odds;
    } else {
      existing.underOdds = row.odds;
    }

    grouped.set(groupKey, existing);

    // Extract per-bookmaker current/open/close prices from byBookmaker.
    if (row.byBookmaker) {
      for (const bookId of PRIORITY_BOOKMAKERS) {
        const bookData = row.byBookmaker[bookId];
        if (!isRecord(bookData)) continue;
        const bookOdds = firstNumber(bookData.odds as unknown);
        if (bookOdds !== null) {
          addBookmakerPairedProp(bookmakerProps, {
            providerEventId,
            marketKey: baseMarketKey,
            providerParticipantId: row.providerParticipantId,
            sportKey,
            line: row.line,
            side: row.side,
            odds: bookOdds,
            snapshotAt,
            bookmakerKey: bookId,
            priceSource: 'current',
          });
        }

        const openOdds = firstNumber(
          bookData.openOdds,
          bookData.openBookOdds,
          bookData.openFairOdds,
        );
        if (openOdds !== null) {
          addBookmakerPairedProp(bookmakerProps, {
            providerEventId,
            marketKey: baseMarketKey,
            providerParticipantId: row.providerParticipantId,
            sportKey,
            line: firstNumber(
              bookData.openOverUnder,
              bookData.openSpread,
              row.line,
            ),
            side: row.side,
            odds: openOdds,
            snapshotAt,
            bookmakerKey: bookId,
            priceSource: 'open',
            isOpening: true,
          });
        }

        const closeOdds = firstNumber(
          bookData.closeOdds,
          bookData.closeBookOdds,
          bookData.closeFairOdds,
        );
        if (closeOdds !== null) {
          addBookmakerPairedProp(bookmakerProps, {
            providerEventId,
            marketKey: baseMarketKey,
            providerParticipantId: row.providerParticipantId,
            sportKey,
            line: firstNumber(
              bookData.closeOverUnder,
              bookData.closeSpread,
              row.line,
            ),
            side: row.side,
            odds: closeOdds,
            snapshotAt,
            bookmakerKey: bookId,
            priceSource: 'close',
            isClosing: true,
          });
        }
      }
    }
  }

  const result: SGOPairedProp[] = Array.from(grouped.values());

  result.push(...bookmakerProps.values());

  return result;
}

function addBookmakerPairedProp(
  props: Map<string, SGOPairedProp>,
  input: {
    providerEventId: string;
    marketKey: string;
    providerParticipantId: string | null;
    sportKey: string | null;
    line: number | string | null;
    side: 'over' | 'under';
    odds: number;
    snapshotAt: string;
    bookmakerKey: string;
    priceSource: 'current' | 'open' | 'close';
    isOpening?: boolean;
    isClosing?: boolean;
  },
) {
  const lineStr = formatLine(input.line);
  const participantKey = input.providerParticipantId ?? '_';
  const key = [
    input.providerEventId,
    participantKey,
    input.marketKey,
    lineStr,
    input.bookmakerKey,
    input.priceSource,
  ].join(':');
  const existing = props.get(key) ?? {
    providerEventId: input.providerEventId,
    marketKey: input.marketKey,
    providerParticipantId: input.providerParticipantId,
    sportKey: input.sportKey,
    line: input.line,
    overOdds: null,
    underOdds: null,
    snapshotAt: input.snapshotAt,
    bookmakerKey: input.bookmakerKey,
    priceSource: input.priceSource,
    isOpening: input.isOpening ?? false,
    isClosing: input.isClosing ?? false,
  };

  if (input.side === 'over') {
    existing.overOdds = input.odds;
  } else {
    existing.underOdds = input.odds;
  }
  existing.isOpening = existing.isOpening || (input.isOpening ?? false);
  existing.isClosing = existing.isClosing || (input.isClosing ?? false);
  props.set(key, existing);
}

function collectOddsRows(
  node: unknown,
  providerEventId: string,
  sportKey: string | null,
  rows: FlatSGOOddsRow[],
  inheritedMarketKey?: string,
): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectOddsRows(
        item,
        providerEventId,
        sportKey,
        rows,
        inheritedMarketKey,
      );
    }
    return;
  }

  if (!isRecord(node)) {
    return;
  }

  const marketKey = firstString(
    node.marketKey,
    node.marketID,
    node.oddID,
    node.oddId,
    inheritedMarketKey,
  );
  const side = inferSide(marketKey);

  if (marketKey && side) {
    rows.push({
      providerEventId,
      marketKey,
      providerParticipantId:
        firstString(
          node.playerID,
          node.playerId,
          node.participantID,
          node.participantId,
          node.entityID,
          node.entityId,
        ) ?? inferParticipantId(marketKey),
      sportKey,
      line: firstNumber(
        node.bookOverUnder,
        node.fairOverUnder,
        node.line,
        node.points,
        node.total,
        node.handicap,
      ),
      odds: firstNumber(
        node.bookOdds,
        node.fairOdds,
        node.americanOdds,
        node.oddsAmerican,
        node.odds,
        node.price,
      ),
      side,
      ...(isRecord(node.byBookmaker)
        ? { byBookmaker: node.byBookmaker as Record<string, unknown> }
        : {}),
    });
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    collectOddsRows(value, providerEventId, sportKey, rows, key);
  }
}

function extractEvents(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  if (isRecord(payload) && Array.isArray(payload.data)) {
    return payload.data.filter(isRecord);
  }

  return [];
}

function extractTeams(value: unknown): SGOResolvedEvent['teams'] {
  const teams = isRecord(value) ? value : {};
  return {
    home: extractTeam(teams.home),
    away: extractTeam(teams.away),
  };
}

function extractTeam(value: unknown): SGOResolvedTeam | null {
  if (!isRecord(value)) {
    return null;
  }

  const names = isRecord(value.names) ? value.names : {};
  const displayName = firstString(names.long, value.name, value.displayName);
  if (!displayName) {
    return null;
  }

  return {
    teamId: firstString(value.teamID, value.teamId, value.id) ?? null,
    displayName,
    abbreviation: firstString(names.short) ?? null,
    city: firstString(names.location) ?? null,
  };
}

function extractPlayers(value: unknown): SGOResolvedPlayer[] {
  if (!isRecord(value)) {
    return [];
  }

  const players: SGOResolvedPlayer[] = [];
  for (const [playerId, playerValue] of Object.entries(value)) {
    if (!isRecord(playerValue)) {
      continue;
    }

    const resolvedPlayerId =
      firstString(playerValue.playerID, playerValue.playerId, playerId) ??
      playerId;
    const firstName = firstString(playerValue.firstName) ?? null;
    const lastName = firstString(playerValue.lastName) ?? null;
    const displayName =
      firstString(playerValue.name, buildDisplayName(firstName, lastName)) ??
      deriveDisplayNameFromProviderId(resolvedPlayerId);

    players.push({
      playerId: resolvedPlayerId,
      teamId: firstString(playerValue.teamID, playerValue.teamId) ?? null,
      displayName,
      firstName,
      lastName,
    });
  }

  return players.sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

function extractEventResult(
  event: Record<string, unknown>,
): SGOEventResult | null {
  const providerEventId = firstString(event.eventID, event.eventId, event.id);
  if (!providerEventId) {
    return null;
  }

  const status = extractStatus(event.status);
  // Use status.finalized as the completion gate — SGO does not reliably set status.completed.
  // See: docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md
  if (!status || !status.finalized) {
    return null;
  }

  return {
    providerEventId,
    status,
    playerStats: extractPlayerStatRows(event.results),
    scoredMarkets: extractScoredMarkets(event.odds),
    resolvedEvent: extractResolvedEvent(event),
  };
}

function extractScoredMarkets(odds: unknown): SGOMarketScore[] {
  const markets: SGOMarketScore[] = [];

  if (Array.isArray(odds)) {
    for (const item of odds) {
      markets.push(...extractScoredMarkets(item));
    }
    return markets;
  }

  if (!isRecord(odds)) {
    return markets;
  }

  const selfOddId = firstString(
    odds.oddID,
    odds.oddId,
    odds.marketKey,
    odds.marketID,
  );
  if (
    'scoringSupported' in odds &&
    odds.scoringSupported === true &&
    selfOddId
  ) {
    const score = firstNumber(odds.score);
    if (score !== null) {
      markets.push({
        oddId: selfOddId,
        baseMarketKey: normalizeMarketKey(selfOddId),
        providerParticipantId:
          firstString(
            odds.playerID,
            odds.playerId,
            odds.participantID,
            odds.participantId,
            odds.entityID,
            odds.entityId,
            odds.statEntityID,
            odds.statEntityId,
          ) ?? inferParticipantId(selfOddId),
        score,
        scoringSupported: true,
      });
    }
    return markets;
  }

  for (const [oddId, oddValue] of Object.entries(odds)) {
    if (Array.isArray(oddValue)) {
      markets.push(...extractScoredMarkets(oddValue));
      continue;
    }

    if (!isRecord(oddValue)) {
      continue;
    }

    const explicitOddId = firstString(
      oddValue.oddID,
      oddValue.oddId,
      oddValue.marketKey,
      oddValue.marketID,
      oddId,
    );

    // Recursively handle nested market groups (e.g. odds.market.{oddId: ...})
    // If the value doesn't have scoringSupported, it may be a group — recurse into it
    if (!('scoringSupported' in oddValue)) {
      const nested = extractScoredMarkets(oddValue);
      markets.push(...nested);
      continue;
    }

    if (oddValue.scoringSupported !== true) {
      continue;
    }
    if (!explicitOddId) {
      continue;
    }

    const score = firstNumber(oddValue.score);
    if (score === null) {
      continue;
    }

    const baseMarketKey = normalizeMarketKey(explicitOddId);
    const providerParticipantId =
      firstString(
        oddValue.playerID,
        oddValue.playerId,
        oddValue.participantID,
        oddValue.participantId,
        oddValue.entityID,
        oddValue.entityId,
        oddValue.statEntityID,
        oddValue.statEntityId,
      ) ?? inferParticipantId(explicitOddId);

    markets.push({
      oddId: explicitOddId,
      baseMarketKey,
      providerParticipantId,
      score,
      scoringSupported: true,
    });
  }

  return markets;
}

function normalizeMarketKey(oddId: string): string {
  const base = stripSideSuffix(oddId);
  const segments = base.split('-');
  if (segments.length >= 4) {
    return [segments[0], 'all', ...segments.slice(-2)].join('-');
  }
  return base;
}

function extractStatus(value: unknown): SGOEventStatus | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    started: readBoolean(value.started),
    completed: readBoolean(value.completed),
    cancelled: readBoolean(value.cancelled),
    ended: readBoolean(value.ended),
    live: readBoolean(value.live),
    delayed: readBoolean(value.delayed),
    finalized: readBoolean(value.finalized),
    oddsAvailable: readBoolean(value.oddsAvailable),
  };
}

function extractPlayerStatRows(results: unknown): SGOPlayerStatRow[] {
  if (!isRecord(results) || !isRecord(results.game)) {
    return [];
  }

  const rows: SGOPlayerStatRow[] = [];
  for (const [providerParticipantId, statsValue] of Object.entries(
    results.game,
  )) {
    if (
      !isRecord(statsValue) ||
      isReservedSidePlaceholder(providerParticipantId.toLowerCase())
    ) {
      continue;
    }

    const stats: Record<string, number> = {};
    for (const [field, rawValue] of Object.entries(statsValue)) {
      const numericValue = firstNumber(rawValue);
      if (numericValue !== null) {
        stats[field] = numericValue;
      }
    }

    rows.push({
      providerParticipantId,
      stats,
    });
  }

  return rows.sort((left, right) =>
    left.providerParticipantId.localeCompare(right.providerParticipantId),
  );
}

function getNestedString(value: Record<string, unknown>, path: string[]) {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return typeof current === 'string' && current.length > 0
    ? current
    : undefined;
}

function buildDisplayName(firstName: string | null, lastName: string | null) {
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName.length > 0 ? fullName : undefined;
}

export interface SGOAccountUsage {
  plan: string | null;
  objectsUsed: number | null;
  objectsLimit: number | null;
  creditsUsed: number | null;
  creditsLimit: number | null;
  resetAt: string | null;
  raw: unknown;
}

export async function fetchSGOAccountUsage(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SGOAccountUsage> {
  const url = new URL(SGO_USAGE_ENDPOINT);
  url.searchParams.set('apiKey', apiKey);

  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(
      `SGO account/usage fetch failed: ${response.status} ${response.statusText}`,
    );
  }

  const raw = (await response.json()) as unknown;
  const data = isRecord(raw) ? raw : {};

  return {
    plan: firstString(data.plan, data.planName, data.tier) ?? null,
    objectsUsed:
      firstNumber(data.objectsUsed, data.objects_used, data.used) ?? null,
    objectsLimit:
      firstNumber(data.objectsLimit, data.objects_limit, data.limit) ?? null,
    creditsUsed: firstNumber(data.creditsUsed, data.credits_used) ?? null,
    creditsLimit: firstNumber(data.creditsLimit, data.credits_limit) ?? null,
    resetAt:
      firstString(
        data.resetAt,
        data.reset_at,
        data.periodEnd,
        data.period_end,
      ) ?? null,
    raw,
  };
}

export function deriveDisplayNameFromProviderId(providerParticipantId: string) {
  const segments = providerParticipantId
    .split('_')
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return providerParticipantId;
  }

  const trimmed = [...segments];
  if (
    trimmed.length > 0 &&
    /^[A-Z]{2,5}$/.test(trimmed[trimmed.length - 1] ?? '')
  ) {
    trimmed.pop();
  }
  if (trimmed.length > 0 && /^\d+$/.test(trimmed[trimmed.length - 1] ?? '')) {
    trimmed.pop();
  }

  const source = trimmed.length > 0 ? trimmed : segments;
  return source
    .map((segment) => segment.charAt(0) + segment.slice(1).toLowerCase())
    .join(' ');
}

function inferSide(marketKey: string | undefined) {
  if (!marketKey) {
    return null;
  }
  if (marketKey.endsWith('-over') || marketKey.endsWith('-home')) {
    return 'over';
  }
  if (marketKey.endsWith('-under') || marketKey.endsWith('-away')) {
    return 'under';
  }
  return null;
}

function inferParticipantId(marketKey: string) {
  const segments = stripSideSuffix(marketKey).split('-');
  if (segments.length < 4) {
    return null;
  }
  const candidate = segments.slice(1, -2).join('-');
  if (!candidate || candidate === 'all') {
    return null;
  }

  const normalizedCandidate = candidate.replace(/^player[-_]/i, '');
  const normalized = normalizedCandidate.toLowerCase();
  if (isReservedSidePlaceholder(normalized)) {
    return null;
  }

  return normalizedCandidate;
}

function stripSideSuffix(marketKey: string) {
  return marketKey.replace(/-(over|under|home|away)$/i, '');
}

function formatLine(line: number | string | null) {
  if (typeof line === 'number' && Number.isFinite(line)) {
    return line.toFixed(1);
  }
  if (typeof line === 'string' && line.length > 0) {
    const parsed = Number.parseFloat(line);
    return Number.isFinite(parsed) ? parsed.toFixed(1) : 'null';
  }
  return 'null';
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.length > 0) {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function readBoolean(value: unknown) {
  return value === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReservedSidePlaceholder(value: string) {
  return /^(player[-_])?(home|away)$/i.test(value);
}
