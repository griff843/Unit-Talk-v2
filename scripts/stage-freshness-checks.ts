/**
 * UTV2-579 — Stage-proof freshness checks for the governed pick machine.
 *
 * Checks each pipeline stage against live Supabase and surfaces whether it is
 * FRESH, STALE, or EMPTY. Enables operators to prove the machine is alive at
 * every stage, not just structurally wired.
 *
 * Pipeline stages checked:
 *   offers → market_universe → candidates → scoring → board → picks → outbox → receipts
 *
 * Usage:
 *   pnpm stage:freshness
 *   pnpm stage:freshness --json
 */

import { createClient } from '@supabase/supabase-js';
import { loadEnvironment } from '@unit-talk/config';

type StageState = 'FRESH' | 'STALE' | 'EMPTY';
type Verdict = 'HEALTHY' | 'DEGRADED' | 'FAILED';
type LatencyState = 'PASS' | 'FAIL' | 'SKIP';

interface StageResult {
  stage: string;
  table: string;
  state: StageState;
  count: number;
  latestAgeMinutes: number | null;
  thresholdMinutes: number;
  detail: string;
}

interface LatencyResult {
  check: string;
  sampleSize: number;
  p50Minutes: number | null;
  p95Minutes: number | null;
  maxMinutes: number | null;
  sloMinutes: number;
  state: LatencyState;
  detail: string;
}

interface FreshnessReport {
  timestamp: string;
  verdict: Verdict;
  stages: StageResult[];
  latency: LatencyResult[];
  summary: string;
}

const env = loadEnvironment();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');

function ageMinutes(isoTs: string): number {
  return Math.round((Date.now() - new Date(isoTs).getTime()) / 60_000);
}

function lagMinutes(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 60_000;
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Inter-stage latency SLO checks (UTV2-587)

async function checkOfferToUniverseLag(): Promise<LatencyResult> {
  const check = 'S1→S2: Offer→Universe';
  const sloMinutes = 90;
  const windowStart = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('market_universe')
    .select('last_offer_snapshot_at, refreshed_at')
    .gte('last_offer_snapshot_at', windowStart)
    .not('refreshed_at', 'is', null)
    .not('last_offer_snapshot_at', 'is', null)
    .limit(500);

  if (error || !data || data.length === 0) {
    return { check, sampleSize: 0, p50Minutes: null, p95Minutes: null, maxMinutes: null, sloMinutes, state: 'SKIP', detail: error?.message ?? 'no fresh universe rows in 4h window' };
  }

  const lags = data
    .map((r) => lagMinutes(r.last_offer_snapshot_at as string, r.refreshed_at as string))
    .filter((v) => v >= 0);

  if (lags.length === 0) {
    return { check, sampleSize: 0, p50Minutes: null, p95Minutes: null, maxMinutes: null, sloMinutes, state: 'SKIP', detail: 'no valid lag pairs (all negative)' };
  }

  const p50 = round2(pct(lags, 50));
  const p95 = round2(pct(lags, 95));
  const max = round2(Math.max(...lags));
  const state: LatencyState = p95 <= sloMinutes ? 'PASS' : 'FAIL';

  return { check, sampleSize: lags.length, p50Minutes: p50, p95Minutes: p95, maxMinutes: max, sloMinutes, state, detail: `p50=${p50}m p95=${p95}m max=${max}m n=${lags.length} slo<${sloMinutes}m` };
}

async function checkUniverseToCandidateLag(): Promise<LatencyResult> {
  const check = 'S2→S3: Universe→Candidate';
  const sloMinutes = 5;
  const windowStart = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('pick_candidates')
    .select('created_at, market_universe!universe_id(refreshed_at)')
    .gte('created_at', windowStart)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !data || data.length === 0) {
    return { check, sampleSize: 0, p50Minutes: null, p95Minutes: null, maxMinutes: null, sloMinutes, state: 'SKIP', detail: error?.message ?? 'no candidates in 48h window' };
  }

  const lags: number[] = [];
  for (const row of data as Array<{ created_at: string; market_universe: { refreshed_at: string } | null }>) {
    const refreshedAt = row.market_universe?.refreshed_at;
    if (refreshedAt && row.created_at >= refreshedAt) {
      lags.push(lagMinutes(refreshedAt, row.created_at));
    }
  }

  if (lags.length === 0) {
    return { check, sampleSize: 0, p50Minutes: null, p95Minutes: null, maxMinutes: null, sloMinutes, state: 'SKIP', detail: 'no valid universe→candidate pairs found' };
  }

  const p50 = round2(pct(lags, 50));
  const p95 = round2(pct(lags, 95));
  const max = round2(Math.max(...lags));
  const state: LatencyState = p95 <= sloMinutes ? 'PASS' : 'FAIL';

  return { check, sampleSize: lags.length, p50Minutes: p50, p95Minutes: p95, maxMinutes: max, sloMinutes, state, detail: `p50=${p50}m p95=${p95}m max=${max}m n=${lags.length} slo<${sloMinutes}m` };
}

async function checkPickDeliveryLag(): Promise<LatencyResult> {
  const check = 'S4→S6: Pick→Receipt (E2E delivery)';
  const sloMinutes = 10;
  const windowStart = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // Step 1: get recent sent outbox rows with their pick_id and timestamps
  const { data: outboxRows, error: outboxErr } = await supabase
    .from('distribution_outbox')
    .select('id, pick_id, created_at')
    .eq('status', 'sent')
    .gte('created_at', windowStart)
    .order('created_at', { ascending: false })
    .limit(50);

  if (outboxErr || !outboxRows || outboxRows.length === 0) {
    return { check, sampleSize: 0, p50Minutes: null, p95Minutes: null, maxMinutes: null, sloMinutes, state: 'SKIP', detail: outboxErr?.message ?? 'no sent outbox rows in 48h' };
  }

  const pickIds = [...new Set(outboxRows.map((r) => r.pick_id as string))];
  const outboxIds = outboxRows.map((r) => r.id as string);

  // Step 2: get pick created_at for those pick_ids
  const { data: pickRows } = await supabase
    .from('picks')
    .select('id, created_at')
    .in('id', pickIds);

  // Step 3: get receipt recorded_at for those outbox_ids
  const { data: receiptRows } = await supabase
    .from('distribution_receipts')
    .select('outbox_id, recorded_at')
    .in('outbox_id', outboxIds);

  const pickMap = new Map((pickRows ?? []).map((p) => [p.id as string, p.created_at as string]));
  const receiptMap = new Map((receiptRows ?? []).map((r) => [r.outbox_id as string, r.recorded_at as string]));

  const lags: number[] = [];
  for (const row of outboxRows) {
    const pickCreated = pickMap.get(row.pick_id as string);
    const receiptRecorded = receiptMap.get(row.id as string);
    if (pickCreated && receiptRecorded) {
      const lag = lagMinutes(pickCreated, receiptRecorded);
      if (lag >= 0) lags.push(lag);
    }
  }

  if (lags.length === 0) {
    return { check, sampleSize: 0, p50Minutes: null, p95Minutes: null, maxMinutes: null, sloMinutes, state: 'SKIP', detail: 'no complete pick→receipt pairs found' };
  }

  const p50 = round2(pct(lags, 50));
  const p95 = round2(pct(lags, 95));
  const max = round2(Math.max(...lags));
  const state: LatencyState = p95 <= sloMinutes ? 'PASS' : 'FAIL';

  return { check, sampleSize: lags.length, p50Minutes: p50, p95Minutes: p95, maxMinutes: max, sloMinutes, state, detail: `p50=${p50}m p95=${p95}m max=${max}m n=${lags.length} slo<${sloMinutes}m` };
}

async function checkStage(
  stage: string,
  table: string,
  timestampCol: string,
  thresholdMinutes: number,
  filter?: Record<string, unknown>,
): Promise<StageResult> {
  // Get the most recent row
  let query = supabase
    .from(table)
    .select(timestampCol)
    .order(timestampCol, { ascending: false })
    .limit(1);

  if (filter) {
    for (const [col, val] of Object.entries(filter)) {
      if (val !== undefined) {
        // @ts-expect-error dynamic filter
        query = query.eq(col, val);
      }
    }
  }

  const { data, error } = await query;

  if (error) {
    return {
      stage,
      table,
      state: 'EMPTY',
      count: 0,
      latestAgeMinutes: null,
      thresholdMinutes,
      detail: `query error: ${error.message}`,
    };
  }

  if (!data || data.length === 0) {
    return {
      stage,
      table,
      state: 'EMPTY',
      count: 0,
      latestAgeMinutes: null,
      thresholdMinutes,
      detail: 'no rows found',
    };
  }

  const latestTs = data[0][timestampCol as keyof typeof data[0]] as string | null;
  if (!latestTs) {
    return {
      stage,
      table,
      state: 'EMPTY',
      count: 0,
      latestAgeMinutes: null,
      thresholdMinutes,
      detail: 'latest timestamp is null',
    };
  }

  const age = ageMinutes(latestTs);

  // Count rows in window
  const windowMs = thresholdMinutes * 60 * 1000;
  const windowStart = new Date(Date.now() - windowMs).toISOString();
  let countQuery = supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .gte(timestampCol, windowStart);

  if (filter) {
    for (const [col, val] of Object.entries(filter)) {
      if (val !== undefined) {
        // @ts-expect-error dynamic filter
        countQuery = countQuery.eq(col, val);
      }
    }
  }

  const { count } = await countQuery;
  const rowCount = count ?? 0;

  const state: StageState = age <= thresholdMinutes ? 'FRESH' : 'STALE';
  const detail =
    state === 'FRESH'
      ? `latest ${age}m ago, ${rowCount} rows in window (threshold ${thresholdMinutes}m)`
      : `latest ${age}m ago — STALE (threshold ${thresholdMinutes}m), ${rowCount} rows in window`;

  return {
    stage,
    table,
    state,
    count: rowCount,
    latestAgeMinutes: age,
    thresholdMinutes,
    detail,
  };
}

async function main(): Promise<void> {
  const checks: Array<() => Promise<StageResult>> = [
    // 1. Offers ingestion
    () => checkStage('Offers', 'provider_offers', 'snapshot_at', 60),

    // 2. Market universe materialization
    () => checkStage('Market Universe', 'market_universe', 'refreshed_at', 120),

    // 3. Candidates generated
    () => checkStage('Candidates', 'pick_candidates', 'created_at', 240),

    // 4. Scoring (candidates with model_score)
    async () => {
      const stage = 'Scoring';
      const table = 'pick_candidates';
      const thresholdMinutes = 240;
      const windowStart = new Date(Date.now() - thresholdMinutes * 60 * 1000).toISOString();

      const { data: latest } = await supabase
        .from(table)
        .select('created_at')
        .not('model_score', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);

      if (!latest || latest.length === 0) {
        return { stage, table, state: 'EMPTY', count: 0, latestAgeMinutes: null, thresholdMinutes, detail: 'no scored candidates found' };
      }

      const age = ageMinutes(latest[0].created_at);
      const { count } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .not('model_score', 'is', null)
        .gte('created_at', windowStart);

      const rowCount = count ?? 0;
      const state: StageState = age <= thresholdMinutes ? 'FRESH' : 'STALE';
      return { stage, table, state, count: rowCount, latestAgeMinutes: age, thresholdMinutes, detail: `latest scored candidate ${age}m ago, ${rowCount} in window` };
    },

    // 5. Board candidates
    async () => {
      const stage = 'Board';
      const table = 'pick_candidates';
      const thresholdMinutes = 240;
      const windowStart = new Date(Date.now() - thresholdMinutes * 60 * 1000).toISOString();

      const { data: latest } = await supabase
        .from(table)
        .select('created_at')
        .eq('is_board_candidate', true)
        .order('created_at', { ascending: false })
        .limit(1);

      if (!latest || latest.length === 0) {
        return { stage, table, state: 'EMPTY', count: 0, latestAgeMinutes: null, thresholdMinutes, detail: 'no board candidates found' };
      }

      const age = ageMinutes(latest[0].created_at);
      const { count } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('is_board_candidate', true)
        .gte('created_at', windowStart);

      const rowCount = count ?? 0;
      const state: StageState = age <= thresholdMinutes ? 'FRESH' : 'STALE';
      return { stage, table, state, count: rowCount, latestAgeMinutes: age, thresholdMinutes, detail: `latest board candidate ${age}m ago, ${rowCount} in window` };
    },

    // 6. Picks created
    () => checkStage('Picks', 'picks', 'created_at', 240),

    // 7. Outbox (delivery queue)
    async () => {
      const stage = 'Outbox';
      const table = 'distribution_outbox';
      const thresholdMinutes = 240;
      const windowStart = new Date(Date.now() - thresholdMinutes * 60 * 1000).toISOString();

      const { data: latest } = await supabase
        .from(table)
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1);

      if (!latest || latest.length === 0) {
        return { stage, table, state: 'EMPTY', count: 0, latestAgeMinutes: null, thresholdMinutes, detail: 'no outbox rows found' };
      }

      const age = ageMinutes(latest[0].created_at);

      const { count: pendingCount } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');

      const { count: completedCount } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed')
        .gte('updated_at', windowStart);

      const pending = pendingCount ?? 0;
      const completed = completedCount ?? 0;
      const state: StageState = age <= thresholdMinutes ? 'FRESH' : 'STALE';
      return {
        stage, table, state, count: completed, latestAgeMinutes: age, thresholdMinutes,
        detail: `latest outbox row ${age}m ago; pending=${pending}, completed-in-window=${completed}`,
      };
    },

    // 8. Receipts
    () => checkStage('Receipts', 'distribution_receipts', 'recorded_at', 240),
  ];

  const [stages, latency] = await Promise.all([
    Promise.all(checks.map((fn) => fn())),
    Promise.all([
      checkOfferToUniverseLag(),
      checkUniverseToCandidateLag(),
      checkPickDeliveryLag(),
    ]),
  ]);

  const hasEmpty = stages.some((s) => s.state === 'EMPTY');
  const hasStale = stages.some((s) => s.state === 'STALE');
  const hasLatencyFail = latency.some((l) => l.state === 'FAIL');
  const verdict: Verdict = hasEmpty ? 'FAILED' : hasStale || hasLatencyFail ? 'DEGRADED' : 'HEALTHY';

  const freshCount = stages.filter((s) => s.state === 'FRESH').length;
  const staleCount = stages.filter((s) => s.state === 'STALE').length;
  const emptyCount = stages.filter((s) => s.state === 'EMPTY').length;
  const latencyPassCount = latency.filter((l) => l.state === 'PASS').length;
  const latencyFailCount = latency.filter((l) => l.state === 'FAIL').length;
  const summary = `${freshCount} FRESH, ${staleCount} STALE, ${emptyCount} EMPTY | latency ${latencyPassCount} PASS ${latencyFailCount} FAIL — verdict: ${verdict}`;

  const report: FreshnessReport = {
    timestamp: new Date().toISOString(),
    verdict,
    stages,
    latency,
    summary,
  };

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const stateIcon = { FRESH: '✓', STALE: '!', EMPTY: '✗' };
    const latIcon = { PASS: '✓', FAIL: '✗', SKIP: '-' };
    const verdictLine = verdict === 'HEALTHY' ? 'HEALTHY' : verdict === 'DEGRADED' ? 'DEGRADED' : 'FAILED';
    console.log(`\nStage Freshness Report — ${report.timestamp}`);
    console.log(`${'─'.repeat(70)}`);
    for (const s of stages) {
      const icon = stateIcon[s.state];
      const ageStr = s.latestAgeMinutes !== null ? `${s.latestAgeMinutes}m` : 'N/A';
      console.log(`[${icon}] ${s.stage.padEnd(18)} ${s.state.padEnd(6)} age=${ageStr.padStart(5)}  ${s.detail}`);
    }
    console.log(`${'─'.repeat(70)}`);
    console.log('Inter-Stage Latency SLOs:');
    for (const l of latency) {
      const icon = latIcon[l.state];
      console.log(`[${icon}] ${l.check.padEnd(30)} ${l.state.padEnd(4)}  ${l.detail}`);
    }
    console.log(`${'─'.repeat(70)}`);
    console.log(`Verdict: ${verdictLine} (${summary})\n`);
  }

  process.exit(verdict === 'HEALTHY' ? 0 : 1);
}

void main();
