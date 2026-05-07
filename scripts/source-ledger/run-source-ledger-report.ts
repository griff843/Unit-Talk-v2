import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDatabaseClient,
  type UnitTalkSupabaseClient,
} from '@unit-talk/db';

type JsonRecord = Record<string, unknown>;
type SourceClass =
  | 'manual'
  | 'heuristic'
  | 'model_generated'
  | 'shadow'
  | 'operator_edited'
  | 'unsupported_market'
  | 'replay'
  | 'synthetic'
  | 'imported_historical'
  | 'UNKNOWN';

interface PickInput {
  id: string;
  created_at: string;
  source: string | null;
  sport_id: string | null;
  market: string | null;
  market_key: string | null;
  market_type_id: string | null;
  metadata: JsonRecord | null;
  submission_id: string | null;
}

interface CandidateInput {
  id: string;
  pick_id: string | null;
  scan_run_id: string | null;
  universe_id: string | null;
  provenance: JsonRecord | null;
  shadow_mode: boolean | null;
  is_board_candidate: boolean | null;
  model_score: number | null;
  model_tier: string | null;
  model_confidence: number | null;
  sport_key: string | null;
  market_key: string | null;
}

interface MarketUniverseInput {
  id: string;
  canonical_market_key: string | null;
  provider_market_key: string | null;
  market_type_id: string | null;
  sport_key: string | null;
}

interface ModelRegistryInput {
  id: string;
}

interface SchemaTable {
  exists: boolean;
  columns: Record<string, boolean>;
  error: string | null;
}

interface SchemaInspection {
  picks: SchemaTable;
  pick_candidates: SchemaTable;
  market_universe: SchemaTable;
  model_registry: SchemaTable;
  sourceHasCheckConstraint: boolean;
  candidateModelColumns: string[];
}

interface LiveData {
  picks: PickInput[];
  candidates: CandidateInput[];
  marketUniverse: MarketUniverseInput[];
  modelRegistry: ModelRegistryInput[];
  distinctSources: Array<{ source: string | null; count: number }>;
  schema: SchemaInspection;
}

interface RunOptions {
  days?: number;
  outDir?: string;
  now?: Date;
  data?: LiveData;
  client?: UnitTalkSupabaseClient;
}

interface ScoredPick {
  pick: PickInput;
  candidate: CandidateInput | null;
  rawSource: string;
  sourceClass: SourceClass;
  candidateJoinExists: boolean;
  modelRefInProvenance: boolean | null;
  modelRefResolvable: boolean;
  unsupportedMarket: boolean;
  legacySource: boolean;
  sport: string;
  marketKey: string;
  marketFamily: string;
}

interface ExclusionRow {
  pick_id: string;
  raw_source_value: string;
  assigned_source_class: SourceClass;
  exclusion_reason: string;
  excluded_from: string;
  sport: string;
  market_key: string;
  created_at: string;
}

const REQUIRED_OUTPUT_DIR = path.join('docs', '06_status', 'proof', 'UTV2-849');

const OUTPUT_FILES = [
  'source-ledger-summary.json',
  'source-ledger-by-type.csv',
  'source-ledger-contamination.csv',
  'source-ledger-exclusions.csv',
  'source-ledger-by-sport.csv',
  'source-ledger-by-market-family.csv',
  'README.md',
  'evidence.json',
] as const;

const SOURCE_CLASSES: SourceClass[] = [
  'manual',
  'heuristic',
  'model_generated',
  'shadow',
  'operator_edited',
  'unsupported_market',
  'replay',
  'synthetic',
  'imported_historical',
  'UNKNOWN',
];

const UTV2_848_CANONICAL = new Set([
  'user-submitted',
  'system-scanner',
  'board-construction',
  'manual',
  'heuristic',
  'operator-edited',
]);

const KNOWN_LEGACY_MAPPINGS = new Map<string, SourceClass>([
  ['system-pick-scanner', 'heuristic'],
  ['smart-form', 'manual'],
  ['api', 'manual'],
  ['human', 'manual'],
  ['canary-proof', 'synthetic'],
  ['imported-historical', 'imported_historical'],
  ['shadow', 'shadow'],
  ['replay', 'replay'],
  ['synthetic', 'synthetic'],
  ['unsupported-market', 'unsupported_market'],
]);

const MODEL_REFERENCE_KEYS = [
  'model_id',
  'modelId',
  'model_registry_id',
  'modelRegistryId',
  'model_or_heuristic_id',
  'modelOrHeuristicId',
];

const PICK_COLUMNS = [
  'id',
  'created_at',
  'source',
  'sport_id',
  'market',
  'market_key',
  'market_type_id',
  'metadata',
  'submission_id',
];

const CANDIDATE_COLUMNS = [
  'id',
  'pick_id',
  'scan_run_id',
  'universe_id',
  'provenance',
  'shadow_mode',
  'is_board_candidate',
  'model_score',
  'model_tier',
  'model_confidence',
  'sport_key',
  'market_key',
];

const MARKET_UNIVERSE_COLUMNS = [
  'id',
  'canonical_market_key',
  'provider_market_key',
  'market_type_id',
  'sport_key',
];

function parseArgs(argv: string[]): { days: number } {
  let days = 30;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--days') continue;
    const value = Number(argv[index + 1]);
    if (!Number.isInteger(value) || value <= 0) throw new Error('--days must be a positive integer');
    days = value;
    index += 1;
  }
  return { days };
}

function iso(date: Date): string {
  return date.toISOString();
}

function pct(count: number, total: number): number {
  if (total === 0) return 0;
  return Number(((count / total) * 100).toFixed(2));
}

function csvEscape(cell: string): string {
  if (!/[",\n\r]/.test(cell)) return cell;
  return `"${cell.replaceAll('"', '""')}"`;
}

function toCsv(rows: string[][]): string {
  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
}

function normalizeSource(source: string | null): string {
  return source?.trim().toLowerCase() || 'UNKNOWN';
}

function valueString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function jsonRecord(value: unknown): JsonRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function modelReference(provenance: JsonRecord | null): string | null {
  const record = jsonRecord(provenance);
  for (const key of MODEL_REFERENCE_KEYS) {
    const value = valueString(record[key]);
    if (value) return value;
  }
  return null;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

async function probeTable(
  client: UnitTalkSupabaseClient,
  table: string,
  columns: string[],
): Promise<SchemaTable> {
  const present: Record<string, boolean> = {};
  let tableExists = true;
  let tableError: string | null = null;
  for (const column of columns) {
    const { error } = await client.from(table).select(column).limit(1);
    if (error) {
      present[column] = false;
      tableError ??= error.message;
      if (/could not find the table|relation .* does not exist/i.test(error.message)) tableExists = false;
    } else {
      present[column] = true;
    }
  }
  return { exists: tableExists, columns: present, error: tableError };
}

async function fetchAll<T>(
  client: UnitTalkSupabaseClient,
  table: string,
  select: string,
  configure: (query: ReturnType<UnitTalkSupabaseClient['from']>) => ReturnType<UnitTalkSupabaseClient['from']>,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = client.from(table).select(select).range(from, from + pageSize - 1);
    query = configure(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table} query failed: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function selectRowsInBatches<T>(
  client: UnitTalkSupabaseClient,
  table: string,
  select: string,
  column: string,
  values: string[],
): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < values.length; index += 200) {
    const { data, error } = await client.from(table).select(select).in(column, values.slice(index, index + 200));
    if (error) throw new Error(`${table} query failed: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
  }
  return rows;
}

function migrationText(): string {
  const migrationDir = path.resolve('supabase', 'migrations');
  if (!fs.existsSync(migrationDir)) return '';
  return fs
    .readdirSync(migrationDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => fs.readFileSync(path.join(migrationDir, file), 'utf8'))
    .join('\n')
    .toLowerCase();
}

async function inspectSchema(client: UnitTalkSupabaseClient): Promise<SchemaInspection> {
  const [picks, pickCandidates, marketUniverse, modelRegistry] = await Promise.all([
    probeTable(client, 'picks', PICK_COLUMNS),
    probeTable(client, 'pick_candidates', CANDIDATE_COLUMNS),
    probeTable(client, 'market_universe', MARKET_UNIVERSE_COLUMNS),
    probeTable(client, 'model_registry', ['id']),
  ]);

  if (!picks.columns['source']) throw new Error(`stop condition: picks.source column unavailable: ${picks.error ?? 'missing'}`);
  if (!pickCandidates.exists) throw new Error(`stop condition: pick_candidates table unavailable: ${pickCandidates.error ?? 'missing'}`);
  if (!marketUniverse.exists) throw new Error(`stop condition: market_universe table unavailable: ${marketUniverse.error ?? 'missing'}`);

  const text = migrationText();
  return {
    picks,
    pick_candidates: pickCandidates,
    market_universe: marketUniverse,
    model_registry: modelRegistry,
    sourceHasCheckConstraint: /check\s*\([^)]*source[^)]*\)/.test(text),
    candidateModelColumns: CANDIDATE_COLUMNS.filter((column) => column.includes('model') && pickCandidates.columns[column]),
  };
}

async function fetchLiveData(client: UnitTalkSupabaseClient, fromIso: string): Promise<LiveData> {
  const schema = await inspectSchema(client);
  const pickSelect = PICK_COLUMNS.filter((column) => schema.picks.columns[column]).join(',');
  const candidateSelect = CANDIDATE_COLUMNS.filter((column) => schema.pick_candidates.columns[column]).join(',');
  const marketUniverseSelect = MARKET_UNIVERSE_COLUMNS
    .filter((column) => schema.market_universe.columns[column])
    .join(',');

  const picks = await fetchAll<PickInput>(
    client,
    'picks',
    pickSelect,
    (query) => query.gte('created_at', fromIso).order('created_at', { ascending: true }),
  );
  const pickIds = picks.map((pick) => pick.id);
  const [candidates, marketUniverse, modelRegistry] = await Promise.all([
    pickIds.length ? selectRowsInBatches<CandidateInput>(client, 'pick_candidates', candidateSelect, 'pick_id', pickIds) : [],
    fetchAll<MarketUniverseInput>(
      client,
      'market_universe',
      marketUniverseSelect,
      (query) => query.order('id', { ascending: true }),
    ),
    schema.model_registry.exists
      ? fetchAll<ModelRegistryInput>(client, 'model_registry', 'id', (query) => query.order('id', { ascending: true }))
      : [],
  ]);

  const sourceCounts = new Map<string | null, number>();
  for (const pick of picks) sourceCounts.set(pick.source, (sourceCounts.get(pick.source) ?? 0) + 1);

  return {
    picks,
    candidates,
    marketUniverse,
    modelRegistry,
    distinctSources: [...sourceCounts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((left, right) => right.count - left.count || String(left.source).localeCompare(String(right.source))),
    schema,
  };
}

function marketFamily(pick: PickInput, candidate: CandidateInput | null): string {
  return pick.market_type_id ?? pick.market_key ?? pick.market ?? candidate?.market_key ?? 'unknown';
}

function isMarketSupported(
  pick: PickInput,
  candidate: CandidateInput | null,
  universeById: Map<string, MarketUniverseInput>,
  supportedKeys: Set<string>,
): boolean {
  if (candidate?.universe_id && universeById.has(candidate.universe_id)) return true;
  return [pick.market_key, pick.market, pick.market_type_id, candidate?.market_key]
    .filter((value): value is string => Boolean(value))
    .some((value) => supportedKeys.has(value));
}

function classifyBaseSource(
  rawSource: string,
  candidate: CandidateInput | null,
  modelRefResolvable: boolean,
): SourceClass {
  if (rawSource === 'UNKNOWN') return 'UNKNOWN';
  if (candidate?.shadow_mode === true || rawSource === 'shadow') return 'shadow';
  if (rawSource === 'replay') return 'replay';
  if (rawSource === 'synthetic' || rawSource === 'canary-proof') return 'synthetic';
  if (rawSource === 'imported-historical') return 'imported_historical';
  if (rawSource === 'operator-edited') return 'operator_edited';
  if (rawSource === 'manual' || rawSource === 'user-submitted' || rawSource === 'smart-form' || rawSource === 'human' || rawSource === 'api') {
    return 'manual';
  }
  if (rawSource === 'heuristic') return 'heuristic';
  if (rawSource === 'system-scanner' || rawSource === 'board-construction' || rawSource === 'system-pick-scanner') {
    if ((rawSource === 'system-scanner' || rawSource === 'board-construction') && candidate && modelRefResolvable) {
      return 'model_generated';
    }
    return candidate || rawSource === 'system-pick-scanner' || rawSource === 'board-construction' ? 'heuristic' : 'UNKNOWN';
  }
  return KNOWN_LEGACY_MAPPINGS.get(rawSource) ?? 'UNKNOWN';
}

function scorePicks(data: LiveData): ScoredPick[] {
  const candidatesByPick = new Map<string, CandidateInput[]>();
  for (const candidate of data.candidates) {
    if (!candidate.pick_id) continue;
    candidatesByPick.set(candidate.pick_id, [...(candidatesByPick.get(candidate.pick_id) ?? []), candidate]);
  }
  const universeById = new Map(data.marketUniverse.map((row) => [row.id, row]));
  const supportedKeys = new Set<string>();
  for (const row of data.marketUniverse) {
    for (const key of [row.id, row.canonical_market_key, row.provider_market_key, row.market_type_id]) {
      if (key) supportedKeys.add(key);
    }
  }
  const modelIds = new Set(data.modelRegistry.map((row) => row.id));

  return data.picks.map((pick) => {
    const candidate = (candidatesByPick.get(pick.id) ?? [])[0] ?? null;
    const rawSource = normalizeSource(pick.source);
    const modelRef = modelReference(candidate?.provenance ?? null);
    const modelRefResolvable = Boolean(modelRef && modelIds.has(modelRef));
    const sourceClass = classifyBaseSource(rawSource, candidate, modelRefResolvable);
    const supported = isMarketSupported(pick, candidate, universeById, supportedKeys);
    const marketKey = pick.market_key ?? pick.market ?? candidate?.market_key ?? 'unknown';
    return {
      pick,
      candidate,
      rawSource,
      sourceClass,
      candidateJoinExists: Boolean(candidate),
      modelRefInProvenance: candidate ? Boolean(modelRef) : null,
      modelRefResolvable,
      unsupportedMarket: !supported,
      legacySource: rawSource !== 'UNKNOWN' && !UTV2_848_CANONICAL.has(rawSource),
      sport: pick.sport_id ?? candidate?.sport_key ?? 'unknown',
      marketKey,
      marketFamily: marketFamily(pick, candidate),
    };
  });
}

function reasonFor(row: ScoredPick, sample: string): string {
  if (row.unsupportedMarket && sample !== 'roi') return 'unsupported_market';
  if (row.sourceClass === 'manual') return 'manual_source';
  if (row.sourceClass === 'heuristic') return 'heuristic_source';
  if (row.sourceClass === 'shadow') return 'shadow_mode';
  if (row.sourceClass === 'operator_edited') return 'operator_edited';
  if (row.sourceClass === 'replay') return 'replay';
  if (row.sourceClass === 'synthetic') return 'synthetic';
  if (row.sourceClass === 'imported_historical') return 'imported_historical';
  if (row.sourceClass === 'unsupported_market' || row.unsupportedMarket) return 'unsupported_market';
  return 'unknown_source';
}

function eligible(row: ScoredPick, sample: string): boolean {
  if (sample === 'model_edge') return row.sourceClass === 'model_generated' && !row.unsupportedMarket;
  if (sample === 'clv') return (row.sourceClass === 'model_generated' || row.sourceClass === 'heuristic') && !row.unsupportedMarket;
  if (sample === 'roi') return ['model_generated', 'heuristic', 'manual', 'operator_edited', 'imported_historical'].includes(row.sourceClass);
  if (sample === 'prod_readiness') return ['model_generated', 'heuristic', 'manual', 'operator_edited'].includes(row.sourceClass) && !row.unsupportedMarket;
  if (sample === 'syndicate') return row.sourceClass === 'model_generated' && !row.unsupportedMarket;
  return false;
}

function buildExclusions(scored: ScoredPick[]): { rows: ExclusionRow[]; counts: Record<string, number> } {
  const counts = Object.fromEntries([
    'shadow_mode',
    'replay',
    'synthetic',
    'unsupported_market',
    'manual_source',
    'heuristic_source',
    'operator_edited',
    'unknown_source',
    'legacy_source',
    'imported_historical',
  ].map((key) => [key, 0])) as Record<string, number>;
  const rows: ExclusionRow[] = [];
  for (const row of scored) {
    for (const sample of ['model_edge', 'clv', 'syndicate', 'roi', 'prod_readiness']) {
      if (eligible(row, sample)) continue;
      const reason = reasonFor(row, sample);
      counts[reason] += 1;
      if (row.legacySource) counts['legacy_source'] += 1;
      rows.push({
        pick_id: row.pick.id,
        raw_source_value: row.rawSource,
        assigned_source_class: row.sourceClass,
        exclusion_reason: reason,
        excluded_from: sample,
        sport: row.sport,
        market_key: row.marketKey,
        created_at: row.pick.created_at,
      });
    }
  }
  return { rows, counts };
}

function contaminationSeverity(value: number): string {
  if (value === 0) return 'clean';
  if (value <= 5) return 'minor';
  if (value <= 20) return 'significant';
  return 'major';
}

function contaminationRows(scored: ScoredPick[]): string[][] {
  const samples = [
    { sample: 'model_edge', intended: 'model_generated', ok: (row: ScoredPick) => row.sourceClass === 'model_generated' && !row.unsupportedMarket },
    { sample: 'roi', intended: 'model_generated+heuristic+manual', ok: (row: ScoredPick) => eligible(row, 'roi') },
    { sample: 'clv', intended: 'model_generated+heuristic', ok: (row: ScoredPick) => eligible(row, 'clv') },
  ];
  const output = [['sample_type', 'intended_source_class', 'contaminating_source_class', 'contamination_count', 'contamination_pct', 'severity']];
  for (const sample of samples) {
    const counts = new Map<string, number>();
    for (const row of scored) {
      if (sample.ok(row)) continue;
      const key = row.unsupportedMarket ? 'unsupported_market' : row.sourceClass;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [sourceClass, count] of [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const contaminationPct = pct(count, scored.length);
      output.push([sample.sample, sample.intended, sourceClass, String(count), String(contaminationPct), contaminationSeverity(contaminationPct)]);
    }
    if (counts.size === 0) output.push([sample.sample, sample.intended, 'none', '0', '0', 'clean']);
  }
  return output;
}

function groupBy(
  scored: ScoredPick[],
  keyFor: (row: ScoredPick) => string,
  header: string[],
): string {
  const groups = new Map<string, ScoredPick[]>();
  for (const row of scored) groups.set(keyFor(row), [...(groups.get(keyFor(row)) ?? []), row]);
  const output = [header];
  for (const [key, rows] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    output.push([
      key,
      String(rows.length),
      String(pct(rows.filter((row) => row.sourceClass === 'model_generated').length, rows.length)),
      String(pct(rows.filter((row) => row.sourceClass === 'heuristic').length, rows.length)),
      String(pct(rows.filter((row) => row.sourceClass === 'manual').length, rows.length)),
      String(pct(rows.filter((row) => row.sourceClass === 'UNKNOWN').length, rows.length)),
      String(pct(rows.filter((row) => row.unsupportedMarket).length, rows.length)),
    ]);
  }
  if (output.length === 1) output.push(['none', '0', '0', '0', '0', '0', '0']);
  return toCsv(output);
}

function sourceCounts(scored: ScoredPick[]): Record<string, number> {
  return Object.fromEntries(SOURCE_CLASSES.map((sourceClass) => [
    sourceClass === 'UNKNOWN' ? 'unknown' : sourceClass,
    sourceClass === 'unsupported_market'
      ? scored.filter((row) => row.unsupportedMarket || row.sourceClass === 'unsupported_market').length
      : scored.filter((row) => row.sourceClass === sourceClass).length,
  ]));
}

function buildSummary(
  data: LiveData,
  scored: ScoredPick[],
  exclusions: ExclusionRow[],
  exclusionCounts: Record<string, number>,
  now: Date,
  from: Date,
  days: number,
): JsonRecord {
  const total = scored.length;
  const counts = sourceCounts(scored);
  const modelGenerated = scored.filter((row) => row.sourceClass === 'model_generated').length;
  const heuristic = scored.filter((row) => row.sourceClass === 'heuristic').length;
  const manual = scored.filter((row) => row.sourceClass === 'manual').length;
  const shadow = scored.filter((row) => row.sourceClass === 'shadow').length;
  const unknown = scored.filter((row) => row.sourceClass === 'UNKNOWN').length;
  const unsupported = scored.filter((row) => row.unsupportedMarket).length;
  const modelEdgeEligible = scored.filter((row) => eligible(row, 'model_edge')).length;
  const prodEligible = scored.filter((row) => eligible(row, 'prod_readiness')).length;
  const syndicateEligible = scored.filter((row) => eligible(row, 'syndicate')).length;
  const contaminationCount = scored.filter((row) => !eligible(row, 'model_edge')).length;
  const distinctSourceValues = data.distinctSources.map((row) => ({
    source: row.source,
    count: row.count,
  }));
  const legacyValues = uniqueSorted(
    data.distinctSources
      .map((row) => normalizeSource(row.source))
      .filter((source) => source !== 'UNKNOWN' && !UTV2_848_CANONICAL.has(source)),
  );

  return {
    schema_version: 1,
    generated_at: iso(now),
    evaluation_window: { from: iso(from), to: iso(now), days },
    system_verdict: contaminationCount > 0 || modelGenerated === 0 ? 'FAIL' : 'PASS',
    verdict_reason: modelGenerated === 0
      ? 'No rows have resolvable model registry attribution; model-edge and syndicate samples remain fully blocked.'
      : 'Source classes were measured read-only with contamination reported separately.',
    row_counts: {
      total_analyzed: total,
      source_pass: modelGenerated,
      source_warn: heuristic + manual + scored.filter((row) => row.sourceClass === 'operator_edited').length,
      source_fail: scored.filter((row) => ['shadow', 'replay', 'synthetic', 'unsupported_market'].includes(row.sourceClass)).length,
      source_unknown: unknown,
    },
    source_class_counts: {
      ...counts,
      legacy_mapped: scored.filter((row) => row.legacySource && row.sourceClass !== 'UNKNOWN').length,
    },
    source_metrics: {
      source_separated_pct: pct(scored.filter((row) => row.sourceClass !== 'UNKNOWN').length, total),
      model_only_pct: pct(modelGenerated, total),
      model_generated_pct: pct(modelGenerated, total),
      heuristic_pct: pct(heuristic, total),
      manual_pct: pct(manual, total),
      shadow_pct: pct(shadow, total),
      unsupported_pct: pct(unsupported, total),
      unknown_pct: pct(unknown, total),
      heuristic_contamination_pct: pct(heuristic, total),
      manual_contamination_pct: pct(manual, total),
      shadow_contamination_pct: pct(shadow, total),
      unknown_source_pct: pct(unknown, total),
      legacy_source_pct: pct(scored.filter((row) => row.legacySource).length, total),
      imported_historical_pct: pct(scored.filter((row) => row.sourceClass === 'imported_historical').length, total),
      model_edge_eligible_pct: pct(modelEdgeEligible, total),
      production_readiness_eligible_pct: pct(prodEligible, total),
      syndicate_readiness_eligible_pct: pct(syndicateEligible, total),
    },
    contamination_summary: {
      model_edge_sample_contaminated: contaminationCount > 0,
      model_edge_contamination_pct: pct(contaminationCount, total),
      roi_sample_contaminated: scored.some((row) => !eligible(row, 'roi')),
      roi_contamination_pct: pct(scored.filter((row) => !eligible(row, 'roi')).length, total),
      clv_sample_contaminated: scored.some((row) => !eligible(row, 'clv')),
      clv_contamination_pct: pct(scored.filter((row) => !eligible(row, 'clv')).length, total),
      source_mixing_count: contaminationCount,
    },
    exclusion_counts: {
      ...exclusionCounts,
      total_exclusion_rows: exclusions.length,
    },
    schema_findings: {
      picks_source_column_exists: data.schema.picks.columns['source'],
      picks_source_has_check_constraint: data.schema.sourceHasCheckConstraint,
      distinct_source_values_found: distinctSourceValues,
      legacy_values_detected: legacyValues,
      null_source_count: data.distinctSources.find((row) => row.source == null)?.count ?? 0,
      pick_candidates_columns_verified: Object.keys(data.schema.pick_candidates.columns).filter((column) => data.schema.pick_candidates.columns[column]),
      pick_candidates_model_columns_found: data.schema.candidateModelColumns,
      model_registry_rows_seen: data.modelRegistry.length,
    },
    reporting_findings: {
      model_edge_contaminants: uniqueSorted(scored.filter((row) => !eligible(row, 'model_edge')).map((row) => row.unsupportedMarket ? 'unsupported_market' : row.sourceClass)),
      roi_contaminants: uniqueSorted(scored.filter((row) => !eligible(row, 'roi')).map((row) => row.unsupportedMarket ? 'unsupported_market' : row.sourceClass)),
      clv_contaminants: uniqueSorted(scored.filter((row) => !eligible(row, 'clv')).map((row) => row.unsupportedMarket ? 'unsupported_market' : row.sourceClass)),
      operational_only_populations: uniqueSorted(scored.filter((row) => ['manual', 'heuristic', 'operator_edited'].includes(row.sourceClass)).map((row) => row.sourceClass)),
      any_model_generated_today: modelGenerated > 0,
    },
  };
}

function writeOutputs(
  outDir: string,
  data: LiveData,
  scored: ScoredPick[],
  exclusions: ExclusionRow[],
  summary: JsonRecord,
): void {
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, 'source-ledger-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'evidence.json'), `${JSON.stringify({
    schema_version: 1,
    issue_id: 'UTV2-849',
    generated_at: summary['generated_at'],
    report_paths: OUTPUT_FILES,
    system_verdict: summary['system_verdict'],
    source_metrics: summary['source_metrics'],
    contamination_summary: summary['contamination_summary'],
    schema_findings: summary['schema_findings'],
    policy: {
      read_only: true,
      migrations_added: false,
      fabricated_model_attribution: false,
      historical_unknowns_preserved: true,
    },
  }, null, 2)}\n`);

  const typeRows = [[
    'source_class',
    'raw_source_value',
    'total_rows',
    'roi_eligible',
    'clv_eligible',
    'model_edge_eligible',
    'prod_readiness_eligible',
    'syndicate_eligible',
    'pct_of_total',
  ]];
  const groups = new Map<string, ScoredPick[]>();
  for (const row of scored) {
    const key = `${row.sourceClass}\t${row.rawSource}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const [key, rows] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const [sourceClass, rawSource] = key.split('\t');
    typeRows.push([
      sourceClass,
      rawSource,
      String(rows.length),
      String(rows.filter((row) => eligible(row, 'roi')).length),
      String(rows.filter((row) => eligible(row, 'clv')).length),
      String(rows.filter((row) => eligible(row, 'model_edge')).length),
      String(rows.filter((row) => eligible(row, 'prod_readiness')).length),
      String(rows.filter((row) => eligible(row, 'syndicate')).length),
      String(pct(rows.length, scored.length)),
    ]);
  }
  fs.writeFileSync(path.join(outDir, 'source-ledger-by-type.csv'), toCsv(typeRows));
  fs.writeFileSync(path.join(outDir, 'source-ledger-contamination.csv'), toCsv(contaminationRows(scored)));
  fs.writeFileSync(
    path.join(outDir, 'source-ledger-exclusions.csv'),
    toCsv([
      ['pick_id', 'raw_source_value', 'assigned_source_class', 'exclusion_reason', 'excluded_from', 'sport', 'market_key', 'created_at'],
      ...exclusions.map((row) => [
        row.pick_id,
        row.raw_source_value,
        row.assigned_source_class,
        row.exclusion_reason,
        row.excluded_from,
        row.sport,
        row.market_key,
        row.created_at,
      ]),
    ]),
  );
  fs.writeFileSync(
    path.join(outDir, 'source-ledger-by-sport.csv'),
    groupBy(scored, (row) => row.sport, ['sport', 'total_rows', 'model_generated_pct', 'heuristic_pct', 'manual_pct', 'unknown_pct', 'unsupported_pct']),
  );
  fs.writeFileSync(
    path.join(outDir, 'source-ledger-by-market-family.csv'),
    groupBy(scored, (row) => row.marketFamily, ['market_family', 'total_rows', 'model_generated_pct', 'heuristic_pct', 'manual_pct', 'unknown_pct', 'unsupported_pct']),
  );

  const sourceCountsValue = summary['source_class_counts'] as Record<string, unknown>;
  const contamination = summary['contamination_summary'] as Record<string, unknown>;
  const exclusionCounts = summary['exclusion_counts'] as Record<string, unknown>;
  const topReasons = Object.entries(exclusionCounts)
    .filter(([key]) => key !== 'total_exclusion_rows')
    .sort(([, left], [, right]) => Number(right) - Number(left))
    .slice(0, 3);
  fs.writeFileSync(
    path.join(outDir, 'README.md'),
    [
      '# UTV2-849 Source-Separated Pick Ledger',
      '',
      `Generated: ${String(summary['generated_at'])}`,
      `Evaluation window: ${(summary['evaluation_window'] as JsonRecord)['from']} to ${(summary['evaluation_window'] as JsonRecord)['to']} (${(summary['evaluation_window'] as JsonRecord)['days']} days)`,
      `System verdict: ${String(summary['system_verdict'])} - ${String(summary['verdict_reason'])}`,
      '',
      '| Source class | Rows |',
      '|---|---:|',
      ...SOURCE_CLASSES.map((sourceClass) => `| ${sourceClass} | ${String(sourceCountsValue[sourceClass === 'UNKNOWN' ? 'unknown' : sourceClass] ?? 0)} |`),
      '',
      '| Sample | Contaminated | Contamination % |',
      '|---|---:|---:|',
      `| model-edge | ${String(contamination['model_edge_sample_contaminated'])} | ${String(contamination['model_edge_contamination_pct'])} |`,
      `| ROI | ${String(contamination['roi_sample_contaminated'])} | ${String(contamination['roi_contamination_pct'])} |`,
      `| CLV | ${String(contamination['clv_sample_contaminated'])} | ${String(contamination['clv_contamination_pct'])} |`,
      '',
      'Top exclusion reasons:',
      ...topReasons.map(([reason, count]) => `- ${reason}: ${String(count)}`),
      '',
      'Source separation PASS does not mean the model has edge.',
      '',
      'Historical UNKNOWN rows are permanently classified as UNKNOWN. They are not reclassified as model_generated.',
      '',
      'No scanner or board-construction population is upgraded to model_generated without a resolvable model_registry link.',
      '',
      `Distinct raw sources observed: ${data.distinctSources.map((row) => `${row.source ?? 'null'}=${row.count}`).join(', ') || 'none'}`,
      '',
    ].join('\n'),
  );
}

export async function runSourceLedgerReport(options: RunOptions = {}): Promise<JsonRecord> {
  const days = options.days ?? 30;
  const now = options.now ?? new Date();
  const from = new Date(now.getTime() - days * 86_400_000);
  const outDir = options.outDir ?? REQUIRED_OUTPUT_DIR;
  const data = options.data
    ?? await fetchLiveData(options.client ?? createDatabaseClient({ useServiceRole: true }), iso(from));
  const scored = scorePicks(data);
  const { rows: exclusions, counts: exclusionCounts } = buildExclusions(scored);
  const summary = buildSummary(data, scored, exclusions, exclusionCounts, now, from, days);
  writeOutputs(outDir, data, scored, exclusions, summary);

  for (const file of OUTPUT_FILES) {
    const outputPath = path.join(outDir, file);
    if (!fs.existsSync(outputPath)) throw new Error(`required output file was not written: ${outputPath}`);
  }
  return summary;
}

function isCli(): boolean {
  return process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCli()) {
  const { days } = parseArgs(process.argv.slice(2));
  runSourceLedgerReport({ days }).then((summary) => {
    process.stdout.write(
      `Source ledger report written to ${REQUIRED_OUTPUT_DIR} with system_verdict=${String(summary['system_verdict'])}\n`,
    );
  }).catch((error: unknown) => {
    process.stderr.write(`Source ledger report failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
