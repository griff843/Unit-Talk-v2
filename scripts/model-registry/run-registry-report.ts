import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDatabaseClient,
  type UnitTalkSupabaseClient,
} from '@unit-talk/db';

type JsonRecord = Record<string, unknown>;
type EntityType =
  | 'champion_model'
  | 'challenger_model'
  | 'shadow_model'
  | 'heuristic_system'
  | 'manual_strategy'
  | 'disabled_model'
  | 'retired_model'
  | 'replay_model'
  | 'synthetic_model'
  | 'UNKNOWN';

interface SchemaTable {
  exists: boolean;
  columns: Record<string, boolean>;
  error: string | null;
}

interface PickInput {
  id: string;
  created_at: string;
  source: string | null;
  sport_id: string | null;
  market: string | null;
  market_key: string | null;
  market_type_id: string | null;
}

interface CandidateInput {
  id: string;
  pick_id: string | null;
  provenance: JsonRecord | null;
  model_score: number | null;
  model_tier: string | null;
  model_confidence: number | null;
  model_registry_id?: string | null;
  registry_id?: string | null;
}

interface RegistryInput {
  id: string;
  model_name: string | null;
  version: string | null;
  sport: string | null;
  market_family: string | null;
  status: string | null;
  champion_since: string | null;
  created_at: string | null;
  updated_at: string | null;
  metadata: JsonRecord | null;
}

interface SchemaInspection {
  picks: SchemaTable;
  pick_candidates: SchemaTable;
  model_registry: SchemaTable;
  candidateModelColumns: string[];
  candidateRegistryColumns: string[];
  registryColumnsVerified: string[];
  registryLinkedToCandidatesByMigration: boolean;
  provenanceModelReferenceKeys: string[];
  provenanceRowsSampled: number;
  provenanceModelReferenceRows: number;
}

interface LiveData {
  picks: PickInput[];
  candidates: CandidateInput[];
  allCandidates: CandidateInput[];
  registry: RegistryInput[];
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
  sourceValue: string;
  entityType: EntityType;
  registryId: string | null;
  registryResolved: boolean;
  modelEdgeEligible: boolean;
}

const REQUIRED_OUTPUT_DIR = path.join('docs', '06_status', 'proof', 'UTV2-850');

const OUTPUT_FILES = [
  'model-registry-summary.json',
  'model-registry-entries.csv',
  'model-attribution-coverage.csv',
  'model-performance-readiness.csv',
  'champion-challenger-status.csv',
  'model-attribution-gaps.csv',
  'schema-gaps.json',
  'README.md',
  'evidence.json',
] as const;

const PICK_COLUMNS = [
  'id',
  'created_at',
  'source',
  'sport_id',
  'market',
  'market_key',
  'market_type_id',
];

const CANDIDATE_COLUMNS = [
  'id',
  'pick_id',
  'provenance',
  'model_score',
  'model_tier',
  'model_confidence',
  'model_registry_id',
  'registry_id',
];

const REGISTRY_COLUMNS = [
  'id',
  'model_name',
  'version',
  'sport',
  'market_family',
  'status',
  'champion_since',
  'created_at',
  'updated_at',
  'metadata',
];

const MODEL_REFERENCE_KEYS = [
  'model_id',
  'modelId',
  'model_registry_id',
  'modelRegistryId',
  'model_or_heuristic_id',
  'modelOrHeuristicId',
  'registry_entity_id',
  'registryEntityId',
];

const ENTITY_TYPES: EntityType[] = [
  'champion_model',
  'challenger_model',
  'shadow_model',
  'heuristic_system',
  'manual_strategy',
  'disabled_model',
  'retired_model',
  'replay_model',
  'synthetic_model',
  'UNKNOWN',
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

function normalize(value: string | null): string {
  return value?.trim().toLowerCase() || 'UNKNOWN';
}

function jsonRecord(value: unknown): JsonRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function modelReferenceFromProvenance(provenance: JsonRecord | null): string | null {
  const record = jsonRecord(provenance);
  for (const key of MODEL_REFERENCE_KEYS) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return null;
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
    .join('\n')
    .toLowerCase();
}

function hasCandidateRegistryMigrationPath(): boolean {
  const text = migrationText();
  return /pick_candidates[\s\S]{0,500}references\s+(public\.)?model_registry/.test(text)
    || /alter\s+table[\s\S]{0,100}pick_candidates[\s\S]{0,500}references\s+(public\.)?model_registry/.test(text);
}

async function inspectSchema(client: UnitTalkSupabaseClient): Promise<SchemaInspection> {
  const [picks, candidates, registry] = await Promise.all([
    probeTable(client, 'picks', PICK_COLUMNS),
    probeTable(client, 'pick_candidates', CANDIDATE_COLUMNS),
    probeTable(client, 'model_registry', REGISTRY_COLUMNS),
  ]);

  if (!picks.exists) throw new Error(`stop condition: picks table unavailable: ${picks.error ?? 'missing'}`);
  if (!candidates.exists) throw new Error(`stop condition: pick_candidates table unavailable: ${candidates.error ?? 'missing'}`);
  if (!registry.exists) throw new Error(`stop condition: model_registry table unavailable: ${registry.error ?? 'missing'}`);

  const provenanceRows = await fetchAll<{ provenance: JsonRecord | null }>(
    client,
    'pick_candidates',
    'provenance',
    (query) => query.not('provenance', 'is', null).limit(5000),
  ).catch(() => []);
  const keys = uniqueSorted(
    provenanceRows
      .flatMap((row) => Object.keys(jsonRecord(row.provenance)))
      .filter((key) => MODEL_REFERENCE_KEYS.includes(key)),
  );

  return {
    picks,
    pick_candidates: candidates,
    model_registry: registry,
    candidateModelColumns: CANDIDATE_COLUMNS.filter((column) => column.includes('model') && candidates.columns[column]),
    candidateRegistryColumns: CANDIDATE_COLUMNS.filter((column) => column.includes('registry') && candidates.columns[column]),
    registryColumnsVerified: REGISTRY_COLUMNS.filter((column) => registry.columns[column]),
    registryLinkedToCandidatesByMigration: hasCandidateRegistryMigrationPath(),
    provenanceModelReferenceKeys: keys,
    provenanceRowsSampled: provenanceRows.length,
    provenanceModelReferenceRows: provenanceRows.filter((row) => modelReferenceFromProvenance(row.provenance)).length,
  };
}

async function fetchLiveData(client: UnitTalkSupabaseClient, fromIso: string): Promise<LiveData> {
  const schema = await inspectSchema(client);
  const pickSelect = PICK_COLUMNS.filter((column) => schema.picks.columns[column]).join(',');
  const candidateSelect = CANDIDATE_COLUMNS.filter((column) => schema.pick_candidates.columns[column]).join(',');
  const registrySelect = REGISTRY_COLUMNS.filter((column) => schema.model_registry.columns[column]).join(',');

  const picks = await fetchAll<PickInput>(
    client,
    'picks',
    pickSelect,
    (query) => query.gte('created_at', fromIso).order('created_at', { ascending: true }),
  );
  const pickIds = picks.map((pick) => pick.id);
  const [candidates, allCandidates, registry] = await Promise.all([
    pickIds.length ? selectRowsInBatches<CandidateInput>(client, 'pick_candidates', candidateSelect, 'pick_id', pickIds) : [],
    fetchAll<CandidateInput>(
      client,
      'pick_candidates',
      candidateSelect,
      (query) => query.order('id', { ascending: true }),
    ),
    fetchAll<RegistryInput>(
      client,
      'model_registry',
      registrySelect,
      (query) => query.order('created_at', { ascending: false }),
    ),
  ]);

  const sourceCounts = new Map<string | null, number>();
  for (const pick of picks) sourceCounts.set(pick.source, (sourceCounts.get(pick.source) ?? 0) + 1);

  return {
    picks,
    candidates,
    allCandidates,
    registry,
    distinctSources: [...sourceCounts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((left, right) => right.count - left.count || String(left.source).localeCompare(String(right.source))),
    schema,
  };
}

function registryStatus(row: RegistryInput): string {
  return normalize(row.status);
}

function registryEntityType(row: RegistryInput): EntityType {
  const metadata = jsonRecord(row.metadata);
  const explicitType = stringValue(metadata['registry_entity_type']);
  if (explicitType && ENTITY_TYPES.includes(explicitType as EntityType)) return explicitType as EntityType;

  const status = registryStatus(row);
  if (status === 'champion') return 'champion_model';
  if (status === 'challenger') return 'challenger_model';
  if (status === 'shadow') return 'shadow_model';
  if (status === 'disabled' || status === 'degraded') return 'disabled_model';
  if (status === 'retired' || status === 'archived') return 'retired_model';
  return 'UNKNOWN';
}

function entityTypeForPick(
  pick: PickInput,
  candidate: CandidateInput | null,
  registryById: Map<string, RegistryInput>,
  hasRegistryFk: boolean,
): { entityType: EntityType; registryId: string | null; registryResolved: boolean } {
  const source = normalize(pick.source);
  const registryId = candidate?.model_registry_id ?? candidate?.registry_id ?? null;
  const registryRow = registryId ? registryById.get(registryId) : undefined;

  if (hasRegistryFk && registryRow) {
    const entityType = registryEntityType(registryRow);
    if (entityType === 'champion_model' || entityType === 'challenger_model' || entityType === 'shadow_model') {
      return { entityType, registryId, registryResolved: true };
    }
  }

  if (source === 'system-pick-scanner' || source === 'board-construction' || source === 'system-scanner') {
    return { entityType: 'heuristic_system', registryId: null, registryResolved: false };
  }
  if (source === 'smart-form' || source === 'api' || source === 'human' || source === 'manual' || source === 'user-submitted') {
    return { entityType: 'manual_strategy', registryId: null, registryResolved: false };
  }
  if (source === 'canary-proof' || source === 'synthetic') {
    return { entityType: 'synthetic_model', registryId: null, registryResolved: false };
  }
  if (source === 'replay') return { entityType: 'replay_model', registryId: null, registryResolved: false };
  return { entityType: 'UNKNOWN', registryId: null, registryResolved: false };
}

function scorePicks(data: LiveData): ScoredPick[] {
  const candidatesByPick = new Map<string, CandidateInput[]>();
  for (const candidate of data.candidates) {
    if (!candidate.pick_id) continue;
    candidatesByPick.set(candidate.pick_id, [...(candidatesByPick.get(candidate.pick_id) ?? []), candidate]);
  }
  const registryById = new Map(data.registry.map((row) => [row.id, row]));
  const hasRegistryFk = data.schema.pick_candidates.columns['model_registry_id'] || data.schema.pick_candidates.columns['registry_id'];

  return data.picks.map((pick) => {
    const candidate = (candidatesByPick.get(pick.id) ?? [])[0] ?? null;
    const ownership = entityTypeForPick(pick, candidate, registryById, hasRegistryFk);
    const modelEdgeEligible = ownership.entityType === 'champion_model';
    return {
      pick,
      candidate,
      sourceValue: pick.source ?? 'null',
      entityType: ownership.entityType,
      registryId: ownership.registryId,
      registryResolved: ownership.registryResolved,
      modelEdgeEligible,
    };
  });
}

function countBy<T extends string>(values: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function registryState(data: LiveData): JsonRecord {
  const types = data.registry.map(registryEntityType);
  return {
    total_registry_entries: data.registry.length,
    champion_count: types.filter((type) => type === 'champion_model').length,
    challenger_count: types.filter((type) => type === 'challenger_model').length,
    shadow_count: types.filter((type) => type === 'shadow_model').length,
    heuristic_count: types.filter((type) => type === 'heuristic_system').length,
    manual_count: types.filter((type) => type === 'manual_strategy').length,
    disabled_count: types.filter((type) => type === 'disabled_model').length,
    retired_count: types.filter((type) => type === 'retired_model').length,
    unknown_count: types.filter((type) => type === 'UNKNOWN').length,
    active_count: data.registry.filter((row) => !['retired', 'archived', 'disabled'].includes(registryStatus(row))).length,
    retired_or_disabled_count: data.registry.filter((row) => ['retired', 'archived', 'disabled'].includes(registryStatus(row))).length,
    status_distribution: countBy(data.registry.map((row) => registryStatus(row))),
    sports_covered: uniqueSorted(data.registry.map((row) => row.sport).filter((value): value is string => Boolean(value))),
    market_families_covered: uniqueSorted(data.registry.map((row) => row.market_family).filter((value): value is string => Boolean(value))),
  };
}

function buildSummary(
  data: LiveData,
  scored: ScoredPick[],
  now: Date,
  from: Date,
  days: number,
): JsonRecord {
  const total = scored.length;
  const modelAttributed = scored.filter((row) => row.registryResolved && ['champion_model', 'challenger_model'].includes(row.entityType)).length;
  const championAttributed = scored.filter((row) => row.registryResolved && row.entityType === 'champion_model').length;
  const challengerAttributed = scored.filter((row) => row.registryResolved && row.entityType === 'challenger_model').length;
  const shadowAttributed = scored.filter((row) => row.registryResolved && row.entityType === 'shadow_model').length;
  const heuristicOwned = scored.filter((row) => row.entityType === 'heuristic_system').length;
  const unknownOwnership = scored.filter((row) => row.entityType === 'UNKNOWN').length;
  const registryColumnPresent = data.schema.pick_candidates.columns['model_registry_id'];
  const registryAliasPresent = data.schema.pick_candidates.columns['registry_id'];
  const linkedCandidateRows = data.allCandidates.filter((row) => row.model_registry_id || row.registry_id).length;
  const linkedPickRows = scored.filter((row) => row.registryId).length;
  const ineligible = total - scored.filter((row) => row.modelEdgeEligible).length;

  return {
    schema_version: 1,
    generated_at: iso(now),
    evaluation_window: { from: iso(from), to: iso(now), days },
    system_verdict: modelAttributed === 0 ? 'FAIL' : modelAttributed >= total * 0.5 ? 'PASS' : 'WARN',
    verdict_reason: modelAttributed === 0
      ? 'No evaluation-window picks resolve to model_registry ownership, so model-edge attribution remains blocked.'
      : 'Some ownership exists, but registry readiness depends on linked coverage and champion metadata.',
    registry_state: registryState(data),
    attribution_coverage: {
      total_picks_analyzed: total,
      model_attributed_count: modelAttributed,
      model_attributed_pct: pct(modelAttributed, total),
      champion_attributed_pct: pct(championAttributed, total),
      challenger_attributed_pct: pct(challengerAttributed, total),
      shadow_attributed_pct: pct(shadowAttributed, total),
      heuristic_owned_pct: pct(heuristicOwned, total),
      unknown_model_ownership_pct: pct(unknownOwnership, total),
      retired_disabled_exposure_pct: pct(scored.filter((row) => ['disabled_model', 'retired_model'].includes(row.entityType)).length, total),
      rows_linked_to_picks: linkedPickRows,
      rows_linked_to_candidates: linkedCandidateRows,
    },
    model_edge_eligibility: {
      eligible_rows: scored.filter((row) => row.modelEdgeEligible).length,
      eligible_pct: pct(scored.filter((row) => row.modelEdgeEligible).length, total),
      ineligible_rows: ineligible,
      reason_breakdown: {
        no_registry_fk: registryColumnPresent || registryAliasPresent ? 0 : total,
        entity_type_ineligible: scored.filter((row) => !['champion_model'].includes(row.entityType) && row.entityType !== 'UNKNOWN').length,
        state_ineligible: scored.filter((row) => ['disabled_model', 'retired_model', 'shadow_model', 'challenger_model'].includes(row.entityType)).length,
        unknown_source: unknownOwnership,
      },
    },
    schema_findings: {
      model_registry_table_exists: data.schema.model_registry.exists,
      model_registry_columns_verified: data.schema.registryColumnsVerified,
      existing_registry_entries: data.registry.length,
      registry_statuses_found: uniqueSorted(data.registry.map((row) => registryStatus(row))),
      pick_candidates_has_model_registry_id_column: registryColumnPresent,
      pick_candidates_has_registry_alias_column: registryAliasPresent,
      pick_candidates_model_columns_found: data.schema.candidateModelColumns,
      pick_candidates_registry_columns_found: data.schema.candidateRegistryColumns,
      pick_candidates_to_registry_join_path: data.schema.registryLinkedToCandidatesByMigration
        ? 'migration text indicates pick_candidates references model_registry'
        : 'none',
      provenance_jsonb_has_usable_ownership_hints: data.schema.provenanceModelReferenceKeys.length > 0,
      provenance_jsonb_model_reference_keys_found: data.schema.provenanceModelReferenceKeys,
      provenance_jsonb_model_reference_rows: data.schema.provenanceModelReferenceRows,
      provenance_jsonb_rows_sampled: data.schema.provenanceRowsSampled,
      migration_needed_for_registry_fk: !registryColumnPresent,
      missing_ownership_metadata: [
        'pick_candidates.model_registry_id FK',
        'registry_entity_type',
        'source_type_compatibility',
        'owner',
        'training_window_start',
        'training_window_end',
        'validation_metrics',
        'calibration_metadata',
        'promotion_approved_by',
        'promotion_approved_at',
      ],
      distinct_picks_source_values: data.distinctSources,
    },
    required_future_changes: {
      minimal_schema_changes: [
        'Add pick_candidates.model_registry_id FK to model_registry.id.',
        'Add or standardize model_registry registry_entity_type, active_state, source_type_compatibility, owner, training window, validation, calibration, and promotion metadata.',
      ],
      minimal_runtime_changes: [
        'Candidate scoring must write model_registry_id at scoring time.',
        'Pick conversion must preserve candidate linkage and block model_generated classification without registry ownership.',
        'Analytics must require model_registry_id resolution before model-edge or syndicate eligibility.',
      ],
      future_enforcement_ready_today: false,
      reason_current_runtime_not_ready: 'The registry exists, but no ownership FK path ties candidates or picks to registry entries.',
    },
  };
}

function coverageRows(scored: ScoredPick[], hasRegistryFk: boolean): string[][] {
  const groups = new Map<string, ScoredPick[]>();
  for (const row of scored) groups.set(row.sourceValue, [...(groups.get(row.sourceValue) ?? []), row]);
  const output = [['source_value', 'entity_type', 'pick_count', 'model_attributed_count', 'model_attributed_pct', 'registry_fk_present', 'model_edge_eligible']];
  for (const [source, rows] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const byEntity = new Map<EntityType, ScoredPick[]>();
    for (const row of rows) byEntity.set(row.entityType, [...(byEntity.get(row.entityType) ?? []), row]);
    for (const [entityType, entityRows] of [...byEntity.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const attributed = entityRows.filter((row) => row.registryResolved && ['champion_model', 'challenger_model'].includes(row.entityType)).length;
      output.push([
        source,
        entityType,
        String(entityRows.length),
        String(attributed),
        String(pct(attributed, entityRows.length)),
        String(hasRegistryFk),
        String(entityRows.some((row) => row.modelEdgeEligible)),
      ]);
    }
  }
  if (output.length === 1) output.push(['none', 'UNKNOWN', '0', '0', '0', String(hasRegistryFk), 'false']);
  return output;
}

function gapRows(data: LiveData, scored: ScoredPick[]): string[][] {
  const output = [['picks_source_value', 'pick_count', 'gap_type', 'gap_description', 'resolution_required']];
  const groups = new Map<string, ScoredPick[]>();
  for (const row of scored) groups.set(row.sourceValue, [...(groups.get(row.sourceValue) ?? []), row]);
  for (const [source, rows] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const attributed = rows.filter((row) => row.registryResolved).length;
    if (attributed > 0) continue;
    const gapType = source === 'system-pick-scanner' || source === 'board-construction'
      ? 'missing_registry_fk'
      : 'source_not_model_owned';
    const description = gapType === 'missing_registry_fk'
      ? 'pick_candidates has no resolvable registry ownership for this source; scanner/board rows remain heuristic_system'
      : 'source is not eligible for model ownership under the current registry standard';
    const resolution = gapType === 'missing_registry_fk'
      ? 'Add pick_candidates.model_registry_id FK and populate it at candidate scoring time'
      : 'Keep this source outside model-edge analytics unless a future governed source contract changes it';
    output.push([source, String(rows.length), gapType, description, resolution]);
  }
  if (!data.schema.pick_candidates.columns['model_registry_id']) {
    output.push([
      'ALL',
      String(scored.length),
      'missing_registry_fk_column',
      'pick_candidates.model_registry_id column does not exist',
      'Create an approved migration in a future ownership-enforcement lane',
    ]);
  }
  return output;
}

function writeOutputs(outDir: string, data: LiveData, scored: ScoredPick[], summary: JsonRecord): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'model-registry-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

  const schemaGaps = {
    schema_version: 1,
    generated_at: summary['generated_at'],
    model_registry: data.schema.model_registry,
    pick_candidates: data.schema.pick_candidates,
    picks: data.schema.picks,
    schema_findings: summary['schema_findings'],
    required_future_changes: summary['required_future_changes'],
  };
  fs.writeFileSync(path.join(outDir, 'schema-gaps.json'), `${JSON.stringify(schemaGaps, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'evidence.json'), `${JSON.stringify({
    schema_version: 1,
    issue_id: 'UTV2-850',
    generated_at: summary['generated_at'],
    report_paths: OUTPUT_FILES,
    system_verdict: summary['system_verdict'],
    registry_state: summary['registry_state'],
    attribution_coverage: summary['attribution_coverage'],
    model_edge_eligibility: summary['model_edge_eligibility'],
    schema_findings: summary['schema_findings'],
    policy: {
      read_only: true,
      migrations_added: false,
      fabricated_model_ownership: false,
      historical_rows_upgraded: false,
    },
  }, null, 2)}\n`);

  fs.writeFileSync(
    path.join(outDir, 'model-registry-entries.csv'),
    toCsv([
      ['model_id', 'model_name', 'model_version', 'registry_entity_type', 'sport', 'market_family', 'active_state', 'deployment_start', 'deployment_end', 'allowed_market_families', 'champion_since', 'owner'],
      ...data.registry.map((row) => {
        const metadata = jsonRecord(row.metadata);
        return [
          row.id,
          row.model_name ?? '',
          row.version ?? '',
          registryEntityType(row),
          row.sport ?? '',
          row.market_family ?? '',
          row.status ?? '',
          stringValue(metadata['deployment_start']) ?? '',
          stringValue(metadata['deployment_end']) ?? '',
          Array.isArray(metadata['allowed_market_families']) ? metadata['allowed_market_families'].join('|') : '',
          row.champion_since ?? '',
          stringValue(metadata['owner']) ?? '',
        ];
      }),
    ]),
  );

  const hasRegistryFk = data.schema.pick_candidates.columns['model_registry_id'] || data.schema.pick_candidates.columns['registry_id'];
  fs.writeFileSync(path.join(outDir, 'model-attribution-coverage.csv'), toCsv(coverageRows(scored, hasRegistryFk)));

  fs.writeFileSync(
    path.join(outDir, 'model-performance-readiness.csv'),
    toCsv([
      ['model_id', 'model_name', 'model_version', 'sport', 'market_family', 'active_state', 'validation_metrics_present', 'calibration_metadata_present', 'training_window_complete', 'promotion_status', 'model_edge_ready'],
      ...data.registry
        .filter((row) => ['champion_model', 'challenger_model', 'shadow_model'].includes(registryEntityType(row)))
        .map((row) => {
          const metadata = jsonRecord(row.metadata);
          const trainingComplete = Boolean(metadata['training_window_start'] && metadata['training_window_end']);
          const validationPresent = Boolean(metadata['validation_metrics']);
          const calibrationPresent = Boolean(metadata['calibration_metadata']);
          const promotionStatus = stringValue(metadata['promotion_status']) ?? '';
          const approved = Boolean(metadata['promotion_approved_by'] && metadata['promotion_approved_at']);
          return [
            row.id,
            row.model_name ?? '',
            row.version ?? '',
            row.sport ?? '',
            row.market_family ?? '',
            row.status ?? '',
            String(validationPresent),
            String(calibrationPresent),
            String(trainingComplete),
            promotionStatus,
            String(validationPresent && calibrationPresent && trainingComplete && approved),
          ];
        }),
    ]),
  );

  const scopes = new Map<string, RegistryInput[]>();
  for (const row of data.registry) {
    const key = `${row.sport ?? 'unknown'}\t${row.market_family ?? 'unknown'}`;
    scopes.set(key, [...(scopes.get(key) ?? []), row]);
  }
  fs.writeFileSync(
    path.join(outDir, 'champion-challenger-status.csv'),
    toCsv([
      ['sport', 'market_family', 'champion_model_id', 'champion_model_name', 'champion_since', 'challenger_model_id', 'challenger_model_name', 'shadow_model_id', 'shadow_model_name', 'has_contested_champion'],
      ...[...scopes.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, rows]) => {
        const [sport, family] = key.split('\t');
        const champion = rows.find((row) => registryEntityType(row) === 'champion_model');
        const challenger = rows.find((row) => registryEntityType(row) === 'challenger_model');
        const shadow = rows.find((row) => registryEntityType(row) === 'shadow_model');
        return [
          sport,
          family,
          champion?.id ?? '',
          champion?.model_name ?? '',
          champion?.champion_since ?? '',
          challenger?.id ?? '',
          challenger?.model_name ?? '',
          shadow?.id ?? '',
          shadow?.model_name ?? '',
          String(Boolean(champion && challenger)),
        ];
      }),
    ]),
  );

  fs.writeFileSync(path.join(outDir, 'model-attribution-gaps.csv'), toCsv(gapRows(data, scored)));

  const registryStateValue = summary['registry_state'] as Record<string, unknown>;
  const coverage = summary['attribution_coverage'] as Record<string, unknown>;
  const gaps = gapRows(data, scored).slice(1).sort((left, right) => Number(right[1]) - Number(left[1])).slice(0, 3);
  fs.writeFileSync(
    path.join(outDir, 'README.md'),
    [
      '# UTV2-850 Champion Model Registry Proof',
      '',
      `Generated: ${String(summary['generated_at'])}`,
      `Evaluation window: ${(summary['evaluation_window'] as JsonRecord)['from']} to ${(summary['evaluation_window'] as JsonRecord)['to']} (${(summary['evaluation_window'] as JsonRecord)['days']} days)`,
      `System verdict: ${String(summary['system_verdict'])} - ${String(summary['verdict_reason'])}`,
      '',
      '| Registry entity type | Count |',
      '|---|---:|',
      ...ENTITY_TYPES.map((type) => {
        const key = type === 'champion_model'
          ? 'champion_count'
          : type === 'challenger_model'
            ? 'challenger_count'
            : type === 'shadow_model'
              ? 'shadow_count'
              : type === 'heuristic_system'
                ? 'heuristic_count'
                : type === 'manual_strategy'
                  ? 'manual_count'
                  : type === 'disabled_model'
                    ? 'disabled_count'
                    : type === 'retired_model'
                      ? 'retired_count'
                      : type === 'UNKNOWN'
                        ? 'unknown_count'
                        : '';
        return `| ${type} | ${String(key ? registryStateValue[key] ?? 0 : 0)} |`;
      }),
      '',
      'Attribution coverage:',
      `- Total picks analyzed: ${String(coverage['total_picks_analyzed'])}`,
      `- Model attributed: ${String(coverage['model_attributed_count'])} (${String(coverage['model_attributed_pct'])}%)`,
      `- Heuristic owned: ${String(coverage['heuristic_owned_pct'])}%`,
      `- Rows linked to candidates: ${String(coverage['rows_linked_to_candidates'])}`,
      `- Rows linked to picks: ${String(coverage['rows_linked_to_picks'])}`,
      '',
      'Top attribution gaps:',
      ...gaps.map((row) => `- ${row[0]}: ${row[1]} (${row[2]})`),
      '',
      'Registry PASS does not prove model edge.',
      '',
      '0% model attribution at baseline - all scanner picks are heuristic_system until pick_candidates.model_registry_id FK is established.',
      '',
      'Current production picks are not truly model_generated because no pick or candidate row resolves to a registry owner. Registry entries exist, but ownership is not persisted at candidate scoring time.',
      '',
    ].join('\n'),
  );
}

export async function runRegistryReport(options: RunOptions = {}): Promise<JsonRecord> {
  const days = options.days ?? 30;
  const now = options.now ?? new Date();
  const from = new Date(now.getTime() - days * 86_400_000);
  const outDir = options.outDir ?? REQUIRED_OUTPUT_DIR;
  const data = options.data
    ?? await fetchLiveData(options.client ?? createDatabaseClient({ useServiceRole: true }), iso(from));
  const scored = scorePicks(data);
  const summary = buildSummary(data, scored, now, from, days);
  writeOutputs(outDir, data, scored, summary);

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
  runRegistryReport({ days }).then((summary) => {
    process.stdout.write(
      `Model registry report written to ${REQUIRED_OUTPUT_DIR} with system_verdict=${String(summary['system_verdict'])}\n`,
    );
  }).catch((error: unknown) => {
    process.stderr.write(`Model registry report failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
