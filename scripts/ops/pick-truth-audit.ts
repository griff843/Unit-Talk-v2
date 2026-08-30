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

    this.#methodsUsed.set('GET', (this.#methodsUsed.get('GET') ?? 0) + 1);
    const response = await this.#fetch(url, {
      method: 'GET',
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
  const normalized = selection.toLowerCase();
  if (/\bover\b/.test(normalized) || /\bO\s+\d/.test(selection) || /^O\s+\d/.test(selection)) {
    return 'over';
  }
  if (/\bunder\b/.test(normalized) || /\bU\s+\d/.test(selection) || /^U\s+\d/.test(selection)) {
    return 'under';
  }
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
export function resolveEventStartTime(event: EventRow): string | null {
  const startsAt = readString(asRecord(event.metadata), 'starts_at');
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
): EventRow | null {
  if (universe?.event_id) {
    const event = eventsById.get(universe.event_id);
    if (event) return event;
  }
  const metadata = asRecord(pick.metadata);
  const eventId = readString(metadata, 'eventId');
  const providerEventId =
    universe?.provider_event_id ?? readString(metadata, 'providerEventId');
  return (
    (eventId ? eventsById.get(eventId) ?? eventsByExternalId.get(eventId) : null) ??
    (providerEventId ? eventsByExternalId.get(providerEventId) : null) ??
    null
  );
}

function resolveParticipantExternalId(
  pick: PickRow,
  participantsById: ReadonlyMap<string, ParticipantRow>,
  universe: MarketUniverseRow | null,
): string | null {
  if (universe?.provider_participant_id) return universe.provider_participant_id;
  const metadata = asRecord(pick.metadata);
  const explicit = readString(metadata, 'providerParticipantId');
  if (explicit) return explicit;
  const participantId =
    pick.participant_id ??
    universe?.participant_id ??
    readString(metadata, 'participantId') ??
    readString(metadata, 'playerId');
  return participantId
    ? participantsById.get(participantId)?.external_id ?? null
    : null;
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
): PickIdentityContext {
  const metadata = asRecord(pick.metadata);
  const providerMarketKey = resolveProviderMarketKey(pick, universe, providerMarketKeysByType);
  const canonical = canonicalMarketKey(pick);

  // The pick's ONE market identity, in its two legitimate spellings. Widening
  // this to every market string the pick carries would let a pick that asserts
  // two different markets accept a game result matching either -- which is how
  // a drifted `market_type_id` could admit the game's own total row for a
  // player prop.
  const candidates = new Set<string>();
  for (const candidate of [providerMarketKey, canonical]) {
    const normalized = normalizeMarketKey(candidate);
    if (normalized) candidates.add(normalized);
  }

  // Every other market claim the pick makes must agree with that identity,
  // directly or through the alias table. One that does not is a contradiction.
  let marketIdentityConflict = false;
  for (const claim of [
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
    event: resolveEvent(pick, eventsById, eventsByExternalId, universe),
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

function pricedSideAvailable(
  side: SelectionSide,
  overOdds: number | null,
  underOdds: number | null,
): boolean {
  const value = side === 'over' ? overOdds : underOdds;
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
    if (!identity.eventScoped && !participantExternalId) {
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
    const closingParticipantId = usesNullParticipantForClosingLookup(pick)
      ? null
      : participantExternalId;

    if (!Number.isFinite(pick.odds ?? null) || pick.odds === 0) {
      clvReason = 'missing_pick_odds';
    } else if (isMoneyline(pick)) {
      // Production has a dedicated moneyline path that takes the side from the
      // participant's home/away role in event_participants. The audit does not
      // read that table, so it declines rather than guessing -- named, so it is
      // never mistaken for a production failure.
      clvReason = 'moneyline_side_not_independently_resolvable';
    } else if (!side) {
      clvReason = 'missing_selection_side';
    } else if (universe?.closing_line !== null && universe?.closing_line !== undefined) {
      // Step 2: production returns `computed` here without resolving anything
      // else. Placing this later would deny CLV that production does compute.
      if (!pricedSideAvailable(side, universe.closing_over_odds, universe.closing_under_odds)) {
        clvReason = 'missing_priced_side';
      }
    } else if (!nonEmpty(event?.external_id) && !nonEmpty(universe?.provider_event_id)) {
      clvReason = 'missing_event_context';
    } else if (!nonEmpty(productionMarketKey)) {
      clvReason = 'missing_market_context';
    } else if (closingParticipantId === null && !usesNullParticipantForClosingLookup(pick)) {
      clvReason = 'missing_participant_context';
    } else if (!event || !resolveEventStartTime(event)) {
      // Production passes eventContext.eventStartTime as the closing cutoff.
      // Without a start time there is no cutoff, and an audit that dropped the
      // cutoff would claim CLV availability production does not have.
      clvReason = 'missing_closing_cutoff';
    } else {
      const baseCriteria = {
        providerEventId: nonEmpty(universe?.provider_event_id) ?? nonEmpty(event.external_id)!,
        providerMarketKey: productionMarketKey,
        providerParticipantId: closingParticipantId,
        before: resolveEventStartTime(event)!,
      };
      let closing = selectLatestClosingOffer(
        observeClosingRows(await closingOfferLookup({ ...baseCriteria, bookmakerKey: 'pinnacle' })),
      );
      if (!closing) {
        closing = selectLatestClosingOffer(observeClosingRows(await closingOfferLookup(baseCriteria)));
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
async function readByIds<T>(
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
    const page = await client.read<T>({
      table,
      select,
      filters: { [column]: inFilter(idsChunk) },
      limit: idsChunk.length * rowsPerId,
    });
    rows.push(...page.rows);
  }
  return rows;
}

async function loadAuditDataset(
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
    'id,external_id,display_name,participant_type',
    participantIds,
  );

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
    });
    providerMarketAliases.push(...page.rows);
  }

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
      marketUniverseById,
      providerMarketKeysByType: buildProviderMarketKeyIndex(providerMarketAliases),
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
      provider_participant_id: criteria.providerParticipantId
        ? `eq.${criteria.providerParticipantId}`
        : 'is.null',
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
        provider_participant_id: criteria.providerParticipantId
          ? `eq.${criteria.providerParticipantId}`
          : 'is.null',
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
