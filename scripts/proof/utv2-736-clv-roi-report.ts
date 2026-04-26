import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvironment } from '../../packages/config/dist/env.js';
import { createClient } from '../../packages/db/node_modules/@supabase/supabase-js/dist/index.mjs';

type QueryResult = { data: unknown[] | null; error: { message?: string } | null };
interface QueryBuilder {
  select(columns: string): QueryBuilder;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder;
  in(column: string, values: string[]): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  not(column: string, operator: string, value: unknown): QueryBuilder;
  range(from: number, to: number): Promise<QueryResult>;
}
interface Client {
  from(table: string): QueryBuilder;
}
type JsonRecord = Record<string, unknown>;

interface SliceReport {
  sport: string;
  market_type: string;
  r_bucket: string;
  sample_size: number;
  win_rate: number | null;
  roi: number | null;
  avg_clv: number | null;
  clv_hit_rate: number | null;
  push_void_count: number;
  unsupported_count: number;
  missing_result_count: number;
  no_close_count: number | null;
  no_open_count: number | null;
  confidence_flag: 'sufficient' | 'low_volume' | 'data_gap';
  verdict: 'trusted' | 'watchlist' | 'blocked_by_data' | 'do_not_use';
}

interface CandidateRow extends JsonRecord {
  id?: string;
  universe_id?: string | null;
  pick_id?: string | null;
  model_score?: number | null;
  model_tier?: string | null;
  shadow_mode?: boolean | null;
  provenance?: unknown;
  filter_details?: unknown;
}

interface UniverseRow extends JsonRecord {
  id?: string;
  sport_key?: string | null;
  provider_key?: string | null;
  provider_event_id?: string | null;
  provider_market_key?: string | null;
  provider_participant_id?: string | null;
  market_type_id?: string | null;
  canonical_market_key?: string | null;
  opening_line?: number | null;
  opening_over_odds?: number | null;
  opening_under_odds?: number | null;
  closing_line?: number | null;
  closing_over_odds?: number | null;
  closing_under_odds?: number | null;
}

interface MarketTypeRow extends JsonRecord {
  id?: string;
  display_name?: string | null;
  short_label?: string | null;
}

interface OfferRow extends JsonRecord {
  provider_key?: string | null;
  provider_event_id?: string | null;
  provider_market_key?: string | null;
  provider_participant_id?: string | null;
  is_closing?: boolean | null;
  line?: number | null;
  over_odds?: number | null;
  under_odds?: number | null;
  snapshot_at?: string | null;
}

interface PickRow extends JsonRecord {
  id?: string;
  odds?: number | null;
  stake_units?: number | null;
}

interface SettlementRow extends JsonRecord {
  pick_id?: string;
  result?: string | null;
  payload?: unknown;
  settled_at?: string | null;
  created_at?: string | null;
}

interface SliceAccumulator {
  sport: string;
  market_type: string;
  r_bucket: string;
  sample_size: number;
  wins: number;
  losses: number;
  pushes: number;
  profit_loss_units: number;
  clv_sum: number;
  clv_count: number;
  clv_hit_count: number;
  push_void_count: number;
  unsupported_count: number;
  missing_result_count: number;
  no_close_count: number | null;
  no_open_count: number | null;
  schema_gap: boolean;
}

interface WrittenReport {
  generatedAt: string;
  summary: {
    sliceCount: number;
    candidateCount: number;
    unsupportedTotal: number;
    missingResultTotal: number;
    noCloseTotal: number;
    noOpenTotal: number;
    lowVolumeSlices: number;
    dataGapSlices: number;
    sufficientSlices: number;
    trustedSlices: number;
    watchlistSlices: number;
    blockedByDataSlices: number;
    doNotUseSlices: number;
  };
  notes: string[];
  slices: SliceReport[];
}

const PAGE_SIZE = 1000;
const RESULT_PATH = resolve(process.cwd(), 'docs/06_status/proof/UTV2-736-clv-roi-report.json');
const DOC_PATH = resolve(process.cwd(), 'docs/06_status/proof/UTV2-736.md');

async function main(): Promise<void> {
  const env = loadEnvironment();
  const supabaseUrl = env.SUPABASE_URL ?? '';
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_ANON_KEY ?? '';
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY are required');
  }

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }) as Client;

  const report = await buildReport(client);
  await writeJson(RESULT_PATH, report.slices);
  await writeMarkdown(DOC_PATH, report);

  console.log('=== UTV2-736 CLV ROI Report ===');
  console.log(`Generated at: ${report.generatedAt}`);
  console.log(`Slices: ${report.summary.sliceCount}`);
  console.log(`Candidates: ${report.summary.candidateCount}`);
  console.log(`Trusted / watchlist / blocked / do_not_use: ${report.summary.trustedSlices} / ${report.summary.watchlistSlices} / ${report.summary.blockedByDataSlices} / ${report.summary.doNotUseSlices}`);
  console.log(`Unsupported total: ${report.summary.unsupportedTotal}`);
  console.log(`Missing-result total: ${report.summary.missingResultTotal}`);
  console.log(`Wrote ${RESULT_PATH}`);
  console.log(`Wrote ${DOC_PATH}`);
}

async function buildReport(client: Client): Promise<WrittenReport> {
  const notes: string[] = [];

  const candidateRows = await fetchRows<CandidateRow>(
    'pick_candidates',
    (from, to) => client.from('pick_candidates').select('*').order('created_at', { ascending: false }).range(from, to),
    'candidate rows',
    notes,
  );
  const shadowScoredCandidates = candidateRows.filter((row) => {
    const shadowMode = readBoolean(row, 'shadow_mode');
    const modelScore = readNumber(row, 'model_score');
    return shadowMode === true && modelScore !== null;
  });

  const universeIds = unique(
    shadowScoredCandidates
      .map((row) => readString(row, 'universe_id'))
      .filter((value): value is string => value !== null),
  );
  const universeRows = universeIds.length > 0
    ? await fetchChunkedRows<UniverseRow>(
        'market_universe',
        universeIds,
        200,
        (chunkIds, from, to) => client.from('market_universe').select('*').in('id', chunkIds).range(from, to),
        'market_universe rows',
        notes,
      )
    : [];
  const universeById = new Map<string, UniverseRow>();
  for (const row of universeRows) {
    const id = readString(row, 'id');
    if (id && !universeById.has(id)) {
      universeById.set(id, row);
    }
  }

  const marketTypeIds = unique(
    universeRows
      .map((row) => readString(row, 'market_type_id'))
      .filter((value): value is string => value !== null),
  );
  const marketTypeRows = marketTypeIds.length > 0
    ? await fetchChunkedRows<MarketTypeRow>(
        'market_types',
        marketTypeIds,
        200,
        (chunkIds, from, to) => client.from('market_types').select('*').in('id', chunkIds).range(from, to),
        'market_types rows',
        notes,
      )
    : [];
  const marketTypeById = new Map<string, MarketTypeRow>();
  for (const row of marketTypeRows) {
    const id = readString(row, 'id');
    if (id && !marketTypeById.has(id)) {
      marketTypeById.set(id, row);
    }
  }

  const providerEventIds = unique(
    universeRows
      .map((row) => readString(row, 'provider_event_id'))
      .filter((value): value is string => value !== null),
  );
  const offerRows = providerEventIds.length > 0
    ? await fetchChunkedRows<OfferRow>(
        'provider_offers',
        providerEventIds,
        200,
        (chunkIds, from, to) =>
          client
            .from('provider_offers')
            .select('*')
            .eq('is_closing', true)
            .in('provider_event_id', chunkIds)
            .range(from, to),
        'provider_offers rows',
        notes,
      )
    : [];
  const closingOfferByKey = new Map<string, OfferRow>();
  for (const row of offerRows) {
    if (readBoolean(row, 'is_closing') !== true) continue;
    const key = buildNaturalKey(row);
    if (!closingOfferByKey.has(key)) {
      closingOfferByKey.set(key, row);
    }
  }

  const pickIds = unique(
    shadowScoredCandidates
      .map((row) => readString(row, 'pick_id'))
      .filter((value): value is string => value !== null),
  );
  const pickRows = pickIds.length > 0
    ? await fetchChunkedRows<PickRow>(
        'picks',
        pickIds,
        200,
        (chunkIds, from, to) => client.from('picks').select('*').in('id', chunkIds).range(from, to),
        'pick rows',
        notes,
      )
    : [];
  const pickById = new Map<string, PickRow>();
  for (const row of pickRows) {
    const id = readString(row, 'id');
    if (id && !pickById.has(id)) {
      pickById.set(id, row);
    }
  }

  const settlementRows = pickIds.length > 0
    ? await fetchChunkedRows<SettlementRow>(
        'settlement_records',
        pickIds,
        200,
        (chunkIds, from, to) =>
          client
            .from('settlement_records')
            .select('*')
            .in('pick_id', chunkIds)
            .order('settled_at', { ascending: false })
            .range(from, to),
        'settlement rows',
        notes,
      )
    : [];
  const settlementByPickId = new Map<string, SettlementRow>();
  for (const row of settlementRows) {
    const pickId = readString(row, 'pick_id');
    if (pickId && !settlementByPickId.has(pickId)) {
      settlementByPickId.set(pickId, row);
    }
  }

  const requiredFieldGaps = {
    candidates:
      candidateRows.length > 0 &&
      (!hasColumn(candidateRows, 'model_score') || !hasColumn(candidateRows, 'pick_id') || !hasColumn(candidateRows, 'universe_id')),
    universe:
      universeRows.length > 0 &&
      (!hasColumn(universeRows, 'sport_key') ||
        !hasColumn(universeRows, 'provider_event_id') ||
        !hasColumn(universeRows, 'provider_market_key') ||
        !hasColumn(universeRows, 'opening_line') ||
        !hasColumn(universeRows, 'closing_line')),
    offers: offerRows.length > 0 && (!hasColumn(offerRows, 'is_closing') || !hasColumn(offerRows, 'line')),
    picks: pickRows.length > 0 && (!hasColumn(pickRows, 'stake_units') || !hasColumn(pickRows, 'odds')),
    settlements:
      settlementRows.length > 0 && (!hasColumn(settlementRows, 'result') || !hasColumn(settlementRows, 'payload')),
  };
  const schemaGap = Object.values(requiredFieldGaps).some(Boolean);
  if (schemaGap) {
    notes.push('At least one expected source column was absent at runtime; affected slices are marked data_gap.');
  }

  const aggregateBySlice = new Map<string, SliceAccumulator>();

  for (const candidate of shadowScoredCandidates) {
    const universe = universeById.get(readString(candidate, 'universe_id') ?? '');
    const sport =
      readString(universe ?? {}, 'sport_key') ??
      readNestedString(candidate, ['provenance', 'sport']) ??
      readNestedString(candidate, ['filter_details', 'sport']) ??
      'unknown';
    const marketType = resolveMarketType(universe, marketTypeById);
    const rBucket = resolveRBucket(candidate);
    const key = `${sport}|${marketType}|${rBucket}`;

    const agg = aggregateBySlice.get(key) ?? {
      sport,
      market_type: marketType,
      r_bucket: rBucket,
      sample_size: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      profit_loss_units: 0,
      clv_sum: 0,
      clv_count: 0,
      clv_hit_count: 0,
      push_void_count: 0,
      unsupported_count: 0,
      missing_result_count: 0,
      no_close_count: 0,
      no_open_count: 0,
      schema_gap: schemaGap || universe === undefined,
    };

    agg.sample_size += 1;
    if (schemaGap || universe === undefined) {
      agg.schema_gap = true;
    }

    const openingKnown = hasOpeningEvidence(universe);
    const closingKnown = hasClosingEvidence(universe, closingOfferByKey);

    if (openingKnown) {
      agg.no_open_count += 0;
    } else if (agg.no_open_count !== null) {
      agg.no_open_count += 1;
    }

    if (closingKnown) {
      agg.no_close_count += 0;
    } else if (agg.no_close_count !== null) {
      agg.no_close_count += 1;
    }

    const pickId = readString(candidate, 'pick_id');
    const settlement = pickId ? settlementByPickId.get(pickId) : undefined;
    const result = readString(settlement ?? {}, 'result');

    if (!pickId) {
      agg.unsupported_count += 1;
      aggregateBySlice.set(key, agg);
      continue;
    }

    if (!settlement || result === null) {
      agg.missing_result_count += 1;
      aggregateBySlice.set(key, agg);
      continue;
    }

    const normalizedResult = result.toLowerCase();
    if (normalizedResult === 'win') {
      agg.wins += 1;
    } else if (normalizedResult === 'loss') {
      agg.losses += 1;
    } else if (normalizedResult === 'push' || normalizedResult === 'void') {
      agg.pushes += 1;
      agg.push_void_count += 1;
    } else {
      agg.missing_result_count += 1;
      aggregateBySlice.set(key, agg);
      continue;
    }

    const payload = asRecord(readValue(settlement, 'payload'));
    const clvRaw = readNumber(payload, 'clvRaw') ?? readNumber(asRecord(readValue(payload, 'clv')), 'clvRaw');
    const beatsClosingLine =
      readBoolean(payload, 'beatsClosingLine') ??
      readBoolean(asRecord(readValue(payload, 'clv')), 'beatsClosingLine');

    if (clvRaw !== null) {
      agg.clv_sum += clvRaw;
      agg.clv_count += 1;
    }
    if (beatsClosingLine === true) {
      agg.clv_hit_count += 1;
    }

    const profitLossUnits =
      readNumber(payload, 'profitLossUnits') ??
      computeProfitLossUnits(
        normalizedResult,
        readNumber(pickById.get(pickId) ?? {}, 'odds'),
        readNumber(pickById.get(pickId) ?? {}, 'stake_units'),
      ) ??
      0;
    agg.profit_loss_units += profitLossUnits;

    aggregateBySlice.set(key, agg);
  }

  const slices = Array.from(aggregateBySlice.values())
    .map((agg) => finalizeSlice(agg, schemaGap))
    .sort((left, right) =>
      left.sport.localeCompare(right.sport) ||
      left.market_type.localeCompare(right.market_type) ||
      left.r_bucket.localeCompare(right.r_bucket),
    );

  const summary = {
    sliceCount: slices.length,
    candidateCount: shadowScoredCandidates.length,
    unsupportedTotal: sum(slices.map((row) => row.unsupported_count)),
    missingResultTotal: sum(slices.map((row) => row.missing_result_count)),
    noCloseTotal: sumNullable(slices.map((row) => row.no_close_count)),
    noOpenTotal: sumNullable(slices.map((row) => row.no_open_count)),
    lowVolumeSlices: slices.filter((row) => row.confidence_flag === 'low_volume').length,
    dataGapSlices: slices.filter((row) => row.confidence_flag === 'data_gap').length,
    sufficientSlices: slices.filter((row) => row.confidence_flag === 'sufficient').length,
    trustedSlices: slices.filter((row) => row.verdict === 'trusted').length,
    watchlistSlices: slices.filter((row) => row.verdict === 'watchlist').length,
    blockedByDataSlices: slices.filter((row) => row.verdict === 'blocked_by_data').length,
    doNotUseSlices: slices.filter((row) => row.verdict === 'do_not_use').length,
  };

  return {
    generatedAt: new Date().toISOString(),
    summary,
    notes,
    slices,
  };
}

function finalizeSlice(agg: SliceAccumulator, schemaGap: boolean): SliceReport {
  const winRate = agg.wins + agg.losses > 0 ? round4(agg.wins / (agg.wins + agg.losses)) : null;
  const roi = agg.sample_size > 0 ? round4(agg.profit_loss_units / agg.sample_size) : null;
  const avgClv = agg.clv_count > 0 ? round4(agg.clv_sum / agg.clv_count) : null;
  const clvHitRate = agg.clv_count > 0 ? round4(agg.clv_hit_count / agg.clv_count) : null;

  let confidence_flag: SliceReport['confidence_flag'];
  if (schemaGap || agg.schema_gap || agg.no_close_count === null || agg.no_open_count === null) {
    confidence_flag = 'data_gap';
  } else if (agg.sample_size < 30) {
    confidence_flag = 'low_volume';
  } else if (agg.no_close_count / agg.sample_size >= 0.2) {
    confidence_flag = 'data_gap';
  } else {
    confidence_flag = 'sufficient';
  }

  let verdict: SliceReport['verdict'];
  if (confidence_flag !== 'sufficient') {
    verdict = 'blocked_by_data';
  } else if (winRate !== null && roi !== null && winRate >= 0.55 && roi >= 0.05) {
    verdict = 'trusted';
  } else if (winRate !== null && roi !== null && winRate < 0.45 && roi < -0.05) {
    verdict = 'do_not_use';
  } else {
    verdict = 'watchlist';
  }

  return {
    sport: agg.sport,
    market_type: agg.market_type,
    r_bucket: agg.r_bucket,
    sample_size: agg.sample_size,
    win_rate: winRate,
    roi,
    avg_clv: avgClv,
    clv_hit_rate: clvHitRate,
    push_void_count: agg.push_void_count,
    unsupported_count: agg.unsupported_count,
    missing_result_count: agg.missing_result_count,
    no_close_count: confidence_flag === 'data_gap' ? null : agg.no_close_count,
    no_open_count: confidence_flag === 'data_gap' ? null : agg.no_open_count,
    confidence_flag,
    verdict,
  };
}

async function fetchRows<T extends JsonRecord>(
  table: string,
  fetchPage: (from: number, to: number) => Promise<{ data: unknown[] | null; error: { message?: string } | null }>,
  label: string,
  notes: string[],
): Promise<T[]> {
  const rows: T[] = [];
  try {
    for (let from = 0; ; from += PAGE_SIZE) {
      const response = await fetchPage(from, from + PAGE_SIZE - 1);
      if (response.error) {
        throw new Error(`${label}: ${response.error.message ?? 'unknown Supabase error'}`);
      }
      const page = (response.data ?? []) as T[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  } catch (error) {
    notes.push(`${table} read failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return rows;
}

async function fetchChunkedRows<T extends JsonRecord>(
  table: string,
  ids: string[],
  chunkSize: number,
  fetchPage: (chunkIds: string[], from: number, to: number) => Promise<QueryResult>,
  label: string,
  notes: string[],
): Promise<T[]> {
  const rows: T[] = [];
  for (const chunkIds of chunk(ids, chunkSize)) {
    const chunkRows = await fetchRows<T>(
      table,
      (from, to) => fetchPage(chunkIds, from, to),
      label,
      notes,
    );
    rows.push(...chunkRows);
  }
  return rows;
}

function resolveMarketType(universe: UniverseRow | undefined, marketTypes: Map<string, MarketTypeRow>): string {
  if (!universe) return 'unknown';
  const marketTypeId = readString(universe, 'market_type_id');
  if (marketTypeId) {
    const marketType = marketTypes.get(marketTypeId);
    const label = readString(marketType ?? {}, 'short_label') ?? readString(marketType ?? {}, 'display_name');
    if (label) return label;
    return marketTypeId;
  }
  return (
    readString(universe, 'canonical_market_key') ??
    readString(universe, 'provider_market_key') ??
    'unknown'
  );
}

function resolveRBucket(candidate: CandidateRow): string {
  const fromMetadata =
    normalizeBucket(readNestedString(candidate, ['provenance', 'r_bucket'])) ??
    normalizeBucket(readNestedString(candidate, ['provenance', 'rBucket'])) ??
    normalizeBucket(readNestedString(candidate, ['provenance', 'bucket'])) ??
    normalizeBucket(readNestedString(candidate, ['provenance', 'tier'])) ??
    normalizeBucket(readNestedString(candidate, ['filter_details', 'r_bucket'])) ??
    normalizeBucket(readNestedString(candidate, ['filter_details', 'rBucket'])) ??
    normalizeBucket(readNestedString(candidate, ['filter_details', 'bucket'])) ??
    normalizeBucket(readNestedString(candidate, ['filter_details', 'tier']));
  if (fromMetadata) return fromMetadata;

  const modelTier = normalizeBucket(readString(candidate, 'model_tier'));
  if (modelTier) {
    const mapped = mapKnownTierToRBucket(modelTier);
    if (mapped) return mapped;
  }

  const score = readNumber(candidate, 'model_score');
  if (score === null) return 'UNKNOWN';
  if (score >= 0.85) return 'R1';
  if (score >= 0.75) return 'R2';
  if (score >= 0.65) return 'R3';
  if (score >= 0.55) return 'R4';
  return 'R5';
}

function mapKnownTierToRBucket(tier: string): string | null {
  const normalized = tier.trim().toUpperCase();
  if (/^R[1-5]$/.test(normalized)) return normalized;
  switch (normalized) {
    case 'A+':
      return 'R1';
    case 'A':
      return 'R2';
    case 'B':
      return 'R3';
    case 'C':
      return 'R4';
    case 'SUPPRESS':
      return 'R5';
    default:
      return null;
  }
}

function normalizeBucket(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (/^R[1-5]$/.test(normalized)) return normalized;
  return mapKnownTierToRBucket(normalized);
}

function buildNaturalKey(row: OfferRow | UniverseRow): string {
  return [
    readString(row, 'provider_key') ?? '',
    readString(row, 'provider_event_id') ?? '',
    readString(row, 'provider_participant_id') ?? '',
    readString(row, 'provider_market_key') ?? '',
  ].join('|');
}

function hasOpeningEvidence(universe: UniverseRow | undefined): boolean {
  if (!universe) return false;
  return (
    readNumber(universe, 'opening_line') !== null &&
    readNumber(universe, 'opening_over_odds') !== null &&
    readNumber(universe, 'opening_under_odds') !== null
  );
}

function hasClosingEvidence(universe: UniverseRow | undefined, closingOffers: Map<string, OfferRow>): boolean {
  if (!universe) return false;
  if (
    readNumber(universe, 'closing_line') !== null &&
    readNumber(universe, 'closing_over_odds') !== null &&
    readNumber(universe, 'closing_under_odds') !== null
  ) {
    return true;
  }
  const key = buildNaturalKey(universe);
  const closingOffer = closingOffers.get(key);
  return (
    readNumber(closingOffer ?? {}, 'line') !== null &&
    readNumber(closingOffer ?? {}, 'over_odds') !== null &&
    readNumber(closingOffer ?? {}, 'under_odds') !== null
  );
}

function computeProfitLossUnits(
  result: string,
  odds: number | null | undefined,
  stakeUnits: number | null | undefined,
): number | null {
  const stake = typeof stakeUnits === 'number' && Number.isFinite(stakeUnits) ? stakeUnits : 1;

  if (result === 'push' || result === 'void') return 0;
  if (result === 'loss') return round2(-stake);
  if (result === 'win') {
    if (typeof odds === 'number' && Number.isFinite(odds) && odds !== 0) {
      return odds > 0 ? round2(stake * (odds / 100)) : round2(stake * (100 / Math.abs(odds)));
    }
    return round2(stake);
  }
  return null;
}

function readString(row: JsonRecord, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(row: JsonRecord, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(row: JsonRecord, key: string): boolean | null {
  const value = row[key];
  return typeof value === 'boolean' ? value : null;
}

function readValue(row: JsonRecord, key: string): unknown {
  return row[key];
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function readNestedString(row: JsonRecord, path: string[]): string | null {
  let current: unknown = row;
  for (const key of path) {
    const record = asRecord(current);
    current = record[key];
  }
  return typeof current === 'string' && current.trim().length > 0 ? current : null;
}

function hasColumn<T extends JsonRecord>(rows: T[], key: string): boolean {
  return rows.some((row) => Object.hasOwn(row, key));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sumNullable(values: Array<number | null>): number {
  return values.reduce((total, value) => total + (value ?? 0), 0);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeMarkdown(filePath: string, report: WrittenReport): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const lines: string[] = [];
  lines.push('# UTV2-736 CLV ROI Report');
  lines.push('');
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Slices: ${report.summary.sliceCount}`);
  lines.push(`- Shadow-scored candidates: ${report.summary.candidateCount}`);
  lines.push(`- Unsupported total: ${report.summary.unsupportedTotal}`);
  lines.push(`- Missing-result total: ${report.summary.missingResultTotal}`);
  lines.push(`- No-close total: ${report.summary.noCloseTotal}`);
  lines.push(`- No-open total: ${report.summary.noOpenTotal}`);
  lines.push(`- Confidence split: sufficient ${report.summary.sufficientSlices}, low-volume ${report.summary.lowVolumeSlices}, data-gap ${report.summary.dataGapSlices}`);
  if (report.notes.length > 0) {
    lines.push('');
    lines.push('## Notes');
    lines.push('');
    for (const note of report.notes) {
      lines.push(`- ${note}`);
    }
  }
  lines.push('');
  lines.push('## Slice Table');
  lines.push('');
  lines.push('| sport | market_type | tier / R-bucket | sample_size | win_rate | roi | avg_clv | clv_hit_rate | push_void_count | unsupported_count | missing_result_count | no_close_count | no_open_count | confidence_flag | verdict |');
  lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  for (const slice of report.slices) {
    lines.push(
      `| ${formatCell(slice.sport)} | ${formatCell(slice.market_type)} | ${formatCell(slice.r_bucket)} | ${slice.sample_size} | ${formatPct(slice.win_rate)} | ${formatPct(slice.roi)} | ${formatPct(slice.avg_clv)} | ${formatPct(slice.clv_hit_rate)} | ${formatMaybeInt(slice.push_void_count)} | ${formatMaybeInt(slice.unsupported_count)} | ${formatMaybeInt(slice.missing_result_count)} | ${formatMaybeInt(slice.no_close_count)} | ${formatMaybeInt(slice.no_open_count)} | ${slice.confidence_flag} | ${slice.verdict} |`,
    );
  }
  lines.push('');
  lines.push('## Confidence Flags');
  lines.push('');
  lines.push('- `sufficient`: sample_size >= 30 and no_close_count / sample_size < 0.2');
  lines.push('- `low_volume`: sample_size < 30');
  lines.push('- `data_gap`: no_close_count / sample_size >= 0.2 or required source columns were missing');
  lines.push('');
  lines.push('## Data Gap Commentary');
  lines.push('');
  lines.push(`- Unsupported total: ${report.summary.unsupportedTotal}`);
  lines.push(`- Missing-result total: ${report.summary.missingResultTotal}`);
  lines.push(`- No-close total: ${report.summary.noCloseTotal}`);
  lines.push(`- No-open total: ${report.summary.noOpenTotal}`);
  lines.push('');
  lines.push('## Overall Conclusion');
  lines.push('');
  if (report.summary.trustedSlices > 0) {
    lines.push(`At least one slice clears the trust threshold, but ${report.summary.blockedByDataSlices} slices remain blocked by data or volume constraints and should not be generalized beyond their current sample. Unsupported and missing-result accounting is preserved in the slice table.`);
  } else if (report.summary.blockedByDataSlices > 0) {
    lines.push(`No slice clears the trust threshold yet. The report is dominated by data/volume constraints, with unsupported and missing-result rows still present in the shadow-scored sample.`);
  } else {
    lines.push('No slice clears the trust threshold, and the observed slices are not yet strong enough to recommend use.');
  }

  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function formatCell(value: string): string {
  return value.replaceAll('|', '\\|');
}

function formatPct(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function formatMaybeInt(value: number | null): string {
  return value === null ? 'n/a' : String(value);
}

async function mainEntry(): Promise<void> {
  await main();
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  mainEntry().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
