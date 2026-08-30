#!/usr/bin/env tsx

/**
 * UTV2-1745 — retrospective pick trustworthiness audit.
 *
 * The production adapter intentionally exposes only HTTP GET. It cannot issue
 * a PostgREST mutation even when the supplied credential has broader rights.
 * The audit never regrades, backfills, or persists CLV.
 */

import { pathToFileURL } from 'node:url';

const ISSUE_ID = 'UTV2-1745';
const DEFAULT_PROJECT_REF = 'zfzdnfwdarxucxtaojxm';
const DEFAULT_SAMPLE_SIZE = 200;
const MAX_SAMPLE_SIZE = 500;
const BULK_CHUNK_SIZE = 80;

type JsonRecord = Record<string, unknown>;
type SettlementResult = 'win' | 'loss' | 'push';
type SelectionSide = 'over' | 'under';

export interface SettlementRow {
  id: string;
  pick_id: string;
  status: string;
  result: string | null;
  source: string;
  evidence_ref: string | null;
  payload: unknown;
  settled_at: string;
  corrects_id: string | null;
}

export interface PickRow {
  id: string;
  market: string;
  market_type_id: string | null;
  selection: string;
  line: number | null;
  odds: number | null;
  participant_id: string | null;
  status: string;
  metadata: unknown;
  created_at: string;
}

export interface GameResultRow {
  id: string;
  event_id: string;
  participant_id: string | null;
  market_key: string;
  actual_value: number;
}

export interface EventRow {
  id: string;
  external_id: string | null;
  event_name: string;
  event_date: string;
  metadata: unknown;
}

export interface ParticipantRow {
  id: string;
  external_id: string | null;
  display_name: string;
  participant_type: string;
  sport?: string | null;
}

export interface MarketUniverseRow {
  id: string;
  event_id: string | null;
  participant_id: string | null;
  provider_event_id: string;
  provider_market_key: string;
  provider_participant_id: string | null;
  provider_key: string;
  closing_line: number | null;
  closing_over_odds: number | null;
  closing_under_odds: number | null;
  last_offer_snapshot_at: string;
}

export interface ClosingOfferRow {
  id: string | null;
  provider_event_id: string | null;
  provider_market_key: string | null;
  provider_participant_id: string | null;
  provider_key: string | null;
  bookmaker_key: string | null;
  is_closing: boolean | null;
  line: number | null;
  over_odds: number | null;
  under_odds: number | null;
  snapshot_at: string | null;
}

export interface ProviderMarketAliasRow {
  market_type_id: string;
  provider: string;
  provider_market_key: string;
}

interface ReadRequest {
  table: string;
  select: string;
  filters?: Readonly<Record<string, string>>;
  order?: string;
  limit?: number;
  offset?: number;
  exactCount?: boolean;
  head?: boolean;
}

export interface ReadResponse<T> {
  rows: T[];
  count: number | null;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** GET-only PostgREST transport. There is deliberately no generic request method. */
export class ReadOnlyPostgrestClient {
  readonly #restBase: URL;
  readonly #key: string;
  readonly #fetch: FetchLike;
  /** Measured transport evidence. Asserting `writes: 0` proves nothing; counting does. */
  readonly #methodsUsed = new Map<string, number>();

  constructor(baseUrl: string, key: string, fetchImpl: FetchLike = fetch) {
    const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.#restBase = new URL('rest/v1/', normalized);
    this.#key = key;
    this.#fetch = fetchImpl;
  }

  /** Every HTTP method this client has actually issued, with its call count. */
  transportEvidence(): { methods: Record<string, number>; requests: number } {
    const methods: Record<string, number> = {};
    let requests = 0;
    for (const [method, count] of this.#methodsUsed) {
      methods[method] = count;
      requests += count;
    }
    return { methods, requests };
  }

  async read<T>(request: ReadRequest): Promise<ReadResponse<T>> {
    const url = new URL(request.table, this.#restBase);
    url.searchParams.set('select', request.select);
    for (const [column, filter] of Object.entries(request.filters ?? {})) {
      url.searchParams.set(column, filter);
    }
    if (request.order) url.searchParams.set('order', request.order);
    if (request.limit !== undefined) url.searchParams.set('limit', String(request.limit));
    if (request.offset !== undefined) url.searchParams.set('offset', String(request.offset));

    const headers: Record<string, string> = {
      apikey: this.#key,
      Authorization: `Bearer ${this.#key}`,
      Accept: 'application/json',
    };
    if (request.exactCount) headers['Prefer'] = 'count=exact';

    // One constant feeds both the tally and the request, so the tally cannot
    // drift from the method actually sent and the "measured, not asserted"
    // claim is structurally true rather than true by coincidence.
    const method = 'GET';
    this.#methodsUsed.set(method, (this.#methodsUsed.get(method) ?? 0) + 1);
    const response = await this.#fetch(url, {
      method,
      headers,
      redirect: 'error',
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(
        `read failed for ${request.table}: HTTP ${response.status} ${detail}`,
      );
    }

    const count = parseContentRangeCount(response.headers.get('content-range'));
    if (request.head) return { rows: [], count };

    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      throw new Error(`read failed for ${request.table}: response was not an array`);
    }
    return { rows: body as T[], count };
  }
}

function parseContentRangeCount(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function chunk<T>(items: readonly T[], size = BULK_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function unique(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function inFilter(values: readonly string[]): string {
  return `in.(${values.join(',')})`;
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

/** `??` falls back only on null/undefined; an empty string must not survive as an identity. */
function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

export function inferSelectionSide(selection: string): SelectionSide | null {
  // Production evaluates four branches SEQUENTIALLY (apps/api/src/clv-service.ts):
  // \bover\b, then \bunder\b, then the O<digit> token, then the U<digit> token.
  // Collapsing them into two over/under families changes the answer for a
  // selection carrying both an `under` word and an `O 8` token.
  const normalized = selection.toLowerCase();
  if (/\bover\b/.test(normalized)) return 'over';
  if (/\bunder\b/.test(normalized)) return 'under';
  if (/\bO\s+\d/.test(selection) || /^O\s+\d/.test(selection)) return 'over';
  if (/\bU\s+\d/.test(selection) || /^U\s+\d/.test(selection)) return 'under';
  return null;
}

export function recomputeGrade(
  actualValue: number,
  line: number,
  side: SelectionSide,
): SettlementResult {
  if (actualValue === line) return 'push';
  const overWon = actualValue > line;
  return side === 'over'
    ? (overWon ? 'win' : 'loss')
    : (overWon ? 'loss' : 'win');
}

function settlementResult(value: string | null): SettlementResult | null {
  return value === 'win' || value === 'loss' || value === 'push' ? value : null;
}

function gameResultReference(settlement: SettlementRow): {
  id: string | null;
  conflict: boolean;
} {
  const evidenceId = settlement.evidence_ref?.startsWith('game-result:')
    ? settlement.evidence_ref.slice('game-result:'.length).trim()
    : null;
  const gradingContext = asRecord(asRecord(settlement.payload)['gradingContext']);
  const payloadId = readString(gradingContext, 'gameResultId');
  return {
    id: evidenceId || payloadId,
    conflict: Boolean(evidenceId && payloadId && evidenceId !== payloadId),
  };
}

/**
 * The CLV context production used for a `source='grading'` settlement.
 *
 * This cohort is written by recordGradedSettlement / recordCorrectedSettlement
 * (apps/api/src/settlement-service.ts), which resolve CLV context from the
 * GRADING EVENT and pass it as `preResolvedContext`. That short-circuits
 * `resolvePickEventContext` entirely (apps/api/src/clv-service.ts), so for
 * every settlement in this audit's cohort production's event identity, cutoff
 * and participant come from here -- not from market_universe, not from
 * pick metadata, and not from readRetainedEventStartTime.
 *
 * `gradingContext.eventId` is persisted on the settlement row, so using it is
 * NOT circular: it is the value production recorded at grading time, read from
 * the settlement, not derived from the game_results row being validated. It is
 * therefore used for CLV only. The P1-A identity proof never consults it,
 * because the grading service chose that event from the same game result whose
 * membership is in question.
 */
export interface GradingClvContext {
  providerEventId: string;
  eventStartTime: string;
  participantExternalId: string | null;
}

/** The event id production recorded when it graded this settlement. */
export function gradingContextEventId(settlement: SettlementRow): string | null {
  return readString(asRecord(asRecord(settlement.payload)['gradingContext']), 'eventId');
}

/** Production's normalization for the display-name participant fallback. */
export function normalizeDisplayName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Key for the name-fallback candidate index.
 *
 * Production does NOT search one flat pool: it calls
 * participants.listByType('player', sport) with the PICK's own metadata.sport,
 * and DatabaseParticipantRepository.listByType applies `.eq('sport', sport)`
 * only when sport is truthy. So the pool a pick is matched against is scoped to
 * that pick's sport, and an absent sport means every player.
 *
 * Pooling all sports together diverges in BOTH directions. Two players sharing a
 * normalized display_name in different sports make the audit see 2 matches where
 * production, scoped to one sport, sees 1 -- denying CLV production has. And for
 * a participant-scoped market the resulting null participant emits
 * `provider_participant_id=is.null`, which can match an event-scoped history row
 * production's `eq.<player>` query never sees -- claiming CLV production does
 * not have. That is the same over-claim class the `??` fix removed.
 */
export function participantNameKey(
  sport: string | null | undefined,
  displayName: string,
): string {
  return `${nonEmpty(sport) ?? ''}|${normalizeDisplayName(displayName)}`;
}

/**
 * Exact port of buildCLVContextFromGradingEvent
 * (apps/api/src/settlement-service.ts). Returns null exactly where production
 * returns null -- no event row, or no external_id -- in which case production
 * falls back to resolvePickEventContext.
 */
export function buildGradingClvContext(
  settlement: SettlementRow,
  pick: PickRow,
  eventsById: ReadonlyMap<string, EventRow>,
  participantsById: ReadonlyMap<string, ParticipantRow>,
  participantsByNormalizedName: ReadonlyMap<string, readonly ParticipantRow[]> = new Map(),
): GradingClvContext | null {
  const eventId = gradingContextEventId(settlement);
  if (!eventId) return null;
  const event = eventsById.get(eventId);
  const externalId = nonEmpty(event?.external_id);
  if (!event || !externalId) return null;

  // Production reads metadata.starts_at, else event_date + 'T23:59:59Z'.
  // readRetainedEventStartTime is NOT on this path.
  //
  // This is the one null return production does NOT have: with neither
  // metadata.starts_at nor event_date, production builds the literal string
  // "nullT23:59:59Z" and returns a context carrying it, which then matches no
  // snapshot and yields missing_closing_line. The audit refuses instead of
  // reproducing a malformed timestamp, so such a pick is named
  // grading_context_unresolvable rather than missing_closing_line. Measured on
  // the cohort: 0 events lack both fields, so the divergence does not occur --
  // but it IS a divergence and is recorded rather than glossed as parity.
  const eventStartTime = resolveEventStartTime(event);
  if (!eventStartTime) return null;

  const metadata = asRecord(pick.metadata);
  const playerName = readString(metadata, 'player');
  if (!pick.participant_id && !playerName) {
    return { providerEventId: externalId, eventStartTime, participantExternalId: null };
  }

  let participantExternalId: string | null = null;
  if (pick.participant_id) {
    // `nonEmpty` where production uses a bare `?? null`: an empty-string
    // external_id would become an `eq.` filter in production and `is.null` here.
    // Measured: 0 participants have a null or blank external_id, so the two
    // agree on every row that exists. Noted because the bundle asserts elsewhere
    // that an empty-string participant id is an `eq` filter, not `is.null`.
    participantExternalId =
      nonEmpty(participantsById.get(pick.participant_id)?.external_id) ?? null;
  } else if (playerName) {
    // Production: participants.listByType('player', sport), then a unique match
    // on the normalized display_name. A non-unique match resolves to null.
    // Production scopes the pool with the PICK's metadata.sport. An absent
    // sport means listByType('player', undefined) -- every player -- so the
    // empty-sport key is the all-players pool, not an empty one.
    const matches =
      participantsByNormalizedName.get(
        participantNameKey(readString(metadata, 'sport'), playerName),
      ) ?? [];
    participantExternalId =
      matches.length === 1 ? nonEmpty(matches[0]?.external_id) ?? null : null;
  }
  return { providerEventId: externalId, eventStartTime, participantExternalId };
}

/**
 * Markets that production treats as event-scoped when it queries the closing
 * line: apps/api/src/clv-service.ts PARTICIPANT_FORBIDDEN_MARKET_TYPE_IDS.
 * Mirrored verbatim — no synonyms, no normalization, no metadata fallback.
 */
const PARTICIPANT_FORBIDDEN_MARKET_TYPE_IDS = new Set([
  'game_total_ou',
  '1h_total_ou',
  '2h_total_ou',
]);

/** Production's canonical market key: `pick.market_type_id ?? pick.market`. */
export function canonicalMarketKey(pick: PickRow): string {
  return pick.market_type_id ?? pick.market;
}

export function isMoneyline(pick: PickRow): boolean {
  return pick.market === 'moneyline';
}

/**
 * Whether the closing-line lookup must send a null participant. Exact mirror of
 * apps/api/src/clv-service.ts:
 *   isMoneyline || PARTICIPANT_FORBIDDEN_MARKET_TYPE_IDS.has(canonicalMarketKey)
 * Production applies NO drift guard here, so neither does the audit: sending a
 * participant where production sends null would deny CLV production resolves.
 */
export function usesNullParticipantForClosingLookup(pick: PickRow): boolean {
  return isMoneyline(pick) || PARTICIPANT_FORBIDDEN_MARKET_TYPE_IDS.has(canonicalMarketKey(pick));
}

/**
 * Whether a null `game_results.participant_id` is the CORRECT value for this
 * pick. Exact port of production's isEventScopedTotalPick
 * (apps/api/src/clv-service.ts), drift guard included: historical data contains
 * player props incorrectly tagged `game_total_ou`, and treating one as an event
 * total would let the game's own total row masquerade as the player's result.
 */
export function isEventScopedTotalPick(pick: PickRow): boolean {
  if (!PARTICIPANT_FORBIDDEN_MARKET_TYPE_IDS.has(canonicalMarketKey(pick))) {
    return false;
  }
  const metadata = asRecord(pick.metadata);
  return !(
    pick.market.startsWith('player_') ||
    pick.participant_id ||
    readString(metadata, 'player') ||
    readString(metadata, 'playerId') ||
    readString(metadata, 'providerParticipantId')
  );
}

/**
 * Closing cutoff, mirroring production's readEventStartTime
 * (apps/api/src/clv-service.ts): metadata.starts_at when present, otherwise the
 * end of the event date. Production passes exactly this value as
 * ClosingLineLookupCriteria.before.
 */
/**
 * Mirrors clv-service.ts's readRetainedEventStartTime. For event-scoped total
 * picks production prefers the start time RETAINED ON THE PICK over anything
 * derived from the event row, and only that path passes it. Ignoring it makes
 * the audit send a later cutoff than production and select an in-play snapshot
 * production would never see.
 */
export function readRetainedEventStartTime(pick: PickRow): string | null {
  const metadata = asRecord(pick.metadata);
  const retained =
    readString(metadata, 'eventStartTime') ?? readString(metadata, 'eventTime');
  return retained && Number.isFinite(Date.parse(retained)) ? retained : null;
}

/**
 * The closing cutoff production would use for this pick: the retained pick-side
 * start time on the event-scoped total path, else the event-derived value.
 */
export function resolveClosingCutoff(pick: PickRow, event: EventRow | null): string | null {
  if (isEventScopedTotalPick(pick)) {
    const retained = readRetainedEventStartTime(pick);
    if (retained) return retained;
  }
  return event ? resolveEventStartTime(event) : null;
}

export function resolveEventStartTime(event: EventRow): string | null {
  // Production (settlement-service.ts:999) tests `startsAt.trim().length > 0`
  // but returns `startsAt` UNTRIMMED, and that raw string becomes the `lte.`
  // cutoff filter. readString would trim it, so a whitespace-padded starts_at
  // would send a different filter than production sends. Read raw, test trimmed.
  const rawStartsAt = asRecord(event.metadata)?.['starts_at'];
  const startsAt =
    typeof rawStartsAt === 'string' && rawStartsAt.trim().length > 0 ? rawStartsAt : null;
  if (startsAt) return startsAt;
  const eventDate = nonEmpty(event.event_date);
  return eventDate ? `${eventDate}T23:59:59Z` : null;
}

function normalizeMarketKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[.-]/g, '_');
  return normalized.length > 0 ? normalized : null;
}

/**
 * Pick-side market identity. It deliberately never consults the referenced
 * game_results row: that row is the thing being validated, so letting it
 * supply the market key would make the market check circular (UTV2-1745 P1-A).
 */
export function resolveProviderMarketKey(
  pick: PickRow,
  universe: MarketUniverseRow | null,
  providerMarketKeysByType: ReadonlyMap<string, string>,
): string | null {
  const fromUniverse = nonEmpty(universe?.provider_market_key);
  if (fromUniverse) return fromUniverse;
  const metadata = asRecord(pick.metadata);
  const explicit = readString(metadata, 'providerMarketKey');
  if (explicit) return explicit;
  for (const candidate of [pick.market_type_id, pick.market]) {
    if (!candidate) continue;
    const alias = nonEmpty(providerMarketKeysByType.get(candidate));
    if (alias) return alias;
  }
  return null;
}

/**
 * The market key production actually sends to the closing-line lookup. Exact
 * mirror of apps/api/src/clv-service.ts:
 *   alias(market_type_id ?? market) ?? alias(pick.market) ?? pick.market
 * Production never resolves to null here, so the audit must not either: emitting
 * `missing_market_context` where production issues a query would deny CLV
 * availability production has.
 */
export function resolveProductionMarketKey(
  pick: PickRow,
  providerMarketKeysByType: ReadonlyMap<string, string>,
): string {
  const canonical = canonicalMarketKey(pick);
  const primary = nonEmpty(providerMarketKeysByType.get(canonical));
  if (primary) return primary;
  if (canonical !== pick.market) {
    const secondary = nonEmpty(providerMarketKeysByType.get(pick.market));
    if (secondary) return secondary;
  }
  return pick.market;
}

/**
 * Pick-side event identity. It deliberately never consults the referenced
 * game_results row. Deriving the event from `gameResult.event_id` and then
 * validating that same row against it is circular: any real-but-wrong
 * game_results id would manufacture its own approval (UTV2-1745 P1-A).
 */
export function resolveEvent(
  pick: PickRow,
  eventsById: ReadonlyMap<string, EventRow>,
  eventsByExternalId: ReadonlyMap<string, EventRow>,
  universe: MarketUniverseRow | null,
  /**
   * external_id values shared by more than one events row. The by-external-id
   * index is last-wins, so an ambiguous value would silently select one of
   * several events and then report `game_result_event_mismatch` -- a claim of
   * CONTRADICTED identity, which is stronger and more misleading than the truth
   * (identity could not be established). Ambiguity resolves to no event.
   */
  ambiguousExternalEventIds: ReadonlySet<string> = new Set(),
): EventRow | null {
  const byExternal = (value: string | null): EventRow | null =>
    value && !ambiguousExternalEventIds.has(value)
      ? eventsByExternalId.get(value) ?? null
      : null;
  if (universe?.event_id) {
    const event = eventsById.get(universe.event_id);
    if (event) return event;
  }
  const metadata = asRecord(pick.metadata);
  const eventId = readString(metadata, 'eventId');
  const providerEventId =
    universe?.provider_event_id ?? readString(metadata, 'providerEventId');
  return (
    (eventId ? eventsById.get(eventId) ?? byExternal(eventId) : null) ??
    byExternal(providerEventId) ??
    null
  );
}

function resolveParticipantExternalId(
  pick: PickRow,
  participantsById: ReadonlyMap<string, ParticipantRow>,
  universe: MarketUniverseRow | null,
): string | null {
  // Production resolves this from the PARTICIPANTS TABLE first, keyed by
  // pick.participant_id (buildCLVContextFromGradingEvent in
  // apps/api/src/settlement-service.ts, and resolvePickEventContext in
  // apps/api/src/clv-service.ts). Preferring market_universe or pick metadata
  // would query a different player than production wherever the provenance row
  // is stale.
  const metadata = asRecord(pick.metadata);
  const participantId =
    pick.participant_id ??
    universe?.participant_id ??
    readString(metadata, 'participantId') ??
    readString(metadata, 'playerId');
  const fromTable = participantId
    ? nonEmpty(participantsById.get(participantId)?.external_id)
    : null;
  if (fromTable) return fromTable;
  return (
    nonEmpty(universe?.provider_participant_id) ??
    readString(metadata, 'providerParticipantId')
  );
}

/**
 * Internal (participants.id) participant identity derived from the pick and its
 * market_universe row only. game_results.participant_id is an internal id, so
 * this is the side of the comparison that must be established independently.
 */
export function resolveParticipantInternalId(
  pick: PickRow,
  universe: MarketUniverseRow | null,
): string | null {
  const metadata = asRecord(pick.metadata);
  return (
    pick.participant_id ??
    universe?.participant_id ??
    readString(metadata, 'participantId') ??
    readString(metadata, 'playerId') ??
    null
  );
}

/** Named, fail-closed outcomes of validating a referenced game_results row. */
export type GameResultIdentityFailure =
  | 'game_result_event_mismatch'
  | 'game_result_participant_mismatch'
  | 'game_result_market_mismatch'
  | 'game_result_identity_unverifiable';

export interface PickIdentityContext {
  /** Event resolved from pick metadata / market_universe only. */
  event: EventRow | null;
  /** Provider market key resolved from pick metadata / market_universe / aliases only. */
  providerMarketKey: string | null;
  /** Internal participant id resolved from the pick / market_universe only. */
  participantInternalId: string | null;
  /** True when a null `game_results.participant_id` is the correct value. */
  eventScoped: boolean;
  /**
   * The pick's single market identity, in its canonical and provider-native
   * forms. `game_results.market_key` holds both forms in production, so both
   * are accepted -- but nothing else is.
   */
  marketKeyCandidates: ReadonlySet<string>;
  /**
   * True when the pick asserts two market identities that do not agree (a
   * `market_type_id` that drifted away from `market`, say). Identity cannot be
   * proven against a contradictory claim, so this fails closed rather than
   * accepting a game result that matches either half.
   */
  marketIdentityConflict: boolean;
}

/**
 * Builds the pick-side identity context WITHOUT reading the referenced
 * game_results row. Everything here comes from the pick, its metadata, its
 * market_universe provenance row, the canonical event/participant tables and
 * the provider market alias table.
 */
export function buildPickIdentityContext(
  pick: PickRow,
  universe: MarketUniverseRow | null,
  eventsById: ReadonlyMap<string, EventRow>,
  eventsByExternalId: ReadonlyMap<string, EventRow>,
  providerMarketKeysByType: ReadonlyMap<string, string>,
  /**
   * Reverse alias index: provider_market_key -> the market_type_id(s) that own
   * it. Without it the `!aliasKey` branch below is a hole: for any pick whose
   * canonical key has no alias row, the pick's own provider-key claim becomes
   * the candidate set and validates itself.
   */
  marketTypeIdsByProviderKey: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  ambiguousExternalEventIds: ReadonlySet<string> = new Set(),
): PickIdentityContext {
  const metadata = asRecord(pick.metadata);
  const providerMarketKey = resolveProviderMarketKey(pick, universe, providerMarketKeysByType);
  const canonical = canonicalMarketKey(pick);

  // The pick's ONE market identity. This must be anchored in something the pick
  // cannot simply assert about itself: the canonical market column and its
  // provider spelling from the alias table. Seeding the candidate set from
  // `metadata.providerMarketKey` or `universe.provider_market_key` -- as an
  // earlier revision did via resolveProviderMarketKey -- lets those claims
  // validate themselves, because the conflict loop below then re-checks them
  // against a set they populated. A pick that named a DIFFERENT market in
  // metadata could therefore admit a real game_results row for that other
  // market and book a fabricated agreement (a rebounds row graded against a
  // points line).
  const aliasKey =
    nonEmpty(providerMarketKeysByType.get(canonical)) ??
    (canonical !== pick.market ? nonEmpty(providerMarketKeysByType.get(pick.market)) : null);
  const provenanceKeys = [
    nonEmpty(universe?.provider_market_key),
    nonEmpty(readString(metadata, 'providerMarketKey')),
  ].filter((key): key is string => key !== null);

  const candidates = new Set<string>();
  for (const candidate of [canonical, aliasKey]) {
    const normalized = normalizeMarketKey(candidate);
    if (normalized) candidates.add(normalized);
  }
  let marketIdentityConflict = false;
  if (!aliasKey) {
    // No authoritative mapping exists for this pick's canonical market, so
    // pick-side provenance is the only provider spelling available and may seed
    // the set -- but only under two conditions, or the claim validates itself.
    //
    //   1. every provenance claim agrees with every other one; and
    //   2. the claimed provider key is not OWNED by some other market_type_id.
    //
    // (2) is the load-bearing half. `rebounds-all-game-ou` belongs to
    // `player_rebounds_ou`; a points pick that names it in metadata is asserting
    // another market's identity, and admitting it would let a real rebounds
    // game_results row grade a points line. Only a provider key that no
    // market_type_id claims -- genuinely unmapped on both sides -- may seed.
    const owners = (key: string): ReadonlySet<string> =>
      marketTypeIdsByProviderKey.get(key) ?? new Set<string>();
    const foreign = provenanceKeys.filter((key) => {
      const owned = owners(key);
      if (owned.size === 0) return false;
      return !owned.has(canonical) && !owned.has(pick.market);
    });
    const distinct = new Set(
      provenanceKeys
        .map((key) => normalizeMarketKey(key))
        .filter((key): key is string => key !== null),
    );
    if (foreign.length > 0 || distinct.size > 1) {
      marketIdentityConflict = true;
    } else {
      for (const normalized of distinct) candidates.add(normalized);
    }
  }

  // Every market claim the pick makes must agree with that identity, directly
  // or through the alias table. One that does not is a contradiction.
  for (const claim of marketIdentityConflict ? [] : [
    pick.market,
    pick.market_type_id,
    readString(metadata, 'providerMarketKey'),
    readString(metadata, 'marketTypeId'),
    universe?.provider_market_key ?? null,
  ]) {
    const normalized = normalizeMarketKey(claim);
    if (!normalized || candidates.has(normalized)) continue;
    const aliased = normalizeMarketKey(
      claim ? providerMarketKeysByType.get(claim) ?? null : null,
    );
    if (aliased && candidates.has(aliased)) continue;
    marketIdentityConflict = true;
    break;
  }

  return {
    event: resolveEvent(
      pick,
      eventsById,
      eventsByExternalId,
      universe,
      ambiguousExternalEventIds,
    ),
    providerMarketKey,
    participantInternalId: resolveParticipantInternalId(pick, universe),
    eventScoped: isEventScopedTotalPick(pick),
    marketKeyCandidates: candidates,
    marketIdentityConflict,
  };
}

/**
 * Proves the referenced game_results row actually belongs to the pick.
 *
 * Fails closed: any identity that cannot be established from the pick side
 * returns a named unresolvable reason. A real-but-wrong game_results id can
 * therefore never reach grade recomputation and can never be counted as an
 * agreement (UTV2-1745 P1-A).
 */
export function validateGameResultIdentity(
  identity: PickIdentityContext,
  gameResult: GameResultRow,
): GameResultIdentityFailure | null {
  if (!identity.event) return 'game_result_identity_unverifiable';
  if (gameResult.event_id !== identity.event.id) return 'game_result_event_mismatch';

  if (identity.eventScoped) {
    if (gameResult.participant_id !== null) return 'game_result_participant_mismatch';
  } else {
    if (!identity.participantInternalId) return 'game_result_identity_unverifiable';
    if (gameResult.participant_id !== identity.participantInternalId) {
      return 'game_result_participant_mismatch';
    }
  }

  if (identity.marketIdentityConflict) return 'game_result_identity_unverifiable';
  if (!identity.providerMarketKey) return 'game_result_identity_unverifiable';
  const resultMarketKey = normalizeMarketKey(gameResult.market_key);
  if (!resultMarketKey) return 'game_result_identity_unverifiable';
  if (!identity.marketKeyCandidates.has(resultMarketKey)) {
    return 'game_result_market_mismatch';
  }
  return null;
}

export interface GradeDisagreement {
  settlement_id: string;
  pick_id: string;
  recorded_result: SettlementResult;
  recomputed_result: SettlementResult;
  game_result_id: string;
  actual_value: number;
  line: number;
  side: SelectionSide;
}

export interface AuditFailure {
  settlement_id: string;
  pick_id: string;
  reason: string;
}

export interface StructuralItem {
  pick_id: string;
  settlement_id: string;
  classes: string[];
}

export interface TruthAuditDataset {
  settlements: SettlementRow[];
  picksById: ReadonlyMap<string, PickRow>;
  gameResultsById: ReadonlyMap<string, GameResultRow>;
  eventsById: ReadonlyMap<string, EventRow>;
  eventsByExternalId: ReadonlyMap<string, EventRow>;
  participantsById: ReadonlyMap<string, ParticipantRow>;
  marketUniverseById: ReadonlyMap<string, MarketUniverseRow>;
  providerMarketKeysByType: ReadonlyMap<string, string>;
  /**
   * Sampled settlement ids that a LATER settlement_records row corrects
   * (`corrects_id`). `corrects_id is null` only excludes the corrections
   * themselves; without this the audit would grade a superseded settlement as
   * if it were the pick's current truth.
   */
  supersededSettlementIds: ReadonlySet<string>;
  /**
   * provider_market_key -> the market_type_id(s) that own it, from
   * provider_market_aliases. Used to refuse a pick-side provider-key claim that
   * belongs to a DIFFERENT market.
   */
  marketTypeIdsByProviderKey?: ReadonlyMap<string, ReadonlySet<string>>;
  /** external_id values shared by more than one events row. */
  ambiguousExternalEventIds?: ReadonlySet<string>;
  /**
   * Participants indexed by production's normalized display_name, for the
   * name-based participant fallback in buildCLVContextFromGradingEvent.
   */
  participantsByNormalizedName?: ReadonlyMap<string, readonly ParticipantRow[]>;
}

export interface ClosingLookupCriteria {
  providerEventId: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
  /**
   * Closing cutoff. Mirrors production's ClosingLineLookupCriteria.before
   * (apps/api/src/clv-service.ts passes eventContext.eventStartTime): only
   * snapshots at or before the event start are eligible.
   */
  before: string;
  /**
   * undefined  -> no bookmaker filter (production's consensus pass)
   * 'pinnacle' -> production's preferred first pass
   * null       -> bookmaker_key is null
   */
  bookmakerKey?: string | null;
}

export type ClosingOfferLookup = (
  criteria: ClosingLookupCriteria,
) => Promise<ClosingOfferRow[]>;

/** Shape returned by production's marketUniverse.findClosingLineByProviderKey. */
export interface MarketUniverseClosingRow {
  closing_line: number | null;
  closing_over_odds: number | null;
  closing_under_odds: number | null;
  provider_key: string | null;
  last_offer_snapshot_at: string | null;
}

/**
 * Production's LATE closing-line fallback
 * (IMarketUniverseRepository.findClosingLineByProviderKey). Keyed by provider
 * identity rather than by the pick's metadata pointer, so a pick with no
 * `metadata.marketUniverseId` can still resolve.
 */
export type MarketUniverseClosingLookup = (criteria: {
  providerEventId: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
}) => Promise<MarketUniverseClosingRow | null>;

export interface RowCountEvidence {
  table: string;
  count: number;
}

export interface PickTruthAuditReport {
  schema_version: 1;
  issue_id: typeof ISSUE_ID;
  generated_at: string;
  target: { project_ref: string; read_only_transport: 'postgrest_get_only' };
  sample: {
    strategy: string;
    requested: number;
    sampled: number;
    grading_settlement_population: number;
    independently_auditable_population: number;
    independent_evidence_coverage_pct: number;
  };
  grading: {
    sampled: number;
    resolvable: number;
    agreements: number;
    disagreements: number;
    unresolvable: number;
    agreement_rate_pct: number | null;
    disagreements_itemized: GradeDisagreement[];
    unresolvable_itemized: AuditFailure[];
  };
  clv: {
    sampled: number;
    resolvable: number;
    unresolvable: number;
    resolvability_rate_pct: number;
    failure_class_counts: Record<string, number>;
    failures_itemized: AuditFailure[];
    persisted_status_mismatches: AuditFailure[];
  };
  structural: {
    orphaned_event: number;
    missing_participant: number;
    unresolvable_market: number;
    affected_picks: number;
    items: StructuralItem[];
  };
  systemic_defect: {
    detected: boolean;
    materiality_rules: string[];
    reasons: string[];
  };
  verdict: {
    answer: 'yes' | 'no';
    can_currently_produce_trustworthy_pick: boolean;
    reasons: string[];
  };
  runtime_proof: {
    queries: Array<{ table: string; description: string; row_count: number }>;
    row_counts: RowCountEvidence[];
  };
  read_only: {
    /** Derived from the transport's own method tally, not asserted. */
    database_writes_performed: number;
    http_methods_issued: Record<string, number>;
    requests_issued: number;
    non_get_requests: number;
  };
}

interface AuditBuildOptions {
  projectRef: string;
  requestedSampleSize: number;
  gradingPopulation: number;
  auditablePopulation: number;
  rowCounts: RowCountEvidence[];
  generatedAt?: string;
  /**
   * Measured transport tally from ReadOnlyPostgrestClient.transportEvidence().
   * Omitted only by unit tests that drive the builder with fake lookups.
   */
  transportEvidence?: () => { methods: Record<string, number>; requests: number };
}

function roundPercent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/**
 * Deterministic latest-eligible selection. Production's findClosingLine issues
 * `.order('snapshot_at', {ascending:false}).limit(1)`, so the newest eligible
 * snapshot wins; the id tie-break keeps the audit deterministic when two rows
 * share a timestamp. It deliberately does NOT require is_closing: production
 * does not filter on it either, and requiring it would make the audit report
 * CLV unavailable where production would resolve it.
 */
export function selectLatestClosingOffer(
  offers: readonly ClosingOfferRow[],
): ClosingOfferRow | null {
  return [...offers].sort((left, right) => {
    const bySnapshot = (right.snapshot_at ?? '').localeCompare(left.snapshot_at ?? '');
    if (bySnapshot !== 0) return bySnapshot;
    return (left.id ?? '').localeCompare(right.id ?? '');
  })[0] ?? null;
}

/**
 * Mirrors `asClosingLineLike` (apps/api/src/clv-service.ts:867). Production
 * wraps EVERY findClosingLine result in it, and it returns null -- the row is
 * treated as no line at all -- when `snapshot_at` or `provider_key` is not a
 * non-empty string. A rejected pinnacle row therefore falls through to the
 * consensus tier and then to the market_universe fallback.
 *
 * The rejection is applied AFTER the latest row is selected, never as a filter
 * on the candidate list: production's query already returned a single row, so a
 * bad row makes production skip that TIER, not fall back to the second-latest
 * row in it. Filtering first would resolve a line production never sees.
 *
 * Both columns are NOT NULL in database.types.ts, so only the empty-string case
 * is reachable on real data. Mirrored anyway: the bundle claims filter-for-filter
 * parity, and an unmirrored gate is a divergence whether or not it is currently
 * reachable.
 */
export function asProductionClosingLine(
  offer: ClosingOfferRow | null,
): ClosingOfferRow | null {
  if (!offer) return null;
  if (typeof offer.snapshot_at !== 'string' || offer.snapshot_at.length === 0) return null;
  if (typeof offer.provider_key !== 'string' || offer.provider_key.length === 0) return null;
  return offer;
}

function pricedSideAvailable(
  side: SelectionSide,
  overOdds: number | null,
  underOdds: number | null,
): boolean {
  const value = side === 'over' ? overOdds : underOdds;
  // `readClosingSideOdds` (apps/api/src/clv-service.ts) does gate on
  // Number.isFinite alone -- but it RETURNS the raw number, and both of its
  // callers test it for truthiness: `const pricedSide = readClosingSideOdds(...)
  // ; if (!pricedSide) return 'missing_priced_side'` at clv-service.ts:415 and
  // the same falsy check at :542. Zero is falsy, so production reports
  // missing_priced_side on zero odds. Reading readClosingSideOdds in isolation
  // says the opposite; the callers are the semantics.
  return typeof value === 'number' && Number.isFinite(value) && value !== 0;
}

export async function buildPickTruthAuditReport(
  dataset: TruthAuditDataset,
  closingOfferLookup: ClosingOfferLookup,
  options: AuditBuildOptions,
  marketUniverseClosingLookup?: MarketUniverseClosingLookup,
): Promise<PickTruthAuditReport> {
  const disagreements: GradeDisagreement[] = [];
  const gradeFailures: AuditFailure[] = [];
  const clvFailures: AuditFailure[] = [];
  const persistedStatusMismatches: AuditFailure[] = [];
  const clvFailureCounts: Record<string, number> = {};
  const structuralItems: StructuralItem[] = [];
  let agreements = 0;
  let clvResolvable = 0;
  /** Rows the closing-line lookups actually returned — a measurement, not the verdict count. */
  let closingRowsObserved = 0;
  const observeClosingRows = (rows: readonly ClosingOfferRow[]): readonly ClosingOfferRow[] => {
    closingRowsObserved += rows.length;
    return rows;
  };

  for (const settlement of dataset.settlements) {
    const pick = dataset.picksById.get(settlement.pick_id);
    if (!pick) {
      gradeFailures.push({
        settlement_id: settlement.id,
        pick_id: settlement.pick_id,
        reason: 'missing_pick',
      });
      clvFailures.push({
        settlement_id: settlement.id,
        pick_id: settlement.pick_id,
        reason: 'missing_pick',
      });
      increment(clvFailureCounts, 'missing_pick');
      structuralItems.push({
        pick_id: settlement.pick_id,
        settlement_id: settlement.id,
        classes: ['orphaned_event', 'unresolvable_market'],
      });
      continue;
    }

    const reference = gameResultReference(settlement);
    const gameResult = reference.id
      ? dataset.gameResultsById.get(reference.id) ?? null
      : null;
    const metadata = asRecord(pick.metadata);
    const universeId =
      readString(metadata, 'marketUniverseId') ?? readString(metadata, 'universeId');
    const universe = universeId
      ? dataset.marketUniverseById.get(universeId) ?? null
      : null;
    const identity = buildPickIdentityContext(
      pick,
      universe,
      dataset.eventsById,
      dataset.eventsByExternalId,
      dataset.providerMarketKeysByType,
      dataset.marketTypeIdsByProviderKey ?? new Map(),
      dataset.ambiguousExternalEventIds ?? new Set(),
    );
    // Production's CLV context for this cohort. Read from the settlement row,
    // never from the referenced game_results row, and used for CLV only.
    const gradingClv = buildGradingClvContext(
      settlement,
      pick,
      dataset.eventsById,
      dataset.participantsById,
      dataset.participantsByNormalizedName ?? new Map(),
    );
    const event = identity.event;
    const providerMarketKey = identity.providerMarketKey;
    const participantExternalId = resolveParticipantExternalId(
      pick,
      dataset.participantsById,
      universe,
    );
    const side = inferSelectionSide(pick.selection);

    const structuralClasses: string[] = [];
    if (!event) structuralClasses.push('orphaned_event');
    // Production sends a null participant for moneyline as well as for
    // event-level totals, so a team moneyline pick with no participant is not a
    // structural blocker. Using `eventScoped` here counted every one of them.
    if (!usesNullParticipantForClosingLookup(pick) && !participantExternalId) {
      structuralClasses.push('missing_participant');
    }
    if (!providerMarketKey || !side || !Number.isFinite(pick.line ?? null)) {
      structuralClasses.push('unresolvable_market');
    }
    if (structuralClasses.length > 0) {
      structuralItems.push({
        pick_id: pick.id,
        settlement_id: settlement.id,
        classes: structuralClasses,
      });
    }

    const recordedResult = settlementResult(settlement.result);
    // Proven independently of the referenced row itself; see P1-A above.
    const identityFailure = gameResult
      ? validateGameResultIdentity(identity, gameResult)
      : null;
    let gradeFailureReason: string | null = null;
    if (dataset.supersededSettlementIds.has(settlement.id)) {
      gradeFailureReason = 'settlement_superseded_by_correction';
    } else if (!recordedResult) gradeFailureReason = 'invalid_recorded_result';
    else if (reference.conflict) gradeFailureReason = 'conflicting_game_result_reference';
    else if (!reference.id) gradeFailureReason = 'missing_game_result_reference';
    else if (!gameResult) gradeFailureReason = 'missing_game_result';
    // Fail closed: the referenced row must be proven to belong to this pick
    // before any recomputation can count as agreement or disagreement.
    else if (identityFailure) gradeFailureReason = identityFailure;
    else if (!Number.isFinite(gameResult.actual_value)) gradeFailureReason = 'invalid_actual_value';
    else if (!Number.isFinite(pick.line ?? null)) gradeFailureReason = 'missing_line';
    else if (!side) gradeFailureReason = 'missing_selection_side';

    if (gradeFailureReason) {
      gradeFailures.push({
        settlement_id: settlement.id,
        pick_id: pick.id,
        reason: gradeFailureReason,
      });
    } else {
      const expected = recomputeGrade(
        gameResult!.actual_value,
        pick.line as number,
        side!,
      );
      if (expected === recordedResult) {
        agreements += 1;
      } else {
        disagreements.push({
          settlement_id: settlement.id,
          pick_id: pick.id,
          recorded_result: recordedResult!,
          recomputed_result: expected,
          game_result_id: gameResult!.id,
          actual_value: gameResult!.actual_value,
          line: pick.line as number,
          side: side!,
        });
      }
    }

    // Mirrors apps/api/src/clv-service.ts computeCLVOutcome in order:
    //   0. odds gate
    //   1. side gate (non-moneyline)
    //   2. market_universe PROVENANCE short-circuit -- before event context,
    //      before any cutoff, before any participant (resolveClosingLineFromPickProvenance)
    //   3. event context
    //   4. provider market key (alias chain; production never resolves to null)
    //   5. participant (null for moneyline and PARTICIPANT_FORBIDDEN markets)
    //   6. provider_offer_history: pinnacle pass, then consensus pass
    //   7. market_universe fallback by provider key
    let clvReason: string | null = null;
    const productionMarketKey = resolveProductionMarketKey(
      pick,
      dataset.providerMarketKeysByType,
    );
    // For this cohort production's participant comes from the grading context.
    // A resolved grading context whose participantExternalId is null is
    // production's own answer -- it passes that null into findClosingLine and
    // filters is(provider_participant_id, null). `??` would fall through to the
    // market_universe/metadata resolver and send eq.<id>, finding a closing line
    // production never sees: the same over-claim class as the deleted
    // missing_participant_context bail. Only an ABSENT context falls back.
    const clvParticipantExternalId = gradingClv
      ? gradingClv.participantExternalId
      : participantExternalId;
    const closingParticipantId = usesNullParticipantForClosingLookup(pick)
      ? null
      : clvParticipantExternalId;
    const clvProviderEventId =
      gradingClv?.providerEventId ??
      // Production's non-grading path resolves the offer-lookup event id from
      // events.external_id, then (event-scoped totals only) metadata
      // providerEventId. market_universe.provider_event_id owns the provenance
      // short-circuit above, not this lookup.
      nonEmpty(event?.external_id) ??
      nonEmpty(readString(asRecord(pick.metadata), 'providerEventId'));
    const clvCutoff = gradingClv?.eventStartTime ?? resolveClosingCutoff(pick, event);

    // Mirrors clv-service.ts exactly: `!Number.isFinite(pick.odds ?? null)`.
    // An extra `|| pick.odds === 0` would refuse a pick production still prices.
    if (!Number.isFinite(pick.odds ?? null)) {
      clvReason = 'missing_pick_odds';
    } else if (isMoneyline(pick)) {
      // `resolvePickEventContext` has a moneyline path that takes the side from
      // the participant's home/away role in event_participants -- but this
      // cohort never reaches it. buildCLVContextFromGradingEvent
      // (apps/api/src/settlement-service.ts) returns three fields and never sets
      // participantSide, so no moneyline pick on this path can ever reach
      // `computed`. It does NOT always terminate at missing_selection_side:
      // clv-service.ts returns missing_closing_line first when no closing line
      // exists, and only reaches the participantSide check after one is found.
      // What is unconditional is the unreachability of a CLV result, which is
      // what this reason names -- rather than blaming an event_participants
      // lookup the audit merely did not perform.
      //
      // This branch precedes the grading_context_unresolvable check below, so a
      // moneyline settlement with NO grading context would be named here even
      // though production would take resolvePickEventContext, set participantSide
      // from event_participants, and could reach `computed`. Measured on the
      // cohort: 0 moneyline picks, 0 settlements missing gradingContext.eventId,
      // and 0 whose named event fails to resolve -- so the combination does not
      // occur. Recorded rather than reordered, because reordering would change
      // the reason reported for a case that has never arisen.
      clvReason = 'moneyline_clv_unreachable_on_grading_path';
    } else if (!side) {
      clvReason = 'missing_selection_side';
    } else if (universe?.closing_line !== null && universe?.closing_line !== undefined) {
      // Step 2: production returns `computed` here without resolving anything
      // else. Placing this later would deny CLV that production does compute.
      if (!pricedSideAvailable(side, universe.closing_over_odds, universe.closing_under_odds)) {
        clvReason = 'missing_priced_side';
      }
    } else if (gradingContextEventId(settlement) !== null && !gradingClv) {
      // The settlement names a grading event that could not be resolved to a
      // usable context. Production would fall back to resolvePickEventContext,
      // which for a player prop additionally requires a resolved participant,
      // event_participants links and chooseEventForPick proximity selection --
      // none of which this read-only audit models. Substituting
      // events.external_id here would resolve where production returns
      // missing_event_context, an over-claim. Name it and fail closed.
      //
      // Unreachable for the audited cohort: all 1571 source='grading'
      // settlements persist gradingContext.eventId and every one resolves. A
      // settlement carrying NO grading context is a different case -- there
      // production genuinely takes the fallback path, and the generic resolver
      // below is the audit's model of it.
      clvReason = 'grading_context_unresolvable';
    } else if (!clvProviderEventId) {
      clvReason = 'missing_event_context';
    } else if (!nonEmpty(productionMarketKey)) {
      clvReason = 'missing_market_context';
    } else if (!clvCutoff) {
      // Production passes eventContext.eventStartTime as the closing cutoff --
      // the pick's retained start time on the event-scoped total path, else the
      // event-derived value. Without a cutoff there is no closing line, and an
      // audit that dropped the cutoff would claim CLV production does not have.
      clvReason = 'missing_closing_cutoff';
    } else {
      const baseCriteria = {
        providerEventId: clvProviderEventId,
        providerMarketKey: productionMarketKey,
        providerParticipantId: closingParticipantId,
        before: clvCutoff,
      };
      let closing = asProductionClosingLine(
        selectLatestClosingOffer(
          observeClosingRows(await closingOfferLookup({ ...baseCriteria, bookmakerKey: 'pinnacle' })),
        ),
      );
      if (!closing) {
        closing = asProductionClosingLine(
          selectLatestClosingOffer(observeClosingRows(await closingOfferLookup(baseCriteria))),
        );
      }
      if (closing) {
        if (!pricedSideAvailable(side, closing.over_odds, closing.under_odds)) {
          clvReason = 'missing_priced_side';
        }
      } else {
        // Step 7: production's late market_universe fallback is keyed by
        // provider identity, not by the pick's metadata pointer, so a pick with
        // no marketUniverseId can still resolve here.
        const fallback = marketUniverseClosingLookup
          ? await marketUniverseClosingLookup({
              providerEventId: baseCriteria.providerEventId,
              providerMarketKey: baseCriteria.providerMarketKey,
              providerParticipantId: baseCriteria.providerParticipantId,
            })
          : null;
        if (fallback) closingRowsObserved += 1;
        if (!fallback || fallback.closing_line === null) {
          clvReason = 'missing_closing_line';
        } else if (!pricedSideAvailable(side, fallback.closing_over_odds, fallback.closing_under_odds)) {
          clvReason = 'missing_priced_side';
        }
      }
    }

    const payload = asRecord(settlement.payload);
    const persistedStatus = readString(payload, 'clvStatus');
    if (clvReason) {
      clvFailures.push({
        settlement_id: settlement.id,
        pick_id: pick.id,
        reason: clvReason,
      });
      increment(clvFailureCounts, clvReason);
      if (persistedStatus === 'computed') {
        persistedStatusMismatches.push({
          settlement_id: settlement.id,
          pick_id: pick.id,
          reason: `persisted_computed_but_currently_${clvReason}`,
        });
      }
    } else {
      clvResolvable += 1;
      if (persistedStatus && persistedStatus !== 'computed') {
        persistedStatusMismatches.push({
          settlement_id: settlement.id,
          pick_id: pick.id,
          reason: `currently_resolvable_but_persisted_${persistedStatus}`,
        });
      }
    }
  }

  const resolvableGrades = agreements + disagreements.length;
  const sampled = dataset.settlements.length;
  const gradingDisagreementPct = roundPercent(disagreements.length, resolvableGrades);
  const clvUnresolvablePct = roundPercent(clvFailures.length, sampled);
  const systemicReasons: string[] = [];
  if (resolvableGrades > 0 && gradingDisagreementPct >= 5) {
    systemicReasons.push(
      `grading disagreement rate ${gradingDisagreementPct}% is at least the 5% materiality rule`,
    );
  }
  if (clvUnresolvablePct >= 10) {
    systemicReasons.push(
      `CLV unresolvable rate ${clvUnresolvablePct}% is at least the 10% materiality rule`,
    );
  }

  const verdictReasons: string[] = [];
  if (sampled === 0) verdictReasons.push('no grading settlements were sampled');
  if (disagreements.length > 0) {
    verdictReasons.push(`${disagreements.length} independently recomputed grades disagree`);
  }
  if (gradeFailures.length > 0) {
    verdictReasons.push(`${gradeFailures.length} sampled grades cannot be independently resolved`);
  }
  if (clvFailures.length > 0) {
    verdictReasons.push(`${clvFailures.length} sampled picks cannot currently resolve CLV`);
  }
  if (structuralItems.length > 0) {
    verdictReasons.push(`${structuralItems.length} sampled picks have structural blockers`);
  }

  const structuralCounts = {
    orphaned_event: structuralItems.filter((item) => item.classes.includes('orphaned_event')).length,
    missing_participant: structuralItems.filter((item) => item.classes.includes('missing_participant')).length,
    unresolvable_market: structuralItems.filter((item) => item.classes.includes('unresolvable_market')).length,
  };

  // Evaluated here, after every lookup has issued its requests.
  const transport = options.transportEvidence?.() ?? { methods: {}, requests: 0 };
  const nonGetRequests = Object.entries(transport.methods)
    .filter(([method]) => method !== 'GET')
    .reduce((total, [, count]) => total + count, 0);

  return {
    schema_version: 1,
    issue_id: ISSUE_ID,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    target: {
      project_ref: options.projectRef,
      read_only_transport: 'postgrest_get_only',
    },
    sample: {
      strategy: 'half earliest + half latest non-correction grading settlements, deterministic by settled_at/id',
      requested: options.requestedSampleSize,
      sampled,
      grading_settlement_population: options.gradingPopulation,
      independently_auditable_population: options.auditablePopulation,
      independent_evidence_coverage_pct: roundPercent(
        options.auditablePopulation,
        options.gradingPopulation,
      ),
    },
    grading: {
      sampled,
      resolvable: resolvableGrades,
      agreements,
      disagreements: disagreements.length,
      unresolvable: gradeFailures.length,
      agreement_rate_pct:
        resolvableGrades > 0 ? roundPercent(agreements, resolvableGrades) : null,
      disagreements_itemized: disagreements,
      unresolvable_itemized: gradeFailures,
    },
    clv: {
      sampled,
      resolvable: clvResolvable,
      unresolvable: clvFailures.length,
      resolvability_rate_pct: roundPercent(clvResolvable, sampled),
      failure_class_counts: clvFailureCounts,
      failures_itemized: clvFailures,
      persisted_status_mismatches: persistedStatusMismatches,
    },
    structural: {
      ...structuralCounts,
      affected_picks: new Set(structuralItems.map((item) => item.pick_id)).size,
      items: structuralItems,
    },
    systemic_defect: {
      detected: systemicReasons.length > 0,
      materiality_rules: [
        'grading disagreement rate >= 5% of independently resolvable grades',
        'CLV unresolvable rate >= 10% of sampled grading settlements',
      ],
      reasons: systemicReasons,
    },
    verdict: {
      answer: verdictReasons.length === 0 ? 'yes' : 'no',
      can_currently_produce_trustworthy_pick: verdictReasons.length === 0,
      reasons: verdictReasons.length > 0
        ? verdictReasons
        : ['all sampled grades agree, CLV resolves, and no sampled pick has a structural blocker'],
    },
    runtime_proof: {
      queries: [
        {
          table: 'settlement_records',
          description: 'Counted the grading-settlement population and selected deterministic earliest/latest audit windows.',
          row_count: options.gradingPopulation,
        },
        {
          table: 'game_results',
          description: 'Loaded the stored result rows referenced by sampled grading settlements for independent recomputation.',
          row_count: dataset.gameResultsById.size,
        },
        {
          table: 'provider_offer_history/market_universe',
          description: 'Resolved current closing-line availability without persisting recomputed CLV.',
          row_count: closingRowsObserved,
        },
      ],
      row_counts: options.rowCounts,
    },
    read_only: {
      database_writes_performed: nonGetRequests,
      http_methods_issued: transport.methods,
      requests_issued: transport.requests,
      non_get_requests: nonGetRequests,
    },
  };
}

/**
 * Mirrors DatabaseProviderOfferRepository.resolveProviderMarketKey's ordering:
 * `providerMarketKeyPriority` (`-all-game-` < `-game-` < `-all-` < other) then
 * localeCompare. A plain Map build is last-wins and non-deterministic when a
 * market_type_id has several sgo aliases, which would silently pick a different
 * provider key than production.
 */
export function buildProviderMarketKeyIndex(
  rows: readonly ProviderMarketAliasRow[],
): ReadonlyMap<string, string> {
  const priority = (key: string): number => {
    if (key.includes('-all-game-')) return 0;
    if (key.includes('-game-')) return 1;
    if (key.includes('-all-')) return 2;
    return 3;
  };
  const byType = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = byType.get(row.market_type_id);
    if (bucket) bucket.push(row.provider_market_key);
    else byType.set(row.market_type_id, [row.provider_market_key]);
  }
  const index = new Map<string, string>();
  for (const [marketTypeId, keys] of byType) {
    keys.sort((left, right) => (priority(left) - priority(right)) || left.localeCompare(right));
    index.set(marketTypeId, keys[0]!);
  }
  return index;
}

async function readExactCount(
  client: ReadOnlyPostgrestClient,
  table: string,
  filters: Readonly<Record<string, string>> = {},
): Promise<number> {
  const result = await client.read({
    table,
    select: 'id',
    filters,
    exactCount: true,
    head: true,
  });
  if (result.count === null) throw new Error(`exact count missing for ${table}`);
  return result.count;
}

/**
 * `limit` is only safe as `idsChunk.length` when the column is unique. For a
 * non-unique column (events.external_id, say) several rows can share one value
 * and a tight limit truncates the result, surfacing as a false
 * `orphaned_event` / `game_result_identity_unverifiable`.
 */
/**
 * A page is only usable when every matching row is in it. `Prefer: count=exact`
 * reports the true total in the content-range header, which is exact even when
 * PostgREST's `max_rows` cap silently shortens the response -- the case a
 * `rows.length === limit` check cannot see.
 */
function assertCompletePage(
  page: { rows: readonly unknown[]; count: number | null },
  what: string,
): void {
  if (page.count === null) {
    throw new Error(`${what}: no exact count; completeness cannot be established`);
  }
  if (page.rows.length < page.count) {
    throw new Error(
      `${what}: read ${page.rows.length} of ${page.count} matching rows; `
      + 'a truncated read cannot be audited',
    );
  }
}

export async function readByIds<T>(
  client: ReadOnlyPostgrestClient,
  table: string,
  select: string,
  ids: readonly string[],
  column = 'id',
  rowsPerId = 1,
): Promise<T[]> {
  const rows: T[] = [];
  for (const idsChunk of chunk(unique(ids))) {
    if (idsChunk.length === 0) continue;
    // `idsChunk.length * rowsPerId` is a budget for the WHOLE chunk, not per
    // id, so a few ids with many rows can push the others' rows off the end.
    // A truncated read makes an ambiguous events.external_id look UNIQUE --
    // failing OPEN in precisely the place the ambiguity guard exists to close.
    //
    // Comparing rows.length against the limit cannot detect this reliably:
    // PostgREST caps every response at the project's `max_rows` setting, so
    // above that cap a truncated page comes back SHORTER than the limit and
    // reads as complete. Prefer: count=exact reports the total number of
    // matching rows in the content-range header regardless of any cap, so the
    // comparison below is exact rather than a heuristic.
    const page = await client.read<T>({
      table,
      select,
      filters: { [column]: inFilter(idsChunk) },
      limit: idsChunk.length * rowsPerId,
      exactCount: true,
    });
    if (page.count === null) {
      throw new Error(
        `readByIds(${table}.${column}) got no exact count; a read whose `
        + 'completeness cannot be established must not be audited',
      );
    }
    if (page.rows.length < page.count) {
      throw new Error(
        `readByIds(${table}.${column}) read ${page.rows.length} of ${page.count} `
        + 'matching rows; a truncated read cannot be audited',
      );
    }
    rows.push(...page.rows);
  }
  return rows;
}

export async function loadAuditDataset(
  client: ReadOnlyPostgrestClient,
  sampleSize: number,
): Promise<{
  dataset: TruthAuditDataset;
  gradingPopulation: number;
  auditablePopulation: number;
  rowCounts: RowCountEvidence[];
}> {
  const rowCountTables = [
    'picks',
    'events',
    'provider_offer_history',
    'settlement_records',
    'game_results',
    'participants',
  ];
  const counts = await Promise.all(
    rowCountTables.map(async (table) => ({ table, count: await readExactCount(client, table) })),
  );

  const gradingFilters = {
    status: 'eq.settled',
    source: 'eq.grading',
    corrects_id: 'is.null',
    result: 'in.(win,loss,push)',
  };
  const gradingPopulation = await readExactCount(
    client,
    'settlement_records',
    gradingFilters,
  );
  const cohortFilters = {
    ...gradingFilters,
    evidence_ref: 'like.game-result:*',
  };
  const auditablePopulation = await readExactCount(
    client,
    'settlement_records',
    cohortFilters,
  );
  const earliestSize = Math.floor(sampleSize / 2);
  const latestSize = sampleSize - earliestSize;
  const selectSettlement =
    'id,pick_id,status,result,source,evidence_ref,payload,settled_at,corrects_id';
  const [earliest, latest] = await Promise.all([
    client.read<SettlementRow>({
      table: 'settlement_records',
      select: selectSettlement,
      filters: cohortFilters,
      order: 'settled_at.asc,id.asc',
      limit: earliestSize,
    }),
    client.read<SettlementRow>({
      table: 'settlement_records',
      select: selectSettlement,
      filters: cohortFilters,
      order: 'settled_at.desc,id.asc',
      limit: latestSize,
    }),
  ]);
  const settlements = [
    ...new Map(
      [...earliest.rows, ...latest.rows].map((row) => [row.id, row] as const),
    ).values(),
  ];

  const picks = await readByIds<PickRow>(
    client,
    'picks',
    'id,market,market_type_id,selection,line,odds,participant_id,status,metadata,created_at',
    settlements.map((row) => row.pick_id),
  );
  const picksById = new Map(picks.map((row) => [row.id, row]));

  const gameResultIds = unique(
    settlements.map((settlement) => gameResultReference(settlement).id),
  );
  const gameResults = await readByIds<GameResultRow>(
    client,
    'game_results',
    'id,event_id,participant_id,market_key,actual_value',
    gameResultIds,
  );
  const gameResultsById = new Map(gameResults.map((row) => [row.id, row]));

  // Corrections that supersede a sampled settlement. A pick may carry several,
  // so allow generous headroom per sampled id rather than one row each.
  const corrections = await readByIds<{ corrects_id: string | null }>(
    client,
    'settlement_records',
    'id,corrects_id',
    settlements.map((row) => row.id),
    'corrects_id',
    8,
  );
  const supersededSettlementIds = new Set(
    corrections
      .map((row) => row.corrects_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  const universeIds = unique(
    picks.map((pick) => {
      const metadata = asRecord(pick.metadata);
      return readString(metadata, 'marketUniverseId') ?? readString(metadata, 'universeId');
    }),
  );
  const universes = await readByIds<MarketUniverseRow>(
    client,
    'market_universe',
    'id,event_id,participant_id,provider_event_id,provider_market_key,provider_participant_id,provider_key,closing_line,closing_over_odds,closing_under_odds,last_offer_snapshot_at',
    universeIds,
  );
  const marketUniverseById = new Map(universes.map((row) => [row.id, row]));

  const eventIds = unique([
    ...gameResults.map((row) => row.event_id),
    ...universes.map((row) => row.event_id),
    ...picks.map((pick) => readString(asRecord(pick.metadata), 'eventId')),
    // The event production itself used for CLV on this cohort. Loading it is
    // what lets the audit mirror buildCLVContextFromGradingEvent instead of
    // reconstructing an event production never consulted.
    ...settlements.map((settlement) => gradingContextEventId(settlement)),
  ]);
  const providerEventIds = unique([
    ...universes.map((row) => row.provider_event_id),
    ...picks.map((pick) => readString(asRecord(pick.metadata), 'providerEventId')),
  ]);
  const [eventsByLocalId, eventsByProviderId] = await Promise.all([
    readByIds<EventRow>(
      client,
      'events',
      'id,external_id,event_name,event_date,metadata',
      eventIds,
    ),
    readByIds<EventRow>(
      client,
      'events',
      'id,external_id,event_name,event_date,metadata',
      providerEventIds,
      'external_id',
      8,
    ),
  ]);
  const events = [
    ...new Map(
      [...eventsByLocalId, ...eventsByProviderId].map((row) => [row.id, row] as const),
    ).values(),
  ];

  const participantIds = unique([
    ...picks.map((pick) => pick.participant_id),
    ...gameResults.map((row) => row.participant_id),
    ...universes.map((row) => row.participant_id),
    ...picks.map((pick) => readString(asRecord(pick.metadata), 'participantId')),
    ...picks.map((pick) => readString(asRecord(pick.metadata), 'playerId')),
  ]);
  const participants = await readByIds<ParticipantRow>(
    client,
    'participants',
    'id,external_id,display_name,participant_type,sport',
    participantIds,
  );

  // Production's name-based participant fallback (buildCLVContextFromGradingEvent)
  // reads participants.listByType('player', sport) and requires a UNIQUE match on
  // the normalized display_name. Mirroring it needs the same candidate pool, so
  // the pool is fetched per sport -- narrowing it server-side by name could make
  // a genuinely ambiguous name look unique and manufacture CLV production does
  // not have. Only picks that actually take this branch cause a read.
  const nameFallbackPicks = picks.filter(
    (pick) => !pick.participant_id && readString(asRecord(pick.metadata), 'player'),
  );
  // One pool PER SPORT, because production scopes the pool per pick:
  // listByType('player', metadata.sport) applies `.eq('sport', sport)` only when
  // sport is truthy. A single flat pool diverges in both directions -- see
  // participantNameKey. `sport` absent means listByType('player', undefined),
  // which is EVERY player, not none, so an unsported pick gets the all-players
  // pool; modelling that as an empty pool would deny the participant production
  // resolves. The all-players pool is fetched ONLY when some pick actually
  // lacks a sport, so a fully-sported cohort does not read the whole table.
  const nameFallbackSports: (string | null)[] = [
    ...unique(nameFallbackPicks.map((pick) => readString(asRecord(pick.metadata), 'sport'))),
    ...(nameFallbackPicks.some((pick) => !readString(asRecord(pick.metadata), 'sport'))
      ? [null]
      : []),
  ];
  const participantsByNormalizedName = new Map<string, ParticipantRow[]>();
  for (const sport of nameFallbackSports) {
    const nameCandidates: ParticipantRow[] = [];
    const PAGE = 1000;
    // DIVERGENCE, deliberate and recorded: production's own listByType
    // (packages/db/src/runtime-repositories.ts:5906) terminates on
    // `page.length < PAGE_SIZE` -- the very rows.length terminator this comment
    // calls dangerous. So production can itself see a short pool and read a
    // non-unique name as unique. The audit is STRICTER: it refuses rather than
    // silently deciding uniqueness on an incomplete pool. That means the audit
    // can report a participant unresolved where production resolved one. It is
    // the fail-closed direction, and refusing to audit is preferable to
    // reproducing a bug in order to agree with it -- but it IS a divergence and
    // is named here rather than glossed as parity.
    //
    // The loop is driven by the exact match total, never by `rows.length < PAGE`.
    // PostgREST caps every response at the project's `max_rows` setting, so a
    // length-based terminator stops early whenever that cap is below PAGE, and
    // a SHORT candidate pool is the dangerous direction: it makes a display name
    // that is genuinely non-unique look unique, and production's fallback only
    // resolves a participant on a UNIQUE normalized-name match. That would
    // manufacture a participant production resolves to null.
    let total: number | null = null;
    const before = nameCandidates.length;
    for (let offset = 0; ; offset += PAGE) {
      const page = await client.read<ParticipantRow>({
        table: 'participants',
        select: 'id,external_id,display_name,participant_type,sport',
        filters: {
          participant_type: 'eq.player',
          ...(sport ? { sport: `eq.${sport}` } : {}),
        },
        order: 'display_name.asc',
        limit: PAGE,
        exactCount: true,
        offset,
      });
      if (page.count === null) {
        throw new Error(
          'participants name-fallback page: no exact count; a pool whose '
          + 'completeness cannot be established must not decide uniqueness',
        );
      }
      total = page.count;
      nameCandidates.push(...page.rows);
      if (nameCandidates.length - before >= total) break;
      if (page.rows.length === 0) {
        throw new Error(
          `participants name-fallback pool: read ${nameCandidates.length - before} `
          + `of ${total} rows before the server stopped returning any; an `
          + 'incomplete pool cannot decide name uniqueness',
        );
      }
    }
    // Bucketed under THIS pool's sport key, so a pick only ever sees the pool
    // production would have queried for it.
    for (const row of nameCandidates) {
      const key = participantNameKey(sport, row.display_name);
      const bucket = participantsByNormalizedName.get(key);
      if (bucket) bucket.push(row);
      else participantsByNormalizedName.set(key, [row]);
    }
  }

  const aliasTypeIds = unique([
    ...picks.map((pick) => pick.market_type_id),
    ...picks.map((pick) => pick.market),
    ...gameResults.map((row) => row.market_key),
  ]);
  const providerMarketAliases: ProviderMarketAliasRow[] = [];
  for (const typeIds of chunk(aliasTypeIds)) {
    const page = await client.read<ProviderMarketAliasRow>({
      table: 'provider_market_aliases',
      select: 'market_type_id,provider,provider_market_key',
      filters: {
        provider: 'eq.sgo',
        market_type_id: inFilter(typeIds),
      },
      // ×8 headroom: production tops out at 4 aliases per market_type_id, and now
      // that priority ordering decides the winner a truncated page would change
      // the resolved provider key rather than merely shorten the list.
      limit: typeIds.length * 8,
      exactCount: true,
    });
    assertCompletePage(page, 'provider_market_aliases (forward, by market_type_id)');
    providerMarketAliases.push(...page.rows);
  }

  // Reverse alias index. A provider market key claimed by a pick but OWNED by a
  // different market_type_id is another market's identity, so the owners have to
  // be known before any pick-side claim may seed identity. Fetched by
  // provider_market_key, because the forward page is keyed by the pick's own
  // market_type_id and would never contain the foreign key.
  const claimedProviderKeys = unique([
    ...universes.map((row) => row.provider_market_key),
    ...picks.map((pick) => readString(asRecord(pick.metadata), 'providerMarketKey')),
  ]);
  const reverseAliases: ProviderMarketAliasRow[] = [];
  for (const keys of chunk(claimedProviderKeys)) {
    const page = await client.read<ProviderMarketAliasRow>({
      table: 'provider_market_aliases',
      select: 'market_type_id,provider,provider_market_key',
      filters: { provider: 'eq.sgo', provider_market_key: inFilter(keys) },
      limit: keys.length * 8,
      exactCount: true,
    });
    assertCompletePage(page, 'provider_market_aliases (reverse, by provider_market_key)');
    reverseAliases.push(...page.rows);
  }
  const marketTypeIdsByProviderKey = new Map<string, Set<string>>();
  for (const row of [...providerMarketAliases, ...reverseAliases]) {
    const bucket = marketTypeIdsByProviderKey.get(row.provider_market_key);
    if (bucket) bucket.add(row.market_type_id);
    else marketTypeIdsByProviderKey.set(row.provider_market_key, new Set([row.market_type_id]));
  }

  // external_id values shared by more than one events row: ambiguous identity,
  // which must read as unverifiable rather than as a contradiction.
  const externalIdCounts = new Map<string, number>();
  for (const row of events) {
    if (row.external_id) {
      externalIdCounts.set(row.external_id, (externalIdCounts.get(row.external_id) ?? 0) + 1);
    }
  }
  const ambiguousExternalEventIds = new Set(
    [...externalIdCounts].filter(([, count]) => count > 1).map(([id]) => id),
  );

  return {
    dataset: {
      settlements,
      picksById,
      gameResultsById,
      supersededSettlementIds,
      eventsById: new Map(events.map((row) => [row.id, row])),
      eventsByExternalId: new Map(
        events
          .filter((row): row is EventRow & { external_id: string } => Boolean(row.external_id))
          .map((row) => [row.external_id, row]),
      ),
      participantsById: new Map(participants.map((row) => [row.id, row])),
      participantsByNormalizedName,
      marketUniverseById,
      providerMarketKeysByType: buildProviderMarketKeyIndex(providerMarketAliases),
      marketTypeIdsByProviderKey,
      ambiguousExternalEventIds,
    },
    gradingPopulation,
    auditablePopulation,
    rowCounts: counts,
  };
}

/**
 * Canonical closing-line source (UTV2-1745 P1-B).
 *
 * `provider_offers` is the legacy/frozen surface; production's CLV resolver
 * (DatabaseProviderOfferRepository.findClosingLine in
 * packages/db/src/runtime-repositories.ts) reads `provider_offer_history`.
 * This mirrors it filter-for-filter so the audit can neither claim CLV
 * availability production would not have nor deny availability it would:
 *
 *   .eq('provider_event_id')      .eq('provider_market_key')
 *   .lte('snapshot_at', before)   participant: eq / is null
 *   bookmaker_key: only filtered when the criteria declare it
 *   .order('snapshot_at', desc).limit(1)
 *
 * Note production applies no provider_key filter and does not require
 * is_closing; neither does this lookup.
 */
export const CLOSING_LINE_TABLE = 'provider_offer_history';

export function createClosingOfferLookup(
  client: ReadOnlyPostgrestClient,
): ClosingOfferLookup {
  return async (criteria) => {
    const filters: Record<string, string> = {
      provider_event_id: `eq.${criteria.providerEventId}`,
      provider_market_key: `eq.${criteria.providerMarketKey}`,
      // Production narrows `undefined` to `null` and then branches on `null`,
      // so an empty-string participant id is an `eq.` filter, not `is.null`.
      provider_participant_id:
        criteria.providerParticipantId === undefined ||
        criteria.providerParticipantId === null
          ? 'is.null'
          : `eq.${criteria.providerParticipantId}`,
      snapshot_at: `lte.${criteria.before}`,
    };
    if (criteria.bookmakerKey !== undefined) {
      filters['bookmaker_key'] = criteria.bookmakerKey === null
        ? 'is.null'
        : `eq.${criteria.bookmakerKey}`;
    }
    const response = await client.read<ClosingOfferRow>({
      table: CLOSING_LINE_TABLE,
      select:
        'id,provider_event_id,provider_market_key,provider_participant_id,provider_key,bookmaker_key,is_closing,line,over_odds,under_odds,snapshot_at',
      filters,
      order: 'snapshot_at.desc',
      limit: 1,
    });
    return response.rows;
  };
}

/**
 * Mirrors DatabaseMarketUniverseRepository.findClosingLineByProviderKey:
 * eq provider_event_id, eq provider_market_key, closing_line not null,
 * participant eq / is null, limit 1.
 */
export function createMarketUniverseClosingLookup(
  client: ReadOnlyPostgrestClient,
): MarketUniverseClosingLookup {
  return async (criteria) => {
    const response = await client.read<MarketUniverseClosingRow>({
      table: 'market_universe',
      select:
        'closing_line,closing_over_odds,closing_under_odds,provider_key,last_offer_snapshot_at',
      filters: {
        provider_event_id: `eq.${criteria.providerEventId}`,
        provider_market_key: `eq.${criteria.providerMarketKey}`,
        closing_line: 'not.is.null',
        // findClosingLineByProviderKey branches on `=== null`, not truthiness.
        provider_participant_id:
          criteria.providerParticipantId === null
            ? 'is.null'
            : `eq.${criteria.providerParticipantId}`,
      },
      limit: 1,
    });
    return response.rows[0] ?? null;
  };
}

interface CliOptions {
  url: string;
  key: string;
  projectRef: string;
  sampleSize: number;
}

function parseCli(argv: readonly string[], environment: NodeJS.ProcessEnv): CliOptions {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
    flags.set(arg.slice(2), value);
    index += 1;
  }

  const url = flags.get('url') ?? environment['PICK_TRUTH_AUDIT_SUPABASE_URL'] ?? '';
  const key = flags.get('read-key') ?? environment['PICK_TRUTH_AUDIT_READ_KEY'] ?? '';
  const projectRef = flags.get('project-ref') ?? DEFAULT_PROJECT_REF;
  const sampleSize = Number(flags.get('sample-size') ?? DEFAULT_SAMPLE_SIZE);
  if (!url || !key) {
    throw new Error(
      'PICK_TRUTH_AUDIT_SUPABASE_URL and PICK_TRUTH_AUDIT_READ_KEY (or --url/--read-key) are required',
    );
  }
  const parsedUrl = new URL(url);
  if (parsedUrl.hostname !== `${projectRef}.supabase.co`) {
    throw new Error(
      `refusing unexpected target ${parsedUrl.hostname}; expected ${projectRef}.supabase.co`,
    );
  }
  if (!Number.isInteger(sampleSize) || sampleSize < 2 || sampleSize > MAX_SAMPLE_SIZE) {
    throw new Error(`sample size must be an integer from 2 to ${MAX_SAMPLE_SIZE}`);
  }
  return { url, key, projectRef, sampleSize };
}

export async function runPickTruthAudit(options: CliOptions): Promise<PickTruthAuditReport> {
  const client = new ReadOnlyPostgrestClient(options.url, options.key);
  const loaded = await loadAuditDataset(client, options.sampleSize);
  return buildPickTruthAuditReport(
    loaded.dataset,
    createClosingOfferLookup(client),
    {
      projectRef: options.projectRef,
      requestedSampleSize: options.sampleSize,
      gradingPopulation: loaded.gradingPopulation,
      auditablePopulation: loaded.auditablePopulation,
      rowCounts: loaded.rowCounts,
      transportEvidence: () => client.transportEvidence(),
    },
    createMarketUniverseClosingLookup(client),
  );
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2), process.env);
  const report = await runPickTruthAudit(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const entrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (entrypoint === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
