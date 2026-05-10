#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvironment } from '@unit-talk/config';

const ROOT = process.cwd();
const CANONICAL_PROJECT_REF = 'zfzdnfwdarxucxtaojxm';

const TARGET_VERSIONS = [
  '202604230002',
  '202604250001',
  '202604250002',
  '202604250004',
  '202604250005',
  '202604270001',
  '202604270002',
  '202604291001',
  '202604291002',
  '202604291003',
  '202605020001',
  '202605020002',
  '202605030001',
  '202605030002',
  '202605070001',
  '202605070002',
  '202605090001',
] as const;

const LOW_RISK_VERSIONS = ['202605020001', '202605070001'] as const;

type TargetVersion = (typeof TARGET_VERSIONS)[number];

interface LocalMigration {
  version: string;
  filename: string;
  absolutePath: string;
}

interface ManagementEnv {
  accessToken: string;
  projectRef: string;
}

interface LiveState {
  ledger: {
    total: number;
    maxVersion: string | null;
    appliedVersions: string[];
  };
  semantic: {
    experimentLedgerConstraintPresent: boolean;
    experimentLedgerConstraintDefinition: string | null;
    marketUniverseClosingBackfillGapCount: number;
    marketUniverseClosingEvidenceCount: number;
    sgoReplayCoverageViewPresent: boolean;
    staleMlbAliasCount: number;
    mlbGameTotalAliasCorrect: boolean;
    mlbNullMarketTypeCount: number;
    mlbNullMarketTypeKnownStakeCount: number;
    mlbNullMarketTypeNullStakeCount: number;
    settlementProfitLossGapCount: number;
    canonicalMarketKeyGapCount: number;
    closingMaterializerIndexes: string[];
    providerOffersBoundedFn: boolean;
    providerOfferHistoryTable: boolean;
    providerOfferCurrentTable: boolean;
    providerOfferCurrentMergeFn: boolean;
    providerOfferCurrentOpeningFn: boolean;
    pickCandidatesSportKeyColumn: boolean;
    pickCandidatesSportKeyIndex: boolean;
    unresolvedBoardCandidateLinks: number;
    linkedBoardCandidateRows: number;
    providerOfferHistoryDropFn: boolean;
    providerOfferLineSnapshotsTable: boolean;
    providerOfferLineSnapshotsSummaryFn: boolean;
    providerOfferLineSnapshotsIndexes: string[];
    stakeConstraintPresent: boolean;
    stakeConstraintValidated: boolean;
    stakeConstraintDefinition: string | null;
    ownershipColumns: string[];
    ownershipIndexes: string[];
    ownershipNulls: {
      registryEntityType: number;
      sourceTypeCompatibility: number;
      activeState: number;
    };
    cronJob: {
      jobname: string | null;
      schedule: string | null;
      command: string | null;
    };
  };
}

interface VersionCheckResult {
  version: TargetVersion;
  issueIds: string[];
  strategy: 'ledger-only' | 'apply-and-ledger';
  semanticallyLive: boolean;
  readyForLedger: boolean;
  reasons: string[];
}

interface ReconciliationReport {
  generated_at: string;
  project_ref: string;
  issue_ids: string[];
  ledger_before: LiveState['ledger'];
  ledger_after: LiveState['ledger'];
  missing_versions_before: string[];
  missing_versions_after: string[];
  checks: VersionCheckResult[];
  actions: {
    applied_migration_versions: string[];
    inserted_ledger_versions: string[];
  };
}

interface LowRiskProof {
  generated_at: string;
  project_ref: string;
  issue_id: 'UTV2-861';
  target_versions: string[];
  semantically_live: boolean;
  checks: {
    sport_key_column_present: boolean;
    sport_key_index_present: boolean;
    unresolved_board_candidate_links: number;
    linked_board_candidate_rows: number;
    stake_constraint_present: boolean;
    stake_constraint_validated: boolean;
    stake_constraint_definition: string | null;
  };
  conclusion: string;
}

interface CliOptions {
  mode: 'inspect' | 'reconcile';
  write: boolean;
  reportOut: string | null;
  lowRiskOut: string | null;
}

function parseRawEnv(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const raw: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    raw[key] = value;
  }
  return raw;
}

function resolveManagementEnv(): ManagementEnv {
  const env = loadEnvironment(ROOT);
  const raw = {
    ...parseRawEnv(path.join(ROOT, '.env')),
    ...parseRawEnv(path.join(ROOT, 'local.env')),
  };

  const accessToken =
    process.env['SUPABASE_ACCESS_TOKEN']?.trim() ||
    raw['SUPABASE_ACCESS_TOKEN'] ||
    '';
  const configuredProjectRef =
    process.env['SUPABASE_PROJECT_REF']?.trim() ||
    env.SUPABASE_PROJECT_REF?.trim() ||
    raw['SUPABASE_PROJECT_REF'] ||
    '';

  if (!accessToken) {
    throw new Error('SUPABASE_ACCESS_TOKEN is required for Phase 9 schema reconciliation.');
  }

  if (configuredProjectRef && configuredProjectRef !== CANONICAL_PROJECT_REF) {
    console.warn(
      `[utv2-phase9-schema-reconciliation] AGENTS.md project ref ${CANONICAL_PROJECT_REF} differs from active environment ${configuredProjectRef}; using the active environment`,
    );
  }

  return {
    accessToken,
    projectRef: configuredProjectRef || CANONICAL_PROJECT_REF,
  };
}

async function runManagementQuery<T>(managementEnv: ManagementEnv, query: string): Promise<T[]> {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${managementEnv.projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managementEnv.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
      cache: 'no-store',
    },
  );

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase management SQL failed (${response.status}): ${body}`);
  }

  return JSON.parse(body) as T[];
}

function getLocalMigrations(): LocalMigration[] {
  const migrationsDir = path.join(ROOT, 'supabase', 'migrations');
  return fs
    .readdirSync(migrationsDir)
    .filter((entry) => entry.endsWith('.sql'))
    .sort()
    .map((filename) => {
      const version = filename.split('_')[0] ?? '';
      return {
        version,
        filename,
        absolutePath: path.join(migrationsDir, filename),
      };
    });
}

function getTargetMigration(localMigrations: LocalMigration[], version: TargetVersion): LocalMigration {
  const match = localMigrations.find((entry) => entry.version === version);
  if (!match) {
    throw new Error(`Missing local migration file for ${version}`);
  }
  return match;
}

export function extractMissingVersions(localVersions: string[], appliedVersions: string[]): string[] {
  const appliedSet = new Set(appliedVersions);
  return localVersions.filter((version) => !appliedSet.has(version));
}

export function cronHasPhase9LifecycleCalls(command: string | null): boolean {
  if (!command) {
    return false;
  }

  return (
    command.includes('summarize_provider_offer_history_partition') &&
    command.includes('drop_old_provider_offer_history_partitions(7)')
  );
}

function listIncludes(values: string[], expected: string[]): boolean {
  const available = new Set(values);
  return expected.every((value) => available.has(value));
}

async function fetchLiveState(managementEnv: ManagementEnv): Promise<LiveState> {
  const rows = await runManagementQuery<{ payload: LiveState }>(
    managementEnv,
    `
      with ledger_versions as (
        select version
        from supabase_migrations.schema_migrations
      ),
      board_candidate_links as (
        select
          count(*) filter (where p.metadata ? 'candidateId')::int as board_picks_with_candidate_id,
          count(*) filter (where p.metadata ? 'candidateId' and pc.id is not null)::int as linked_candidate_rows,
          count(*) filter (where p.metadata ? 'candidateId' and pc.id is null)::int as unresolved_candidate_links
        from public.picks p
        left join public.pick_candidates pc
          on pc.id::text = p.metadata->>'candidateId'
        where p.source = 'board-construction'
      ),
      experiment_ledger_constraint as (
        select
          conname,
          pg_get_constraintdef(oid, true) as definition
        from pg_constraint
        where conname = 'experiment_ledger_run_type_check'
      ),
      closing_backfill_gap as (
        select count(*)::int as gap_count
        from public.market_universe mu
        where mu.closing_line is null
          and mu.closing_over_odds is null
          and mu.closing_under_odds is null
          and exists (
            select 1
            from public.provider_offers po
            where po.provider_key = mu.provider_key
              and po.provider_event_id = mu.provider_event_id
              and coalesce(po.provider_participant_id, '') = coalesce(mu.provider_participant_id, '')
              and po.provider_market_key = mu.provider_market_key
              and po.is_closing = true
              and po.line is not null
              and po.over_odds is not null
              and po.under_odds is not null
          )
      ),
      closing_backfill_evidence as (
        select count(*)::int as evidence_count
        from public.market_universe
        where closing_line is not null
          and closing_over_odds is not null
          and closing_under_odds is not null
      ),
      stale_mlb_aliases as (
        select count(*)::int as stale_count
        from public.provider_market_aliases
        where provider = 'sgo'
          and sport_id = 'MLB'
          and provider_market_key in (
            'batting-doubles-all-game-ou',
            'batting-hits-all-game-ou',
            'batting-hits-runs-rbis-all-game-ou',
            'batting-home-runs-all-game-ou',
            'batting-rbi-all-game-ou',
            'batting-singles-all-game-ou',
            'batting-triples-all-game-ou',
            'batting-walks-all-game-ou',
            'batting-total-bases-all-game-ou',
            'pitching-earned-runs-all-game-ou',
            'pitching-hits-allowed-all-game-ou',
            'pitching-outs-all-game-ou',
            'pitching-strikeouts-all-game-ou'
          )
      ),
      mlb_total_alias as (
        select exists(
          select 1
          from public.provider_market_aliases
          where provider = 'sgo'
            and provider_market_key = 'points-all-game-ou'
            and sport_id = 'MLB'
            and market_type_id = 'game_total_ou'
        ) as alias_correct
      ),
      mlb_market_type_gaps as (
        select count(*)::int as gap_count
        from public.picks p
        where p.market_type_id is null
          and p.sport_id = 'MLB'
          and exists (
            select 1 from public.market_types mt where mt.id = p.market
          )
      ),
      mlb_market_type_gap_breakdown as (
        select
          count(*) filter (where p.stake_units is not null)::int as known_stake_gap_count,
          count(*) filter (where p.stake_units is null)::int as null_stake_gap_count
        from public.picks p
        where p.market_type_id is null
          and p.sport_id = 'MLB'
          and exists (
            select 1 from public.market_types mt where mt.id = p.market
          )
      ),
      settlement_profit_loss_gaps as (
        select count(*)::int as gap_count
        from public.settlement_records sr
        where sr.result in ('win', 'loss', 'push')
          and sr.corrects_id is null
          and (sr.payload->>'profitLossUnits') is null
      ),
      canonical_market_key_gaps as (
        with alias_candidates as (
          select
            mu.id,
            coalesce(
              (
                select pma.market_type_id
                from public.provider_market_aliases pma
                where pma.provider = mu.provider_key
                  and pma.provider_market_key = mu.provider_market_key
                  and pma.sport_id = mu.sport_key
                  and pma.market_type_id is not null
                limit 1
              ),
              (
                select pma.market_type_id
                from public.provider_market_aliases pma
                where pma.provider = mu.provider_key
                  and pma.provider_market_key = mu.provider_market_key
                  and pma.sport_id is null
                  and pma.market_type_id is not null
                limit 1
              )
            ) as resolved_market_type_id,
            mu.market_type_id,
            mu.canonical_market_key,
            mu.provider_market_key
          from public.market_universe mu
        )
        select count(*)::int as gap_count
        from alias_candidates
        where resolved_market_type_id is not null
          and (
            market_type_id is null
            or canonical_market_key = provider_market_key
          )
      ),
      ownership_nulls as (
        select
          count(*) filter (where registry_entity_type is null)::int as registry_entity_type_nulls,
          count(*) filter (where source_type_compatibility is null)::int as source_type_compatibility_nulls,
          count(*) filter (where active_state is null)::int as active_state_nulls
        from public.model_registry
      ),
      semantic_indexes as (
        select indexname
        from pg_indexes
        where schemaname = 'public'
          and indexname in (
            'idx_provider_offers_closing_snapshot_id_desc',
            'idx_market_universe_provider_event_id',
            'idx_pick_candidates_sport_key',
            'pick_candidates_model_registry_id_idx',
            'pick_candidates_scoring_run_id_idx',
            'pick_candidates_ownership_timestamp_idx',
            'pick_candidates_pick_ownership_idx',
            'model_registry_entity_scope_idx',
            'model_registry_active_scope_idx',
            'model_registry_source_type_compatibility_idx',
            'provider_offer_line_snapshots_bk_idx',
            'provider_offer_line_snapshots_date_idx',
            'provider_offer_line_snapshots_provider_date_idx'
          )
      ),
      semantic_columns as (
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and (
            (table_name = 'pick_candidates' and column_name in ('sport_key', 'model_registry_id', 'scoring_run_id', 'ownership_timestamp')) or
            (table_name = 'model_registry' and column_name in ('registry_entity_type', 'source_type_compatibility', 'active_state'))
          )
      ),
      semantic_relations as (
        select relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and relname in (
            'provider_offer_history',
            'provider_offer_current',
            'provider_offer_line_snapshots',
            'sgo_replay_coverage'
          )
      ),
      semantic_functions as (
        select proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and proname in (
            'prune_provider_offers_bounded',
            'drop_old_provider_offer_history_partitions',
            'summarize_provider_offer_history_partition',
            'merge_provider_offer_staging_cycle',
            'list_provider_offer_current_opening'
          )
      ),
      stake_constraint as (
        select
          conname,
          convalidated,
          pg_get_constraintdef(oid, true) as definition
        from pg_constraint
        where conname = 'picks_stake_units_canonical_check'
      ),
      cron_job as (
        select jobname, schedule, command
        from cron.job
        where jobname = 'nightly-retention-prune'
      )
      select json_build_object(
        'ledger', json_build_object(
          'total', (select count(*)::int from ledger_versions),
          'maxVersion', (select max(version) from ledger_versions),
          'appliedVersions', coalesce((select json_agg(version order by version asc) from ledger_versions), '[]'::json)
        ),
        'semantic', json_build_object(
          'experimentLedgerConstraintPresent', exists(
            select 1 from experiment_ledger_constraint
          ),
          'experimentLedgerConstraintDefinition', (select definition from experiment_ledger_constraint),
          'marketUniverseClosingBackfillGapCount', (select gap_count from closing_backfill_gap),
          'marketUniverseClosingEvidenceCount', (select evidence_count from closing_backfill_evidence),
          'sgoReplayCoverageViewPresent', exists(
            select 1 from semantic_relations where relname = 'sgo_replay_coverage'
          ),
          'staleMlbAliasCount', (select stale_count from stale_mlb_aliases),
          'mlbGameTotalAliasCorrect', (select alias_correct from mlb_total_alias),
          'mlbNullMarketTypeCount', (select gap_count from mlb_market_type_gaps),
          'mlbNullMarketTypeKnownStakeCount', (select known_stake_gap_count from mlb_market_type_gap_breakdown),
          'mlbNullMarketTypeNullStakeCount', (select null_stake_gap_count from mlb_market_type_gap_breakdown),
          'settlementProfitLossGapCount', (select gap_count from settlement_profit_loss_gaps),
          'canonicalMarketKeyGapCount', (select gap_count from canonical_market_key_gaps),
          'closingMaterializerIndexes', coalesce((
            select json_agg(indexname order by indexname)
            from semantic_indexes
            where indexname in (
              'idx_provider_offers_closing_snapshot_id_desc',
              'idx_market_universe_provider_event_id'
            )
          ), '[]'::json),
          'providerOffersBoundedFn', exists(
            select 1 from semantic_functions where proname = 'prune_provider_offers_bounded'
          ),
          'providerOfferHistoryTable', exists(
            select 1 from semantic_relations where relname = 'provider_offer_history'
          ),
          'providerOfferCurrentTable', exists(
            select 1 from semantic_relations where relname = 'provider_offer_current'
          ),
          'providerOfferCurrentMergeFn', exists(
            select 1 from semantic_functions where proname = 'merge_provider_offer_staging_cycle'
          ),
          'providerOfferCurrentOpeningFn', exists(
            select 1 from semantic_functions where proname = 'list_provider_offer_current_opening'
          ),
          'pickCandidatesSportKeyColumn', exists(
            select 1 from semantic_columns
            where table_name = 'pick_candidates' and column_name = 'sport_key'
          ),
          'pickCandidatesSportKeyIndex', exists(
            select 1 from semantic_indexes where indexname = 'idx_pick_candidates_sport_key'
          ),
          'unresolvedBoardCandidateLinks', (select unresolved_candidate_links from board_candidate_links),
          'linkedBoardCandidateRows', (select linked_candidate_rows from board_candidate_links),
          'providerOfferHistoryDropFn', exists(
            select 1 from semantic_functions where proname = 'drop_old_provider_offer_history_partitions'
          ),
          'providerOfferLineSnapshotsTable', exists(
            select 1 from semantic_relations where relname = 'provider_offer_line_snapshots'
          ),
          'providerOfferLineSnapshotsSummaryFn', exists(
            select 1 from semantic_functions where proname = 'summarize_provider_offer_history_partition'
          ),
          'providerOfferLineSnapshotsIndexes', coalesce((
            select json_agg(indexname order by indexname)
            from semantic_indexes
            where indexname like 'provider_offer_line_snapshots%'
          ), '[]'::json),
          'stakeConstraintPresent', exists(select 1 from stake_constraint),
          'stakeConstraintValidated', coalesce((select convalidated from stake_constraint), false),
          'stakeConstraintDefinition', (select definition from stake_constraint),
          'ownershipColumns', coalesce((
            select json_agg(column_name order by table_name, column_name)
            from semantic_columns
            where (table_name = 'pick_candidates' and column_name in ('model_registry_id', 'scoring_run_id', 'ownership_timestamp'))
               or (table_name = 'model_registry' and column_name in ('registry_entity_type', 'source_type_compatibility', 'active_state'))
          ), '[]'::json),
          'ownershipIndexes', coalesce((
            select json_agg(indexname order by indexname)
            from semantic_indexes
            where indexname in (
              'pick_candidates_model_registry_id_idx',
              'pick_candidates_scoring_run_id_idx',
              'pick_candidates_ownership_timestamp_idx',
              'pick_candidates_pick_ownership_idx',
              'model_registry_entity_scope_idx',
              'model_registry_active_scope_idx',
              'model_registry_source_type_compatibility_idx'
            )
          ), '[]'::json),
          'ownershipNulls', json_build_object(
            'registryEntityType', (select registry_entity_type_nulls from ownership_nulls),
            'sourceTypeCompatibility', (select source_type_compatibility_nulls from ownership_nulls),
            'activeState', (select active_state_nulls from ownership_nulls)
          ),
          'cronJob', json_build_object(
            'jobname', (select jobname from cron_job),
            'schedule', (select schedule from cron_job),
            'command', (select command from cron_job)
          )
        )
      ) as payload;
    `,
  );

  const payload = rows[0]?.payload;
  if (!payload) {
    throw new Error('Failed to fetch live Phase 9 schema state.');
  }
  return payload;
}

export function evaluateVersionChecks(liveState: LiveState): VersionCheckResult[] {
  const ownershipColumnsReady = listIncludes(liveState.semantic.ownershipColumns, [
    'active_state',
    'model_registry_id',
    'ownership_timestamp',
    'registry_entity_type',
    'scoring_run_id',
    'source_type_compatibility',
  ]);
  const ownershipIndexesReady = listIncludes(liveState.semantic.ownershipIndexes, [
    'model_registry_active_scope_idx',
    'model_registry_entity_scope_idx',
    'model_registry_source_type_compatibility_idx',
    'pick_candidates_model_registry_id_idx',
    'pick_candidates_ownership_timestamp_idx',
    'pick_candidates_pick_ownership_idx',
    'pick_candidates_scoring_run_id_idx',
  ]);
  const snapshotsIndexesReady = listIncludes(liveState.semantic.providerOfferLineSnapshotsIndexes, [
    'provider_offer_line_snapshots_bk_idx',
    'provider_offer_line_snapshots_date_idx',
    'provider_offer_line_snapshots_provider_date_idx',
  ]);

  return [
    {
      version: '202604230002',
      issueIds: ['UTV2-860'],
      strategy: 'apply-and-ledger',
      semanticallyLive:
        liveState.semantic.experimentLedgerConstraintPresent &&
        (liveState.semantic.experimentLedgerConstraintDefinition ?? '').includes('shadow_comparison'),
      readyForLedger:
        liveState.semantic.experimentLedgerConstraintPresent &&
        (liveState.semantic.experimentLedgerConstraintDefinition ?? '').includes('shadow_comparison'),
      reasons: [
        liveState.semantic.experimentLedgerConstraintPresent
          ? 'experiment_ledger_run_type_check exists live'
          : 'experiment_ledger_run_type_check is missing live',
        `definition=${liveState.semantic.experimentLedgerConstraintDefinition ?? 'missing'}`,
      ],
    },
    {
      version: '202604250001',
      issueIds: ['UTV2-860'],
      strategy: 'apply-and-ledger',
      semanticallyLive:
        liveState.semantic.marketUniverseClosingBackfillGapCount === 0 &&
        liveState.semantic.marketUniverseClosingEvidenceCount > 0,
      readyForLedger:
        liveState.semantic.marketUniverseClosingBackfillGapCount === 0 &&
        liveState.semantic.marketUniverseClosingEvidenceCount > 0,
      reasons: [
        `market_universe closing backfill gaps=${liveState.semantic.marketUniverseClosingBackfillGapCount}`,
        `market_universe rows with closing evidence=${liveState.semantic.marketUniverseClosingEvidenceCount}`,
      ],
    },
    {
      version: '202604250002',
      issueIds: ['UTV2-860'],
      strategy: 'apply-and-ledger',
      semanticallyLive: liveState.semantic.sgoReplayCoverageViewPresent,
      readyForLedger: liveState.semantic.sgoReplayCoverageViewPresent,
      reasons: [
        liveState.semantic.sgoReplayCoverageViewPresent
          ? 'sgo_replay_coverage view exists live'
          : 'sgo_replay_coverage view is missing live',
      ],
    },
    {
      version: '202604250004',
      issueIds: ['UTV2-860'],
      strategy: 'apply-and-ledger',
      semanticallyLive:
        liveState.semantic.staleMlbAliasCount === 0 &&
        liveState.semantic.mlbGameTotalAliasCorrect &&
        liveState.semantic.mlbNullMarketTypeKnownStakeCount === 0,
      readyForLedger:
        liveState.semantic.staleMlbAliasCount === 0 &&
        liveState.semantic.mlbGameTotalAliasCorrect &&
        liveState.semantic.mlbNullMarketTypeKnownStakeCount === 0,
      reasons: [
        `stale MLB alias rows=${liveState.semantic.staleMlbAliasCount}`,
        `MLB game-total alias correct=${liveState.semantic.mlbGameTotalAliasCorrect}`,
        `MLB picks missing market_type_id=${liveState.semantic.mlbNullMarketTypeCount}`,
        `MLB missing market_type_id with known stake=${liveState.semantic.mlbNullMarketTypeKnownStakeCount}`,
        `MLB missing market_type_id with null stake=${liveState.semantic.mlbNullMarketTypeNullStakeCount}`,
      ],
    },
    {
      version: '202604250005',
      issueIds: ['UTV2-860'],
      strategy: 'ledger-only',
      semanticallyLive: liveState.semantic.settlementProfitLossGapCount === 0,
      readyForLedger: liveState.semantic.settlementProfitLossGapCount === 0,
      reasons: [
        `settlement_records missing payload.profitLossUnits=${liveState.semantic.settlementProfitLossGapCount}`,
      ],
    },
    {
      version: '202604270001',
      issueIds: ['UTV2-860'],
      strategy: 'apply-and-ledger',
      semanticallyLive: liveState.semantic.canonicalMarketKeyGapCount === 0,
      readyForLedger: liveState.semantic.canonicalMarketKeyGapCount === 0,
      reasons: [
        `market_universe canonical key gaps=${liveState.semantic.canonicalMarketKeyGapCount}`,
      ],
    },
    {
      version: '202604270002',
      issueIds: ['UTV2-860'],
      strategy: 'ledger-only',
      semanticallyLive: listIncludes(liveState.semantic.closingMaterializerIndexes, [
        'idx_market_universe_provider_event_id',
        'idx_provider_offers_closing_snapshot_id_desc',
      ]),
      readyForLedger: listIncludes(liveState.semantic.closingMaterializerIndexes, [
        'idx_market_universe_provider_event_id',
        'idx_provider_offers_closing_snapshot_id_desc',
      ]),
      reasons: [
        `closing materializer indexes=${liveState.semantic.closingMaterializerIndexes.join(', ')}`,
      ],
    },
    {
      version: '202604291001',
      issueIds: ['UTV2-860'],
      strategy: 'ledger-only',
      semanticallyLive: liveState.semantic.providerOffersBoundedFn,
      readyForLedger: liveState.semantic.providerOffersBoundedFn,
      reasons: [
        liveState.semantic.providerOffersBoundedFn
          ? 'prune_provider_offers_bounded exists live'
          : 'prune_provider_offers_bounded is missing live',
      ],
    },
    {
      version: '202604291002',
      issueIds: ['UTV2-860'],
      strategy: 'ledger-only',
      semanticallyLive: liveState.semantic.providerOfferHistoryTable,
      readyForLedger: liveState.semantic.providerOfferHistoryTable,
      reasons: [
        liveState.semantic.providerOfferHistoryTable
          ? 'provider_offer_history exists live'
          : 'provider_offer_history is missing live',
      ],
    },
    {
      version: '202604291003',
      issueIds: ['UTV2-860'],
      strategy: 'ledger-only',
      semanticallyLive:
        liveState.semantic.providerOfferCurrentTable &&
        liveState.semantic.providerOfferCurrentMergeFn &&
        liveState.semantic.providerOfferCurrentOpeningFn,
      readyForLedger:
        liveState.semantic.providerOfferCurrentTable &&
        liveState.semantic.providerOfferCurrentMergeFn &&
        liveState.semantic.providerOfferCurrentOpeningFn,
      reasons: [
        liveState.semantic.providerOfferCurrentTable
          ? 'provider_offer_current exists live'
          : 'provider_offer_current is missing live',
        liveState.semantic.providerOfferCurrentMergeFn
          ? 'merge_provider_offer_staging_cycle exists live'
          : 'merge_provider_offer_staging_cycle is missing live',
        liveState.semantic.providerOfferCurrentOpeningFn
          ? 'list_provider_offer_current_opening exists live'
          : 'list_provider_offer_current_opening is missing live',
      ],
    },
    {
      version: '202605020001',
      issueIds: ['UTV2-860', 'UTV2-861'],
      strategy: 'ledger-only',
      semanticallyLive:
        liveState.semantic.pickCandidatesSportKeyColumn &&
        liveState.semantic.pickCandidatesSportKeyIndex,
      readyForLedger:
        liveState.semantic.pickCandidatesSportKeyColumn &&
        liveState.semantic.pickCandidatesSportKeyIndex,
      reasons: [
        liveState.semantic.pickCandidatesSportKeyColumn
          ? 'pick_candidates.sport_key exists live'
          : 'pick_candidates.sport_key is missing live',
        liveState.semantic.pickCandidatesSportKeyIndex
          ? 'idx_pick_candidates_sport_key exists live'
          : 'idx_pick_candidates_sport_key is missing live',
      ],
    },
    {
      version: '202605020002',
      issueIds: ['UTV2-860'],
      strategy: 'ledger-only',
      semanticallyLive:
        liveState.semantic.unresolvedBoardCandidateLinks === 0 &&
        liveState.semantic.linkedBoardCandidateRows > 0,
      readyForLedger:
        liveState.semantic.unresolvedBoardCandidateLinks === 0 &&
        liveState.semantic.linkedBoardCandidateRows > 0,
      reasons: [
        `linked board-construction candidate rows=${liveState.semantic.linkedBoardCandidateRows}`,
        `unresolved board-construction candidate links=${liveState.semantic.unresolvedBoardCandidateLinks}`,
      ],
    },
    {
      version: '202605030001',
      issueIds: ['UTV2-860'],
      strategy: 'ledger-only',
      semanticallyLive: liveState.semantic.providerOfferHistoryDropFn,
      readyForLedger: liveState.semantic.providerOfferHistoryDropFn,
      reasons: [
        liveState.semantic.providerOfferHistoryDropFn
          ? 'drop_old_provider_offer_history_partitions exists live'
          : 'drop_old_provider_offer_history_partitions is missing live',
      ],
    },
    {
      version: '202605030002',
      issueIds: ['UTV2-860'],
      strategy: 'ledger-only',
      semanticallyLive:
        liveState.semantic.providerOfferLineSnapshotsTable &&
        liveState.semantic.providerOfferLineSnapshotsSummaryFn &&
        snapshotsIndexesReady,
      readyForLedger:
        liveState.semantic.providerOfferLineSnapshotsTable &&
        liveState.semantic.providerOfferLineSnapshotsSummaryFn &&
        snapshotsIndexesReady,
      reasons: [
        liveState.semantic.providerOfferLineSnapshotsTable
          ? 'provider_offer_line_snapshots exists live'
          : 'provider_offer_line_snapshots is missing live',
        liveState.semantic.providerOfferLineSnapshotsSummaryFn
          ? 'summarize_provider_offer_history_partition exists live'
          : 'summarize_provider_offer_history_partition is missing live',
        snapshotsIndexesReady
          ? 'line snapshot indexes exist live'
          : 'line snapshot indexes are incomplete live',
      ],
    },
    {
      version: '202605070001',
      issueIds: ['UTV2-860', 'UTV2-861'],
      strategy: 'ledger-only',
      semanticallyLive: liveState.semantic.stakeConstraintPresent,
      readyForLedger: liveState.semantic.stakeConstraintPresent,
      reasons: [
        liveState.semantic.stakeConstraintPresent
          ? 'picks_stake_units_canonical_check exists live'
          : 'picks_stake_units_canonical_check is missing live',
        liveState.semantic.stakeConstraintValidated
          ? 'constraint is VALIDATED (stronger than migration expectation)'
          : 'constraint remains NOT VALID as designed',
      ],
    },
    {
      version: '202605070002',
      issueIds: ['UTV2-860'],
      strategy: 'ledger-only',
      semanticallyLive:
        ownershipColumnsReady &&
        ownershipIndexesReady &&
        liveState.semantic.ownershipNulls.registryEntityType === 0 &&
        liveState.semantic.ownershipNulls.sourceTypeCompatibility === 0 &&
        liveState.semantic.ownershipNulls.activeState === 0,
      readyForLedger:
        ownershipColumnsReady &&
        ownershipIndexesReady &&
        liveState.semantic.ownershipNulls.registryEntityType === 0 &&
        liveState.semantic.ownershipNulls.sourceTypeCompatibility === 0 &&
        liveState.semantic.ownershipNulls.activeState === 0,
      reasons: [
        ownershipColumnsReady
          ? 'ownership columns exist live'
          : 'ownership columns are incomplete live',
        ownershipIndexesReady
          ? 'ownership indexes exist live'
          : 'ownership indexes are incomplete live',
        `ownership nulls: registry_entity_type=${liveState.semantic.ownershipNulls.registryEntityType}, source_type_compatibility=${liveState.semantic.ownershipNulls.sourceTypeCompatibility}, active_state=${liveState.semantic.ownershipNulls.activeState}`,
      ],
    },
    {
      version: '202605090001',
      issueIds: ['UTV2-860'],
      strategy: 'apply-and-ledger',
      semanticallyLive: cronHasPhase9LifecycleCalls(liveState.semantic.cronJob.command),
      readyForLedger: cronHasPhase9LifecycleCalls(liveState.semantic.cronJob.command),
      reasons: [
        cronHasPhase9LifecycleCalls(liveState.semantic.cronJob.command)
          ? 'nightly-retention-prune includes summarize + partition-drop calls'
          : 'nightly-retention-prune is still missing summarize + partition-drop calls',
      ],
    },
  ];
}

function buildLowRiskProof(liveState: LiveState, managementEnv: ManagementEnv): LowRiskProof {
  const semanticallyLive =
    liveState.semantic.pickCandidatesSportKeyColumn &&
    liveState.semantic.pickCandidatesSportKeyIndex &&
    liveState.semantic.unresolvedBoardCandidateLinks === 0 &&
    liveState.semantic.linkedBoardCandidateRows > 0 &&
    liveState.semantic.stakeConstraintPresent;

  return {
    generated_at: new Date().toISOString(),
    project_ref: managementEnv.projectRef,
    issue_id: 'UTV2-861',
    target_versions: [...LOW_RISK_VERSIONS],
    semantically_live: semanticallyLive,
    checks: {
      sport_key_column_present: liveState.semantic.pickCandidatesSportKeyColumn,
      sport_key_index_present: liveState.semantic.pickCandidatesSportKeyIndex,
      unresolved_board_candidate_links: liveState.semantic.unresolvedBoardCandidateLinks,
      linked_board_candidate_rows: liveState.semantic.linkedBoardCandidateRows,
      stake_constraint_present: liveState.semantic.stakeConstraintPresent,
      stake_constraint_validated: liveState.semantic.stakeConstraintValidated,
      stake_constraint_definition: liveState.semantic.stakeConstraintDefinition,
    },
    conclusion: semanticallyLive
      ? 'Low-risk convergence slice is already semantically live; no additional DDL apply is required beyond ledger reconciliation.'
      : 'Low-risk convergence slice is not yet fully semantically live; do not mark UTV2-861 done.',
  };
}

function buildReconciliationReport(
  managementEnv: ManagementEnv,
  beforeState: LiveState,
  afterState: LiveState,
  checks: VersionCheckResult[],
  appliedMigrationVersions: string[],
  insertedLedgerVersions: string[],
  localMigrations: LocalMigration[],
): ReconciliationReport {
  return {
    generated_at: new Date().toISOString(),
    project_ref: managementEnv.projectRef,
    issue_ids: ['UTV2-860', 'UTV2-861'],
    ledger_before: beforeState.ledger,
    ledger_after: afterState.ledger,
    missing_versions_before: extractMissingVersions(
      localMigrations.map((entry) => entry.version),
      beforeState.ledger.appliedVersions,
    ),
    missing_versions_after: extractMissingVersions(
      localMigrations.map((entry) => entry.version),
      afterState.ledger.appliedVersions,
    ),
    checks,
    actions: {
      applied_migration_versions: appliedMigrationVersions,
      inserted_ledger_versions: insertedLedgerVersions,
    },
  };
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function applyMigrationSql(
  managementEnv: ManagementEnv,
  localMigrations: LocalMigration[],
  version: TargetVersion,
): Promise<void> {
  const migration = getTargetMigration(localMigrations, version);
  const sql = fs.readFileSync(migration.absolutePath, 'utf8');
  await runManagementQuery(managementEnv, sql);
}

async function insertLedgerVersions(
  managementEnv: ManagementEnv,
  versions: readonly string[],
): Promise<void> {
  if (versions.length === 0) {
    return;
  }

  const values = versions.map((version) => `('${version}')`).join(',\n  ');
  await runManagementQuery(
    managementEnv,
    `
      insert into supabase_migrations.schema_migrations (version)
      values
        ${values}
      on conflict do nothing;
    `,
  );
}

function parseArgs(argv: string[]): CliOptions {
  let mode: CliOptions['mode'] = 'inspect';
  let write = false;
  let reportOut: string | null = null;
  let lowRiskOut: string | null = null;

  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === 'inspect' || arg === 'reconcile') {
      mode = arg;
    } else if (arg === '--write') {
      write = true;
    } else if (arg === '--report-out' && next) {
      reportOut = path.resolve(next);
      index++;
    } else if (arg === '--low-risk-out' && next) {
      lowRiskOut = path.resolve(next);
      index++;
    } else if (arg === '--help') {
      console.log(`Usage: tsx scripts/utv2-phase9-schema-reconciliation.ts [inspect|reconcile] [options]

Options:
  --write                    Execute live changes (required for reconcile)
  --report-out <path>        Write the UTV2-860 reconciliation report JSON
  --low-risk-out <path>      Write the UTV2-861 low-risk proof JSON
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { mode, write, reportOut, lowRiskOut };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);
  const managementEnv = resolveManagementEnv();
  const localMigrations = getLocalMigrations();
  const beforeState = await fetchLiveState(managementEnv);
  const checksBefore = evaluateVersionChecks(beforeState);
  const lowRiskProofBefore = buildLowRiskProof(beforeState, managementEnv);

  if (options.mode === 'inspect') {
    const report = buildReconciliationReport(
      managementEnv,
      beforeState,
      beforeState,
      checksBefore,
      [],
      [],
      localMigrations,
    );
    if (options.reportOut) {
      writeJson(options.reportOut, report);
    }
    if (options.lowRiskOut) {
      writeJson(options.lowRiskOut, lowRiskProofBefore);
    }
    console.log(JSON.stringify({ report, lowRiskProof: lowRiskProofBefore }, null, 2));
    return;
  }

  if (!options.write) {
    throw new Error('reconcile mode requires --write');
  }

  const pendingTargetVersions = extractMissingVersions(
    [...TARGET_VERSIONS],
    beforeState.ledger.appliedVersions,
  ) as TargetVersion[];
  const unexpectedMissing = extractMissingVersions(
    localMigrations.map((entry) => entry.version),
    beforeState.ledger.appliedVersions,
  ).filter((version) => !TARGET_VERSIONS.includes(version as TargetVersion));

  if (unexpectedMissing.length > 0) {
    throw new Error(
      `Unexpected missing migration versions detected outside the approved Phase 9 set: ${unexpectedMissing.join(', ')}`,
    );
  }

  const ledgerOnlyFailures = checksBefore.filter(
    (check) =>
      pendingTargetVersions.includes(check.version) &&
      check.strategy === 'ledger-only' &&
      !check.readyForLedger,
  );
  if (ledgerOnlyFailures.length > 0) {
    throw new Error(
      `Cannot reconcile Phase 9 ledger; semantic checks failed for: ${ledgerOnlyFailures
        .map((check) => check.version)
        .join(', ')}`,
    );
  }

  const appliedMigrationVersions: string[] = [];
  for (const check of checksBefore) {
    if (
      pendingTargetVersions.includes(check.version) &&
      check.strategy === 'apply-and-ledger' &&
      !check.readyForLedger
    ) {
      await applyMigrationSql(managementEnv, localMigrations, check.version);
      appliedMigrationVersions.push(check.version);
    }
  }

  const afterApplyState = await fetchLiveState(managementEnv);
  const checksAfterApply = evaluateVersionChecks(afterApplyState);
  const failedAfterApply = checksAfterApply.filter(
    (check) => pendingTargetVersions.includes(check.version) && !check.readyForLedger,
  );
  if (failedAfterApply.length > 0) {
    throw new Error(
      `Phase 9 reconciliation is still unsafe after apply step; failing versions: ${failedAfterApply
        .map((check) => check.version)
        .join(', ')}`,
    );
  }

  await insertLedgerVersions(managementEnv, pendingTargetVersions);

  const finalState = await fetchLiveState(managementEnv);
  const insertedLedgerVersions = pendingTargetVersions.filter((version) =>
    finalState.ledger.appliedVersions.includes(version),
  );
  const remainingTargetMissing = extractMissingVersions(
    [...TARGET_VERSIONS],
    finalState.ledger.appliedVersions,
  );
  if (remainingTargetMissing.length > 0) {
    throw new Error(
      `Phase 9 ledger reconciliation incomplete; remaining missing versions: ${remainingTargetMissing.join(', ')}`,
    );
  }

  const report = buildReconciliationReport(
    managementEnv,
    beforeState,
    finalState,
    checksAfterApply,
    appliedMigrationVersions,
    insertedLedgerVersions,
    localMigrations,
  );
  const lowRiskProof = buildLowRiskProof(finalState, managementEnv);

  if (options.reportOut) {
    writeJson(options.reportOut, report);
  }
  if (options.lowRiskOut) {
    writeJson(options.lowRiskOut, lowRiskProof);
  }

  console.log(JSON.stringify({ report, lowRiskProof }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[utv2-phase9-schema-reconciliation] ${message}`);
    process.exit(1);
  });
}
