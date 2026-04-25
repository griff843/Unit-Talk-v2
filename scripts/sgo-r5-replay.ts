import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type SupabaseClient } from '../packages/db/node_modules/@supabase/supabase-js/dist/index.mjs';
import { americanToImplied, calculateCLVProb, proportionalDevig } from '@unit-talk/domain';
import { loadEnvironment } from '@unit-talk/config';

type Client = SupabaseClient<Record<string, never>>;

type CliOptions = {
  outPath: string;
  dryRun: boolean;
  evidencePath: string;
};

type ReplayTier = 'over' | 'under';

type ScoreBand =
  | '<0.50'
  | '0.50-0.55'
  | '0.55-0.60'
  | '0.60-0.65'
  | '>=0.65';

interface ReplayCoverageRow {
  candidate_id: string;
  model_score: number | null;
  model_tier: string | null;
  sport_key: string | null;
  provider_key: string | null;
  provider_event_id: string | null;
  provider_market_key: string | null;
  has_opening: boolean | null;
  has_closing: boolean | null;
  replay_eligible: boolean | null;
}

interface PickCandidateRow {
  id: string;
  pick_id: string | null;
  universe_id: string | null;
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

interface ParticipantRow {
  id: string;
  external_id: string | null;
}

interface GameResultRow {
  event_id: string;
  participant_id: string | null;
  market_key: string;
  actual_value: number;
}

interface ReplayRecord {
  candidateId: string;
  sport: string;
  tier: string;
  band: ScoreBand;
  modelScore: number;
  side: ReplayTier;
  outcome: string;
  clv: number;
}

interface ProofReport {
  generatedAt: string;
  summary: {
    candidates: number;
    settled: number;
    clvComputed: number;
    bySport: Array<{
      sport: string;
      candidates: number;
      settled: number;
      clvComputed: number;
    }>;
  };
  clvDistribution: {
    mean: number | null;
    median: number | null;
    percentPositive: number | null;
    sampleSize: number;
  };
  roiByTierAndBand: Array<{
    tier: string;
    scoreBand: ScoreBand;
    candidates: number;
    wins: number;
    losses: number;
    pushes: number;
    decided: number;
    winRate: number | null;
    roi: number | null;
  }>;
  calibrationByBand: Array<{
    scoreBand: ScoreBand;
    candidates: number;
    decided: number;
    wins: number;
    losses: number;
    pushes: number;
    modelScoreMean: number | null;
    actualWinRate: number | null;
    calibrationGap: number | null;
  }>;
  monotonicity: {
    ok: boolean;
    bandWinRates: Array<{ band: ScoreBand; winRate: number | null; decided: number }>;
    reasons: string[];
  };
  verdict: {
    status: 'PASS' | 'PARTIAL_ACCEPTABLE' | 'BLOCKED';
    reason: string;
    settledWithClv: number;
  };
}

const PAGE_SIZE = 1000;
const SCORE_BANDS: ScoreBand[] = ['<0.50', '0.50-0.55', '0.55-0.60', '0.60-0.65', '>=0.65'];

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

  const report = await buildReport(client);
  printReport(report);

  if (options.dryRun) {
    console.log(`Dry-run enabled. Proof file not written to ${options.outPath}`);
    return;
  }

  await writeProof(options.outPath, options.evidencePath, report);
}

export async function buildReport(client: Client): Promise<ProofReport> {
  const coverageRows = await fetchReplayCoverage(client);
  const candidateRows = await fetchPickCandidates(client, coverageRows.map((row) => row.candidate_id));
  const candidateById = new Map(candidateRows.map((row) => [row.id, row]));

  const universeIds = unique(
    candidateRows
      .map((row) => row.universe_id)
      .filter((id): id is string => id !== null),
  );
  const universeRows = await fetchMarketUniverses(client, universeIds);
  const universeById = new Map(universeRows.map((market) => [market.id, market]));
  const participantRows = await fetchParticipantsByExternalId(
    client,
    unique(
      universeRows
        .map((row) => row.provider_participant_id)
        .filter((id): id is string => id !== null),
    ),
  );
  const participantIdByExternalId = new Map(
    participantRows
      .filter((row): row is ParticipantRow & { external_id: string } => row.external_id !== null)
      .map((row) => [row.external_id, row.id]),
  );
  const providerEvidence = await fetchProviderOfferEvidence(client, universeRows);
  const events = await fetchEvents(client, unique(universeRows.map((row) => row.provider_event_id)));
  const eventIdByExternalId = new Map(
    events
      .filter((row): row is EventRow & { external_id: string } => row.external_id !== null)
      .map((row) => [row.external_id, row.id]),
  );
  const gameResults = await fetchGameResults(client, events.map((row) => row.id));
  const gameResultByKey = new Map(gameResults.map((row) => [resultKey(row), row]));

  const records: ReplayRecord[] = [];
  const bySportSummary = new Map<string, { candidates: number; settled: number; clvComputed: number }>();

  for (const row of coverageRows) {
    const sport = row.sport_key ?? 'UNKNOWN';
    const sportsAgg = bySportSummary.get(sport) ?? { candidates: 0, settled: 0, clvComputed: 0 };
    sportsAgg.candidates += 1;

    const candidate = candidateById.get(row.candidate_id);
    const universe = candidate?.universe_id ? universeById.get(candidate.universe_id) : null;
    const participantId =
      universe?.participant_id ??
      (universe?.provider_participant_id
        ? participantIdByExternalId.get(universe.provider_participant_id) ?? null
        : null);

    if (!isSettlementCompatible(universe, participantId)) {
      bySportSummary.set(sport, sportsAgg);
      continue;
    }

    const opening = getOpening(universe, providerEvidence);
    const closing = getClosing(universe, providerEvidence);
    const eventId = universe ? eventIdByExternalId.get(universe.provider_event_id) : undefined;
    const marketKey = universe?.market_type_id ?? universe?.canonical_market_key ?? null;
    const gameResult =
      eventId && marketKey
        ? gameResultByKey.get([eventId, participantId ?? '', marketKey].join('|')) ?? null
        : null;
    const outcome =
      gameResult && opening && universe
        ? evaluatePick(inferSide(universe), opening, gameResult.actual_value).result
        : null;

    if (outcome !== null) {
      sportsAgg.settled += 1;
    }

    const modelScore = normalizeScore(row.model_score);
    const side = universe ? inferSide(universe) : null;
    const closingOdds = getClosingOdds(closing);
    const clv =
      modelScore !== null && side && outcome !== null && closingOdds
        ? computeClv(modelScore, side, closingOdds)
        : null;

    if (clv !== null) {
      sportsAgg.clvComputed += 1;
      records.push({
        candidateId: row.candidate_id,
        sport,
        tier: row.model_tier ?? 'UNKNOWN',
        band: bucketScore(modelScore),
        modelScore,
        side,
        outcome,
        clv,
      });
    }

    bySportSummary.set(sport, sportsAgg);
  }

  const bySport = Array.from(bySportSummary.entries())
    .map(([sport, stats]) => ({ sport, ...stats }))
    .sort((left, right) => right.candidates - left.candidates || left.sport.localeCompare(right.sport));

  const clvDistribution = summarizeClv(records);
  const roiByTierAndBand = summarizeRoi(records);
  const calibrationByBand = summarizeCalibration(records);
  const monotonicity = checkMonotonicity(calibrationByBand);

  const settledWithClv = records.length;
  const verdict =
    settledWithClv >= 30
      ? {
          status: 'PASS',
          reason: `PASS: ${settledWithClv} settled candidates with closing-line CLV (>=30)`,
          settledWithClv,
        }
      : settledWithClv >= 10
        ? {
            status: 'PARTIAL_ACCEPTABLE',
            reason: `PARTIAL_ACCEPTABLE: ${settledWithClv} settled candidates with closing-line CLV (10-29)`,
            settledWithClv,
          }
        : {
            status: 'BLOCKED',
            reason: `BLOCKED: only ${settledWithClv} settled candidates with closing-line CLV (<10)`,
            settledWithClv,
          };

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      candidates: coverageRows.length,
      settled: records.length,
      clvComputed: settledWithClv,
      bySport,
    },
    clvDistribution,
    roiByTierAndBand,
    calibrationByBand,
    monotonicity,
    verdict,
  };
}

async function fetchReplayCoverage(client: Client): Promise<ReplayCoverageRow[]> {
  const rows = await fetchPaged<ReplayCoverageRow>(async (from, to) => {
    const { data, error } = await client
      .from('sgo_replay_coverage')
      .select(
        'candidate_id,model_score,model_tier,sport_key,provider_key,provider_event_id,provider_market_key,has_opening,has_closing,replay_eligible',
      )
      .eq('replay_eligible', true)
      .order('candidate_id')
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as ReplayCoverageRow[];
  });

  return rows;
}

async function fetchPickCandidates(
  client: Client,
  candidateIds: string[],
): Promise<PickCandidateRow[]> {
  if (candidateIds.length === 0) return [];

  const rows: PickCandidateRow[] = [];
  for (const chunkIds of chunk(candidateIds, 200)) {
    rows.push(
      ...(await fetchPaged<PickCandidateRow>(async (from, to) => {
        const { data, error } = await client
          .from('pick_candidates')
          .select('id,pick_id,universe_id')
          .in('id', chunkIds)
          .range(from, to);
        if (error) throw error;
        return (data ?? []) as PickCandidateRow[];
      })),
    );
  }

  return rows;
}

async function fetchMarketUniverses(client: Client, ids: string[]): Promise<MarketUniverseRow[]> {
  if (ids.length === 0) return [];

  const rows: MarketUniverseRow[] = [];
  for (const chunkIds of chunk(ids, 200)) {
    rows.push(
      ...(await fetchPaged<MarketUniverseRow>(async (from, to) => {
        const { data, error } = await client
          .from('market_universe')
          .select('id,provider_key,provider_event_id,provider_market_key,provider_participant_id,sport_key,participant_id,market_type_id,canonical_market_key,fair_over_prob,fair_under_prob,opening_line,opening_over_odds,opening_under_odds,closing_line,closing_over_odds,closing_under_odds')
          .in('id', chunkIds)
          .range(from, to);
        if (error) throw error;
        return (data ?? []) as MarketUniverseRow[];
      })),
    );
  }

  return rows;
}

async function fetchProviderOfferEvidence(
  client: Client,
  universeRows: MarketUniverseRow[],
): Promise<Map<string, MarketEvidence>> {
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

async function fetchEvents(client: Client, externalIds: string[]): Promise<EventRow[]> {
  if (externalIds.length === 0) return [];

  const rows: EventRow[] = [];
  for (const chunkIds of chunk(externalIds, 200)) {
    const { data, error } = await client
      .from('events')
      .select('id,external_id')
      .in('external_id', chunkIds);
    if (error) throw error;
    rows.push(...((data ?? []) as EventRow[]));
  }

  return rows;
}

async function fetchParticipantsByExternalId(
  client: Client,
  externalIds: string[],
): Promise<ParticipantRow[]> {
  if (externalIds.length === 0) return [];

  const rows: ParticipantRow[] = [];
  for (const chunkIds of chunk(externalIds, 200)) {
    const { data, error } = await client
      .from('participants')
      .select('id,external_id')
      .in('external_id', chunkIds);
    if (error) throw error;
    rows.push(...((data ?? []) as ParticipantRow[]));
  }

  return rows;
}

async function fetchGameResults(client: Client, eventIds: string[]): Promise<GameResultRow[]> {
  if (eventIds.length === 0) return [];

  const rows: GameResultRow[] = [];
  for (const chunkIds of chunk(eventIds, 200)) {
    rows.push(
      ...(await fetchPaged<GameResultRow>(async (from, to) => {
        const { data, error } = await client
          .from('game_results')
          .select('event_id,participant_id,market_key,actual_value')
          .in('event_id', chunkIds)
          .range(from, to);
        if (error) throw error;
        return (data ?? []) as GameResultRow[];
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

function getOpening(
  universe: MarketUniverseRow | undefined,
  evidence: Map<string, MarketEvidence>,
): PricePoint | null {
  if (!universe) return null;
  if (
    universe.opening_line !== null &&
    universe.opening_over_odds !== null &&
    universe.opening_under_odds !== null
  ) {
    return {
      line: universe.opening_line,
      overOdds: universe.opening_over_odds,
      underOdds: universe.opening_under_odds,
    };
  }

  return evidence.get(naturalKey(universe))?.opening ?? null;
}

function getClosing(
  universe: MarketUniverseRow | undefined,
  evidence: Map<string, MarketEvidence>,
): PricePoint | null {
  if (!universe) return null;
  if (
    universe.closing_line !== null &&
    universe.closing_over_odds !== null &&
    universe.closing_under_odds !== null
  ) {
    return {
      line: universe.closing_line,
      overOdds: universe.closing_over_odds,
      underOdds: universe.closing_under_odds,
    };
  }

  return evidence.get(naturalKey(universe))?.closing ?? null;
}

function getClosingOdds(closing: PricePoint | null) {
  if (!closing) return null;
  if (
    closing.line === null ||
    closing.overOdds === null ||
    closing.underOdds === null
  ) {
    return null;
  }

  const over = proportionalDevig(americanToImplied(closing.overOdds), americanToImplied(closing.underOdds));
  if (!over) return null;
  return {
    over: over.overFair,
    under: over.underFair,
  };
}

function computeClv(modelScore: number, side: ReplayTier, implied: { over: number; under: number }) {
  const marketProb = side === 'over' ? implied.over : implied.under;
  if (!Number.isFinite(marketProb)) return null;
  return calculateCLVProb(modelScore, marketProb);
}

function inferSide(universe: MarketUniverseRow): ReplayTier {
  return (universe.fair_over_prob ?? 0) >= (universe.fair_under_prob ?? 0) ? 'over' : 'under';
}

function normalizeScore(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= 0 || value >= 1) return null;
  return value;
}

function bucketScore(score: number): ScoreBand {
  if (score < 0.5) return '<0.50';
  if (score < 0.55) return '0.50-0.55';
  if (score < 0.6) return '0.55-0.60';
  if (score < 0.65) return '0.60-0.65';
  return '>=0.65';
}

function summarizeClv(records: ReplayRecord[]) {
  const values = records.map((row) => row.clv);
  return {
    mean: round(average(values), 4),
    median: round(median(values), 4),
    percentPositive: values.length === 0
      ? null
      : round((values.filter((value) => value > 0).length / values.length) * 100, 2),
    sampleSize: values.length,
  };
}

function summarizeRoi(records: ReplayRecord[]) {
  const byTierBand = new Map<
    string,
    { tier: string; scoreBand: ScoreBand; candidates: number; wins: number; losses: number; pushes: number; decided: number; roiSum: number }
  >();

  for (const record of records) {
    const key = `${record.tier}|${record.band}`;
    const bucket =
      byTierBand.get(key) ?? {
        tier: record.tier,
        scoreBand: record.band,
        candidates: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        decided: 0,
        roiSum: 0,
      };

    bucket.candidates += 1;
    const value = outcomeToResultValue(record.outcome);
    bucket.roiSum += value;
    if (record.outcome === 'win') {
      bucket.wins += 1;
      bucket.decided += 1;
    } else if (record.outcome === 'loss') {
      bucket.losses += 1;
      bucket.decided += 1;
    } else {
      bucket.pushes += 1;
    }

    byTierBand.set(key, bucket);
  }

  return [...byTierBand.values()]
    .sort((left, right) =>
      left.tier.localeCompare(right.tier) || bandOrder(left.scoreBand) - bandOrder(right.scoreBand),
    )
    .map((row) => ({
      ...row,
      winRate: row.decided > 0 ? round(row.wins / row.decided, 4) : null,
      roi: row.candidates > 0 ? round(row.roiSum / row.candidates, 4) : null,
    }));
}

function summarizeCalibration(records: ReplayRecord[]) {
  const byBand = new Map<ScoreBand, { scoreBand: ScoreBand; candidates: number; decided: number; wins: number; losses: number; pushes: number; modelSum: number }>();

  for (const record of records) {
    const bucket = byBand.get(record.band) ?? {
      scoreBand: record.band,
      candidates: 0,
      decided: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      modelSum: 0,
    };

    bucket.candidates += 1;
    bucket.modelSum += record.modelScore;
    if (record.outcome === 'win') {
      bucket.wins += 1;
      bucket.decided += 1;
    } else if (record.outcome === 'loss') {
      bucket.losses += 1;
      bucket.decided += 1;
    } else {
      bucket.pushes += 1;
    }

    byBand.set(record.band, bucket);
  }

  return SCORE_BANDS.map((band) => {
    const row = byBand.get(band) ?? {
      scoreBand: band,
      candidates: 0,
      decided: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      modelSum: 0,
    };

    const modelScoreMean = row.candidates > 0 ? round(row.modelSum / row.candidates, 4) : null;
    const actualWinRate = row.decided > 0 ? round(row.wins / row.decided, 4) : null;
    const calibrationGap =
      modelScoreMean === null || actualWinRate === null ? null : round(modelScoreMean - actualWinRate, 4);

    return {
      ...row,
      modelScoreMean,
      actualWinRate,
      calibrationGap,
    };
  });
}

function checkMonotonicity(calibrationByBand: ProofReport['calibrationByBand']) {
  const bandWinRates = calibrationByBand.map((row) => ({
    band: row.scoreBand,
    winRate: row.actualWinRate,
    decided: row.decided,
  }));

  const reasons: string[] = [];
  let ok = true;

  for (let index = 1; index < bandWinRates.length; index += 1) {
    const prev = bandWinRates[index - 1];
    const current = bandWinRates[index];
    if (prev.winRate === null || current.winRate === null) continue;
    if (current.winRate + 0.0000001 < prev.winRate) {
      ok = false;
      reasons.push(
        `Win rate decreases from ${formatPercent(prev.winRate)} in ${prev.band} to ${formatPercent(current.winRate)} in ${current.band}`,
      );
    }
  }

  if (ok) {
    reasons.push('Win rates are non-decreasing across score bands.');
  }

  return { ok, bandWinRates, reasons };
}

function isSettlementCompatible(
  universe: MarketUniverseRow | null | undefined,
  resolvedParticipantId: string | null,
) {
  if (!universe) return false;
  if (!universe.provider_market_key.includes('-game-')) return false;
  if (universe.provider_participant_id !== null && resolvedParticipantId === null) return false;
  return true;
}

function evaluatePick(side: ReplayTier, opening: PricePoint, actualValue: number) {
  let result: 'win' | 'loss' | 'push' = 'push';
  if (actualValue > opening.line) result = side === 'over' ? 'win' : 'loss';
  if (actualValue < opening.line) result = side === 'under' ? 'win' : 'loss';
  return { result };
}

function resultKey(row: GameResultRow) {
  return [row.event_id, row.participant_id ?? '', row.market_key].join('|');
}

function naturalKey(
  row: Pick<
    MarketUniverseRow | ProviderOfferEvidenceRow,
    'provider_key' | 'provider_event_id' | 'provider_participant_id' | 'provider_market_key'
  >,
) {
  return [row.provider_key, row.provider_event_id, row.provider_participant_id ?? '', row.provider_market_key].join('|');
}

function buildProofMarkdown(report: ProofReport) {
  const lines = [
    '# UTV2-723 - SGO model-trust R5 replay',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `- Verdict: **${report.verdict.status}**`,
    `- Reason: ${report.verdict.reason}`,
    `- Candidates (replay eligible): ${report.summary.candidates}`,
    `- Settled: ${report.summary.settled}`,
    `- CLV-computed: ${report.summary.clvComputed}`,
    '',
    '## Summary by sport',
    '',
    '| Sport | Candidates | Settled | CLV-computed |',
    '| --- | ---: | ---: | ---: |',
    ...report.summary.bySport.map(
      (row) => `| ${row.sport} | ${row.candidates} | ${row.settled} | ${row.clvComputed} |`,
    ),
    '',
    '## CLV distribution',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Mean | ${formatPercent(report.clvDistribution.mean)} |`,
    `| Median | ${formatPercent(report.clvDistribution.median)} |`,
    `| % Positive | ${report.clvDistribution.percentPositive === null ? 'n/a' : `${report.clvDistribution.percentPositive.toFixed(2)}%`}`,
    `| Sample size | ${report.clvDistribution.sampleSize} |`,
    '',
    '## ROI by score band and model tier',
    '',
    '| Tier | Score band | Candidates | Wins | Losses | Pushes | Win rate | ROI |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- | --- |',
    ...report.roiByTierAndBand.map(
      (row) =>
        `| ${row.tier} | ${row.scoreBand} | ${row.candidates} | ${row.wins} | ${row.losses} | ${row.pushes} | ${formatPercent(row.winRate)} | ${formatPercent(row.roi)} |`,
    ),
    '',
    '## Calibration by score band',
    '',
    '| Score band | Candidates | Decided | Wins | Losses | Pushes | Model score mean | Actual win rate | Calibration gap |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |',
    ...report.calibrationByBand.map(
      (row) =>
        `| ${row.scoreBand} | ${row.candidates} | ${row.decided} | ${row.wins} | ${row.losses} | ${row.pushes} | ${formatPercent(row.modelScoreMean)} | ${formatPercent(row.actualWinRate)} | ${formatSignedPercent(row.calibrationGap)} |`,
    ),
    '',
    '## Monotonicity check',
    '',
    `- Status: **${report.monotonicity.ok ? 'PASS' : 'FAIL'}**`,
    ...report.monotonicity.reasons.map((reason) => `- ${reason}`),
  ];

  return `${lines.join('\n')}\n`;
}

function outcomeToResultValue(outcome: string) {
  if (outcome === 'win') return 1;
  if (outcome === 'loss') return -1;
  return 0;
}

function bandOrder(value: ScoreBand) {
  return SCORE_BANDS.indexOf(value);
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint];
  return (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
}

function round(value: number | null, precision: number) {
  if (value === null || !Number.isFinite(value)) return null;
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  return `${(value * 100).toFixed(2)}%`;
}

function formatSignedPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  const asPercent = value * 100;
  const sign = asPercent > 0 ? '+' : asPercent < 0 ? '-' : '';
  return `${sign}${Math.abs(asPercent).toFixed(2)}%`;
}

async function writeProof(markdownPath: string, evidencePath: string, report: ProofReport) {
  const markdownAbsolute = resolve(markdownPath);
  await mkdir(dirname(markdownAbsolute), { recursive: true });
  await writeFile(markdownAbsolute, buildProofMarkdown(report), 'utf8');
  console.log(`Wrote ${markdownAbsolute}`);

  const evidenceAbsolute = resolve(evidencePath);
  await mkdir(dirname(evidenceAbsolute), { recursive: true });
  await writeFile(evidenceAbsolute, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${evidenceAbsolute}`);
}

function printReport(report: ProofReport) {
  console.log('=== SGO R5 Replay Proof ===');
  console.log(`Candidates (replay eligible): ${report.summary.candidates}`);
  console.log(`Settled: ${report.summary.settled}`);
  console.log(`CLV-computed: ${report.summary.clvComputed}`);
  console.log(`Mean CLV: ${formatPercent(report.clvDistribution.mean)}`);
  console.log(`Median CLV: ${formatPercent(report.clvDistribution.median)}`);
  console.log(`Monotonicity: ${report.monotonicity.ok ? 'PASS' : 'FAIL'}`);
  for (const reason of report.monotonicity.reasons) {
    console.log(`  ${reason}`);
  }
  console.log(`Verdict: ${report.verdict.status} — ${report.verdict.reason}`);
}

function parseCliOptions(args: string[]): CliOptions {
  const values = new Map<string, string>([
    ['out', 'docs/06_status/proof/UTV2-723/PROOF-UTV2-723.md'],
    ['evidence', 'docs/06_status/proof/UTV2-723/evidence.json'],
  ]);
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith('--')) continue;
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    const value = args[index + 1];
    if (value && !value.startsWith('--')) {
      if (arg === '--out') {
        values.set('out', value);
      } else if (arg === '--evidence') {
        values.set('evidence', value);
      }
      index += 1;
    }
  }

  return {
    outPath: values.get('out') ?? 'docs/06_status/proof/UTV2-723/PROOF-UTV2-723.md',
    evidencePath: values.get('evidence') ?? 'docs/06_status/proof/UTV2-723/evidence.json',
    dryRun,
  };
}

function unique<T>(values: T[]) {
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
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      try {
        console.error(JSON.stringify(error, null, 2));
      } catch {
        console.error(String(error));
      }
    }
    process.exit(1);
  });
}
