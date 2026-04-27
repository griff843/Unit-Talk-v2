import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadEnvironment } from '@unit-talk/config';
import { normalizeMarketKey } from '@unit-talk/domain';

type Area = 'pipeline';
type WindowKey = 'today' | 'last24h';
type DatabaseClient = ReturnType<typeof createClient>;
type CountKey =
  | 'provider_offers'
  | 'market_universe_rows_refreshed'
  | 'pick_candidates_created'
  | 'pick_candidates_scored'
  | 'qualified_candidates'
  | 'candidates_with_pick_id'
  | 'picks_created_by_system_pick_scanner'
  | 'picks_in_awaiting_approval'
  | 'posted_picks'
  | 'settled_picks'
  | 'clv_backed_settlements'
  | 'pnl_populated_settlements'
  | 'posted_system_picks_without_result'
  | 'posted_system_picks_missing_event'
  | 'posted_system_picks_missing_participant'
  | 'posted_system_picks_missing_market_type'
  | 'posted_system_picks_with_game_result';

type PipelineWindowCounts = Record<CountKey, number>;

interface ReportWindow {
  label: string;
  since: string;
  counts: PipelineWindowCounts;
  dropOff: FunnelDropOff;
  diagnosis: string;
  suspectedBlockers: string[];
  posted_system_picks_skipped_by_grading_reason: Record<string, number>;
  posted_system_pick_samples: PostedSystemPickSample[];
}

interface FunnelDropOff {
  from: CountKey | null;
  to: CountKey | null;
  fromCount: number | null;
  toCount: number | null;
}

interface PipelineReport {
  schema_version: 1;
  generated_at: string;
  area: Area;
  mode: 'read-only';
  counting_strategy: 'supabase_estimated_count';
  output_paths: {
    json: string;
    markdown: string;
  };
  windows: Record<WindowKey, ReportWindow>;
  definitions: Record<CountKey, string>;
  suggested_linear_issue: {
    title: string;
    description: string;
  };
}

interface PostedSystemPickSample {
  pick_id: string;
  market: string;
  market_type_id: string | null;
  selection: string;
  line: number | null;
  event_id: string | null;
  participant_id: string | null;
  market_universe_id: string | null;
  market_universe_event_id: string | null;
  market_universe_market_type_id: string | null;
  market_universe_canonical_market_key: string | null;
  matching_game_result_count: number;
  settlement_count: number;
  grading_skip_reason: string;
}

const REPORT_DIR = path.join(process.cwd(), 'docs', '06_status', 'system-checks');
const JSON_REPORT_PATH = path.join(REPORT_DIR, 'latest-pipeline.json');
const MARKDOWN_REPORT_PATH = path.join(REPORT_DIR, 'latest-pipeline.md');

const COUNT_KEYS: CountKey[] = [
  'provider_offers',
  'market_universe_rows_refreshed',
  'pick_candidates_created',
  'pick_candidates_scored',
  'qualified_candidates',
  'candidates_with_pick_id',
  'picks_created_by_system_pick_scanner',
  'picks_in_awaiting_approval',
  'posted_picks',
  'settled_picks',
  'clv_backed_settlements',
  'pnl_populated_settlements',
  'posted_system_picks_without_result',
  'posted_system_picks_missing_event',
  'posted_system_picks_missing_participant',
  'posted_system_picks_missing_market_type',
  'posted_system_picks_with_game_result',
];

const DEFINITIONS: Record<CountKey, string> = {
  provider_offers: 'provider_offers rows with snapshot_at in the window.',
  market_universe_rows_refreshed: 'market_universe rows with refreshed_at in the window.',
  pick_candidates_created: 'pick_candidates rows with created_at in the window.',
  pick_candidates_scored: 'pick_candidates rows with model_score present and updated_at in the window.',
  qualified_candidates: "pick_candidates rows with status='qualified' and created_at in the window.",
  candidates_with_pick_id: 'pick_candidates rows with pick_id present and updated_at in the window.',
  picks_created_by_system_pick_scanner:
    "picks rows with source='system-pick-scanner' and created_at in the window.",
  picks_in_awaiting_approval:
    "picks rows with source='system-pick-scanner', status='awaiting_approval', and created_at in the window.",
  posted_picks:
    "picks rows with source='system-pick-scanner', status='posted', and posted_at in the window.",
  settled_picks:
    "picks rows with source='system-pick-scanner', status='settled', and settled_at in the window.",
  clv_backed_settlements:
    "settlement_records rows settled in the window for system-pick-scanner picks whose payload includes clvRaw, clvPercent, or beatsClosingLine.",
  pnl_populated_settlements:
    "settlement_records rows settled in the window for system-pick-scanner picks whose payload includes profitLossUnits.",
  posted_system_picks_without_result:
    'Exact count of posted system-pick-scanner picks in the window with no matching game_results row.',
  posted_system_picks_missing_event:
    'Exact count of posted system-pick-scanner picks in the window without a resolvable event id from metadata or market_universe.',
  posted_system_picks_missing_participant:
    'Exact count of posted system-pick-scanner picks in the window without a pick, metadata, or market_universe participant id.',
  posted_system_picks_missing_market_type:
    'Exact count of posted system-pick-scanner picks in the window without a pick, metadata, or market_universe market_type_id.',
  posted_system_picks_with_game_result:
    'Exact count of posted system-pick-scanner picks in the window with a matching game_results row.',
};

function parseArea(argv: string[]): Area {
  const areaFlagIndex = argv.indexOf('--area');
  const area =
    areaFlagIndex >= 0
      ? argv[areaFlagIndex + 1]
      : argv.find((arg) => arg.startsWith('--area='))?.slice('--area='.length);

  if (area !== 'pipeline') {
    throw new Error(`Unsupported or missing area: ${area ?? '(missing)'}. Use --area pipeline.`);
  }

  return area;
}

function startOfLocalToday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

async function countRows(
  db: DatabaseClient,
  table: string,
  timestampColumn: string,
  since: string,
  // The repo's generated database type is intentionally loose at the Supabase
  // boundary, so keep this helper loose and validate behavior with live reads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filters: (query: any) => any = (query) => query,
): Promise<number> {
  let query = db
    .from(table)
    .select('id', { count: 'estimated' })
    .gte(timestampColumn, since)
    .limit(1);
  query = filters(query) as typeof query;
  const { count, error } = await query;

  if (error) {
    throw new Error(`${table} count failed: ${JSON.stringify(error)}`);
  }

  return count ?? 0;
}

async function fetchSettlementsInWindow(
  db: DatabaseClient,
  since: string,
): Promise<Array<{ payload: Record<string, unknown> | null }>> {
  const rows: Array<{ payload: Record<string, unknown> | null }> = [];
  const pageSize = 1_000;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await db
      .from('settlement_records')
      .select('payload,picks!inner(source)')
      .eq('picks.source', 'system-pick-scanner')
      .gte('settled_at', since)
      .range(from, to);

    if (error) {
      throw new Error(`settlement_records payload scan failed: ${JSON.stringify(error)}`);
    }

    const page = (data ?? []) as Array<{ payload: Record<string, unknown> | null }>;
    rows.push(...page);

    if (page.length < pageSize) {
      return rows;
    }
  }
}

function hasAnyPayloadKey(payload: Record<string, unknown> | null, keys: string[]): boolean {
  if (!payload) {
    return false;
  }
  return keys.some((key) => payload[key] !== undefined && payload[key] !== null);
}

async function fetchPostedSystemPickDiagnostics(
  db: DatabaseClient,
  since: string,
): Promise<{
  counts: Pick<
    PipelineWindowCounts,
    | 'posted_system_picks_without_result'
    | 'posted_system_picks_missing_event'
    | 'posted_system_picks_missing_participant'
    | 'posted_system_picks_missing_market_type'
    | 'posted_system_picks_with_game_result'
  >;
  skippedByReason: Record<string, number>;
  samples: PostedSystemPickSample[];
}> {
  const { data, error } = await db
    .from('picks')
    .select('id,market,market_type_id,selection,line,participant_id,metadata,posted_at')
    .eq('source', 'system-pick-scanner')
    .eq('status', 'posted')
    .gte('posted_at', since)
    .order('posted_at', { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`posted system pick diagnostic scan failed: ${JSON.stringify(error)}`);
  }

  let withoutResult = 0;
  let missingEvent = 0;
  let missingParticipant = 0;
  let missingMarketType = 0;
  let withGameResult = 0;
  const skippedByReason: Record<string, number> = {};
  const samples: PostedSystemPickSample[] = [];

  for (const pick of data ?? []) {
    const metadata = asRecord(pick.metadata);
    const marketUniverseId = readString(metadata, 'marketUniverseId') ?? readString(metadata, 'universeId');
    const universe = marketUniverseId
      ? await fetchMarketUniverseDiagnostic(db, marketUniverseId)
      : null;
    const eventId =
      readString(metadata, 'eventId') ??
      readString(metadata, 'event_id') ??
      universe?.event_id ??
      null;
    const participantId =
      pick.participant_id ??
      readString(metadata, 'participantId') ??
      readString(metadata, 'playerId') ??
      universe?.participant_id ??
      null;
    const marketTypeId =
      pick.market_type_id ??
      readString(metadata, 'marketTypeId') ??
      universe?.market_type_id ??
      null;
    const marketKeys = buildResultMarketKeyCandidates(pick.market, marketTypeId, universe?.canonical_market_key ?? null);
    const matchingGameResultCount = eventId
      ? await countMatchingGameResults(db, {
          eventId,
          participantId,
          marketKeys,
        })
      : 0;
    const settlementCount = await countPickSettlements(db, pick.id);

    if (!eventId) {
      missingEvent += 1;
    }
    if (!participantId) {
      missingParticipant += 1;
    }
    if (!marketTypeId) {
      missingMarketType += 1;
    }
    if (matchingGameResultCount > 0) {
      withGameResult += 1;
    } else {
      withoutResult += 1;
    }

    const gradingSkipReason = inferReadOnlyGradingSkipReason({
      market: pick.market,
      line: pick.line,
      eventId,
      participantId,
      marketTypeId,
      matchingGameResultCount,
      settlementCount,
    });
    skippedByReason[gradingSkipReason] = (skippedByReason[gradingSkipReason] ?? 0) + 1;

    if (samples.length < 10) {
      samples.push({
        pick_id: pick.id,
        market: pick.market,
        market_type_id: pick.market_type_id ?? null,
        selection: pick.selection,
        line: pick.line ?? null,
        event_id: eventId,
        participant_id: participantId,
        market_universe_id: marketUniverseId ?? null,
        market_universe_event_id: universe?.event_id ?? null,
        market_universe_market_type_id: universe?.market_type_id ?? null,
        market_universe_canonical_market_key: universe?.canonical_market_key ?? null,
        matching_game_result_count: matchingGameResultCount,
        settlement_count: settlementCount,
        grading_skip_reason: gradingSkipReason,
      });
    }
  }

  return {
    counts: {
      posted_system_picks_without_result: withoutResult,
      posted_system_picks_missing_event: missingEvent,
      posted_system_picks_missing_participant: missingParticipant,
      posted_system_picks_missing_market_type: missingMarketType,
      posted_system_picks_with_game_result: withGameResult,
    },
    skippedByReason,
    samples,
  };
}

async function fetchMarketUniverseDiagnostic(
  db: DatabaseClient,
  id: string,
): Promise<{
  event_id: string | null;
  participant_id: string | null;
  market_type_id: string | null;
  canonical_market_key: string | null;
} | null> {
  const { data, error } = await db
    .from('market_universe')
    .select('event_id,participant_id,market_type_id,canonical_market_key')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`market_universe diagnostic lookup failed: ${JSON.stringify(error)}`);
  }

  return data ?? null;
}

async function countMatchingGameResults(
  db: DatabaseClient,
  input: { eventId: string; participantId: string | null; marketKeys: string[] },
): Promise<number> {
  if (input.marketKeys.length === 0) {
    return 0;
  }

  let query = db
    .from('game_results')
    .select('id', { count: 'estimated' })
    .eq('event_id', input.eventId)
    .in('market_key', input.marketKeys)
    .limit(1);
  query = input.participantId === null
    ? query.is('participant_id', null)
    : query.eq('participant_id', input.participantId);
  const { count, error } = await query;

  if (error) {
    throw new Error(`game_results diagnostic lookup failed: ${JSON.stringify(error)}`);
  }

  return count ?? 0;
}

async function countPickSettlements(db: DatabaseClient, pickId: string): Promise<number> {
  const { count, error } = await db
    .from('settlement_records')
    .select('id', { count: 'estimated' })
    .eq('pick_id', pickId)
    .limit(1);

  if (error) {
    throw new Error(`settlement diagnostic lookup failed: ${JSON.stringify(error)}`);
  }

  return count ?? 0;
}

function buildResultMarketKeyCandidates(
  market: string,
  marketTypeId: string | null,
  universeCanonicalMarketKey: string | null,
): string[] {
  const keys = new Set<string>();
  keys.add(normalizeMarketKey(market));
  if (marketTypeId) {
    keys.add(marketTypeId);
  }
  if (universeCanonicalMarketKey) {
    keys.add(universeCanonicalMarketKey);
  }
  return [...keys].filter((key) => key.length > 0);
}

function inferReadOnlyGradingSkipReason(input: {
  market: string;
  line: number | null;
  eventId: string | null;
  participantId: string | null;
  marketTypeId: string | null;
  matchingGameResultCount: number;
  settlementCount: number;
}): string {
  if (input.settlementCount > 0) {
    return 'settlement_already_exists';
  }

  const marketKey = normalizeMarketKey(input.market);
  const participantRequired = isParticipantRequiredForGrading(marketKey, input.marketTypeId);
  if (!isSupportedForGrading(marketKey, input.marketTypeId)) {
    return 'unsupported_market_family';
  }
  if (participantRequired && !input.participantId) {
    return 'missing_participant_id';
  }
  if (!Number.isFinite(input.line)) {
    return 'missing_line';
  }
  if (!input.eventId) {
    return 'event_link_not_found';
  }
  if (input.matchingGameResultCount === 0) {
    return 'game_result_not_found';
  }
  return 'eligible_for_grading';
}

function isSupportedForGrading(marketKey: string, marketTypeId: string | null): boolean {
  return (
    marketKey === 'game_total_ou' ||
    marketKey === 'team_total_ou' ||
    marketKey.endsWith('-all-game-ou') ||
    /^player_[a-z0-9_]+_ou$/.test(marketKey) ||
    /^(batting|pitching)_[a-z0-9_]+_ou$/.test(marketKey) ||
    marketTypeId === 'game_total_ou' ||
    marketTypeId === 'team_total_ou' ||
    Boolean(marketTypeId?.endsWith('_ou'))
  );
}

function isParticipantRequiredForGrading(marketKey: string, marketTypeId: string | null): boolean {
  return marketKey !== 'game_total_ou' && marketTypeId !== 'game_total_ou';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function collectWindow(
  db: DatabaseClient,
  label: string,
  since: string,
): Promise<ReportWindow> {
  const providerOffers = await countRows(db, 'provider_offers', 'snapshot_at', since);
  const marketUniverseRowsRefreshed = await countRows(db, 'market_universe', 'refreshed_at', since);
  const pickCandidatesCreated = await countRows(db, 'pick_candidates', 'created_at', since);
  const pickCandidatesScored = await countRows(db, 'pick_candidates', 'updated_at', since, (query) =>
    query.not('model_score', 'is', null),
  );
  const qualifiedCandidates = await countRows(db, 'pick_candidates', 'created_at', since, (query) =>
    query.eq('status', 'qualified'),
  );
  const candidatesWithPickId = await countRows(db, 'pick_candidates', 'updated_at', since, (query) =>
    query.not('pick_id', 'is', null),
  );
  const picksCreatedByScanner = await countRows(db, 'picks', 'created_at', since, (query) =>
    query.eq('source', 'system-pick-scanner'),
  );
  const picksAwaitingApproval = await countRows(db, 'picks', 'created_at', since, (query) =>
    query.eq('source', 'system-pick-scanner').eq('status', 'awaiting_approval'),
  );
  const postedPicks = await countRows(db, 'picks', 'posted_at', since, (query) =>
    query.eq('source', 'system-pick-scanner').eq('status', 'posted'),
  );
  const settledPicks = await countRows(db, 'picks', 'settled_at', since, (query) =>
    query.eq('source', 'system-pick-scanner').eq('status', 'settled'),
  );
  const settlements = await fetchSettlementsInWindow(db, since);
  const postedDiagnostics = await fetchPostedSystemPickDiagnostics(db, since);

  const counts: PipelineWindowCounts = {
    provider_offers: providerOffers,
    market_universe_rows_refreshed: marketUniverseRowsRefreshed,
    pick_candidates_created: pickCandidatesCreated,
    pick_candidates_scored: pickCandidatesScored,
    qualified_candidates: qualifiedCandidates,
    candidates_with_pick_id: candidatesWithPickId,
    picks_created_by_system_pick_scanner: picksCreatedByScanner,
    picks_in_awaiting_approval: picksAwaitingApproval,
    posted_picks: postedPicks,
    settled_picks: settledPicks,
    clv_backed_settlements: settlements.filter((row) =>
      hasAnyPayloadKey(row.payload, ['clvRaw', 'clvPercent', 'beatsClosingLine']),
    ).length,
    pnl_populated_settlements: settlements.filter((row) =>
      hasAnyPayloadKey(row.payload, ['profitLossUnits']),
    ).length,
    ...postedDiagnostics.counts,
  };

  const dropOff = identifyDropOff(counts);
  const suspectedBlockers = identifySuspectedBlockers(counts);
  const diagnosis = formatWindowDiagnosis(dropOff, postedDiagnostics.skippedByReason);

  return {
    label,
    since,
    counts,
    dropOff,
    diagnosis,
    suspectedBlockers,
    posted_system_picks_skipped_by_grading_reason: postedDiagnostics.skippedByReason,
    posted_system_pick_samples: postedDiagnostics.samples,
  };
}

function formatWindowDiagnosis(
  dropOff: FunnelDropOff,
  skippedByReason: Record<string, number>,
): string {
  const skipEntries = Object.entries(skippedByReason);
  if (
    dropOff.from === 'posted_picks' &&
    dropOff.to === 'settled_picks' &&
    skipEntries.length > 0
  ) {
    const reasons = skipEntries
      .map(([reason, count]) => `${reason}=${count}`)
      .join(', ');
    return `Posted system-pick-scanner picks are not settlement-eligible: ${reasons}.`;
  }

  return formatDiagnosis(dropOff);
}

function identifyDropOff(counts: PipelineWindowCounts): FunnelDropOff {
  const checks: Array<[CountKey, CountKey, boolean]> = [
    ['provider_offers', 'market_universe_rows_refreshed', counts.provider_offers > 0],
    ['market_universe_rows_refreshed', 'pick_candidates_created', counts.market_universe_rows_refreshed > 0],
    ['pick_candidates_created', 'pick_candidates_scored', counts.pick_candidates_created > 0],
    ['qualified_candidates', 'picks_created_by_system_pick_scanner', counts.qualified_candidates > 0 && counts.pick_candidates_scored > 0],
    ['picks_in_awaiting_approval', 'posted_picks', counts.picks_in_awaiting_approval > 0],
    ['posted_picks', 'settled_picks', counts.posted_picks > 0],
  ];

  for (const [from, to, applies] of checks) {
    if (applies && counts[from] > 0 && counts[to] === 0) {
      return { from, to, fromCount: counts[from], toCount: counts[to] };
    }
  }

  return { from: null, to: null, fromCount: null, toCount: null };
}

function formatDiagnosis(dropOff: FunnelDropOff): string {
  if (!dropOff.from || !dropOff.to) {
    return 'No hard zero-count funnel stop detected in this window.';
  }

  if (dropOff.from === 'provider_offers' && dropOff.to === 'market_universe_rows_refreshed') {
    return 'MarketUniverseMaterializer is not refreshing rows from provider_offers.';
  }
  if (dropOff.from === 'market_universe_rows_refreshed' && dropOff.to === 'pick_candidates_created') {
    return 'CandidateBuilderService is not creating candidates from refreshed market_universe rows.';
  }
  if (dropOff.from === 'pick_candidates_created' && dropOff.to === 'pick_candidates_scored') {
    return 'Candidate scoring scheduler/model scoring is not scoring created candidates.';
  }
  if (dropOff.from === 'qualified_candidates' && dropOff.to === 'picks_created_by_system_pick_scanner') {
    return 'CandidatePickScanner is not linking qualified scored candidates to picks.';
  }
  if (dropOff.from === 'picks_in_awaiting_approval' && dropOff.to === 'posted_picks') {
    return 'Command Center/operator approval flow is not moving awaiting_approval picks forward.';
  }
  if (dropOff.from === 'posted_picks' && dropOff.to === 'settled_picks') {
    return 'Settlement/grading path has posted system-pick-scanner picks but no settled system-pick-scanner picks.';
  }

  return `${dropOff.from} has ${dropOff.fromCount}, but ${dropOff.to} has ${dropOff.toCount}.`;
}

function identifySuspectedBlockers(counts: PipelineWindowCounts): string[] {
  const blockers: string[] = [];

  if (counts.provider_offers > 0 && counts.market_universe_rows_refreshed === 0) {
    blockers.push('MarketUniverseMaterializer path: offers are present but no market_universe rows refreshed.');
  }
  if (counts.provider_offers > 0 && counts.pick_candidates_created === 0) {
    blockers.push('CandidateBuilderService path: provider_offers are present but no pick_candidates were created.');
  }
  if (counts.pick_candidates_created > 0 && counts.pick_candidates_scored === 0) {
    blockers.push('Candidate scoring path: candidates exist but model_score is not being populated.');
  }
  if (counts.pick_candidates_scored > 0 && counts.qualified_candidates > 0 && counts.picks_created_by_system_pick_scanner === 0) {
    blockers.push('CandidatePickScanner path: scored qualified candidates exist but no system-pick-scanner picks were created.');
  }
  if (counts.picks_in_awaiting_approval > 0 && counts.posted_picks === 0) {
    blockers.push('Operator approval path: awaiting_approval picks exist but none posted in the window.');
  }
  if (counts.posted_picks > 0 && counts.settled_picks === 0) {
    blockers.push('Settlement/grading path: posted system-pick-scanner picks exist but none settled in the window.');
  }
  if (counts.settled_picks > 0 && counts.clv_backed_settlements === 0) {
    blockers.push('Settlement CLV path: settled picks exist but settlement payloads have no CLV fields.');
  }
  if (counts.settled_picks > 0 && counts.pnl_populated_settlements === 0) {
    blockers.push('Settlement P&L path: settled picks exist but settlement payloads have no profitLossUnits.');
  }

  return blockers.length > 0 ? blockers : ['No obvious zero-count blocker detected from the requested funnel counts.'];
}

function buildSuggestedLinearIssue(report: PipelineReport): PipelineReport['suggested_linear_issue'] {
  const primary = report.windows.last24h;
  const counts = primary.counts;
  const blockers = primary.suspectedBlockers.map((blocker) => `- ${blocker}`).join('\n');

  return {
    title: `Investigate system pick pipeline drop-off: ${primary.diagnosis}`,
    description: [
      '## Problem',
      'The read-only pipeline audit shows a system-generated pick funnel drop-off.',
      '',
      '## Last 24h counts',
      ...COUNT_KEYS.map((key) => `- ${key}: ${counts[key]}`),
      '',
      '## Diagnosis',
      primary.diagnosis,
      '',
      '## Top suspected blockers',
      blockers,
      '',
      '## Acceptance criteria',
      '- Identify the first failing service/path in the system-generated pick pipeline.',
      '- Add or update focused node:test coverage for the failing path.',
      '- Keep DB writes scoped to the actual runtime fix; do not create proof picks unless explicitly required.',
      '- Run pnpm verify before PR.',
    ].join('\n'),
  };
}

function renderMarkdown(report: PipelineReport): string {
  const lines = [
    '# System Check: Pipeline',
    '',
    `Generated: ${report.generated_at}`,
    `Mode: ${report.mode}`,
    `Counting strategy: ${report.counting_strategy}`,
    '',
  ];

  for (const key of ['today', 'last24h'] as const) {
    const window = report.windows[key];
    lines.push(`## ${window.label}`);
    lines.push('');
    lines.push(`Since: ${window.since}`);
    lines.push('');
    lines.push('| Count | Value |');
    lines.push('|---|---:|');
    for (const countKey of COUNT_KEYS) {
      lines.push(`| ${countKey} | ${window.counts[countKey]} |`);
    }
    lines.push('');
    lines.push(`Diagnosis: ${window.diagnosis}`);
    lines.push('');
    lines.push('Top suspected blockers:');
    for (const blocker of window.suspectedBlockers) {
      lines.push(`- ${blocker}`);
    }
    lines.push('');
    lines.push('Posted system-pick grading skip reasons:');
    for (const [reason, count] of Object.entries(window.posted_system_picks_skipped_by_grading_reason)) {
      lines.push(`- ${reason}: ${count}`);
    }
    if (Object.keys(window.posted_system_picks_skipped_by_grading_reason).length === 0) {
      lines.push('- none');
    }
    lines.push('');
    lines.push('Posted system-pick samples:');
    lines.push('| Pick | Market | Type | Line | Event | Participant | Game Results | Settlement | Skip Reason |');
    lines.push('|---|---|---|---:|---|---|---:|---:|---|');
    for (const sample of window.posted_system_pick_samples) {
      lines.push(
        `| ${sample.pick_id} | ${sample.market} | ${sample.market_universe_market_type_id ?? sample.market_type_id ?? ''} | ${sample.line ?? ''} | ${sample.event_id ?? ''} | ${sample.participant_id ?? ''} | ${sample.matching_game_result_count} | ${sample.settlement_count} | ${sample.grading_skip_reason} |`,
      );
    }
    if (window.posted_system_pick_samples.length === 0) {
      lines.push('| none |  |  |  |  |  |  |  |  |');
    }
    lines.push('');
  }

  lines.push('## Definitions');
  lines.push('');
  for (const countKey of COUNT_KEYS) {
    lines.push(`- ${countKey}: ${report.definitions[countKey]}`);
  }
  lines.push('');
  lines.push('## Suggested Linear Issue Text');
  lines.push('');
  lines.push(`Title: ${report.suggested_linear_issue.title}`);
  lines.push('');
  lines.push(report.suggested_linear_issue.description);
  lines.push('');

  return lines.join('\n');
}

async function buildPipelineReport(db: DatabaseClient): Promise<PipelineReport> {
  const now = new Date();
  const generatedAt = now.toISOString();
  const todaySince = startOfLocalToday(now).toISOString();
  const last24hSince = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString();

  const [today, last24h] = await Promise.all([
    collectWindow(db, 'Today', todaySince),
    collectWindow(db, 'Last 24h', last24hSince),
  ]);

  const report: PipelineReport = {
    schema_version: 1,
    generated_at: generatedAt,
    area: 'pipeline',
    mode: 'read-only',
    counting_strategy: 'supabase_estimated_count',
    output_paths: {
      json: JSON_REPORT_PATH,
      markdown: MARKDOWN_REPORT_PATH,
    },
    windows: { today, last24h },
    definitions: DEFINITIONS,
    suggested_linear_issue: { title: '', description: '' },
  };

  report.suggested_linear_issue = buildSuggestedLinearIssue(report);
  return report;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  parseArea(argv);
  const env = loadEnvironment();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for pipeline system check.');
  }
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const report = await buildPipelineReport(db);

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(MARKDOWN_REPORT_PATH, renderMarkdown(report), 'utf8');

  console.log(`Wrote ${JSON_REPORT_PATH}`);
  console.log(`Wrote ${MARKDOWN_REPORT_PATH}`);
  console.log(`Diagnosis (last 24h): ${report.windows.last24h.diagnosis}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export {
  buildPipelineReport,
  identifyDropOff,
  identifySuspectedBlockers,
  renderMarkdown,
};
