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

  constructor(baseUrl: string, key: string, fetchImpl: FetchLike = fetch) {
    const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.#restBase = new URL('rest/v1/', normalized);
    this.#key = key;
    this.#fetch = fetchImpl;
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

function isGameTotal(pick: PickRow): boolean {
  const metadata = asRecord(pick.metadata);
  const candidates = [
    pick.market,
    pick.market_type_id,
    readString(metadata, 'marketTypeId'),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase().replace(/[.-]/g, '_'));
  return candidates.some((value) =>
    value === 'game_total' || value === 'game_total_ou' || value === 'total' || value === 'totals'
  );
}

function resolveProviderMarketKey(
  pick: PickRow,
  gameResult: GameResultRow | null,
  universe: MarketUniverseRow | null,
  providerMarketKeysByType: ReadonlyMap<string, string>,
): string | null {
  if (universe?.provider_market_key) return universe.provider_market_key;
  const metadata = asRecord(pick.metadata);
  const explicit = readString(metadata, 'providerMarketKey');
  if (explicit) return explicit;
  for (const candidate of [pick.market_type_id, pick.market, gameResult?.market_key]) {
    if (!candidate) continue;
    const alias = providerMarketKeysByType.get(candidate);
    if (alias) return alias;
  }
  const resultKey = gameResult?.market_key ?? null;
  return resultKey?.endsWith('-all-game-ou') ? resultKey : null;
}

function resolveEvent(
  pick: PickRow,
  gameResult: GameResultRow | null,
  eventsById: ReadonlyMap<string, EventRow>,
  eventsByExternalId: ReadonlyMap<string, EventRow>,
  universe: MarketUniverseRow | null,
): EventRow | null {
  if (gameResult) {
    const event = eventsById.get(gameResult.event_id);
    if (event) return event;
  }
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
}

export interface ClosingLookupCriteria {
  providerEventId: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
}

export type ClosingOfferLookup = (
  criteria: ClosingLookupCriteria,
) => Promise<ClosingOfferRow[]>;

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
    database_writes_performed: 0;
    write_method_reachable: false;
    transport_method: 'GET';
  };
}

interface AuditBuildOptions {
  projectRef: string;
  requestedSampleSize: number;
  gradingPopulation: number;
  auditablePopulation: number;
  rowCounts: RowCountEvidence[];
  generatedAt?: string;
}

function roundPercent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function chooseClosingOffer(
  offers: readonly ClosingOfferRow[],
): ClosingOfferRow | null {
  const eligible = offers.filter((offer) => offer.is_closing === true);
  const pinnacle = eligible.filter((offer) => offer.bookmaker_key === 'pinnacle');
  const candidates = pinnacle.length > 0 ? pinnacle : eligible;
  return [...candidates].sort((left, right) =>
    (right.snapshot_at ?? '').localeCompare(left.snapshot_at ?? '')
  )[0] ?? null;
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
): Promise<PickTruthAuditReport> {
  const disagreements: GradeDisagreement[] = [];
  const gradeFailures: AuditFailure[] = [];
  const clvFailures: AuditFailure[] = [];
  const persistedStatusMismatches: AuditFailure[] = [];
  const clvFailureCounts: Record<string, number> = {};
  const structuralItems: StructuralItem[] = [];
  let agreements = 0;
  let clvResolvable = 0;

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
    const event = resolveEvent(
      pick,
      gameResult,
      dataset.eventsById,
      dataset.eventsByExternalId,
      universe,
    );
    const providerMarketKey = resolveProviderMarketKey(
      pick,
      gameResult,
      universe,
      dataset.providerMarketKeysByType,
    );
    const participantExternalId = resolveParticipantExternalId(
      pick,
      dataset.participantsById,
      universe,
    );
    const side = inferSelectionSide(pick.selection);

    const structuralClasses: string[] = [];
    if (!event) structuralClasses.push('orphaned_event');
    if (!isGameTotal(pick) && !participantExternalId) {
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
    let gradeFailureReason: string | null = null;
    if (!recordedResult) gradeFailureReason = 'invalid_recorded_result';
    else if (reference.conflict) gradeFailureReason = 'conflicting_game_result_reference';
    else if (!reference.id) gradeFailureReason = 'missing_game_result_reference';
    else if (!gameResult) gradeFailureReason = 'missing_game_result';
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

    let clvReason: string | null = null;
    if (!Number.isFinite(pick.odds ?? null) || pick.odds === 0) {
      clvReason = 'missing_pick_odds';
    } else if (!side) {
      clvReason = 'missing_selection_side';
    } else if (!event?.external_id && !universe?.provider_event_id) {
      clvReason = 'missing_event_context';
    } else if (!providerMarketKey) {
      clvReason = 'missing_market_context';
    } else if (!isGameTotal(pick) && !participantExternalId) {
      clvReason = 'missing_participant_context';
    } else if (
      universe?.closing_line !== null &&
      universe?.closing_line !== undefined
    ) {
      if (!pricedSideAvailable(
        side,
        universe.closing_over_odds,
        universe.closing_under_odds,
      )) {
        clvReason = 'missing_priced_side';
      }
    } else {
      const offers = await closingOfferLookup({
        providerEventId: universe?.provider_event_id ?? event!.external_id!,
        providerMarketKey,
        providerParticipantId: isGameTotal(pick) ? null : participantExternalId,
      });
      const closing = chooseClosingOffer(offers);
      if (!closing) clvReason = 'missing_closing_line';
      else if (!pricedSideAvailable(side, closing.over_odds, closing.under_odds)) {
        clvReason = 'missing_priced_side';
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
      affected_picks: structuralItems.length,
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
          table: 'provider_offers/market_universe',
          description: 'Resolved current closing-line availability without persisting recomputed CLV.',
          row_count: clvResolvable,
        },
      ],
      row_counts: options.rowCounts,
    },
    read_only: {
      database_writes_performed: 0,
      write_method_reachable: false,
      transport_method: 'GET',
    },
  };
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

async function readByIds<T>(
  client: ReadOnlyPostgrestClient,
  table: string,
  select: string,
  ids: readonly string[],
  column = 'id',
): Promise<T[]> {
  const rows: T[] = [];
  for (const idsChunk of chunk(unique(ids))) {
    if (idsChunk.length === 0) continue;
    const page = await client.read<T>({
      table,
      select,
      filters: { [column]: inFilter(idsChunk) },
      limit: idsChunk.length,
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
    'provider_offers',
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
      limit: typeIds.length * 4,
    });
    providerMarketAliases.push(...page.rows);
  }

  return {
    dataset: {
      settlements,
      picksById,
      gameResultsById,
      eventsById: new Map(events.map((row) => [row.id, row])),
      eventsByExternalId: new Map(
        events
          .filter((row): row is EventRow & { external_id: string } => Boolean(row.external_id))
          .map((row) => [row.external_id, row]),
      ),
      participantsById: new Map(participants.map((row) => [row.id, row])),
      marketUniverseById,
      providerMarketKeysByType: new Map(
        providerMarketAliases.map((row) => [row.market_type_id, row.provider_market_key]),
      ),
    },
    gradingPopulation,
    auditablePopulation,
    rowCounts: counts,
  };
}

function createClosingOfferLookup(
  client: ReadOnlyPostgrestClient,
): ClosingOfferLookup {
  return async (criteria) => {
    const filters: Record<string, string> = {
      provider_event_id: `eq.${criteria.providerEventId}`,
      provider_market_key: `eq.${criteria.providerMarketKey}`,
      provider_key: 'eq.sgo',
      provider_participant_id: criteria.providerParticipantId
        ? `eq.${criteria.providerParticipantId}`
        : 'is.null',
      is_closing: 'eq.true',
    };
    const response = await client.read<ClosingOfferRow>({
      table: 'provider_offers',
      select:
        'id,provider_event_id,provider_market_key,provider_participant_id,provider_key,bookmaker_key,is_closing,line,over_odds,under_odds,snapshot_at',
      filters,
      order: 'snapshot_at.desc',
      limit: 100,
    });
    return response.rows;
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
    },
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
