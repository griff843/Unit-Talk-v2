import type { SGOPairedProp } from './sgo-normalizer.js';

const SGO_EVENTS_ENDPOINT = 'https://api.sportsgameodds.com/v2/events';

export interface SGOFetchOptions {
  apiKey: string;
  league: string;
  snapshotAt: string;
  startsAfter?: string;
  startsBefore?: string;
  fetchImpl?: typeof fetch;
}

export interface SGOFetchResult {
  eventsCount: number;
  events: SGOResolvedEvent[];
  pairedProps: SGOPairedProp[];
}

export interface SGOResultsFetchOptions {
  apiKey: string;
  league: string;
  snapshotAt: string;
  lookbackHours?: number;
  fetchImpl?: typeof fetch;
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
  completed: boolean;
  cancelled: boolean;
  ended: boolean;
  live: boolean;
  delayed: boolean;
  finalized: boolean;
  oddsAvailable: boolean;
}

export interface SGOPlayerStatRow {
  providerParticipantId: string;
  stats: Record<string, number>;
}

export interface SGOEventResult {
  providerEventId: string;
  status: SGOEventStatus | null;
  playerStats: SGOPlayerStatRow[];
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
}

export async function fetchAndPairSGOProps(
  options: SGOFetchOptions,
): Promise<SGOFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL(SGO_EVENTS_ENDPOINT);
  url.searchParams.set('apiKey', options.apiKey);
  url.searchParams.set('leagueID', options.league);
  url.searchParams.set('includeOpposingOdds', 'true');
  url.searchParams.set('oddsAvailable', 'true');
  url.searchParams.set('startsAfter', options.startsAfter ?? options.snapshotAt);
  url.searchParams.set(
    'startsBefore',
    options.startsBefore ?? addDaysToIso(options.snapshotAt, 7),
  );

  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`SGO fetch failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as unknown;
  const rawEvents = extractEvents(payload);
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
  };
}

function extractResolvedEvent(event: Record<string, unknown>): SGOResolvedEvent | null {
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
  const providerParticipantIds = new Set<string>(players.map((player) => player.playerId));
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
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL(SGO_EVENTS_ENDPOINT);
  url.searchParams.set('apiKey', options.apiKey);
  url.searchParams.set('leagueID', options.league);
  url.searchParams.set('startsBefore', options.snapshotAt);
  url.searchParams.set(
    'startsAfter',
    subtractHoursFromIso(options.snapshotAt, options.lookbackHours ?? 48),
  );

  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`SGO results fetch failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as unknown;
  const rawEvents = extractEvents(payload);

  return rawEvents
    .map(extractEventResult)
    .filter((event): event is SGOEventResult => event !== null);
}

function pairEventOdds(event: Record<string, unknown>, snapshotAt: string) {
  const providerEventId = firstString(event.eventID, event.eventId, event.id);
  if (!providerEventId) {
    return [];
  }

  const sportKey = firstString(event.leagueID, event.leagueId, event.sportKey) ?? null;
  const rows: FlatSGOOddsRow[] = [];
  collectOddsRows(event.odds, providerEventId, sportKey, rows);

  const grouped = new Map<string, SGOPairedProp>();
  for (const row of rows) {
    const baseMarketKey = stripSideSuffix(row.marketKey);
    const lineStr = formatLine(row.line);
    const participantKey = row.providerParticipantId ?? '_';
    const groupKey = [providerEventId, participantKey, baseMarketKey, lineStr].join(':');
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
  }

  return Array.from(grouped.values());
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
      collectOddsRows(item, providerEventId, sportKey, rows, inheritedMarketKey);
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
      line: firstNumber(node.bookOverUnder, node.fairOverUnder, node.line, node.points, node.total, node.handicap),
      odds: firstNumber(node.bookOdds, node.fairOdds, node.americanOdds, node.oddsAmerican, node.odds, node.price),
      side,
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
      firstString(playerValue.playerID, playerValue.playerId, playerId) ?? playerId;
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

  return players.sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function extractEventResult(event: Record<string, unknown>): SGOEventResult | null {
  const providerEventId = firstString(event.eventID, event.eventId, event.id);
  if (!providerEventId) {
    return null;
  }

  const status = extractStatus(event.status);
  if (!status || !status.completed || !status.finalized) {
    return null;
  }

  return {
    providerEventId,
    status,
    playerStats: extractPlayerStatRows(event.results),
  };
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
  for (const [providerParticipantId, statsValue] of Object.entries(results.game)) {
    if (!isRecord(statsValue) || isReservedSidePlaceholder(providerParticipantId.toLowerCase())) {
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
  return typeof current === 'string' && current.length > 0 ? current : undefined;
}

function buildDisplayName(firstName: string | null, lastName: string | null) {
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName.length > 0 ? fullName : undefined;
}

export function deriveDisplayNameFromProviderId(providerParticipantId: string) {
  const segments = providerParticipantId
    .split('_')
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return providerParticipantId;
  }

  const trimmed = [...segments];
  if (trimmed.length > 0 && /^[A-Z]{2,5}$/.test(trimmed[trimmed.length - 1] ?? '')) {
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
  if (marketKey.endsWith('-over')) {
    return 'over';
  }
  if (marketKey.endsWith('-under')) {
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
  return marketKey.replace(/-(over|under)$/i, '');
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
