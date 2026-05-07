import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDatabaseClient,
  type UnitTalkSupabaseClient,
} from '@unit-talk/db';

type Verdict = 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';
type JsonRecord = Record<string, unknown>;

interface PickInput {
  id: string;
  created_at: string;
  source: string | null;
  sport_id: string | null;
  market: string | null;
  market_key: string | null;
  market_type_id: string | null;
  metadata: JsonRecord | null;
  stake_units: number | null;
  submission_id: string | null;
  posted_at: string | null;
  settled_at: string | null;
}

interface CandidateInput {
  id: string;
  pick_id: string | null;
  scan_run_id: string | null;
  universe_id: string | null;
  provenance: JsonRecord | null;
  model_score: number | null;
  model_tier: string | null;
  model_confidence: number | null;
  shadow_mode: boolean | null;
  is_board_candidate: boolean | null;
  sport_key: string | null;
  market_key: string | null;
  created_at: string | null;
}

interface MarketUniverseInput {
  id: string;
  canonical_market_key: string | null;
  provider_market_key: string | null;
  market_type_id: string | null;
  market_family_id: string | null;
  sport_key: string | null;
}

interface ModelRegistryInput {
  id: string;
  model_name: string | null;
  version: string | null;
  sport: string | null;
  market_family: string | null;
  status: string | null;
}

interface SchemaTable {
  exists: boolean;
  columns: Record<string, boolean>;
  error: string | null;
}

interface SchemaInspection {
  picks: SchemaTable;
  pick_candidates: SchemaTable;
  model_registry: SchemaTable;
  market_universe: SchemaTable;
  modelReferenceKeysFound: string[];
  modelReferenceRows: number;
  sampledProvenanceRows: number;
  modelRegistryLinkedToCandidates: boolean;
  fkJoinPath: string;
  directFieldsOnPicks: string[];
  joinOnlyFields: string[];
  missingFields: string[];
}

interface LiveData {
  picks: PickInput[];
  candidates: CandidateInput[];
  allCandidates: CandidateInput[];
  marketUniverse: MarketUniverseInput[];
  modelRegistry: ModelRegistryInput[];
  schema: SchemaInspection;
  distinctSources: Array<{ source: string; count: number }>;
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
  verdict: Verdict;
  reasons: string[];
  caveats: string[];
  sourceType: string;
  sourceCanonical: boolean;
  hasSubmissionId: boolean;
  hasCandidateLink: boolean;
  hasMarketUniverse: boolean;
  hasScoreLineage: boolean;
  hasModelHint: boolean;
  modelAttributed: boolean;
  partialProvenance: boolean;
  noProvenance: boolean;
  ageDays: number;
  sport: string;
  marketFamily: string;
  marketKey: string;
}

interface ExclusionRow {
  pick_id: string;
  exclusion_reason: string;
  source_type: string;
  sport: string;
  market_key: string;
  candidate_id: string;
  scan_run_id: string;
  created_at: string;
}

const REQUIRED_OUTPUT_DIR = path.join('docs', '06_status', 'proof', 'UTV2-848');

const OUTPUT_FILES = [
  'evidence.json',
  'provenance-summary.json',
  'provenance-by-source-type.csv',
  'provenance-by-sport.csv',
  'provenance-by-market-family.csv',
  'provenance-exclusions.csv',
  'provenance-unknowns.csv',
  'schema-gaps.json',
  'README.md',
] as const;

const CANONICAL_SOURCES = new Set([
  'user-submitted',
  'system-scanner',
  'board-construction',
  'manual',
  'heuristic',
  'operator-edited',
]);

const MODEL_REFERENCE_KEYS = [
  'model_id',
  'modelId',
  'model_registry_id',
  'modelRegistryId',
  'model_or_heuristic_id',
  'modelOrHeuristicId',
  'heuristic_id',
  'heuristicId',
  'producer_id',
  'producerId',
];

const PICK_REQUIRED_COLUMNS = [
  'id',
  'created_at',
  'source',
  'sport_id',
  'market',
  'market_key',
  'market_type_id',
  'metadata',
  'stake_units',
  'submission_id',
  'posted_at',
  'settled_at',
];

const CANDIDATE_REQUIRED_COLUMNS = [
  'id',
  'pick_id',
  'scan_run_id',
  'universe_id',
  'provenance',
  'model_score',
  'model_tier',
  'model_confidence',
  'shadow_mode',
  'is_board_candidate',
  'sport_key',
  'market_key',
  'created_at',
];

const MODEL_REGISTRY_COLUMNS = [
  'id',
  'model_name',
  'version',
  'sport',
  'market_family',
  'status',
];

const MARKET_UNIVERSE_COLUMNS = [
  'id',
  'canonical_market_key',
  'provider_market_key',
  'market_type_id',
  'market_family_id',
  'sport_key',
];

const EXCLUSION_KEYS = [
  'no_candidate_link',
  'no_provenance',
  'no_model_attribution',
  'source_ambiguous',
  'shadow_mode',
  'no_market_universe',
  'no_stake',
  'manual_source',
  'heuristic_source',
  'historical_unknown',
  'model_attribution_jsonb_absent',
] as const;

function parseArgs(argv: string[]): { days: number } {
  let days = 30;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--days') continue;
    const value = Number(argv[index + 1]);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error('--days must be a positive integer');
    }
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

function valueString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeSource(source: string | null): string {
  return source?.trim().toLowerCase() || 'unknown';
}

function sourceIsCanonical(source: string | null): boolean {
  return CANONICAL_SOURCES.has(normalizeSource(source));
}

function jsonRecord(value: unknown): JsonRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function modelHintFromProvenance(provenance: JsonRecord | null): {
  key: string | null;
  value: string | null;
} {
  const record = jsonRecord(provenance);
  for (const key of MODEL_REFERENCE_KEYS) {
    const value = valueString(record[key]);
    if (value) return { key, value };
  }
  return { key: null, value: null };
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
      if (/could not find the table|relation .* does not exist/i.test(error.message)) {
        tableExists = false;
      }
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
  const pageSize = 1000;
  const rows: T[] = [];
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
    const batch = values.slice(index, index + 200);
    const { data, error } = await client.from(table).select(select).in(column, batch);
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
    .join('\n');
}

function hasModelRegistryCandidateFk(): boolean {
  const text = migrationText().toLowerCase();
  return /pick_candidates[\s\S]{0,400}references\s+(public\.)?model_registry/.test(text)
    || /alter\s+table[\s\S]{0,80}pick_candidates[\s\S]{0,400}references\s+(public\.)?model_registry/.test(text);
}

async function inspectSchema(
  client: UnitTalkSupabaseClient,
): Promise<SchemaInspection> {
  const [picks, candidates, modelRegistry, marketUniverse] = await Promise.all([
    probeTable(client, 'picks', PICK_REQUIRED_COLUMNS),
    probeTable(client, 'pick_candidates', CANDIDATE_REQUIRED_COLUMNS),
    probeTable(client, 'model_registry', MODEL_REGISTRY_COLUMNS),
    probeTable(client, 'market_universe', MARKET_UNIVERSE_COLUMNS),
  ]);

  if (!picks.columns['source']) {
    throw new Error(`stop condition: picks.source column unavailable: ${picks.error ?? 'missing'}`);
  }
  if (!candidates.exists) {
    throw new Error(`stop condition: pick_candidates table unavailable: ${candidates.error ?? 'missing'}`);
  }
  if (!modelRegistry.exists) {
    throw new Error(`stop condition: model_registry table unavailable: ${modelRegistry.error ?? 'missing'}`);
  }

  const provenanceRows = await fetchAll<{ provenance: JsonRecord | null }>(
    client,
    'pick_candidates',
    'provenance',
    (query) => query.not('provenance', 'is', null).limit(5000),
  ).catch(() => []);
  const modelReferenceKeysFound = uniqueSorted(
    provenanceRows
      .map((row) => modelHintFromProvenance(row.provenance).key)
      .filter((value): value is string => Boolean(value)),
  );

  const directFieldsOnPicks = [
    'source_type',
    'submission_id',
    'stake_units',
    'posted_at',
    'settled_at',
  ].filter((field) => {
    if (field === 'source_type') return picks.columns['source'];
    return picks.columns[field];
  });

  const joinOnlyFields = [
    'candidate_id',
    'market_universe_id',
    'scan_run_id',
    'score_snapshot',
    'board_run_flag',
    'shadow_mode_flag',
    'runtime_env_id',
    'provider_attribution',
  ].filter((field) => {
    if (field === 'candidate_id') return candidates.columns['id'] && candidates.columns['pick_id'];
    if (field === 'market_universe_id') return candidates.columns['universe_id'];
    if (field === 'scan_run_id' || field === 'runtime_env_id') return candidates.columns['scan_run_id'];
    if (field === 'score_snapshot') {
      return candidates.columns['model_score']
        && candidates.columns['model_confidence']
        && candidates.columns['model_tier'];
    }
    if (field === 'board_run_flag') return candidates.columns['is_board_candidate'];
    if (field === 'shadow_mode_flag') return candidates.columns['shadow_mode'];
    if (field === 'provider_attribution') return candidates.columns['universe_id'] && marketUniverse.exists;
    return false;
  });

  const missingFields = [
    'model_or_heuristic_id',
    'feature_snapshot_id',
    'score_snapshot_id',
    'board_run_id_on_picks',
    'scan_run_id_on_picks',
    'candidate_id_on_picks',
    'market_universe_id_on_picks',
  ];

  const modelRegistryLinkedToCandidates = hasModelRegistryCandidateFk();

  return {
    picks,
    pick_candidates: candidates,
    model_registry: modelRegistry,
    market_universe: marketUniverse,
    modelReferenceKeysFound,
    modelReferenceRows: modelReferenceKeysFound.length === 0
      ? 0
      : provenanceRows.filter((row) => modelHintFromProvenance(row.provenance).key).length,
    sampledProvenanceRows: provenanceRows.length,
    modelRegistryLinkedToCandidates,
    fkJoinPath: modelRegistryLinkedToCandidates
      ? 'migration text indicates pick_candidates references model_registry'
      : 'no FK or direct join path from pick_candidates to model_registry found in migrations or live probes',
    directFieldsOnPicks,
    joinOnlyFields,
    missingFields,
  };
}

async function fetchLiveData(client: UnitTalkSupabaseClient, fromIso: string): Promise<LiveData> {
  const schema = await inspectSchema(client);
  const pickSelect = PICK_REQUIRED_COLUMNS
    .filter((column) => schema.picks.columns[column])
    .join(',');
  const candidateSelect = CANDIDATE_REQUIRED_COLUMNS
    .filter((column) => schema.pick_candidates.columns[column])
    .join(',');
  const marketUniverseSelect = MARKET_UNIVERSE_COLUMNS
    .filter((column) => schema.market_universe.columns[column])
    .join(',');
  const modelRegistrySelect = MODEL_REGISTRY_COLUMNS
    .filter((column) => schema.model_registry.columns[column])
    .join(',');
  const picks = await fetchAll<PickInput>(
    client,
    'picks',
    pickSelect,
    (query) => query.gte('created_at', fromIso).order('created_at', { ascending: true }),
  );
  const pickIds = picks.map((pick) => pick.id);
  const candidates = pickIds.length
    ? await selectRowsInBatches<CandidateInput>(
        client,
        'pick_candidates',
        candidateSelect,
        'pick_id',
        pickIds,
      )
    : [];
  const [allCandidates, marketUniverse, modelRegistry] = await Promise.all([
    fetchAll<CandidateInput>(
      client,
      'pick_candidates',
      candidateSelect,
      (query) => query.order('created_at', { ascending: true }),
    ),
    fetchAll<MarketUniverseInput>(
      client,
      'market_universe',
      marketUniverseSelect,
      (query) => query.order('id', { ascending: true }),
    ).catch(() => []),
    fetchAll<ModelRegistryInput>(
      client,
      'model_registry',
      modelRegistrySelect,
      (query) => query.order('id', { ascending: true }),
    ),
  ]);

  const sourceCounts = new Map<string, number>();
  for (const pick of picks) {
    const source = pick.source ?? 'null';
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  }

  return {
    picks,
    candidates,
    allCandidates,
    marketUniverse,
    modelRegistry,
    schema,
    distinctSources: [...sourceCounts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((left, right) => right.count - left.count || left.source.localeCompare(right.source)),
  };
}

function marketFamilyFor(
  pick: PickInput,
  candidate: CandidateInput | null,
  universeById: Map<string, MarketUniverseInput>,
): string {
  const universe = candidate?.universe_id ? universeById.get(candidate.universe_id) : undefined;
  return (
    universe?.market_family_id
    ?? pick.market_type_id
    ?? pick.market_key
    ?? pick.market
    ?? candidate?.market_key
    ?? 'unknown'
  );
}

function scorePicks(data: LiveData, now: Date): ScoredPick[] {
  const candidatesByPick = new Map<string, CandidateInput[]>();
  for (const candidate of data.candidates) {
    if (!candidate.pick_id) continue;
    const rows = candidatesByPick.get(candidate.pick_id) ?? [];
    rows.push(candidate);
    candidatesByPick.set(candidate.pick_id, rows);
  }
  const universeById = new Map(data.marketUniverse.map((row) => [row.id, row]));
  const modelIds = new Set(data.modelRegistry.map((row) => row.id));

  return data.picks.map((pick) => {
    const candidate = (candidatesByPick.get(pick.id) ?? [])[0] ?? null;
    const sourceType = normalizeSource(pick.source);
    const sourceCanonical = sourceIsCanonical(pick.source);
    const hasSubmissionId = Boolean(pick.submission_id);
    const hasCandidateLink = Boolean(candidate);
    const hasMarketUniverse = Boolean(candidate?.universe_id && universeById.has(candidate.universe_id));
    const hasScoreLineage = Boolean(
      candidate
        && (candidate.model_score != null || candidate.model_confidence != null || candidate.model_tier != null),
    );
    const modelHint = modelHintFromProvenance(candidate?.provenance ?? null);
    const hasModelHint = Boolean(modelHint.value);
    const modelAttributed = Boolean(modelHint.value && modelIds.has(modelHint.value));
    const reasons: string[] = [];
    const caveats: string[] = [];

    if (!pick.source || !sourceCanonical) reasons.push('source-ambiguous');
    if (!hasCandidateLink && sourceType !== 'user-submitted') reasons.push('no-candidate-link');
    if (!hasCandidateLink && !hasSubmissionId) reasons.push('no-provenance');
    if (!hasModelHint || !modelAttributed) reasons.push('no-model-attribution');
    if (candidate && !hasModelHint) reasons.push('model-attribution-jsonb-absent');
    if (candidate?.shadow_mode === true) reasons.push('shadow-mode');
    if (!hasMarketUniverse) reasons.push('no-market-universe');
    if (pick.stake_units == null || pick.stake_units <= 0) reasons.push('no-stake');
    if (sourceType === 'manual') reasons.push('manual-source');
    if (sourceType === 'heuristic') reasons.push('heuristic-source');

    if (pick.source && !sourceCanonical) caveats.push('legacy-source');
    if (hasModelHint && !modelAttributed) caveats.push('partial-model-attribution');
    if (candidate && !hasModelHint && hasScoreLineage) caveats.push('score-without-registry');
    if (candidate && !candidate.scan_run_id) caveats.push('scan-run-missing');
    if (candidate?.is_board_candidate === true && !candidate.scan_run_id) {
      caveats.push('board-candidate-untraced');
    }

    const noProvenance = !hasCandidateLink && !hasSubmissionId;
    const partialProvenance = !noProvenance && (
      !hasMarketUniverse
      || !hasScoreLineage
      || !modelAttributed
      || !sourceCanonical
    );
    if (noProvenance) reasons.push('historical-unknown');

    const ageDays = Number(
      ((now.getTime() - new Date(pick.created_at).getTime()) / 86_400_000).toFixed(2),
    );

    let verdict: Verdict;
    if (noProvenance) {
      verdict = 'UNKNOWN';
    } else if (
      sourceCanonical
      && hasCandidateLink
      && hasMarketUniverse
      && pick.stake_units != null
      && pick.stake_units > 0
      && hasScoreLineage
      && modelAttributed
    ) {
      verdict = 'PASS';
    } else if (
      sourceCanonical
      && (hasCandidateLink || hasSubmissionId)
      && pick.stake_units != null
      && pick.stake_units > 0
    ) {
      verdict = 'WARN';
    } else {
      verdict = 'FAIL';
    }

    return {
      pick,
      candidate,
      verdict,
      reasons: uniqueSorted(reasons),
      caveats: uniqueSorted(caveats),
      sourceType,
      sourceCanonical,
      hasSubmissionId,
      hasCandidateLink,
      hasMarketUniverse,
      hasScoreLineage,
      hasModelHint,
      modelAttributed,
      partialProvenance,
      noProvenance,
      ageDays,
      sport: pick.sport_id ?? candidate?.sport_key ?? 'unknown',
      marketFamily: marketFamilyFor(pick, candidate, universeById),
      marketKey: pick.market_key ?? pick.market ?? candidate?.market_key ?? 'unknown',
    };
  });
}

function buildExclusions(scored: ScoredPick[]): { rows: ExclusionRow[]; counts: Record<string, number> } {
  const rows: ExclusionRow[] = [];
  const counts = Object.fromEntries(EXCLUSION_KEYS.map((key) => [key, 0])) as Record<string, number>;
  for (const row of scored) {
    for (const reason of row.reasons) {
      const key = reason.replaceAll('-', '_');
      if (key in counts) counts[key] += 1;
      rows.push({
        pick_id: row.pick.id,
        exclusion_reason: reason,
        source_type: row.sourceType,
        sport: row.sport,
        market_key: row.marketKey,
        candidate_id: row.candidate?.id ?? '',
        scan_run_id: row.candidate?.scan_run_id ?? '',
        created_at: row.pick.created_at,
      });
    }
  }
  return { rows, counts };
}

function groupRows(
  scored: ScoredPick[],
  keyFor: (row: ScoredPick) => string,
  header: string[],
  metrics: (rows: ScoredPick[]) => string[],
): string {
  const groups = new Map<string, ScoredPick[]>();
  for (const row of scored) {
    const key = keyFor(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const output = [header];
  for (const [key, rows] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    output.push([key, String(rows.length), ...metrics(rows)]);
  }
  if (output.length === 1) output.push(['none', '0', ...metrics([])]);
  return toCsv(output);
}

function countVerdict(rows: ScoredPick[], verdict: Verdict): number {
  return rows.filter((row) => row.verdict === verdict).length;
}

function metricPct(rows: ScoredPick[], predicate: (row: ScoredPick) => boolean): string {
  return String(pct(rows.filter(predicate).length, rows.length));
}

function systemVerdict(scored: ScoredPick[]): 'PASS' | 'WARN' | 'FAIL' {
  const total = scored.length;
  const sourceNullPct = pct(scored.filter((row) => row.sourceType === 'unknown').length, total);
  const noProvenancePct = pct(scored.filter((row) => row.noProvenance).length, total);
  const noModelPct = pct(scored.filter((row) => !row.modelAttributed).length, total);
  const allResolvablePct = pct(countVerdict(scored, 'PASS'), total);
  const coreLinkedPct = pct(scored.filter((row) => row.hasCandidateLink || row.hasSubmissionId).length, total);
  const allHaveSource = scored.every((row) => row.sourceCanonical);
  const allHaveLink = scored.every((row) => row.hasCandidateLink || row.hasSubmissionId);

  if (sourceNullPct > 10 || noProvenancePct > 30 || noModelPct > 50) return 'FAIL';
  if (allResolvablePct >= 90 && allHaveSource && allHaveLink) return 'PASS';
  if (coreLinkedPct >= 70) return 'WARN';
  return 'FAIL';
}

function schemaGaps(data: LiveData): JsonRecord {
  const schema = data.schema;
  return {
    schema_version: 1,
    generated_at: iso(new Date()),
    required_schema_questions: {
      pick_candidates_provenance_contains_model_reference_key: schema.modelReferenceKeysFound.length > 0,
      model_reference_keys_found_in_jsonb: schema.modelReferenceKeysFound,
      model_reference_rows_sampled: schema.modelReferenceRows,
      sampled_provenance_rows: schema.sampledProvenanceRows,
      pick_candidates_to_model_registry_join_path: schema.fkJoinPath,
      distinct_picks_source_values: data.distinctSources,
      pick_candidates_total: data.allCandidates.length,
      pick_candidates_with_pick_id: data.allCandidates.filter((row) => row.pick_id).length,
      pick_candidates_without_pick_id: data.allCandidates.filter((row) => !row.pick_id).length,
      pick_candidates_pick_id_pct: pct(
        data.allCandidates.filter((row) => row.pick_id).length,
        data.allCandidates.length,
      ),
      required_fields_directly_on_picks: schema.directFieldsOnPicks,
      required_fields_only_through_joins: schema.joinOnlyFields,
      required_fields_missing: schema.missingFields,
    },
    table_verification: {
      picks: schema.picks,
      pick_candidates: schema.pick_candidates,
      model_registry: schema.model_registry,
      market_universe: schema.market_universe,
    },
    runtime_enforcement_gaps: {
      hard_fail_should_cover: [
        'picks.source null at ingestion',
        'picks.source non-canonical at qualification',
        'stake_units null or <= 0 at qualification',
        'candidate conversion without universe_id',
      ],
      quarantine_should_cover: [
        'candidate-linked pick missing scan_run_id',
        'submission-only pick without candidate row',
        'missing model_or_heuristic_id',
        'shadow_mode candidate rows',
      ],
      warn_only_should_cover: [
        'JSONB model hint not found in model_registry',
        'board candidate without scan_run_id',
        'manual or heuristic source excluded from model-only edge',
      ],
      paths_currently_lacking_enforcement: [
        'candidate scoring/materialization does not persist a model_registry FK',
        'pick qualification does not enforce canonical provenance completeness',
        'historical analytics must quarantine missing model attribution instead of filtering silently',
      ],
      future_lane_needed: 'UTV2-850 should establish model registry linkage; a later 848 enforcement lane should add write-boundary blocking once source ledger semantics land.',
    },
  };
}

function writeOutputs(
  outDir: string,
  data: LiveData,
  scored: ScoredPick[],
  exclusions: ExclusionRow[],
  exclusionCounts: Record<string, number>,
  summary: JsonRecord,
): void {
  fs.mkdirSync(outDir, { recursive: true });
  const gaps = schemaGaps(data);

  fs.writeFileSync(path.join(outDir, 'provenance-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'schema-gaps.json'), `${JSON.stringify(gaps, null, 2)}\n`);
  fs.writeFileSync(
    path.join(outDir, 'evidence.json'),
    `${JSON.stringify({
      schema_version: 1,
      issue_id: 'UTV2-848',
      generated_at: summary['generated_at'],
      report_paths: OUTPUT_FILES,
      summary_path: path.join(outDir, 'provenance-summary.json').replaceAll('\\', '/'),
      schema_gaps_path: path.join(outDir, 'schema-gaps.json').replaceAll('\\', '/'),
      system_verdict: summary['system_verdict'],
      row_counts: summary['row_counts'],
      provenance_metrics: summary['provenance_metrics'],
      schema_findings: (gaps['required_schema_questions'] as JsonRecord),
      runtime_enforcement_gaps: (gaps['runtime_enforcement_gaps'] as JsonRecord),
      policy: {
        historical_unknowns_preserved: true,
        fabricated_attribution: false,
        historical_rows_silently_upgraded: false,
      },
    }, null, 2)}\n`,
  );

  fs.writeFileSync(
    path.join(outDir, 'provenance-by-source-type.csv'),
    groupRows(
      scored,
      (row) => row.sourceType,
      [
        'source_type',
        'total_rows',
        'provenance_pass',
        'provenance_fail',
        'provenance_unknown',
        'model_attributed_pct',
        'candidate_linked_pct',
      ],
      (rows) => [
        String(countVerdict(rows, 'PASS')),
        String(countVerdict(rows, 'FAIL')),
        String(countVerdict(rows, 'UNKNOWN')),
        metricPct(rows, (row) => row.modelAttributed),
        metricPct(rows, (row) => row.hasCandidateLink),
      ],
    ),
  );
  fs.writeFileSync(
    path.join(outDir, 'provenance-by-sport.csv'),
    groupRows(
      scored,
      (row) => row.sport,
      [
        'sport',
        'total_rows',
        'provenance_pass',
        'provenance_fail',
        'provenance_unknown',
        'source_separated_pct',
        'candidate_linked_pct',
        'model_attributed_pct',
      ],
      (rows) => [
        String(countVerdict(rows, 'PASS')),
        String(countVerdict(rows, 'FAIL')),
        String(countVerdict(rows, 'UNKNOWN')),
        metricPct(rows, (row) => row.sourceCanonical),
        metricPct(rows, (row) => row.hasCandidateLink),
        metricPct(rows, (row) => row.modelAttributed),
      ],
    ),
  );
  fs.writeFileSync(
    path.join(outDir, 'provenance-by-market-family.csv'),
    groupRows(
      scored,
      (row) => row.marketFamily,
      [
        'market_family',
        'total_rows',
        'provenance_pass',
        'provenance_fail',
        'provenance_unknown',
        'candidate_linked_pct',
      ],
      (rows) => [
        String(countVerdict(rows, 'PASS')),
        String(countVerdict(rows, 'FAIL')),
        String(countVerdict(rows, 'UNKNOWN')),
        metricPct(rows, (row) => row.hasCandidateLink),
      ],
    ),
  );
  fs.writeFileSync(
    path.join(outDir, 'provenance-exclusions.csv'),
    toCsv([
      [
        'pick_id',
        'exclusion_reason',
        'source_type',
        'sport',
        'market_key',
        'candidate_id',
        'scan_run_id',
        'created_at',
      ],
      ...exclusions.map((row) => [
        row.pick_id,
        row.exclusion_reason,
        row.source_type,
        row.sport,
        row.market_key,
        row.candidate_id,
        row.scan_run_id,
        row.created_at,
      ]),
    ]),
  );
  fs.writeFileSync(
    path.join(outDir, 'provenance-unknowns.csv'),
    toCsv([
      ['pick_id', 'source_type', 'has_submission_id', 'has_candidate_link', 'created_at', 'age_days'],
      ...scored
        .filter((row) => row.verdict === 'UNKNOWN')
        .map((row) => [
          row.pick.id,
          row.sourceType,
          String(row.hasSubmissionId),
          String(row.hasCandidateLink),
          row.pick.created_at,
          String(row.ageDays),
        ]),
    ]),
  );

  const topReasons = Object.entries(exclusionCounts)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 3);
  const metrics = summary['provenance_metrics'] as Record<string, unknown>;
  fs.writeFileSync(
    path.join(outDir, 'README.md'),
    [
      '# UTV2-848 Provenance Report',
      '',
      `Generated: ${String(summary['generated_at'])}`,
      `Evaluation window: ${(summary['evaluation_window'] as JsonRecord)['from']} to ${(summary['evaluation_window'] as JsonRecord)['to']} (${(summary['evaluation_window'] as JsonRecord)['days']} days)`,
      `System verdict: ${String(summary['system_verdict'])} - ${String(summary['verdict_reason'])}`,
      '',
      '| Metric | Value |',
      '|---|---:|',
      ...Object.entries(metrics).map(([key, value]) => `| ${key} | ${String(value)} |`),
      '',
      'Top exclusion reasons:',
      ...topReasons.map(([reason, count]) => `- ${reason}: ${count}`),
      '',
      `Historical UNKNOWN count: ${String((summary['row_counts'] as JsonRecord)['provenance_unknown'])}`,
      '',
      'Provenance PASS does not mean the model has edge.',
      '',
      'Runtime enforcement gap report:',
      '- Hard fail: null/non-canonical source at ingestion or qualification, invalid stake_units at qualification, candidate conversion without universe_id.',
      '- Quarantine: missing scan_run_id, submission-only rows, missing model_or_heuristic_id, and shadow_mode rows.',
      '- Warn only: JSONB model hint that does not resolve, board candidate without scan_run_id, manual or heuristic source.',
      '- Future lane: UTV2-850 remains the top blocker for resolvable model attribution.',
      '',
    ].join('\n'),
  );
}

export async function runProvenanceReport(options: RunOptions = {}): Promise<JsonRecord> {
  const days = options.days ?? 30;
  const now = options.now ?? new Date();
  const from = new Date(now.getTime() - days * 86_400_000);
  const outDir = options.outDir ?? REQUIRED_OUTPUT_DIR;
  const data = options.data
    ?? await fetchLiveData(options.client ?? createDatabaseClient({ useServiceRole: true }), iso(from));
  const scored = scorePicks(data, now);
  const { rows: exclusions, counts: exclusionCounts } = buildExclusions(scored);
  const total = scored.length;
  const candidateWithPickId = data.allCandidates.filter((row) => row.pick_id).length;
  const candidateWithoutPickId = data.allCandidates.length - candidateWithPickId;
  const verdict = systemVerdict(scored);
  const summary: JsonRecord = {
    schema_version: 1,
    generated_at: iso(now),
    evaluation_window: {
      from: iso(from),
      to: iso(now),
      days,
    },
    system_verdict: verdict,
    verdict_reason: verdict === 'FAIL'
      ? 'Model attribution is not resolvable for the required threshold, so trusted model-edge evaluation remains blocked.'
      : 'Core provenance linkage is present at the configured threshold, with caveats in exclusions.',
    row_counts: {
      total_analyzed: total,
      total_picks_analyzed: total,
      total_candidates_analyzed: data.allCandidates.length,
      provenance_pass: countVerdict(scored, 'PASS'),
      provenance_warn: countVerdict(scored, 'WARN'),
      provenance_fail: countVerdict(scored, 'FAIL'),
      provenance_unknown: countVerdict(scored, 'UNKNOWN'),
      rows_with_partial_provenance: scored.filter((row) => row.partialProvenance).length,
      rows_with_no_provenance: scored.filter((row) => row.noProvenance).length,
      candidates_with_pick_id: candidateWithPickId,
      candidates_without_pick_id: candidateWithoutPickId,
    },
    provenance_metrics: {
      provenance_linked_pct: pct(scored.filter((row) => row.hasCandidateLink || row.hasSubmissionId).length, total),
      model_attributed_pct: pct(scored.filter((row) => row.modelAttributed).length, total),
      candidate_linked_pct: pct(scored.filter((row) => row.hasCandidateLink).length, total),
      market_universe_linked_pct: pct(scored.filter((row) => row.hasMarketUniverse).length, total),
      source_type_present_pct: pct(scored.filter((row) => row.sourceType !== 'unknown').length, total),
      source_separated_pct: pct(scored.filter((row) => row.sourceCanonical).length, total),
      shadow_pct: pct(scored.filter((row) => row.candidate?.shadow_mode === true).length, total),
      historical_unknown_pct: pct(countVerdict(scored, 'UNKNOWN'), total),
      operator_edited_pct: pct(scored.filter((row) => row.sourceType === 'operator-edited').length, total),
      excluded_from_model_edge_pct: pct(
        scored.filter((row) => row.reasons.some((reason) => [
          'no-candidate-link',
          'no-provenance',
          'no-model-attribution',
          'source-ambiguous',
          'no-market-universe',
          'no-stake',
          'manual-source',
          'heuristic-source',
          'historical-unknown',
          'model-attribution-jsonb-absent',
        ].includes(reason))).length,
        total,
      ),
    },
    distinct_picks_source_values: data.distinctSources,
    model_reference_keys_found_in_jsonb: data.schema.modelReferenceKeysFound,
    exclusion_counts: exclusionCounts,
    schema_gaps: {
      model_id_column_exists_on_picks: Boolean(data.schema.picks.columns['model_id']),
      board_run_id_column_exists_on_picks: Boolean(data.schema.picks.columns['board_run_id']),
      scan_run_id_column_exists_on_picks: Boolean(data.schema.picks.columns['scan_run_id']),
      candidate_id_column_exists_on_picks: Boolean(data.schema.picks.columns['candidate_id']),
      market_universe_id_column_exists_on_picks: Boolean(data.schema.picks.columns['market_universe_id']),
      model_registry_linked_to_candidates: data.schema.modelRegistryLinkedToCandidates,
      provenance_jsonb_has_model_ref_pct: pct(
        data.schema.modelReferenceRows,
        data.schema.sampledProvenanceRows,
      ),
      required_fields_directly_on_picks: data.schema.directFieldsOnPicks,
      required_fields_only_through_joins: data.schema.joinOnlyFields,
      required_fields_missing: data.schema.missingFields,
    },
  };

  writeOutputs(outDir, data, scored, exclusions, exclusionCounts, summary);

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
  runProvenanceReport({ days }).then((summary) => {
    process.stdout.write(
      `Provenance report written to ${REQUIRED_OUTPUT_DIR} with system_verdict=${String(summary['system_verdict'])}\n`,
    );
  }).catch((error: unknown) => {
    process.stderr.write(`Provenance report failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
