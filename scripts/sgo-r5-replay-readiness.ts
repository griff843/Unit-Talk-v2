import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnvironment } from '@unit-talk/config';

type Client = SupabaseClient<Record<string, never>>;

interface CliOptions {
  outPath: string;
  minSamples: number;
}

interface CandidateRow {
  id: string;
  created_at: string;
  model_score: number | null;
  model_tier: string | null;
  status: string;
  is_board_candidate: boolean;
  pick_id: string | null;
  universe_id: string;
}

interface MarketUniverseRow {
  id: string;
  provider_key: string;
  provider_event_id: string;
  provider_market_key: string;
  provider_participant_id: string | null;
  sport_key: string;
  opening_line: number | null;
  opening_over_odds: number | null;
  opening_under_odds: number | null;
  closing_line: number | null;
  closing_over_odds: number | null;
  closing_under_odds: number | null;
  last_offer_snapshot_at: string;
}

interface ReplayReadinessReport {
  generatedAt: string;
  totals: {
    candidates: number;
    scoredCandidates: number;
    boardCandidates: number;
    linkedToPicks: number;
    scoredSgoCandidates: number;
    scoredWithOpening: number;
    scoredWithClosing: number;
    scoredOpenCloseReady: number;
    replayEligible: number;
  };
  bySportTier: Array<{
    sport: string;
    tier: string;
    scored: number;
    opening: number;
    closing: number;
    openCloseReady: number;
  }>;
  verdict: {
    status: 'pass' | 'blocked';
    reason: string;
    minimumSamples: number;
  };
  sampleBlockedCandidates: Array<{
    candidateId: string;
    sport: string | null;
    market: string | null;
    modelScore: number | null;
    modelTier: string | null;
    hasOpening: boolean;
    hasClosing: boolean;
    pickId: string | null;
  }>;
}

const PAGE_SIZE = 1000;

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const env = loadEnvironment();
  const client = createClient<Record<string, never>>(
    env.SUPABASE_URL ?? '',
    env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const report = await buildReplayReadinessReport(client, options);
  await writeJson(options.outPath, report);
  printReport(report, options.outPath);
}

async function buildReplayReadinessReport(
  client: Client,
  options: CliOptions,
): Promise<ReplayReadinessReport> {
  const candidates = await fetchCandidates(client);
  const universeRows = await fetchMarketUniverse(client, unique(candidates.map((row) => row.universe_id)));
  const universeById = new Map(universeRows.map((row) => [row.id, row]));
  const scored = candidates.filter((row) => row.model_score !== null);
  const scoredSgo = scored.filter((row) => universeById.get(row.universe_id)?.provider_key === 'sgo');
  const scoredWithOpening = scoredSgo.filter((row) => hasOpening(universeById.get(row.universe_id)));
  const scoredWithClosing = scoredSgo.filter((row) => hasClosing(universeById.get(row.universe_id)));
  const replayEligible = scoredSgo.filter((row) => {
    const universe = universeById.get(row.universe_id);
    return hasOpening(universe) && hasClosing(universe);
  });

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      candidates: candidates.length,
      scoredCandidates: scored.length,
      boardCandidates: candidates.filter((row) => row.is_board_candidate).length,
      linkedToPicks: candidates.filter((row) => row.pick_id !== null).length,
      scoredSgoCandidates: scoredSgo.length,
      scoredWithOpening: scoredWithOpening.length,
      scoredWithClosing: scoredWithClosing.length,
      scoredOpenCloseReady: replayEligible.length,
      replayEligible: replayEligible.length,
    },
    bySportTier: summarizeBySportTier(scoredSgo, universeById),
    verdict:
      replayEligible.length >= options.minSamples
        ? {
            status: 'pass',
            reason: `replayEligible ${replayEligible.length} meets minimum ${options.minSamples}`,
            minimumSamples: options.minSamples,
          }
        : {
            status: 'blocked',
            reason:
              `Only ${replayEligible.length} scored candidates have both opening and closing market data; ` +
              `need at least ${options.minSamples} before R5 CLV/ROI replay is meaningful.`,
            minimumSamples: options.minSamples,
          },
    sampleBlockedCandidates: scoredSgo.slice(0, 20).map((row) => {
      const universe = universeById.get(row.universe_id);
      return {
        candidateId: row.id,
        sport: universe?.sport_key ?? null,
        market: universe?.provider_market_key ?? null,
        modelScore: row.model_score,
        modelTier: row.model_tier,
        hasOpening: hasOpening(universe),
        hasClosing: hasClosing(universe),
        pickId: row.pick_id,
      };
    }),
  };
}

function summarizeBySportTier(
  candidates: CandidateRow[],
  universeById: Map<string, MarketUniverseRow>,
) {
  const summaries = new Map<string, {
    sport: string;
    tier: string;
    scored: number;
    opening: number;
    closing: number;
    openCloseReady: number;
  }>();
  for (const candidate of candidates) {
    const universe = universeById.get(candidate.universe_id);
    const sport = universe?.sport_key ?? 'UNKNOWN';
    const tier = candidate.model_tier ?? 'UNKNOWN';
    const key = `${sport}|${tier}`;
    const summary = summaries.get(key) ?? {
      sport,
      tier,
      scored: 0,
      opening: 0,
      closing: 0,
      openCloseReady: 0,
    };
    summary.scored += 1;
    summary.opening += hasOpening(universe) ? 1 : 0;
    summary.closing += hasClosing(universe) ? 1 : 0;
    summary.openCloseReady += hasOpening(universe) && hasClosing(universe) ? 1 : 0;
    summaries.set(key, summary);
  }

  return Array.from(summaries.values()).sort((left, right) => {
    if (right.openCloseReady !== left.openCloseReady) return right.openCloseReady - left.openCloseReady;
    if (right.scored !== left.scored) return right.scored - left.scored;
    return `${left.sport}:${left.tier}`.localeCompare(`${right.sport}:${right.tier}`);
  });
}

async function fetchCandidates(client: Client) {
  return fetchPaged<CandidateRow>(async (from, to) => {
    const { data, error } = await client
      .from('pick_candidates')
      .select('id,created_at,model_score,model_tier,status,is_board_candidate,pick_id,universe_id')
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as CandidateRow[];
  });
}

async function fetchMarketUniverse(client: Client, ids: string[]) {
  const rows: MarketUniverseRow[] = [];
  for (const chunkIds of chunk(ids, 200)) {
    rows.push(
      ...(await fetchPaged<MarketUniverseRow>(async (from, to) => {
        const { data, error } = await client
          .from('market_universe')
          .select('id,provider_key,provider_event_id,provider_market_key,provider_participant_id,sport_key,opening_line,opening_over_odds,opening_under_odds,closing_line,closing_over_odds,closing_under_odds,last_offer_snapshot_at')
          .in('id', chunkIds)
          .range(from, to);
        if (error) throw error;
        return (data ?? []) as MarketUniverseRow[];
      })),
    );
  }
  return rows;
}

async function fetchPaged<T>(fetchPage: (from: number, to: number) => Promise<T[]>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await fetchPage(from, from + PAGE_SIZE - 1);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function hasOpening(row: MarketUniverseRow | undefined) {
  return Boolean(
    row &&
      row.opening_line !== null &&
      row.opening_over_odds !== null &&
      row.opening_under_odds !== null,
  );
}

function hasClosing(row: MarketUniverseRow | undefined) {
  return Boolean(
    row &&
      row.closing_line !== null &&
      row.closing_over_odds !== null &&
      row.closing_under_odds !== null,
  );
}

function parseCliOptions(args: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith('--')) continue;
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      values.set(arg.slice(2), next);
      index += 1;
    }
  }

  const minSamples = Number.parseInt(values.get('min-samples') ?? '100', 10);
  if (!Number.isFinite(minSamples) || minSamples < 1) {
    throw new Error('--min-samples must be a positive integer');
  }

  return {
    minSamples,
    outPath: values.get('out') ?? 'out/sgo-r5-replay-readiness.json',
  };
}

function printReport(report: ReplayReadinessReport, outPath: string) {
  console.log('=== SGO R5 Replay Readiness ===');
  console.log(`Candidates: ${report.totals.candidates}`);
  console.log(`Scored candidates: ${report.totals.scoredCandidates}`);
  console.log(`Board candidates: ${report.totals.boardCandidates}`);
  console.log(`Linked to picks: ${report.totals.linkedToPicks}`);
  console.log(`Scored SGO candidates: ${report.totals.scoredSgoCandidates}`);
  console.log(`Scored with opening data: ${report.totals.scoredWithOpening}`);
  console.log(`Scored with closing data: ${report.totals.scoredWithClosing}`);
  console.log(`Replay eligible: ${report.totals.replayEligible}`);
  console.log(`Verdict: ${report.verdict.status.toUpperCase()} - ${report.verdict.reason}`);
  console.log('');
  console.log('By sport/tier:');
  for (const row of report.bySportTier) {
    console.log(
      [
        row.sport.padEnd(4),
        row.tier.padEnd(8),
        `scored=${row.scored}`,
        `opening=${row.opening}`,
        `closing=${row.closing}`,
        `ready=${row.openCloseReady}`,
      ].join(' | '),
    );
  }
  console.log('');
  console.log(`Wrote ${outPath}`);
}

async function writeJson(path: string, value: unknown) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
