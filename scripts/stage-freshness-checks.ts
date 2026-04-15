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

interface StageResult {
  stage: string;
  table: string;
  state: StageState;
  count: number;
  latestAgeMinutes: number | null;
  thresholdMinutes: number;
  detail: string;
}

interface FreshnessReport {
  timestamp: string;
  verdict: Verdict;
  stages: StageResult[];
  summary: string;
}

const env = loadEnvironment();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');

function ageMinutes(isoTs: string): number {
  return Math.round((Date.now() - new Date(isoTs).getTime()) / 60_000);
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

  const stages = await Promise.all(checks.map((fn) => fn()));

  const hasEmpty = stages.some((s) => s.state === 'EMPTY');
  const hasStale = stages.some((s) => s.state === 'STALE');
  const verdict: Verdict = hasEmpty ? 'FAILED' : hasStale ? 'DEGRADED' : 'HEALTHY';

  const freshCount = stages.filter((s) => s.state === 'FRESH').length;
  const staleCount = stages.filter((s) => s.state === 'STALE').length;
  const emptyCount = stages.filter((s) => s.state === 'EMPTY').length;
  const summary = `${freshCount} FRESH, ${staleCount} STALE, ${emptyCount} EMPTY — verdict: ${verdict}`;

  const report: FreshnessReport = {
    timestamp: new Date().toISOString(),
    verdict,
    stages,
    summary,
  };

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const stateIcon = { FRESH: '✓', STALE: '!', EMPTY: '✗' };
    const verdictLine = verdict === 'HEALTHY' ? 'HEALTHY' : verdict === 'DEGRADED' ? 'DEGRADED' : 'FAILED';
    console.log(`\nStage Freshness Report — ${report.timestamp}`);
    console.log(`${'─'.repeat(70)}`);
    for (const s of stages) {
      const icon = stateIcon[s.state];
      const ageStr = s.latestAgeMinutes !== null ? `${s.latestAgeMinutes}m` : 'N/A';
      console.log(`[${icon}] ${s.stage.padEnd(18)} ${s.state.padEnd(6)} age=${ageStr.padStart(5)}  ${s.detail}`);
    }
    console.log(`${'─'.repeat(70)}`);
    console.log(`Verdict: ${verdictLine} (${summary})\n`);
  }

  process.exit(verdict === 'HEALTHY' ? 0 : 1);
}

void main();
