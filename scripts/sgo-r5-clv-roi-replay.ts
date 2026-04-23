import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnvironment } from '@unit-talk/config';

type Client = SupabaseClient<Record<string, never>>;
type Side = 'over' | 'under';

interface CliOptions {
  outPath: string;
}

interface CandidateRow {
  id: string;
  model_score: number | null;
  model_tier: string | null;
  universe_id: string;
}

interface MarketUniverseRow {
  id: string;
  provider_key: string;
  provider_event_id: string;
  provider_market_key: string;
  provider_participant_id: string | null;
  sport_key: string;
  participant_id: string | null;
  market_type_id: string | null;
  canonical_market_key: string;
  fair_over_prob: number | null;
  fair_under_prob: number | null;
  opening_line: number | null;
  opening_over_odds: number | null;
  opening_under_odds: number | null;
  closing_line: number | null;
  closing_over_odds: number | null;
  closing_under_odds: number | null;
}

interface ProviderOfferEvidenceRow {
  provider_key: string;
  provider_event_id: string;
  provider_market_key: string;
  provider_participant_id: string | null;
  line: number | null;
  over_odds: number | null;
  under_odds: number | null;
  is_opening: boolean;
  is_closing: boolean;
}

interface MarketEvidence {
  opening: PricePoint | null;
  closing: PricePoint | null;
}

interface PricePoint {
  line: number;
  overOdds: number;
  underOdds: number;
}

interface EventRow {
  id: string;
  external_id: string | null;
}

interface GameResultRow {
  event_id: string;
  participant_id: string | null;
  market_key: string;
  actual_value: number;
}

interface ReplayPick {
  candidateId: string;
  sport: string;
  tier: string;
  side: Side;
  modelScore: number;
  opening: PricePoint;
  closing: PricePoint;
  actualValue: number;
  result: 'win' | 'loss' | 'push';
  profitUnits: number;
  lineClv: number;
  oddsClv: number;
}

interface ReplayReport {
  generatedAt: string;
  totals: {
    scoredSgoCandidates: number;
    openCloseReady: number;
    settlementCompatible: number;
    eventMatched: number;
    eventsWithAnyResult: number;
    resultReady: number;
    replayed: number;
    missingEvent: number;
    missingResult: number;
    missingResultMarket: number;
    missingResultParticipant: number;
  };
  overall: ReplaySummary;
  byTier: ReplaySummary[];
  bySportTier: ReplaySummary[];
  sample: ReplayPick[];
}

interface ReplaySummary {
  bucket: string;
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  roi: number | null;
  avgLineClv: number | null;
  avgOddsClv: number | null;
  positiveLineClvRate: number | null;
}

const PAGE_SIZE = 1000;

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const env = loadEnvironment();
  const client = createClient<Record<string, never>>(
    env.SUPABASE_URL ?? '',
    env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const report = await buildReport(client);
  await writeJson(options.outPath, report);
  printReport(report, options.outPath);
}

async function buildReport(client: Client): Promise<ReplayReport> {
  const candidates = (await fetchCandidates(client)).filter((row) => row.model_score !== null);
  const universeRows = await fetchMarketUniverse(client, unique(candidates.map((row) => row.universe_id)));
  const universeById = new Map(universeRows.map((row) => [row.id, row]));
  const scoredSgo = candidates.filter((row) => universeById.get(row.universe_id)?.provider_key === 'sgo');
  const scoredUniverseRows = scoredSgo
    .map((row) => universeById.get(row.universe_id))
    .filter((row): row is MarketUniverseRow => row !== undefined);
  const providerEvidence = await fetchProviderOfferEvidence(client, scoredUniverseRows);
  const openCloseReady = scoredSgo.filter((row) => {
    const universe = universeById.get(row.universe_id);
    return getOpening(universe, providerEvidence) && getClosing(universe, providerEvidence);
  });
  const events = await fetchEvents(client, unique(scoredUniverseRows.map((row) => row.provider_event_id)));
  const eventIdByExternalId = new Map(
    events
      .filter((row): row is EventRow & { external_id: string } => row.external_id !== null)
      .map((row) => [row.external_id, row.id]),
  );
  const resultRows = await fetchGameResults(client, events.map((row) => row.id));
  const resultByKey = new Map(resultRows.map((row) => [resultKey(row), row]));
  const eventIdsWithResults = new Set(resultRows.map((row) => row.event_id));
  const eventMarketKeys = new Set(resultRows.map((row) => [row.event_id, row.market_key].join('|')));
  const eventParticipantKeys = new Set(
    resultRows.map((row) => [row.event_id, row.participant_id ?? ''].join('|')),
  );

  const replayed: ReplayPick[] = [];
  let eventMatched = 0;
  let eventsWithAnyResult = 0;
  let missingEvent = 0;
  let missingResult = 0;
  let missingResultMarket = 0;
  let missingResultParticipant = 0;

  const settlementCompatible = openCloseReady.filter((candidate) =>
    isSettlementCompatible(universeById.get(candidate.universe_id)),
  );

  for (const candidate of settlementCompatible) {
    const universe = universeById.get(candidate.universe_id);
    if (!universe || candidate.model_score === null) continue;
    const eventId = eventIdByExternalId.get(universe.provider_event_id);
    const marketKey = universe.market_type_id ?? universe.canonical_market_key;
    if (!eventId || !marketKey) {
      if (!eventId) missingEvent++;
      missingResult++;
      continue;
    }
    eventMatched++;
    if (eventIdsWithResults.has(eventId)) {
      eventsWithAnyResult++;
    }
    const result = resultByKey.get([
      eventId,
      universe.participant_id ?? '',
      marketKey,
    ].join('|'));
    if (!result) {
      if (!eventMarketKeys.has([eventId, marketKey].join('|'))) {
        missingResultMarket++;
      }
      if (!eventParticipantKeys.has([eventId, universe.participant_id ?? ''].join('|'))) {
        missingResultParticipant++;
      }
      missingResult++;
      continue;
    }

    const opening = getOpening(universe, providerEvidence);
    const closing = getClosing(universe, providerEvidence);
    if (!opening || !closing) continue;

    const side = inferSide(universe);
    const evaluated = evaluatePick(side, opening, closing, result.actual_value);
    replayed.push({
      candidateId: candidate.id,
      sport: universe.sport_key,
      tier: candidate.model_tier ?? 'UNKNOWN',
      side,
      modelScore: candidate.model_score,
      opening,
      closing,
      actualValue: result.actual_value,
      ...evaluated,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      scoredSgoCandidates: scoredSgo.length,
      openCloseReady: openCloseReady.length,
      settlementCompatible: settlementCompatible.length,
      eventMatched,
      eventsWithAnyResult,
      resultReady: replayed.length,
      replayed: replayed.length,
      missingEvent,
      missingResult,
      missingResultMarket,
      missingResultParticipant,
    },
    overall: summarize('overall', replayed),
    byTier: summarizeGroups(replayed, (row) => row.tier),
    bySportTier: summarizeGroups(replayed, (row) => `${row.sport}:${row.tier}`),
    sample: replayed.slice(0, 20),
  };
}

async function fetchCandidates(client: Client) {
  return fetchPaged<CandidateRow>(async (from, to) => {
    const { data, error } = await client
      .from('pick_candidates')
      .select('id,model_score,model_tier,universe_id')
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as CandidateRow[];
  });
}

async function fetchMarketUniverse(client: Client, ids: string[]) {
  const rows: MarketUniverseRow[] = [];
  for (const chunkIds of chunk(ids, 200)) {
    rows.push(...(await fetchPaged<MarketUniverseRow>(async (from, to) => {
      const { data, error } = await client
        .from('market_universe')
        .select('id,provider_key,provider_event_id,provider_market_key,provider_participant_id,sport_key,participant_id,market_type_id,canonical_market_key,fair_over_prob,fair_under_prob,opening_line,opening_over_odds,opening_under_odds,closing_line,closing_over_odds,closing_under_odds')
        .in('id', chunkIds)
        .range(from, to);
      if (error) throw error;
      return (data ?? []) as MarketUniverseRow[];
    })));
  }
  return rows;
}

async function fetchProviderOfferEvidence(client: Client, universeRows: MarketUniverseRow[]) {
  const evidence = new Map<string, MarketEvidence>();
  const eventIds = unique(universeRows.map((row) => row.provider_event_id));
  for (const eventIdChunk of chunk(eventIds, 100)) {
    for (const flag of ['is_opening', 'is_closing'] as const) {
      const rows = await fetchPaged<ProviderOfferEvidenceRow>(async (from, to) => {
        const { data, error } = await client
          .from('provider_offers')
          .select('provider_key,provider_event_id,provider_market_key,provider_participant_id,line,over_odds,under_odds,is_opening,is_closing')
          .eq('provider_key', 'sgo')
          .in('provider_event_id', eventIdChunk)
          .eq(flag, true)
          .range(from, to);
        if (error) throw error;
        return (data ?? []) as ProviderOfferEvidenceRow[];
      });
      for (const row of rows) {
        if (row.line === null || row.over_odds === null || row.under_odds === null) continue;
        const key = naturalKey(row);
        const existing = evidence.get(key) ?? { opening: null, closing: null };
        const point = { line: row.line, overOdds: row.over_odds, underOdds: row.under_odds };
        if (row.is_opening && !existing.opening) existing.opening = point;
        if (row.is_closing && !existing.closing) existing.closing = point;
        evidence.set(key, existing);
      }
    }
  }
  return evidence;
}

async function fetchEvents(client: Client, externalIds: string[]) {
  const rows: EventRow[] = [];
  for (const ids of chunk(externalIds, 200)) {
    const { data, error } = await client
      .from('events')
      .select('id,external_id')
      .in('external_id', ids);
    if (error) throw error;
    rows.push(...((data ?? []) as EventRow[]));
  }
  return rows;
}

async function fetchGameResults(client: Client, eventIds: string[]) {
  const rows: GameResultRow[] = [];
  for (const ids of chunk(eventIds, 200)) {
    rows.push(...(await fetchPaged<GameResultRow>(async (from, to) => {
      const { data, error } = await client
        .from('game_results')
        .select('event_id,participant_id,market_key,actual_value')
        .in('event_id', ids)
        .range(from, to);
      if (error) throw error;
      return (data ?? []) as GameResultRow[];
    })));
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

function getOpening(row: MarketUniverseRow | undefined, evidence: Map<string, MarketEvidence>) {
  if (!row) return null;
  if (row.opening_line !== null && row.opening_over_odds !== null && row.opening_under_odds !== null) {
    return { line: row.opening_line, overOdds: row.opening_over_odds, underOdds: row.opening_under_odds };
  }
  return evidence.get(naturalKey(row))?.opening ?? null;
}

function getClosing(row: MarketUniverseRow | undefined, evidence: Map<string, MarketEvidence>) {
  if (!row) return null;
  if (row.closing_line !== null && row.closing_over_odds !== null && row.closing_under_odds !== null) {
    return { line: row.closing_line, overOdds: row.closing_over_odds, underOdds: row.closing_under_odds };
  }
  return evidence.get(naturalKey(row))?.closing ?? null;
}

function inferSide(row: MarketUniverseRow): Side {
  return (row.fair_over_prob ?? 0) >= (row.fair_under_prob ?? 0) ? 'over' : 'under';
}

function isSettlementCompatible(row: MarketUniverseRow | undefined) {
  if (!row) return false;
  if (!row.provider_market_key.includes('-game-')) return false;
  if (row.provider_participant_id !== null && row.participant_id === null) return false;
  return true;
}

function evaluatePick(side: Side, opening: PricePoint, closing: PricePoint, actualValue: number) {
  const odds = side === 'over' ? opening.overOdds : opening.underOdds;
  let result: ReplayPick['result'] = 'push';
  if (actualValue > opening.line) result = side === 'over' ? 'win' : 'loss';
  if (actualValue < opening.line) result = side === 'under' ? 'win' : 'loss';
  const profitUnits = result === 'push' ? 0 : result === 'win' ? profitForOneUnit(odds) : -1;
  const lineClv = side === 'over' ? closing.line - opening.line : opening.line - closing.line;
  const openOdds = side === 'over' ? opening.overOdds : opening.underOdds;
  const closeOdds = side === 'over' ? closing.overOdds : closing.underOdds;
  const oddsClv = americanToImplied(closeOdds) - americanToImplied(openOdds);
  return { result, profitUnits, lineClv, oddsClv };
}

function summarizeGroups(rows: ReplayPick[], keyFn: (row: ReplayPick) => string) {
  const groups = new Map<string, ReplayPick[]>();
  for (const row of rows) {
    const key = keyFn(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return Array.from(groups.entries())
    .map(([key, group]) => summarize(key, group))
    .sort((left, right) => right.picks - left.picks || left.bucket.localeCompare(right.bucket));
}

function summarize(bucket: string, rows: ReplayPick[]): ReplaySummary {
  const wins = rows.filter((row) => row.result === 'win').length;
  const losses = rows.filter((row) => row.result === 'loss').length;
  const pushes = rows.filter((row) => row.result === 'push').length;
  const decided = wins + losses;
  const profit = rows.reduce((sum, row) => sum + row.profitUnits, 0);
  return {
    bucket,
    picks: rows.length,
    wins,
    losses,
    pushes,
    winRate: decided > 0 ? round(wins / decided) : null,
    roi: rows.length > 0 ? round(profit / rows.length) : null,
    avgLineClv: average(rows.map((row) => row.lineClv)),
    avgOddsClv: average(rows.map((row) => row.oddsClv)),
    positiveLineClvRate: rows.length > 0 ? round(rows.filter((row) => row.lineClv > 0).length / rows.length) : null,
  };
}

function resultKey(row: GameResultRow) {
  return [row.event_id, row.participant_id ?? '', row.market_key].join('|');
}

function naturalKey(row: Pick<MarketUniverseRow | ProviderOfferEvidenceRow, 'provider_key' | 'provider_event_id' | 'provider_participant_id' | 'provider_market_key'>) {
  return [row.provider_key, row.provider_event_id, row.provider_participant_id ?? '', row.provider_market_key].join('|');
}

function profitForOneUnit(americanOdds: number) {
  return americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
}

function americanToImplied(americanOdds: number) {
  return americanOdds > 0
    ? 100 / (americanOdds + 100)
    : Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

function average(values: number[]) {
  return values.length > 0 ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
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
  return { outPath: values.get('out') ?? 'out/sgo-r5-clv-roi-replay.json' };
}

function printReport(report: ReplayReport, outPath: string) {
  console.log('=== SGO R5 CLV/ROI Replay ===');
  console.log(`Scored SGO candidates: ${report.totals.scoredSgoCandidates}`);
  console.log(`Open/close ready: ${report.totals.openCloseReady}`);
  console.log(`Settlement compatible: ${report.totals.settlementCompatible}`);
  console.log(`Event matched: ${report.totals.eventMatched}`);
  console.log(`Events with any result rows: ${report.totals.eventsWithAnyResult}`);
  console.log(`Result ready / replayed: ${report.totals.replayed}`);
  console.log(`Missing result: ${report.totals.missingResult}`);
  console.log(`Missing event: ${report.totals.missingEvent}`);
  console.log(`Missing market result: ${report.totals.missingResultMarket}`);
  console.log(`Missing participant result: ${report.totals.missingResultParticipant}`);
  printSummary(report.overall);
  console.log('');
  console.log('By tier:');
  for (const row of report.byTier) printSummary(row);
  console.log('');
  console.log(`Wrote ${outPath}`);
}

function printSummary(row: ReplaySummary) {
  console.log(
    `${row.bucket}: picks=${row.picks} winRate=${formatPct(row.winRate)} roi=${formatPct(row.roi)} avgLineClv=${row.avgLineClv ?? 'n/a'} positiveLineClv=${formatPct(row.positiveLineClvRate)}`,
  );
}

function formatPct(value: number | null) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
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
