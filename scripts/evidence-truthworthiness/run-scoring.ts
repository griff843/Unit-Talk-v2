import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDatabaseClient,
  type UnitTalkSupabaseClient,
} from '@unit-talk/db';

type Verdict = 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';
type SampleVerdict = 'PASS' | 'WARN' | 'FAIL' | 'INSUFFICIENT';
type DimensionName =
  | 'worker-freshness'
  | 'scheduler-freshness'
  | 'provider-freshness'
  | 'candidate-materialization-freshness'
  | 'board-writer-freshness'
  | 'stake-valid'
  | 'provenance-linked'
  | 'CLV-backed'
  | 'supported-market'
  | 'settlement-valid'
  | 'model-attributed'
  | 'source-separated'
  | 'queue-latency'
  | 'posting-latency'
  | 'stranded-queue-counts';

type JsonRecord = Record<string, unknown>;

interface PickInput {
  id: string;
  created_at: string;
  status: string | null;
  source: string | null;
  sport_id: string | null;
  market: string | null;
  market_type_id: string | null;
  metadata: JsonRecord | null;
  stake_units: number | null;
  submission_id: string | null;
  posted_at: string | null;
  settled_at: string | null;
}

interface SettlementInput {
  id: string;
  pick_id: string;
  status: string | null;
  result: string | null;
  corrects_id: string | null;
  settled_at: string | null;
}

interface OutboxInput {
  id: string;
  pick_id: string;
  status: string | null;
  created_at: string;
}

interface ReceiptInput {
  outbox_id: string;
  status: string | null;
  recorded_at: string;
}

interface CandidateInput {
  pick_id: string | null;
  scan_run_id: string | null;
  provenance: JsonRecord | null;
  updated_at: string;
}

interface GovernedInput {
  pick_id: string | null;
  board_run_id: string | null;
  candidate_id: string | null;
  universe_id: string | null;
  provider_market_key: string | null;
  sport_key: string | null;
  market: string | null;
  model_tier: string | null;
}

interface OfferInput {
  provider_market_key: string | null;
  sport_key: string | null;
  is_closing: boolean | null;
  snapshot_at: string | null;
}

interface MarketUniverseInput {
  id: string;
  canonical_market_key: string | null;
  provider_market_key: string | null;
  market_type_id: string | null;
  sport_key: string | null;
}

interface SystemRunInput {
  run_type: string;
  created_at: string;
}

interface LiveData {
  picks: PickInput[];
  settlements: SettlementInput[];
  outbox: OutboxInput[];
  receipts: ReceiptInput[];
  candidates: CandidateInput[];
  governed: GovernedInput[];
  closingOffers: OfferInput[];
  marketUniverse: MarketUniverseInput[];
  modelIds: string[];
  systemRuns: SystemRunInput[];
  latestProviderSnapshotAt: string | null;
  latestCandidateUpdatedAt: string | null;
  latestBoardPickAt: string | null;
  strandedQueueCount: number;
  schemaNotes: string[];
}

interface RunOptions {
  days?: number;
  outDir?: string;
  now?: Date;
  data?: LiveData;
  client?: UnitTalkSupabaseClient;
}

interface RowDimension {
  verdict: Verdict;
  value: string;
}

interface ScoredPick {
  pick: PickInput;
  dimensions: Record<string, RowDimension>;
  queueLatencySeconds: number | null;
  postingLatencySeconds: number | null;
  rowVerdict: Verdict;
}

interface ExclusionRow {
  pick_id: string;
  exclusion_reason: string;
  dimension: string;
  dimension_value: string;
  sport: string;
  market_key: string;
  source_type: string;
  created_at: string;
}

const OUTPUT_FILES = [
  'truthworthiness-summary.json',
  'truthworthiness-by-dimension.csv',
  'truthworthiness-by-sport.csv',
  'truthworthiness-by-market-family.csv',
  'truthworthiness-by-source-type.csv',
  'truthworthiness-exclusions.csv',
  'README.md',
] as const;

const DIMENSIONS: Array<{ name: DimensionName; granularity: 'system' | 'row' }> = [
  { name: 'worker-freshness', granularity: 'system' },
  { name: 'scheduler-freshness', granularity: 'system' },
  { name: 'provider-freshness', granularity: 'system' },
  { name: 'candidate-materialization-freshness', granularity: 'system' },
  { name: 'board-writer-freshness', granularity: 'system' },
  { name: 'stake-valid', granularity: 'row' },
  { name: 'provenance-linked', granularity: 'row' },
  { name: 'CLV-backed', granularity: 'row' },
  { name: 'supported-market', granularity: 'row' },
  { name: 'settlement-valid', granularity: 'row' },
  { name: 'model-attributed', granularity: 'row' },
  { name: 'source-separated', granularity: 'row' },
  { name: 'queue-latency', granularity: 'row' },
  { name: 'posting-latency', granularity: 'row' },
  { name: 'stranded-queue-counts', granularity: 'system' },
];

const REQUIRED_OUTPUT_DIR = path.join(
  'docs',
  '06_status',
  'proof',
  'evidence-truthworthiness',
);

const SAMPLE_DIMENSIONS = {
  trusted_roi_sample: ['stake-valid', 'settlement-valid', 'provenance-linked'],
  trusted_clv_sample: [
    'CLV-backed',
    'settlement-valid',
    'supported-market',
    'provenance-linked',
  ],
  trusted_model_edge_sample: [
    'model-attributed',
    'source-separated',
    'settlement-valid',
    'supported-market',
    'CLV-backed',
    'provenance-linked',
    'stake-valid',
  ],
  trusted_production_readiness_sample: [
    'provenance-linked',
    'queue-latency',
    'posting-latency',
  ],
  trusted_syndicate_readiness_sample: [
    'stake-valid',
    'provenance-linked',
    'CLV-backed',
    'supported-market',
    'settlement-valid',
    'model-attributed',
    'source-separated',
    'queue-latency',
    'posting-latency',
  ],
} as const;

const SYSTEM_REQUIREMENTS = {
  trusted_roi_sample: ['worker-freshness', 'scheduler-freshness'],
  trusted_clv_sample: ['provider-freshness'],
  trusted_model_edge_sample: ['provider-freshness', 'scheduler-freshness'],
  trusted_production_readiness_sample: [
    'worker-freshness',
    'scheduler-freshness',
    'provider-freshness',
    'candidate-materialization-freshness',
    'board-writer-freshness',
    'stranded-queue-counts',
  ],
  trusted_syndicate_readiness_sample: [
    'worker-freshness',
    'scheduler-freshness',
    'provider-freshness',
    'candidate-materialization-freshness',
    'board-writer-freshness',
    'stranded-queue-counts',
  ],
} as const;

function parseArgs(argv: string[]): { days: number } {
  let days = 30;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--days') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('--days must be a positive integer');
      }
      days = value;
      index += 1;
    }
  }
  return { days };
}

function iso(date: Date): string {
  return date.toISOString();
}

function ageMinutes(now: Date, timestamp: string | null): number | null {
  if (!timestamp) return null;
  const millis = now.getTime() - new Date(timestamp).getTime();
  return Math.max(0, millis / 60000);
}

function ageHours(now: Date, timestamp: string | null): number | null {
  const minutes = ageMinutes(now, timestamp);
  return minutes == null ? null : minutes / 60;
}

function freshnessVerdict(
  age: number | null,
  passBelow: number,
  warnBelow: number,
): Verdict {
  if (age == null) return 'FAIL';
  if (age < passBelow) return 'PASS';
  if (age <= warnBelow) return 'WARN';
  return 'FAIL';
}

function pct(pass: number, total: number): number {
  if (total === 0) return 0;
  return Number(((pass / total) * 100).toFixed(2));
}

function avg(values: Array<number | null>): number | null {
  const usable = values.filter((value): value is number => value != null);
  if (usable.length === 0) return null;
  return Number((usable.reduce((sum, value) => sum + value, 0) / usable.length).toFixed(2));
}

function normalizeMetadata(raw: JsonRecord | null): JsonRecord {
  return raw && typeof raw === 'object' ? raw : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function modelIdFromPick(pick: PickInput, governed: GovernedInput | undefined): string | null {
  const metadata = normalizeMetadata(pick.metadata);
  return (
    stringValue(metadata['model_id']) ??
    stringValue(metadata['modelId']) ??
    stringValue(metadata['model_registry_id']) ??
    stringValue(metadata['modelRegistryId']) ??
    governed?.model_tier ??
    null
  );
}

function canonicalSource(source: string | null): {
  verdict: Verdict;
  canonical: string;
  exclusion: boolean;
} {
  if (!source) return { verdict: 'FAIL', canonical: 'null', exclusion: true };
  const normalized = source.trim().toLowerCase();
  if (['user-submitted', 'smart-form', 'api'].includes(normalized)) {
    return { verdict: 'PASS', canonical: 'user-submitted', exclusion: false };
  }
  if (
    ['system-scanner', 'system-pick-scanner', 'candidate-builder', 'alert-agent', 'model-driven'].includes(
      normalized,
    )
  ) {
    return { verdict: 'PASS', canonical: 'system-scanner', exclusion: false };
  }
  if (['board-construction'].includes(normalized)) {
    return { verdict: 'PASS', canonical: 'board-construction', exclusion: false };
  }
  if (['manual', 'operator'].includes(normalized)) {
    return { verdict: 'PASS', canonical: 'manual', exclusion: normalized === 'manual' };
  }
  if (['direct-api', 'heuristic'].includes(normalized)) {
    return { verdict: 'WARN', canonical: normalized, exclusion: true };
  }
  return { verdict: 'FAIL', canonical: normalized, exclusion: true };
}

async function selectRows<T>(
  client: UnitTalkSupabaseClient,
  table: string,
  select: string,
  configure?: (query: ReturnType<UnitTalkSupabaseClient['from']> extends infer Builder ? Builder : never) => unknown,
): Promise<T[]> {
  let query = client.from(table).select(select);
  if (configure) {
    query = configure(query as never) as typeof query;
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`${table} query failed: ${error.message}`);
  }
  return (data ?? []) as T[];
}

async function selectRowsInBatches<T>(
  client: UnitTalkSupabaseClient,
  table: string,
  select: string,
  column: string,
  values: string[],
  batchSize = 200,
): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    const batch = values.slice(index, index + batchSize);
    rows.push(
      ...(await selectRows<T>(
        client,
        table,
        select,
        (query) => query.in(column, batch),
      )),
    );
  }
  return rows;
}

async function verifyRequiredSchema(client: UnitTalkSupabaseClient): Promise<string[]> {
  const notes: string[] = [];
  const checks: Array<{ table: string; select: string; stop: string }> = [
    {
      table: 'picks',
      select:
        'id,created_at,status,source,sport_id,market,market_type_id,metadata,stake_units,submission_id,posted_at,settled_at',
      stop: 'picks required columns are unavailable',
    },
    {
      table: 'system_runs',
      select: 'run_type,created_at',
      stop: 'system_runs table does not exist',
    },
    {
      table: 'provider_offers',
      select: 'provider_market_key,sport_key,is_closing,snapshot_at',
      stop: 'provider_offers table is missing',
    },
  ];

  for (const check of checks) {
    const { error } = await client.from(check.table).select(check.select).limit(1);
    if (error) {
      throw new Error(`${check.stop}: ${error.message}`);
    }
  }

  const optionalChecks = [
    {
      table: 'v_governed_pick_performance',
      select:
        'pick_id,board_run_id,candidate_id,universe_id,provider_market_key,sport_key,market,model_tier',
      note:
        'board_run_id/model_tier are read from v_governed_pick_performance because picks does not expose direct board/model columns',
    },
    {
      table: 'pick_candidates',
      select: 'pick_id,scan_run_id,provenance,updated_at',
      note: 'scan_run_id is read from pick_candidates because picks does not expose it directly',
    },
    { table: 'model_registry', select: 'id', note: 'model attribution is cross-checked against model_registry.id' },
  ];

  for (const check of optionalChecks) {
    const { error } = await client.from(check.table).select(check.select).limit(1);
    if (error) {
      notes.push(`${check.table}: ${error.message}`);
    } else {
      notes.push(check.note);
    }
  }

  return notes;
}

async function fetchAll<T>(
  client: UnitTalkSupabaseClient,
  table: string,
  select: string,
  configure: (query: ReturnType<UnitTalkSupabaseClient['from']>) => ReturnType<UnitTalkSupabaseClient['from']>,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    let query = client.from(table).select(select).range(from, to);
    query = configure(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table} query failed: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function fetchLiveData(
  client: UnitTalkSupabaseClient,
  fromIso: string,
): Promise<LiveData> {
  const schemaNotes = await verifyRequiredSchema(client);
  const picks = await fetchAll<PickInput>(
    client,
    'picks',
    'id,created_at,status,source,sport_id,market,market_type_id,metadata,stake_units,submission_id,posted_at,settled_at',
    (query) => query.gte('created_at', fromIso).order('created_at', { ascending: true }),
  );
  const pickIds = picks.map((pick) => pick.id);

  const [settlements, outbox, candidates, governed, closingOffers, marketUniverse, modelRows, systemRuns] =
    await Promise.all([
      pickIds.length
        ? selectRowsInBatches<SettlementInput>(
            client,
            'settlement_records',
            'id,pick_id,status,result,corrects_id,settled_at',
            'pick_id',
            pickIds,
          )
        : Promise.resolve([]),
      pickIds.length
        ? selectRowsInBatches<OutboxInput>(
            client,
            'distribution_outbox',
            'id,pick_id,status,created_at',
            'pick_id',
            pickIds,
          )
        : Promise.resolve([]),
      pickIds.length
        ? selectRowsInBatches<CandidateInput>(
            client,
            'pick_candidates',
            'pick_id,scan_run_id,provenance,updated_at',
            'pick_id',
            pickIds,
          ).catch(() => [])
        : Promise.resolve([]),
      pickIds.length
        ? selectRowsInBatches<GovernedInput>(
            client,
            'v_governed_pick_performance',
            'pick_id,board_run_id,candidate_id,universe_id,provider_market_key,sport_key,market,model_tier',
            'pick_id',
            pickIds,
          ).catch(() => [])
        : Promise.resolve([]),
      selectRows<OfferInput>(
        client,
        'provider_offers',
        'provider_market_key,sport_key,is_closing,snapshot_at',
        (query) => query.eq('is_closing', true).order('snapshot_at', { ascending: false }).limit(5000),
      ),
      selectRows<MarketUniverseInput>(
        client,
        'market_universe',
        'id,canonical_market_key,provider_market_key,market_type_id,sport_key',
        (query) => query.limit(10000),
      ),
      selectRows<{ id: string }>(client, 'model_registry', 'id', (query) => query.limit(10000)).catch(() => []),
      selectRows<SystemRunInput>(
        client,
        'system_runs',
        'run_type,created_at',
        (query) => query.order('created_at', { ascending: false }).limit(500),
      ),
    ]);

  const receipts = outbox.length
    ? await selectRowsInBatches<ReceiptInput>(
        client,
        'distribution_receipts',
        'outbox_id,status,recorded_at',
        'outbox_id',
        outbox.map((row) => row.id),
      )
    : [];

  const [{ data: provider }, { data: candidate }, { count: strandedCount }] = await Promise.all([
    client.from('provider_offers').select('snapshot_at').order('snapshot_at', { ascending: false }).limit(1),
    client.from('pick_candidates').select('updated_at').order('updated_at', { ascending: false }).limit(1),
    client
      .from('distribution_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lt('created_at', new Date(Date.now() - 60 * 60000).toISOString()),
  ]);

  const latestBoardPickAt =
    governed
      .filter((row) => row.board_run_id)
      .map((row) => picks.find((pick) => pick.id === row.pick_id)?.created_at ?? null)
      .filter((value): value is string => value != null)
      .sort()
      .at(-1) ?? null;

  return {
    picks,
    settlements,
    outbox,
    receipts,
    candidates,
    governed,
    closingOffers,
    marketUniverse,
    modelIds: modelRows.map((row) => row.id),
    systemRuns,
    latestProviderSnapshotAt:
      Array.isArray(provider) && provider[0] && typeof provider[0]['snapshot_at'] === 'string'
        ? provider[0]['snapshot_at']
        : null,
    latestCandidateUpdatedAt:
      Array.isArray(candidate) && candidate[0] && typeof candidate[0]['updated_at'] === 'string'
        ? candidate[0]['updated_at']
        : null,
    latestBoardPickAt,
    strandedQueueCount: strandedCount ?? 0,
    schemaNotes,
  };
}

function latestSystemRun(runs: SystemRunInput[], predicate: (runType: string) => boolean): string | null {
  return (
    runs
      .filter((run) => predicate(run.run_type))
      .map((run) => run.created_at)
      .sort()
      .at(-1) ?? null
  );
}

function buildSystemDimensions(data: LiveData, now: Date): Record<string, JsonRecord> {
  const workerAge = ageMinutes(now, latestSystemRun(data.systemRuns, (type) => type === 'worker.heartbeat'));
  const schedulerAge = ageHours(now, latestSystemRun(data.systemRuns, (type) => type.startsWith('scheduler.')));
  const providerAge = ageHours(now, data.latestProviderSnapshotAt);
  const candidateAge = ageHours(now, data.latestCandidateUpdatedAt);
  const boardAge = ageHours(now, data.latestBoardPickAt);
  const strandedVerdict: Verdict =
    data.strandedQueueCount === 0 ? 'PASS' : data.strandedQueueCount <= 5 ? 'WARN' : 'FAIL';

  return {
    worker_freshness: {
      verdict: freshnessVerdict(workerAge, 10, 60),
      age_minutes: workerAge == null ? null : Number(workerAge.toFixed(2)),
    },
    scheduler_freshness: {
      verdict: freshnessVerdict(schedulerAge, 4, 24),
      age_hours: schedulerAge == null ? null : Number(schedulerAge.toFixed(2)),
    },
    provider_freshness: {
      verdict: freshnessVerdict(providerAge, 4, 24),
      age_hours: providerAge == null ? null : Number(providerAge.toFixed(2)),
    },
    candidate_materialization_freshness: {
      verdict: freshnessVerdict(candidateAge, 6, 24),
      age_hours: candidateAge == null ? null : Number(candidateAge.toFixed(2)),
    },
    board_writer_freshness: {
      verdict: freshnessVerdict(boardAge, 6, 24),
      age_hours: boardAge == null ? null : Number(boardAge.toFixed(2)),
    },
    stranded_queue_counts: {
      verdict: strandedVerdict,
      count: data.strandedQueueCount,
    },
  };
}

function getSystemVerdict(systemDimensions: Record<string, JsonRecord>): Verdict {
  const verdicts = Object.values(systemDimensions).map((dimension) => dimension['verdict']);
  if (verdicts.includes('FAIL')) return 'FAIL';
  if (verdicts.includes('WARN')) return 'WARN';
  return 'PASS';
}

function scorePicks(data: LiveData, now: Date): ScoredPick[] {
  const settlementsByPick = new Map<string, SettlementInput[]>();
  for (const row of data.settlements) {
    const rows = settlementsByPick.get(row.pick_id) ?? [];
    rows.push(row);
    settlementsByPick.set(row.pick_id, rows);
  }
  const outboxByPick = new Map<string, OutboxInput[]>();
  for (const row of data.outbox) {
    const rows = outboxByPick.get(row.pick_id) ?? [];
    rows.push(row);
    outboxByPick.set(row.pick_id, rows);
  }
  const receiptsByOutbox = new Map<string, ReceiptInput[]>();
  for (const row of data.receipts) {
    const rows = receiptsByOutbox.get(row.outbox_id) ?? [];
    rows.push(row);
    receiptsByOutbox.set(row.outbox_id, rows);
  }
  const candidateByPick = new Map(data.candidates.filter((row) => row.pick_id).map((row) => [row.pick_id!, row]));
  const governedByPick = new Map(data.governed.filter((row) => row.pick_id).map((row) => [row.pick_id!, row]));
  const universeKeys = new Set<string>();
  for (const row of data.marketUniverse) {
    for (const value of [row.id, row.canonical_market_key, row.provider_market_key, row.market_type_id]) {
      if (value) universeKeys.add(value);
    }
  }
  const closingKeys = new Set(
    data.closingOffers
      .filter((row) => row.is_closing)
      .flatMap((row) => [row.provider_market_key, row.sport_key].filter((value): value is string => Boolean(value))),
  );
  const modelIds = new Set(data.modelIds);

  return data.picks.map((pick) => {
    const governed = governedByPick.get(pick.id);
    const candidate = candidateByPick.get(pick.id);
    const settlements = (settlementsByPick.get(pick.id) ?? []).sort((left, right) =>
      String(right.settled_at ?? '').localeCompare(String(left.settled_at ?? '')),
    );
    const settlement = settlements[0];
    const outboxRows = (outboxByPick.get(pick.id) ?? []).sort((left, right) =>
      left.created_at.localeCompare(right.created_at),
    );
    const firstOutbox = outboxRows[0];
    const firstReceipt = firstOutbox
      ? (receiptsByOutbox.get(firstOutbox.id) ?? []).sort((left, right) =>
          left.recorded_at.localeCompare(right.recorded_at),
        )[0]
      : undefined;
    const source = canonicalSource(pick.source);
    const modelId = modelIdFromPick(pick, governed);
    const hasProvenance = Boolean(
      pick.submission_id ||
        candidate?.scan_run_id ||
        governed?.candidate_id ||
        governed?.board_run_id ||
        candidate?.provenance?.['scan_run_id'],
    );
    const supportedMarket = Boolean(
      (pick.market_type_id && universeKeys.has(pick.market_type_id)) ||
        (pick.market && universeKeys.has(pick.market)) ||
        (governed?.provider_market_key && universeKeys.has(governed.provider_market_key)),
    );
    const hasClosing =
      Boolean(pick.market && closingKeys.has(pick.market)) ||
      Boolean(governed?.provider_market_key && closingKeys.has(governed.provider_market_key)) ||
      Boolean(governed?.sport_key && closingKeys.has(governed.sport_key));
    const isSettled =
      pick.status === 'settled' &&
      settlement != null &&
      settlement.status !== 'voided' &&
      settlement.result !== 'void';
    const correctedSettlement = Boolean(settlement?.corrects_id);
    const queueApplies = ['queued', 'posted', 'settled'].includes(pick.status ?? '');
    const queueLatencySeconds =
      firstOutbox != null
        ? Math.max(0, (new Date(firstOutbox.created_at).getTime() - new Date(pick.created_at).getTime()) / 1000)
        : null;
    const postingLatencySeconds =
      firstOutbox && firstReceipt
        ? Math.max(0, (new Date(firstReceipt.recorded_at).getTime() - new Date(firstOutbox.created_at).getTime()) / 1000)
        : null;
    const latestClosingAgeHours = ageHours(
      now,
      data.closingOffers
        .filter((row) => row.is_closing)
        .map((row) => row.snapshot_at)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null,
    );

    const dimensions: Record<string, RowDimension> = {
      'stake-valid': {
        verdict: pick.stake_units != null && pick.stake_units > 0 ? 'PASS' : pick.stake_units == null ? 'UNKNOWN' : 'FAIL',
        value: String(pick.stake_units ?? 'null'),
      },
      'provenance-linked': {
        verdict: hasProvenance ? 'PASS' : 'FAIL',
        value: hasProvenance ? 'linked' : 'missing',
      },
      'CLV-backed': {
        verdict: !isSettled ? 'UNKNOWN' : hasClosing ? (latestClosingAgeHours != null && latestClosingAgeHours > 48 ? 'WARN' : 'PASS') : 'FAIL',
        value: hasClosing ? 'closing-line-found' : 'missing-closing-line',
      },
      'supported-market': {
        verdict: supportedMarket ? 'PASS' : 'FAIL',
        value: supportedMarket ? 'supported' : 'unsupported',
      },
      'settlement-valid': {
        verdict: isSettled ? (correctedSettlement ? 'WARN' : 'PASS') : 'FAIL',
        value: settlement ? `${settlement.status ?? 'null'}:${settlement.result ?? 'null'}` : 'missing',
      },
      'model-attributed': {
        verdict: modelId && (modelIds.size === 0 || modelIds.has(modelId)) ? 'PASS' : 'FAIL',
        value: modelId ?? 'null',
      },
      'source-separated': {
        verdict: source.verdict,
        value: source.canonical,
      },
      'queue-latency': {
        verdict: !queueApplies
          ? 'UNKNOWN'
          : queueLatencySeconds == null
            ? 'FAIL'
            : queueLatencySeconds < 30
              ? 'PASS'
              : queueLatencySeconds <= 300
                ? 'WARN'
                : 'FAIL',
        value: queueLatencySeconds == null ? 'null' : String(Number(queueLatencySeconds.toFixed(2))),
      },
      'posting-latency': {
        verdict: !firstOutbox
          ? 'UNKNOWN'
          : postingLatencySeconds == null
            ? firstOutbox.status === 'sent'
              ? 'FAIL'
              : 'UNKNOWN'
            : postingLatencySeconds < 300
              ? 'PASS'
              : postingLatencySeconds <= 1800
                ? 'WARN'
                : 'FAIL',
        value: postingLatencySeconds == null ? 'null' : String(Number(postingLatencySeconds.toFixed(2))),
      },
    };

    const rowVerdicts = Object.values(dimensions).map((dimension) => dimension.verdict);
    const rowVerdict: Verdict = rowVerdicts.includes('FAIL') || rowVerdicts.includes('UNKNOWN')
      ? 'FAIL'
      : rowVerdicts.includes('WARN')
        ? 'WARN'
        : 'PASS';

    return {
      pick,
      dimensions,
      queueLatencySeconds,
      postingLatencySeconds,
      rowVerdict,
    };
  });
}

function addExclusion(
  rows: ExclusionRow[],
  scored: ScoredPick,
  reason: string,
  dimension: string,
): void {
  const dimensionValue = scored.dimensions[dimension]?.value ?? 'system-fail';
  rows.push({
    pick_id: scored.pick.id,
    exclusion_reason: reason,
    dimension,
    dimension_value: dimensionValue,
    sport: scored.pick.sport_id ?? 'unknown',
    market_key: scored.pick.market ?? scored.pick.market_type_id ?? 'unknown',
    source_type: scored.pick.source ?? 'unknown',
    created_at: scored.pick.created_at,
  });
}

function buildExclusions(
  scored: ScoredPick[],
  systemDimensions: Record<string, JsonRecord>,
): { rows: ExclusionRow[]; counts: Record<string, number> } {
  const rows: ExclusionRow[] = [];
  for (const row of scored) {
    if (row.dimensions['stake-valid']?.verdict !== 'PASS') addExclusion(rows, row, 'no-stake', 'stake-valid');
    if (row.dimensions['provenance-linked']?.verdict !== 'PASS') addExclusion(rows, row, 'no-provenance', 'provenance-linked');
    if (row.dimensions['model-attributed']?.verdict !== 'PASS') addExclusion(rows, row, 'no-model-attribution', 'model-attributed');
    if (row.dimensions['source-separated']?.verdict === 'FAIL' || row.dimensions['source-separated']?.verdict === 'WARN') {
      addExclusion(rows, row, 'source-ambiguous', 'source-separated');
    }
    if (row.dimensions['supported-market']?.verdict !== 'PASS') addExclusion(rows, row, 'unsupported-market', 'supported-market');
    if (row.dimensions['settlement-valid']?.verdict === 'FAIL') addExclusion(rows, row, 'not-settled', 'settlement-valid');
    if (row.dimensions['CLV-backed']?.verdict !== 'PASS') addExclusion(rows, row, 'no-clv', 'CLV-backed');
    if (row.dimensions['CLV-backed']?.verdict === 'WARN') addExclusion(rows, row, 'stale-provider-offer', 'CLV-backed');
    if (['manual', 'heuristic'].includes((row.pick.source ?? '').toLowerCase())) {
      addExclusion(rows, row, 'manual-source', 'source-separated');
    }
    if (systemDimensions['scheduler_freshness']?.['verdict'] === 'FAIL') {
      addExclusion(rows, row, 'stale-scheduler', 'scheduler-freshness');
    }
    if (systemDimensions['candidate_materialization_freshness']?.['verdict'] === 'FAIL') {
      addExclusion(rows, row, 'stale-candidates', 'candidate-materialization-freshness');
    }
  }

  const counts = {
    no_stake: 0,
    no_provenance: 0,
    no_model_attribution: 0,
    source_ambiguous: 0,
    unsupported_market: 0,
    not_settled: 0,
    no_clv: 0,
    stale_provider_offer: 0,
    stale_scheduler: 0,
    stale_candidates: 0,
    manual_source: 0,
  };
  for (const row of rows) {
    const key = row.exclusion_reason.replaceAll('-', '_') as keyof typeof counts;
    if (key in counts) counts[key] += 1;
  }
  return { rows, counts };
}

function sampleVerdict(
  rows: ScoredPick[],
  requiredDimensions: readonly string[],
  systemRequired: readonly string[],
  systemDimensions: Record<string, JsonRecord>,
  strictWarn: boolean,
): SampleVerdict {
  if (rows.length < 10) return 'INSUFFICIENT';
  const systemVerdicts = systemRequired.map((name) => systemDimensions[name.replaceAll('-', '_')]?.['verdict']);
  if (systemVerdicts.includes('FAIL')) return 'FAIL';
  if (strictWarn && systemVerdicts.includes('WARN')) return 'FAIL';
  const passRows = rows.filter((row) =>
    requiredDimensions.every((dimension) => row.dimensions[dimension]?.verdict === 'PASS'),
  ).length;
  const rate = passRows / rows.length;
  if (rate >= 0.9) return systemVerdicts.includes('WARN') ? 'WARN' : 'PASS';
  if (rate >= 0.7) return 'WARN';
  return 'FAIL';
}

function dimensionStats(scored: ScoredPick[], systemDimensions: Record<string, JsonRecord>): string {
  const rows = [
    ['dimension', 'granularity', 'verdict', 'pass_count', 'warn_count', 'fail_count', 'unknown_count', 'pass_pct'],
  ];
  for (const dimension of DIMENSIONS) {
    if (dimension.granularity === 'system') {
      const key = dimension.name.replaceAll('-', '_');
      const verdict = String(systemDimensions[key]?.['verdict'] ?? 'UNKNOWN');
      rows.push([
        dimension.name,
        'system',
        verdict,
        verdict === 'PASS' ? '1' : '0',
        verdict === 'WARN' ? '1' : '0',
        verdict === 'FAIL' ? '1' : '0',
        verdict === 'UNKNOWN' ? '1' : '0',
        verdict === 'PASS' ? '100' : '0',
      ]);
      continue;
    }
    const verdicts = scored.map((row) => row.dimensions[dimension.name]?.verdict ?? 'UNKNOWN');
    const passCount = verdicts.filter((verdict) => verdict === 'PASS').length;
    const warnCount = verdicts.filter((verdict) => verdict === 'WARN').length;
    const failCount = verdicts.filter((verdict) => verdict === 'FAIL').length;
    const unknownCount = verdicts.filter((verdict) => verdict === 'UNKNOWN').length;
    const aggregate: Verdict =
      failCount + unknownCount > 0 ? 'FAIL' : warnCount > 0 ? 'WARN' : 'PASS';
    rows.push([
      dimension.name,
      'row',
      aggregate,
      String(passCount),
      String(warnCount),
      String(failCount),
      String(unknownCount),
      String(pct(passCount, scored.length)),
    ]);
  }
  return toCsv(rows);
}

function groupCsv(
  scored: ScoredPick[],
  keyFor: (row: ScoredPick) => string,
  columns: string[],
  metricFor: (rows: ScoredPick[]) => string[],
): string {
  const groups = new Map<string, ScoredPick[]>();
  for (const row of scored) {
    const key = keyFor(row);
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
  }
  const output = [columns];
  for (const [key, rows] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    output.push([key, String(rows.length), ...metricFor(rows)]);
  }
  if (output.length === 1) output.push(['none', '0', ...metricFor([])]);
  return toCsv(output);
}

function passPct(rows: ScoredPick[], dimension: string): string {
  return String(pct(rows.filter((row) => row.dimensions[dimension]?.verdict === 'PASS').length, rows.length));
}

function toCsv(rows: string[][]): string {
  return `${rows
    .map((row) =>
      row
        .map((cell) => {
          if (!/[",\n\r]/.test(cell)) return cell;
          return `"${cell.replaceAll('"', '""')}"`;
        })
        .join(','),
    )
    .join('\n')}\n`;
}

function writeOutputs(
  outDir: string,
  summary: JsonRecord,
  scored: ScoredPick[],
  exclusions: ExclusionRow[],
  systemDimensions: Record<string, JsonRecord>,
): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'truthworthiness-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'truthworthiness-by-dimension.csv'), dimensionStats(scored, systemDimensions));
  fs.writeFileSync(
    path.join(outDir, 'truthworthiness-by-sport.csv'),
    groupCsv(
      scored,
      (row) => row.pick.sport_id ?? 'unknown',
      [
        'sport',
        'total_rows',
        'trusted_pass',
        'untrusted_fail',
        'stake_valid_pct',
        'provenance_linked_pct',
        'clv_backed_pct',
        'settlement_valid_pct',
        'model_attributed_pct',
      ],
      (rows) => [
        String(rows.filter((row) => row.rowVerdict === 'PASS').length),
        String(rows.filter((row) => row.rowVerdict === 'FAIL').length),
        passPct(rows, 'stake-valid'),
        passPct(rows, 'provenance-linked'),
        passPct(rows, 'CLV-backed'),
        passPct(rows, 'settlement-valid'),
        passPct(rows, 'model-attributed'),
      ],
    ),
  );
  fs.writeFileSync(
    path.join(outDir, 'truthworthiness-by-market-family.csv'),
    groupCsv(
      scored,
      (row) => row.pick.market_type_id ?? row.pick.market ?? 'unknown',
      [
        'market_family',
        'total_rows',
        'trusted_pass',
        'supported_market_pct',
        'clv_backed_pct',
        'settlement_valid_pct',
      ],
      (rows) => [
        String(rows.filter((row) => row.rowVerdict === 'PASS').length),
        passPct(rows, 'supported-market'),
        passPct(rows, 'CLV-backed'),
        passPct(rows, 'settlement-valid'),
      ],
    ),
  );
  fs.writeFileSync(
    path.join(outDir, 'truthworthiness-by-source-type.csv'),
    groupCsv(
      scored,
      (row) => canonicalSource(row.pick.source).canonical,
      [
        'source_type',
        'total_rows',
        'trusted_pass',
        'model_attributed_pct',
        'source_separated_pct',
      ],
      (rows) => [
        String(rows.filter((row) => row.rowVerdict === 'PASS').length),
        passPct(rows, 'model-attributed'),
        passPct(rows, 'source-separated'),
      ],
    ),
  );
  fs.writeFileSync(
    path.join(outDir, 'truthworthiness-exclusions.csv'),
    toCsv([
      ['pick_id', 'exclusion_reason', 'dimension', 'dimension_value', 'sport', 'market_key', 'source_type', 'created_at'],
      ...exclusions.map((row) => [
        row.pick_id,
        row.exclusion_reason,
        row.dimension,
        row.dimension_value,
        row.sport,
        row.market_key,
        row.source_type,
        row.created_at,
      ]),
    ]),
  );

  const sampleVerdicts = summary['sample_verdicts'] as Record<string, string>;
  const topReasons = Object.entries(summary['exclusion_counts'] as Record<string, number>)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 3);
  fs.writeFileSync(
    path.join(outDir, 'README.md'),
    [
      '# Evidence Truthworthiness Report',
      '',
      `Generated: ${String(summary['generated_at'])}`,
      `Evaluation window: ${(summary['evaluation_window'] as JsonRecord)['from']} to ${(summary['evaluation_window'] as JsonRecord)['to']} (${(summary['evaluation_window'] as JsonRecord)['days']} days)`,
      `System verdict: ${summary['system_verdict']} - runtime and evidence dimensions are separated in the machine-readable summary.`,
      '',
      '| Sample | Verdict |',
      '|---|---|',
      ...Object.entries(sampleVerdicts).map(([sample, verdict]) => `| ${sample} | ${verdict} |`),
      '',
      'Top exclusion reasons:',
      ...topReasons.map(([reason, count]) => `- ${reason}: ${count}`),
      '',
      'A truthworthiness PASS permits evaluation; it does not prove model edge.',
      '',
    ].join('\n'),
  );
}

export async function runEvidenceTruthworthiness(options: RunOptions = {}): Promise<JsonRecord> {
  const days = options.days ?? 30;
  const now = options.now ?? new Date();
  const from = new Date(now.getTime() - days * 24 * 60 * 60000);
  const outDir = options.outDir ?? REQUIRED_OUTPUT_DIR;
  const data =
    options.data ??
    (await fetchLiveData(options.client ?? createDatabaseClient({ useServiceRole: true }), iso(from)));

  const systemDimensions = buildSystemDimensions(data, now);
  const scored = scorePicks(data, now);
  const { rows: exclusions, counts: exclusionCounts } = buildExclusions(scored, systemDimensions);
  const systemVerdict = getSystemVerdict(systemDimensions);
  const summary: JsonRecord = {
    schema_version: 1,
    generated_at: iso(now),
    evaluation_window: {
      from: iso(from),
      to: iso(now),
      days,
    },
    system_verdict: systemVerdict,
    system_dimensions: systemDimensions,
    row_counts: {
      total_analyzed: scored.length,
      trusted_pass: scored.filter((row) => row.rowVerdict === 'PASS').length,
      trusted_warn: scored.filter((row) => row.rowVerdict === 'WARN').length,
      untrusted_fail: scored.filter((row) => row.rowVerdict === 'FAIL').length,
      unknown: scored.filter((row) =>
        Object.values(row.dimensions).some((dimension) => dimension.verdict === 'UNKNOWN'),
      ).length,
    },
    dimension_pass_rates: {
      stake_valid_pct: Number(passPct(scored, 'stake-valid')),
      provenance_linked_pct: Number(passPct(scored, 'provenance-linked')),
      clv_backed_pct: Number(passPct(scored, 'CLV-backed')),
      supported_market_pct: Number(passPct(scored, 'supported-market')),
      settlement_valid_pct: Number(passPct(scored, 'settlement-valid')),
      model_attributed_pct: Number(passPct(scored, 'model-attributed')),
      source_separated_pct: Number(passPct(scored, 'source-separated')),
    },
    latency: {
      avg_queue_latency_seconds: avg(scored.map((row) => row.queueLatencySeconds)),
      avg_posting_latency_seconds: avg(scored.map((row) => row.postingLatencySeconds)),
    },
    exclusion_counts: exclusionCounts,
    sample_verdicts: {
      trusted_roi_sample: sampleVerdict(
        scored,
        SAMPLE_DIMENSIONS.trusted_roi_sample,
        SYSTEM_REQUIREMENTS.trusted_roi_sample,
        systemDimensions,
        false,
      ),
      trusted_clv_sample: sampleVerdict(
        scored,
        SAMPLE_DIMENSIONS.trusted_clv_sample,
        SYSTEM_REQUIREMENTS.trusted_clv_sample,
        systemDimensions,
        false,
      ),
      trusted_model_edge_sample: sampleVerdict(
        scored,
        SAMPLE_DIMENSIONS.trusted_model_edge_sample,
        SYSTEM_REQUIREMENTS.trusted_model_edge_sample,
        systemDimensions,
        false,
      ),
      trusted_production_readiness_sample: sampleVerdict(
        scored,
        SAMPLE_DIMENSIONS.trusted_production_readiness_sample,
        SYSTEM_REQUIREMENTS.trusted_production_readiness_sample,
        systemDimensions,
        false,
      ),
      trusted_syndicate_readiness_sample: sampleVerdict(
        scored,
        SAMPLE_DIMENSIONS.trusted_syndicate_readiness_sample,
        SYSTEM_REQUIREMENTS.trusted_syndicate_readiness_sample,
        systemDimensions,
        true,
      ),
    },
    schema_notes: data.schemaNotes,
  };

  writeOutputs(outDir, summary, scored, exclusions, systemDimensions);

  for (const file of OUTPUT_FILES) {
    const outputPath = path.join(outDir, file);
    if (!fs.existsSync(outputPath)) {
      throw new Error(`required output file was not written: ${outputPath}`);
    }
  }

  return summary;
}

function isCli(): boolean {
  return process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCli()) {
  const { days } = parseArgs(process.argv.slice(2));
  runEvidenceTruthworthiness({ days }).then((summary) => {
    process.stdout.write(
      `Evidence truthworthiness report written to ${REQUIRED_OUTPUT_DIR} with system_verdict=${String(summary['system_verdict'])}\n`,
    );
  }).catch((error: unknown) => {
    process.stderr.write(`Evidence truthworthiness scoring failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
