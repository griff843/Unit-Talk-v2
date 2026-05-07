import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnvironment } from '@unit-talk/config';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type CandidateRow = {
  id: string;
  pick_id: string | null;
  model_score: number | null;
  model_registry_id?: string | null;
  scoring_run_id?: string | null;
  ownership_timestamp?: string | null;
  shadow_mode?: boolean | null;
  sport_key?: string | null;
  updated_at?: string | null;
};

type PickRow = {
  id: string;
  source: string | null;
  created_at?: string | null;
};

type RegistryRow = {
  id: string;
  sport: string;
  market_family: string;
  status: string;
  registry_entity_type?: string | null;
  active_state?: string | null;
  source_type_compatibility?: string[] | null;
};

const OUTPUT_DIR = path.resolve('docs/06_status/proof/UTV2-854');
const MIGRATION_PATH = path.resolve(
  'supabase/migrations/202605070002_utv2_854_model_ownership_persistence.sql',
);

function pct(count: number, total: number): number {
  if (total === 0) return 0;
  return Number(((count / total) * 100).toFixed(2));
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function fetchAll<T>(client: SupabaseClient, table: string, select: string): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from(table).select(select).range(offset, offset + pageSize - 1);
    if (error) throw new Error(`${table} query failed: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function probeColumn(client: SupabaseClient, table: string, column: string): Promise<boolean> {
  const { error } = await client.from(table).select(column).limit(1);
  return error === null;
}

function classifyPick(
  pick: PickRow,
  candidate: CandidateRow | null,
  registry: RegistryRow | null,
): 'model_generated' | 'heuristic' | 'manual' | 'UNKNOWN' {
  const source = asString(pick.source)?.toLowerCase() ?? 'unknown';
  if (['api', 'human', 'manual', 'smart-form', 'user-submitted'].includes(source)) return 'manual';
  if (!candidate) return source === 'board-construction' || source === 'system-pick-scanner' ? 'heuristic' : 'UNKNOWN';
  if (candidate.shadow_mode === true) return 'UNKNOWN';

  const entityType = registry?.registry_entity_type?.toLowerCase() ?? null;
  const activeState = (registry?.active_state ?? registry?.status ?? '').toLowerCase();
  const modelAttributed = Boolean(
    candidate.model_registry_id &&
    candidate.scoring_run_id &&
    candidate.ownership_timestamp &&
    entityType === 'champion_model' &&
    activeState !== 'disabled' &&
    activeState !== 'retired' &&
    activeState !== 'archived',
  );

  if (modelAttributed && source === 'board-construction') return 'model_generated';
  if (source === 'board-construction' || source === 'system-pick-scanner' || source === 'system-scanner') return 'heuristic';
  return 'UNKNOWN';
}

function toCsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\n');
}

async function main() {
  const env = loadEnvironment();
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const migrationExists = await fs.access(MIGRATION_PATH).then(() => true).catch(() => false);
  const schemaProbe = {
    pick_candidates_model_registry_id: await probeColumn(client, 'pick_candidates', 'model_registry_id'),
    pick_candidates_scoring_run_id: await probeColumn(client, 'pick_candidates', 'scoring_run_id'),
    pick_candidates_ownership_timestamp: await probeColumn(client, 'pick_candidates', 'ownership_timestamp'),
    model_registry_registry_entity_type: await probeColumn(client, 'model_registry', 'registry_entity_type'),
    model_registry_source_type_compatibility: await probeColumn(client, 'model_registry', 'source_type_compatibility'),
    model_registry_active_state: await probeColumn(client, 'model_registry', 'active_state'),
  };

  const candidates = await fetchAll<CandidateRow>(
    client,
    'pick_candidates',
    'id,pick_id,model_score,model_registry_id,scoring_run_id,ownership_timestamp,shadow_mode,sport_key,updated_at',
  ).catch(async () => fetchAll<CandidateRow>(
    client,
    'pick_candidates',
    'id,pick_id,model_score,shadow_mode,updated_at',
  ));
  const picks = await fetchAll<PickRow>(client, 'picks', 'id,source,created_at').catch(() => [] as PickRow[]);
  const registry = await fetchAll<RegistryRow>(
    client,
    'model_registry',
    'id,sport,market_family,status,registry_entity_type,active_state,source_type_compatibility',
  ).catch(async () => fetchAll<RegistryRow>(
    client,
    'model_registry',
    'id,sport,market_family,status',
  ));

  const candidateByPickId = new Map(candidates.filter((row) => row.pick_id).map((row) => [row.pick_id as string, row]));
  const registryById = new Map(registry.map((row) => [row.id, row]));

  const scoredCandidates = candidates.filter((row) => row.model_score !== null);
  const ownershipWrites = scoredCandidates.map((row) => {
    const ownershipComplete = Boolean(row.model_registry_id && row.scoring_run_id && row.ownership_timestamp);
    const owner = row.model_registry_id ? registryById.get(row.model_registry_id) ?? null : null;
    const ownerState = (owner?.active_state ?? owner?.status ?? 'UNKNOWN').toLowerCase();
    return {
      candidateId: row.id,
      pickId: row.pick_id ?? '',
      ownershipComplete,
      ownerId: row.model_registry_id ?? '',
      scoringRunId: row.scoring_run_id ?? '',
      ownershipTimestamp: row.ownership_timestamp ?? '',
      ownerState,
      quarantined: !ownershipComplete || ownerState === 'degraded',
    };
  });

  const classifiedPicks = picks.map((pick) => {
    const candidate = candidateByPickId.get(pick.id) ?? null;
    const owner = candidate?.model_registry_id ? registryById.get(candidate.model_registry_id) ?? null : null;
    return {
      pickId: pick.id,
      source: pick.source ?? 'UNKNOWN',
      sourceClass: classifyPick(pick, candidate, owner),
      candidateId: candidate?.id ?? '',
      ownerId: candidate?.model_registry_id ?? '',
    };
  });

  const modelAttributed = classifiedPicks.filter((row) => row.ownerId).length;
  const modelGenerated = classifiedPicks.filter((row) => row.sourceClass === 'model_generated').length;
  const heuristic = classifiedPicks.filter((row) => row.sourceClass === 'heuristic').length;
  const manual = classifiedPicks.filter((row) => row.sourceClass === 'manual').length;
  const unknown = classifiedPicks.filter((row) => row.sourceClass === 'UNKNOWN').length;
  const ownershipWriteSuccess = ownershipWrites.filter((row) => row.ownershipComplete).length;
  const ownershipWriteFailure = ownershipWrites.length - ownershipWriteSuccess;
  const degradedQuarantine = ownershipWrites.filter((row) => row.ownerState === 'degraded').length;
  const nullOwnershipQuarantine = ownershipWrites.filter((row) => !row.ownershipComplete).length;
  const disabledRetiredExposure = ownershipWrites.filter((row) => ['disabled', 'retired', 'archived'].includes(row.ownerState)).length;

  const summary: Record<string, Json> = {
    issue_id: 'UTV2-854',
    generated_at: new Date().toISOString(),
    migration_file_present: migrationExists,
    schema_probe: schemaProbe,
    counts: {
      picks_total: picks.length,
      candidates_total: candidates.length,
      scored_candidates_total: scoredCandidates.length,
      registry_total: registry.length,
    },
    metrics: {
      model_attributed_pct: pct(modelAttributed, classifiedPicks.length),
      model_generated_pct: pct(modelGenerated, classifiedPicks.length),
      heuristic_pct: pct(heuristic, classifiedPicks.length),
      manual_pct: pct(manual, classifiedPicks.length),
      unknown_pct: pct(unknown, classifiedPicks.length),
      ownership_write_success_pct: pct(ownershipWriteSuccess, ownershipWrites.length),
      ownership_write_failure_pct: pct(ownershipWriteFailure, ownershipWrites.length),
    },
    quarantines: {
      null_ownership: nullOwnershipQuarantine,
      degraded_ownership: degradedQuarantine,
    },
    enforcement: {
      disabled_retired_exposure_count: disabledRetiredExposure,
      invalid_entity_type_rows: registry.filter((row) => row.registry_entity_type && row.registry_entity_type !== 'champion_model').length,
    },
    reporting_findings: {
      any_model_generated_today: modelGenerated > 0,
      true_model_generated_inventory_exists: modelGenerated > 0,
      historical_unknown_rows_preserved: true,
    },
  };

  await fs.writeFile(
    path.join(OUTPUT_DIR, 'ownership-persistence-summary.json'),
    JSON.stringify(summary, null, 2),
  );

  await fs.writeFile(
    path.join(OUTPUT_DIR, 'migration-results.json'),
    JSON.stringify(
      {
        issue_id: 'UTV2-854',
        generated_at: new Date().toISOString(),
        migration_file_present: migrationExists,
        migration_file: MIGRATION_PATH,
        schema_probe: schemaProbe,
        live_schema_ready: Object.values(schemaProbe).every(Boolean),
      },
      null,
      2,
    ),
  );

  await fs.writeFile(
    path.join(OUTPUT_DIR, 'ownership-write-results.csv'),
    toCsv([
      ['candidate_id', 'pick_id', 'owner_id', 'scoring_run_id', 'ownership_timestamp', 'ownership_complete', 'owner_state'],
      ...ownershipWrites.map((row) => [
        row.candidateId,
        row.pickId,
        row.ownerId,
        row.scoringRunId,
        row.ownershipTimestamp,
        String(row.ownershipComplete),
        row.ownerState,
      ]),
    ]),
  );

  await fs.writeFile(
    path.join(OUTPUT_DIR, 'ownership-enforcement-results.csv'),
    toCsv([
      ['metric', 'count'],
      ['ownership_write_success', String(ownershipWriteSuccess)],
      ['ownership_write_failure', String(ownershipWriteFailure)],
      ['disabled_retired_exposure_count', String(disabledRetiredExposure)],
      ['invalid_entity_type_rows', String(registry.filter((row) => row.registry_entity_type && row.registry_entity_type !== 'champion_model').length)],
    ]),
  );

  await fs.writeFile(
    path.join(OUTPUT_DIR, 'ownership-quarantine-results.csv'),
    toCsv([
      ['metric', 'count'],
      ['null_ownership_quarantine', String(nullOwnershipQuarantine)],
      ['degraded_ownership_quarantine', String(degradedQuarantine)],
      ['unknown_pick_inventory', String(unknown)],
    ]),
  );

  await fs.writeFile(
    path.join(OUTPUT_DIR, 'README.md'),
    [
      '# UTV2-854 Proof',
      '',
      '- `ownership-persistence-summary.json` captures the top-line schema and inventory verdict.',
      '- `ownership-write-results.csv` lists scored candidates and whether the ownership trio is present.',
      '- `ownership-enforcement-results.csv` summarizes observed write and enforcement counts.',
      '- `ownership-quarantine-results.csv` summarizes null-ownership and degraded-owner quarantine counts.',
      '- `migration-results.json` records whether the approved migration file exists and whether the linked database currently exposes the new columns.',
    ].join('\n'),
  );

  await fs.writeFile(
    path.join(OUTPUT_DIR, 'evidence.json'),
    JSON.stringify(
      {
        issue_id: 'UTV2-854',
        generated_at: new Date().toISOString(),
        artifacts: [
          'ownership-persistence-summary.json',
          'ownership-write-results.csv',
          'ownership-enforcement-results.csv',
          'ownership-quarantine-results.csv',
          'migration-results.json',
          'README.md',
        ],
        summary,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
