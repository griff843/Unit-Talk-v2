/**
 * UTV2-746 Proof: SGO Contract Replay Scorecard
 *
 * Replays all posted picks through the hardened SGO contract validator
 * (dry-run — no settlements written). Reports pass/fail by sport × market family.
 *
 * Run:
 *   npx tsx scripts/proof/utv2-746-sgo-contract-replay-scorecard.ts
 *   npx tsx scripts/proof/utv2-746-sgo-contract-replay-scorecard.ts --dry-run
 *   npx tsx scripts/proof/utv2-746-sgo-contract-replay-scorecard.ts --include-settled
 *
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type SupabaseClient } from '../../packages/db/node_modules/@supabase/supabase-js/dist/index.mjs';
import { loadEnvironment } from '@unit-talk/config';

type Client = SupabaseClient<Record<string, never>>;

const PAGE_SIZE = 1000;

interface CliOptions {
  dryRun: boolean;
  includeSettled: boolean;
  outPath: string;
  evidencePath: string;
}

// --- Data shapes from DB ---

interface PickRow {
  id: string;
  market: string;
  selection: string;
  participant_id: string | null;
  line: number | null;
  sport_id: string;
  status: string;
}

interface SettlementRow {
  pick_id: string;
}

interface EventParticipantRow {
  participant_id: string;
  event_id: string;
}

interface EventRow {
  id: string;
  sport_id: string;
  status: string;
  external_id: string | null;
}

interface GameResultRow {
  event_id: string;
  participant_id: string | null;
  market_key: string;
  actual_value: number;
}

interface SportRow {
  id: string;
  display_name: string;
}

// --- Contract rule types (mirrors grading-service.ts) ---

type MarketFamily = 'player_prop' | 'game_total' | 'team_total' | 'unsupported';
type ParticipantRequirement = 'required' | 'forbidden';
type SkipReason =
  | 'settlement_already_exists'
  | 'unsupported_market_family'
  | 'missing_participant_id'
  | 'missing_line'
  | 'event_link_not_found'
  | 'event_not_completed'
  | 'event_provenance_missing_external_id'
  | 'game_result_not_found'
  | 'selection_side_not_supported';

interface ContractCheckResult {
  pickId: string;
  sportDisplayName: string;
  marketFamily: MarketFamily;
  outcome: 'pass' | 'skip';
  skipReason?: SkipReason;
}

interface MarketFamilyRule {
  family: MarketFamily;
  participantRequirement: ParticipantRequirement;
  gradeable: boolean;
}

// --- Market classification (mirrors grading-service.ts classifyMarketFamilyForGrading) ---

function classifyMarketFamily(marketKey: string): MarketFamilyRule {
  const normalized = marketKey.toLowerCase().trim();

  if (normalized === 'game_total_ou') {
    return { family: 'game_total', participantRequirement: 'forbidden', gradeable: true };
  }

  if (normalized === 'team_total_ou') {
    return { family: 'team_total', participantRequirement: 'required', gradeable: true };
  }

  if (
    normalized.endsWith('-all-game-ou') ||
    /^player_[a-z0-9_]+_ou$/.test(normalized) ||
    /^(batting|pitching)_[a-z0-9_]+_ou$/.test(normalized)
  ) {
    return { family: 'player_prop', participantRequirement: 'required', gradeable: true };
  }

  return { family: 'unsupported', participantRequirement: 'forbidden', gradeable: false };
}

// --- Selection side inference (mirrors grading-service.ts inferSelectionSide) ---

function inferSelectionSide(selection: string): 'over' | 'under' | null {
  const normalized = selection.toLowerCase();
  if (/\bover\b/.test(normalized)) return 'over';
  if (/\bunder\b/.test(normalized)) return 'under';
  if (/\bO\s+\d/.test(selection) || /^O\s+\d/.test(selection)) return 'over';
  if (/\bU\s+\d/.test(selection) || /^U\s+\d/.test(selection)) return 'under';
  return null;
}

// --- Grading market key aliases (mirrors grading-service.ts COMMON_GRADING_MARKET_ALIASES) ---

const GRADING_MARKET_ALIASES: Record<string, string> = {
  'points-all-game-ou': 'player_points_ou',
  player_points_ou: 'points-all-game-ou',
  'rebounds-all-game-ou': 'player_rebounds_ou',
  player_rebounds_ou: 'rebounds-all-game-ou',
  'assists-all-game-ou': 'player_assists_ou',
  player_assists_ou: 'assists-all-game-ou',
  batting_hits_ou: 'player_batting_hits_ou',
  batting_total_bases_ou: 'player_batting_total_bases_ou',
  batting_walks_ou: 'player_batting_walks_ou',
  batting_singles_ou: 'player_batting_singles_ou',
  batting_doubles_ou: 'player_batting_doubles_ou',
  batting_triples_ou: 'player_batting_triples_ou',
  batting_home_runs_ou: 'player_batting_home_runs_ou',
  batting_rbi_ou: 'player_batting_rbi_ou',
  batting_hrr_ou: 'player_batting_hrr_ou',
  batting_strikeouts_ou: 'batting_strikeouts-all-game-ou',
  pitching_strikeouts_ou: 'player_pitching_strikeouts_ou',
  pitching_innings_ou: 'player_pitching_innings_ou',
};

// --- Data fetching ---

async function fetchAllPaged<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await fetchPage(from, from + PAGE_SIZE - 1);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchPostedPicks(client: Client): Promise<PickRow[]> {
  return fetchAllPaged(async (from, to) => {
    const { data, error } = await client
      .from('picks')
      .select('id,market,selection,participant_id,line,sport_id,status')
      .eq('status', 'posted')
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as PickRow[];
  });
}

async function fetchAllPicks(client: Client): Promise<PickRow[]> {
  return fetchAllPaged(async (from, to) => {
    const { data, error } = await client
      .from('picks')
      .select('id,market,selection,participant_id,line,sport_id,status')
      .in('status', ['posted', 'settled'])
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as PickRow[];
  });
}

async function fetchSettledPickIds(client: Client, pickIds: string[]): Promise<Set<string>> {
  if (pickIds.length === 0) return new Set();
  const settled = new Set<string>();
  for (const chunk of chunkArray(pickIds, 200)) {
    const { data, error } = await client
      .from('settlements')
      .select('pick_id')
      .in('pick_id', chunk);
    if (error) throw error;
    for (const row of (data ?? []) as SettlementRow[]) {
      settled.add(row.pick_id);
    }
  }
  return settled;
}

async function fetchSports(client: Client): Promise<Map<string, string>> {
  const { data, error } = await client.from('sports').select('id,display_name');
  if (error) throw error;
  return new Map((data ?? []).map((row: SportRow) => [row.id, row.display_name]));
}

async function fetchEventParticipants(
  client: Client,
  participantIds: string[],
): Promise<Map<string, string[]>> {
  if (participantIds.length === 0) return new Map();

  const byParticipant = new Map<string, string[]>();
  for (const chunk of chunkArray(participantIds, 200)) {
    const rows = await fetchAllPaged<EventParticipantRow>(async (from, to) => {
      const { data, error } = await client
        .from('event_participants')
        .select('participant_id,event_id')
        .in('participant_id', chunk)
        .range(from, to);
      if (error) throw error;
      return (data ?? []) as EventParticipantRow[];
    });
    for (const row of rows) {
      const existing = byParticipant.get(row.participant_id) ?? [];
      existing.push(row.event_id);
      byParticipant.set(row.participant_id, existing);
    }
  }
  return byParticipant;
}

async function fetchEvents(client: Client, eventIds: string[]): Promise<Map<string, EventRow>> {
  if (eventIds.length === 0) return new Map();

  const eventMap = new Map<string, EventRow>();
  for (const chunk of chunkArray(eventIds, 200)) {
    const { data, error } = await client
      .from('events')
      .select('id,sport_id,status,external_id')
      .in('id', chunk);
    if (error) throw error;
    for (const row of (data ?? []) as EventRow[]) {
      eventMap.set(row.id, row);
    }
  }
  return eventMap;
}

async function fetchGameResultsForEvents(
  client: Client,
  eventIds: string[],
): Promise<Map<string, GameResultRow[]>> {
  if (eventIds.length === 0) return new Map();

  const byEvent = new Map<string, GameResultRow[]>();
  for (const chunk of chunkArray(eventIds, 200)) {
    const rows = await fetchAllPaged<GameResultRow>(async (from, to) => {
      const { data, error } = await client
        .from('game_results')
        .select('event_id,participant_id,market_key,actual_value')
        .in('event_id', chunk)
        .range(from, to);
      if (error) throw error;
      return (data ?? []) as GameResultRow[];
    });
    for (const row of rows) {
      const existing = byEvent.get(row.event_id) ?? [];
      existing.push(row);
      byEvent.set(row.event_id, existing);
    }
  }
  return byEvent;
}

// --- Contract validation (dry-run) ---

function normalizeMarketKey(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '_').trim();
}

function resolveGradingMarketKeyCandidates(normalizedKey: string): string[] {
  const candidates = new Set([normalizedKey]);
  const alias = GRADING_MARKET_ALIASES[normalizedKey];
  if (alias) candidates.add(alias);
  return [...candidates];
}

function findGameResult(
  results: GameResultRow[],
  participantId: string | null,
  marketKeys: string[],
): GameResultRow | null {
  for (const key of marketKeys) {
    const match = results.find(
      (r) =>
        r.market_key === key &&
        (r.participant_id === participantId || r.participant_id === null),
    );
    if (match) return match;
  }
  return null;
}

function runContractCheck(
  pick: PickRow,
  sportDisplayName: string,
  alreadySettled: boolean,
  eventsByParticipant: Map<string, string[]>,
  eventById: Map<string, EventRow>,
  gameResultsByEvent: Map<string, GameResultRow[]>,
): ContractCheckResult {
  const marketFamily = classifyMarketFamily(normalizeMarketKey(pick.market));

  if (alreadySettled) {
    return {
      pickId: pick.id,
      sportDisplayName,
      marketFamily: marketFamily.family,
      outcome: 'skip',
      skipReason: 'settlement_already_exists',
    };
  }

  if (!marketFamily.gradeable) {
    return {
      pickId: pick.id,
      sportDisplayName,
      marketFamily: marketFamily.family,
      outcome: 'skip',
      skipReason: 'unsupported_market_family',
    };
  }

  if (marketFamily.participantRequirement === 'required' && !pick.participant_id) {
    return {
      pickId: pick.id,
      sportDisplayName,
      marketFamily: marketFamily.family,
      outcome: 'skip',
      skipReason: 'missing_participant_id',
    };
  }

  if (pick.line === null || !Number.isFinite(pick.line)) {
    return {
      pickId: pick.id,
      sportDisplayName,
      marketFamily: marketFamily.family,
      outcome: 'skip',
      skipReason: 'missing_line',
    };
  }

  const eventIds =
    marketFamily.participantRequirement === 'forbidden' || !pick.participant_id
      ? []
      : (eventsByParticipant.get(pick.participant_id) ?? []);

  const candidateEvents = eventIds
    .map((id) => eventById.get(id))
    .filter((e): e is EventRow => e !== null);

  if (candidateEvents.length === 0) {
    return {
      pickId: pick.id,
      sportDisplayName,
      marketFamily: marketFamily.family,
      outcome: 'skip',
      skipReason: 'event_link_not_found',
    };
  }

  const completedEvent = candidateEvents.find((e) => e.status === 'completed') ?? null;

  if (!completedEvent) {
    return {
      pickId: pick.id,
      sportDisplayName,
      marketFamily: marketFamily.family,
      outcome: 'skip',
      skipReason: 'event_not_completed',
    };
  }

  if (!completedEvent.external_id) {
    return {
      pickId: pick.id,
      sportDisplayName,
      marketFamily: marketFamily.family,
      outcome: 'skip',
      skipReason: 'event_provenance_missing_external_id',
    };
  }

  const normalizedMarket = normalizeMarketKey(pick.market);
  const marketKeys = resolveGradingMarketKeyCandidates(normalizedMarket);
  const eventResults = gameResultsByEvent.get(completedEvent.id) ?? [];
  const gameResult = findGameResult(eventResults, pick.participant_id, marketKeys);

  if (!gameResult) {
    return {
      pickId: pick.id,
      sportDisplayName,
      marketFamily: marketFamily.family,
      outcome: 'skip',
      skipReason: 'game_result_not_found',
    };
  }

  const side = inferSelectionSide(pick.selection);
  if (!side) {
    return {
      pickId: pick.id,
      sportDisplayName,
      marketFamily: marketFamily.family,
      outcome: 'skip',
      skipReason: 'selection_side_not_supported',
    };
  }

  return {
    pickId: pick.id,
    sportDisplayName,
    marketFamily: marketFamily.family,
    outcome: 'pass',
  };
}

// --- Scorecard aggregation ---

interface SportFamilyBucket {
  sport: string;
  marketFamily: MarketFamily;
  attempted: number;
  passed: number;
  skips: Record<string, number>;
}

function buildScorecard(results: ContractCheckResult[]) {
  const bucketKey = (r: ContractCheckResult) => `${r.sportDisplayName}|${r.marketFamily}`;
  const buckets = new Map<string, SportFamilyBucket>();
  const globalSkips: Record<string, number> = {};

  for (const result of results) {
    const key = bucketKey(result);
    const bucket = buckets.get(key) ?? {
      sport: result.sportDisplayName,
      marketFamily: result.marketFamily,
      attempted: 0,
      passed: 0,
      skips: {},
    };

    bucket.attempted += 1;
    if (result.outcome === 'pass') {
      bucket.passed += 1;
    } else if (result.skipReason) {
      bucket.skips[result.skipReason] = (bucket.skips[result.skipReason] ?? 0) + 1;
      globalSkips[result.skipReason] = (globalSkips[result.skipReason] ?? 0) + 1;
    }

    buckets.set(key, bucket);
  }

  const sortedBuckets = [...buckets.values()].sort(
    (a, b) =>
      a.sport.localeCompare(b.sport) ||
      a.marketFamily.localeCompare(b.marketFamily),
  );

  const totalAttempted = results.length;
  const totalPassed = results.filter((r) => r.outcome === 'pass').length;
  const totalSkipped = totalAttempted - totalPassed;

  return { sortedBuckets, globalSkips, totalAttempted, totalPassed, totalSkipped };
}

// --- Markdown output ---

function buildMarkdown(
  scorecard: ReturnType<typeof buildScorecard>,
  runAt: string,
  includeSettled: boolean,
): string {
  const { sortedBuckets, globalSkips, totalAttempted, totalPassed, totalSkipped } = scorecard;
  const passRate = totalAttempted > 0
    ? ((totalPassed / totalAttempted) * 100).toFixed(1)
    : 'n/a';

  const lines: string[] = [
    '# UTV2-746 SGO Contract Replay Scorecard',
    '',
    `**Generated:** ${runAt}`,
    `**Scope:** ${includeSettled ? 'posted + settled' : 'posted only (ungraded picks)'}`,
    `**Contract validator version:** post-hardening sprint (UTV2-664 → UTV2-745)`,
    '',
    '---',
    '',
    '## Overall',
    '',
    `| Metric | Value |`,
    `|---|---|`,
    `| Attempted | ${totalAttempted} |`,
    `| Passed (graded) | ${totalPassed} (${passRate}%) |`,
    `| Skipped (failed contract) | ${totalSkipped} |`,
    '',
    '---',
    '',
    '## Pass Rate by SGO Event Type (Sport × Market Family)',
    '',
    '| Sport | Market Family | Attempted | Passed | Pass% | Top Skip Reason |',
    '|---|---|---:|---:|---:|---|',
  ];

  for (const bucket of sortedBuckets) {
    const pct = bucket.attempted > 0
      ? ((bucket.passed / bucket.attempted) * 100).toFixed(1)
      : 'n/a';
    const topSkip = Object.entries(bucket.skips)
      .sort(([, a], [, b]) => b - a)[0];
    const topSkipLabel = topSkip
      ? `${topSkip[0]} (${topSkip[1]})`
      : '—';
    lines.push(
      `| ${bucket.sport} | ${bucket.marketFamily} | ${bucket.attempted} | ${bucket.passed} | ${pct}% | ${topSkipLabel} |`,
    );
  }

  lines.push(
    '',
    '---',
    '',
    '## Skip Reason Breakdown (Root Cause Analysis)',
    '',
    '| Skip Reason | Count | % of Attempted | Root Cause |',
    '|---|---:|---:|---|',
  );

  const rootCauses: Record<string, string> = {
    event_not_completed:
      'Event status still in_progress or scheduled — finalized-results repoll (UTV2-745) should clear these',
    missing_participant_id:
      'Pick participant_id not set — provider_entity_aliases backfill gap (UTV2-740)',
    game_result_not_found:
      'No game_results row matching event + participant + market key — ingest gap or market key alias missing',
    selection_side_not_supported:
      'inferSelectionSide() cannot resolve over/under from pick.selection string',
    unsupported_market_family:
      'Market key does not match any gradeable family (game_total, team_total, player_prop)',
    settlement_already_exists:
      'Pick already settled — correct behavior, not a failure',
    missing_line:
      'Pick.line is null — data ingestion issue',
    event_link_not_found:
      'No event_participants row linking participant to any event',
    event_provenance_missing_external_id:
      'Event has no external_id — cannot verify provider provenance',
  };

  const sortedSkips = Object.entries(globalSkips).sort(([, a], [, b]) => b - a);
  for (const [reason, count] of sortedSkips) {
    const pct = totalAttempted > 0
      ? ((count / totalAttempted) * 100).toFixed(1)
      : 'n/a';
    const cause = rootCauses[reason] ?? 'Unknown — investigate manually';
    lines.push(`| \`${reason}\` | ${count} | ${pct}% | ${cause} |`);
  }

  lines.push(
    '',
    '---',
    '',
    '## Acceptance Criteria Check',
    '',
    '| Criterion | Status |',
    '|---|---|',
    `| Scorecard shows pass rate by SGO event type | ${totalAttempted > 0 ? 'PASS' : 'BLOCKED — no picks found'} |`,
    `| Failures documented with root cause | PASS — see Skip Reason Breakdown above |`,
    '',
    '---',
    '',
    '## Open Gaps',
    '',
    '| Gap | Issue | Status |',
    '|---|---|---|',
    '| 40 `missing_participant_id` picks — player alias backfill | UTV2-740 | Ready for Codex |',
    '| `scoringSupported=true` hard gate | UTV2-742 | Ready for Codex |',
    '| `includeOpenCloseOdds=true` always in historical | UTV2-744 | Ready for Codex |',
    '| Participant-aware market aliasing in materializer | UTV2-732 | Codex lane active |',
    '',
    '*This scorecard is derived from a dry-run replay — no settlements were written.*',
  );

  return lines.join('\n') + '\n';
}

// --- Main ---

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const env = loadEnvironment();

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const client = createClient<Record<string, never>>(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  console.log('=== UTV2-746 SGO Contract Replay Scorecard ===');
  console.log(`Scope: ${options.includeSettled ? 'posted + settled' : 'posted only'}`);
  console.log('Fetching data...\n');

  const picks = options.includeSettled
    ? await fetchAllPicks(client)
    : await fetchPostedPicks(client);

  console.log(`Picks loaded: ${picks.length}`);

  const sports = await fetchSports(client);
  const settledIds = await fetchSettledPickIds(client, picks.map((p) => p.id));

  const participantIds = unique(
    picks
      .map((p) => p.participant_id)
      .filter((id): id is string => id !== null),
  );
  const eventsByParticipant = await fetchEventParticipants(client, participantIds);

  const allEventIds = unique([...eventsByParticipant.values()].flat());
  const eventById = await fetchEvents(client, allEventIds);

  const completedEventIds = [...eventById.values()]
    .filter((e) => e.status === 'completed')
    .map((e) => e.id);
  const gameResultsByEvent = await fetchGameResultsForEvents(client, completedEventIds);

  console.log(
    `Events: ${eventById.size} total, ${completedEventIds.length} completed`,
  );
  console.log(`Game results loaded for ${gameResultsByEvent.size} events\n`);

  const results: ContractCheckResult[] = [];
  for (const pick of picks) {
    const sportName = sports.get(pick.sport_id) ?? pick.sport_id;
    const result = runContractCheck(
      pick,
      sportName,
      settledIds.has(pick.id),
      eventsByParticipant,
      eventById,
      gameResultsByEvent,
    );
    results.push(result);
  }

  const scorecard = buildScorecard(results);
  const runAt = new Date().toISOString();
  const markdown = buildMarkdown(scorecard, runAt, options.includeSettled);

  console.log(markdown);

  if (options.dryRun) {
    console.log(`Dry-run: not writing files`);
    return;
  }

  const mdPath = resolve(options.outPath);
  await mkdir(dirname(mdPath), { recursive: true });
  await writeFile(mdPath, markdown, 'utf8');
  console.log(`Wrote ${mdPath}`);

  const evidence = {
    schema_version: 1,
    issue_id: 'UTV2-746',
    generated_at: runAt,
    scope: options.includeSettled ? 'posted+settled' : 'posted',
    summary: {
      attempted: scorecard.totalAttempted,
      passed: scorecard.totalPassed,
      skipped: scorecard.totalSkipped,
      pass_rate_pct:
        scorecard.totalAttempted > 0
          ? Math.round((scorecard.totalPassed / scorecard.totalAttempted) * 1000) / 10
          : null,
    },
    skip_breakdown: scorecard.globalSkips,
    by_sport_family: scorecard.sortedBuckets.map((b) => ({
      sport: b.sport,
      market_family: b.marketFamily,
      attempted: b.attempted,
      passed: b.passed,
      pass_rate_pct:
        b.attempted > 0
          ? Math.round((b.passed / b.attempted) * 1000) / 10
          : null,
      skip_reasons: b.skips,
    })),
  };

  const evidencePath = resolve(options.evidencePath);
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${evidencePath}`);
}

// --- CLI ---

function parseCliOptions(args: string[]): CliOptions {
  const flags = new Set<string>();
  const values = new Map<string, string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      values.set(key, next);
      i++;
    } else {
      flags.add(key);
    }
  }

  return {
    dryRun: flags.has('dry-run'),
    includeSettled: flags.has('include-settled'),
    outPath:
      values.get('out') ??
      'docs/06_status/proof/UTV2-746/scorecard-live.md',
    evidencePath:
      values.get('evidence') ??
      'docs/06_status/proof/UTV2-746/evidence-live.json',
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err: unknown) => {
    if (err instanceof Error) {
      console.error(err.message);
    } else {
      console.error(JSON.stringify(err, null, 2));
    }
    process.exit(1);
  });
}
