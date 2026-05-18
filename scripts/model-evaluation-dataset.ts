import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { loadEnvironment as getConfig } from '@unit-talk/config';
import { createDatabaseClientFromConnection, createServiceRoleDatabaseConnectionConfig } from '@unit-talk/db';

type JsonRecord = Record<string, unknown>;

interface SettlementRecordRow extends JsonRecord {
  clv?: unknown;
  payload?: unknown;
  result?: unknown;
  settled_at?: unknown;
}

interface PickQueryRow extends JsonRecord {
  band?: unknown;
  clv?: unknown;
  confidence?: unknown;
  created_at?: unknown;
  market?: unknown;
  metadata?: unknown;
  odds?: unknown;
  settlement_records?: unknown;
  sport?: unknown;
  sport_id?: unknown;
  stake_units?: unknown;
}

interface PickRow {
  odds: number | null;
  clv: number | null;
  result: string | null;
  confidence: number | null;
  edge: number | null;
  trust: number | null;
  readiness: number | null;
  uniqueness: number | null;
  boardFit: number | null;
  market: string | null;
  sport: string | null;
  stake_units: number | null;
  band: string | null;
  edge_source: string | null;
  edge_method: string | null;
  real_edge: boolean;
  confidence_proxy: boolean;
  null_scores: boolean;
  null_band: boolean;
}

interface SampleCounts {
  total: number;
  real_edge: number;
  confidence_proxy: number;
  null_scores: number;
  null_band: number;
}

const OUTPUT_PATH = 'artifacts/model-evaluation-dataset.json';

const columns: Array<keyof PickRow> = [
  'odds',
  'clv',
  'result',
  'confidence',
  'edge',
  'trust',
  'readiness',
  'uniqueness',
  'boardFit',
  'market',
  'sport',
  'stake_units',
  'band',
  'edge_source',
  'edge_method',
  'real_edge',
  'confidence_proxy',
  'null_scores',
  'null_band',
];

async function main() {
  const after = parseAfterArg(process.argv.slice(2));
  const config = getConfig();

  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  const connection = createServiceRoleDatabaseConnectionConfig(config as Parameters<typeof createServiceRoleDatabaseConnectionConfig>[0]);
  const supabase = createDatabaseClientFromConnection(connection);

  let query = supabase
    .from('picks')
    .select('*, settlement_records!inner(*)')
    .not('settlement_records.settled_at', 'is', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .order('settled_at', {
      foreignTable: 'settlement_records',
      ascending: true,
    });

  if (after) {
    query = query.gte('created_at', after);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to query settled picks: ${error.message}`);
  }

  const rows = (data ?? []).flatMap((pick) => {
    const pickRow = pick as PickQueryRow;
    return getSettlementRecords(pickRow).map((settlement) =>
      toPickRow(pickRow, settlement),
    );
  });
  const sample_counts = countSamples(rows);

  console.log('columns:', columns);
  console.log('sample_counts:', sample_counts);

  const dataset = {
    generated_at: new Date().toISOString(),
    filters: after ? { after } : {},
    columns,
    rows,
    sample_counts,
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(
    `${OUTPUT_PATH}`,
    `${JSON.stringify(dataset, null, 2)}\n`,
    'utf8',
  );
}

function parseAfterArg(args: string[]) {
  const afterArg = args.find((arg) => arg.startsWith('--after='));
  if (!afterArg) {
    return undefined;
  }

  const after = afterArg.slice('--after='.length).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(after) || Number.isNaN(Date.parse(after))) {
    throw new Error('--after must be formatted as YYYY-MM-DD.');
  }

  return after;
}

function toPickRow(
  pick: PickQueryRow,
  settlement: SettlementRecordRow,
): PickRow {
  const metadata = asRecord(pick.metadata);
  const promotionScores = asRecord(metadata?.promotionScores);
  const domainAnalysis = asRecord(metadata?.domainAnalysis);
  const edgeSource =
    toNullableString(metadata?.edgeSource) ??
    toNullableString(domainAnalysis?.edgeSource);
  const domainEdgeSource = toNullableString(domainAnalysis?.edgeSource);
  const edgeMethod =
    toNullableString(metadata?.edgeMethod) ??
    toNullableString(domainAnalysis?.edgeMethod);
  const nullScores = promotionScores === null;
  const band = toNullableString(pick.band);

  return {
    odds: toNullableNumber(pick.odds),
    clv:
      toNullableNumber(pick.clv) ??
      toNullableNumber(settlement.clv) ??
      toNullableNumber(asRecord(settlement.payload)?.clv),
    result: toNullableString(settlement.result),
    confidence:
      toNullableNumber(pick.confidence) ??
      toNullableNumber(metadata?.confidence),
    edge: toNullableNumber(promotionScores?.edge),
    trust: toNullableNumber(promotionScores?.trust),
    readiness: toNullableNumber(promotionScores?.readiness),
    uniqueness: toNullableNumber(promotionScores?.uniqueness),
    boardFit: toNullableNumber(promotionScores?.boardFit),
    market: toNullableString(pick.market),
    sport: toNullableString(pick.sport) ?? toNullableString(pick.sport_id),
    stake_units: toNullableNumber(pick.stake_units),
    band,
    edge_source: edgeSource,
    edge_method: edgeMethod,
    real_edge:
      edgeSource !== null &&
      edgeSource !== 'confidence-proxy' &&
      (domainEdgeSource === 'domain-analysis-v1' ||
        edgeSource === 'domain-analysis-v1'),
    confidence_proxy: edgeSource === 'confidence-proxy' || edgeSource === null,
    null_scores: nullScores,
    null_band: band === null,
  };
}

function getSettlementRecords(row: PickQueryRow): SettlementRecordRow[] {
  const settlements = row.settlement_records;
  if (Array.isArray(settlements)) {
    return settlements
      .filter(isRecord)
      .map((settlement) => settlement as SettlementRecordRow);
  }

  if (isRecord(settlements)) {
    return [settlements as SettlementRecordRow];
  }

  return [];
}

function countSamples(rows: PickRow[]): SampleCounts {
  return rows.reduce<SampleCounts>(
    (counts, row) => ({
      total: counts.total + 1,
      real_edge: counts.real_edge + Number(row.real_edge),
      confidence_proxy: counts.confidence_proxy + Number(row.confidence_proxy),
      null_scores: counts.null_scores + Number(row.null_scores),
      null_band: counts.null_band + Number(row.null_band),
    }),
    {
      total: 0,
      real_edge: 0,
      confidence_proxy: 0,
      null_scores: 0,
      null_band: 0,
    },
  );
}

function asRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
