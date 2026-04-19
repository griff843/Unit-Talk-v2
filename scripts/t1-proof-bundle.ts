import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadEnvironment } from '@unit-talk/config';

type CommandResult = {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

type PickProofSummary = {
  pickId: string;
  ok: boolean;
  verdict: string;
  status?: string;
  promotionStatus?: string;
  promotionTarget?: string | null;
};

type PipelineSummary = {
  counts: Record<string, number>;
  latestRunStatus: string | null;
  latestRunAt: string | null;
  latestSuccessfulRunAt: string | null;
  staleProcessingCount: number;
  stalePendingCount: number;
  deferredPendingCount: number;
  workerVerdict: string;
};

const env = loadEnvironment();
const workerTargets = (env.UNIT_TALK_DISTRIBUTION_TARGETS?.trim() || 'discord:canary')
  .split(',')
  .map((target) => target.trim())
  .filter(Boolean);
const args = process.argv.slice(2);
const pickIds = readMultiOption('pick');
const issueId = readOption('issue');
const change = readOption('change');
const json = hasFlag('json');
const skipVerify = hasFlag('skip-verify');
const skipPipeline = hasFlag('skip-pipeline');

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
  const head = runSimple('git', ['rev-parse', 'HEAD']);
  const timestamp = new Date().toISOString();

  const verifyResult = skipVerify ? null : runPnpm(['verify']);
  const pipelineSummary =
    skipPipeline || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY
      ? null
      : await collectPipelineSummary();
  const pickSummaries = await Promise.all(pickIds.map((pickId) => collectPickProof(pickId)));

  const overallVerdict = computeOverallVerdict({
    verifyResult,
    pipelineSummary,
    pickSummaries,
  });

  const bundle = {
    timestamp,
    issueId: issueId ?? null,
    change: change ?? null,
    gitHead: head.ok ? head.stdout.trim() : null,
    verify: verifyResult
      ? {
          ok: verifyResult.ok,
          exitCode: verifyResult.exitCode,
          tail: tail(verifyResult.ok ? verifyResult.stdout : [verifyResult.stdout, verifyResult.stderr].filter(Boolean).join('\n'), 20),
        }
      : {
          skipped: true,
        },
    pipeline: pipelineSummary ?? {
      skipped: true,
    },
    picks: pickSummaries,
    verdict: overallVerdict,
  };

  if (json) {
    console.log(JSON.stringify(bundle, null, 2));
    process.exit(overallVerdict === 'FAIL' ? 1 : 0);
    return;
  }

  printBundle(bundle);
  process.exit(overallVerdict === 'FAIL' ? 1 : 0);
}

async function collectPipelineSummary(): Promise<PipelineSummary> {
  const client = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const now = Date.now();
  const { data: outboxRows, error: outboxError } = await client
    .from('distribution_outbox')
    .select('id,status,target,created_at,claimed_at');

  if (outboxError) {
    throw new Error(`Failed reading distribution_outbox: ${outboxError.message}`);
  }

  const { data: runs, error: runsError } = await client
    .from('system_runs')
    .select('status,started_at,finished_at,run_type')
    .eq('run_type', 'distribution.process')
    .order('started_at', { ascending: false })
    .limit(10);

  if (runsError) {
    throw new Error(`Failed reading system_runs: ${runsError.message}`);
  }

  const { data: heartbeats, error: heartbeatsError } = await client
    .from('system_runs')
    .select('status,started_at,finished_at,run_type')
    .eq('run_type', 'worker.heartbeat')
    .order('started_at', { ascending: false })
    .limit(10);

  if (heartbeatsError) {
    throw new Error(`Failed reading worker heartbeats: ${heartbeatsError.message}`);
  }

  const counts: Record<string, number> = {};
  const staleProcessing = (outboxRows ?? []).filter((row) => {
    if (!workerTargets.includes(row.target) || row.status !== 'processing' || !row.claimed_at) {
      return false;
    }
    return ageMinutes(now, row.claimed_at) > 5;
  });
  const stalePending = (outboxRows ?? []).filter((row) => {
    if (!workerTargets.includes(row.target) || row.status !== 'pending') {
      return false;
    }
    return ageMinutes(now, row.created_at) > 30;
  });
  const deferredPending = (outboxRows ?? []).filter((row) => {
    if (workerTargets.includes(row.target) || row.status !== 'pending') {
      return false;
    }
    return ageMinutes(now, row.created_at) > 30;
  });

  for (const row of outboxRows ?? []) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  const latestRun = runs?.[0] ?? null;
  const latestSuccessfulRun =
    runs?.find((run) => run.status === 'succeeded') ?? null;
  const runsInWindow = (runs ?? []).filter((run) => ageMinutes(now, run.started_at) <= 120);
  const heartbeatsInWindow = (heartbeats ?? []).filter((heartbeat) => ageMinutes(now, heartbeat.started_at) <= 10);

  let workerVerdict = 'HEALTHY';
  if (heartbeatsInWindow.length === 0 && !latestRun) {
    workerVerdict = 'DOWN_NO_RUNS_OR_HEARTBEATS';
  } else if (heartbeatsInWindow.length === 0 && runsInWindow.length === 0) {
    workerVerdict = 'DOWN_NO_RUNS_OR_HEARTBEATS_IN_WINDOW';
  } else if (latestRun?.status === 'failed') {
    workerVerdict = 'DEGRADED_LAST_RUN_FAILED';
  } else if (latestRun?.status === 'cancelled') {
    workerVerdict = 'DEGRADED_LAST_RUN_CANCELLED';
  } else if (staleProcessing.length > 0) {
    workerVerdict = 'DEGRADED_STALE_PROCESSING';
  }

  return {
    counts,
    latestRunStatus: latestRun?.status ?? null,
    latestRunAt: latestRun?.started_at ?? null,
    latestSuccessfulRunAt: latestSuccessfulRun?.started_at ?? null,
    staleProcessingCount: staleProcessing.length,
    stalePendingCount: stalePending.length,
    deferredPendingCount: deferredPending.length,
    workerVerdict,
  };
}

async function collectPickProof(pickId: string): Promise<PickProofSummary> {
  const result = runPnpm(['verify:pick', '--', pickId, '--json']);
  const payload = parsePickPayload(result.stdout);
  if (payload) {
    return {
      pickId,
      ok: payload.verdict === 'VERIFIED',
      verdict: payload.verdict ?? 'UNKNOWN',
      status: payload.pick?.status,
      promotionStatus: payload.pick?.promotion_status,
      promotionTarget: payload.pick?.promotion_target ?? null,
    };
  }

  if (!result.ok) {
    const body = [result.stdout, result.stderr].filter(Boolean).join('\n');
    return {
      pickId,
      ok: false,
      verdict: extractString(body, '"verdict":') ?? 'FAILED_TO_VERIFY',
    };
  }

  return {
    pickId,
    ok: false,
    verdict: 'FAILED_TO_VERIFY',
  };
}

function parsePickPayload(stdout: string):
  | {
      verdict?: string;
      pick?: {
        status?: string;
        promotion_status?: string;
        promotion_target?: string | null;
      } | null;
    }
  | null {
  const jsonStart = stdout.indexOf('{');
  const jsonEnd = stdout.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    return null;
  }

  const candidate = stdout.slice(jsonStart, jsonEnd + 1).trim();
  let payload: {
    verdict?: string;
    pick?: {
      status?: string;
      promotion_status?: string;
      promotion_target?: string | null;
    } | null;
  };

  try {
    payload = JSON.parse(candidate) as typeof payload;
  } catch {
    return null;
  }

  return payload;
}

function computeOverallVerdict(input: {
  verifyResult: CommandResult | null;
  pipelineSummary: PipelineSummary | null;
  pickSummaries: PickProofSummary[];
}): 'PASS' | 'PARTIAL' | 'FAIL' {
  const verifyFailed = input.verifyResult !== null && !input.verifyResult.ok;
  const pickFailed = input.pickSummaries.some((summary) => !summary.ok);
  const pipelineFailed =
    input.pipelineSummary !== null &&
    (input.pipelineSummary.workerVerdict !== 'HEALTHY' ||
      (input.pipelineSummary.counts['dead_letter'] ?? 0) > 0);

  if (verifyFailed || pickFailed || pipelineFailed) {
    return 'FAIL';
  }

  if (
    input.verifyResult === null ||
    input.pipelineSummary === null ||
    input.pickSummaries.length === 0
  ) {
    return 'PARTIAL';
  }

  return 'PASS';
}

function printBundle(bundle: {
  timestamp: string;
  issueId: string | null;
  change: string | null;
  gitHead: string | null;
  verify: { ok?: boolean; exitCode?: number | null; tail?: string; skipped?: boolean };
  pipeline: PipelineSummary | { skipped: true };
  picks: PickProofSummary[];
  verdict: string;
}): void {
  console.log('# T1 Proof Bundle');
  console.log('');
  console.log(`Timestamp: ${bundle.timestamp}`);
  console.log(`Issue: ${bundle.issueId ?? 'n/a'}`);
  console.log(`Change: ${bundle.change ?? 'n/a'}`);
  console.log(`HEAD: ${bundle.gitHead ?? 'n/a'}`);
  console.log('');

  console.log('Verify');
  if ('skipped' in bundle.verify) {
    console.log('- skipped');
  } else {
    console.log(`- pnpm verify: ${bundle.verify.ok ? 'PASS' : 'FAIL'} (exit ${bundle.verify.exitCode ?? 'n/a'})`);
    if (bundle.verify.tail) {
      console.log('```text');
      console.log(bundle.verify.tail);
      console.log('```');
    }
  }

  console.log('');
  console.log('Pipeline');
  if ('skipped' in bundle.pipeline) {
    console.log('- skipped');
  } else {
    const counts = Object.entries(bundle.pipeline.counts)
      .map(([status, count]) => `${status}=${count}`)
      .join(', ');
    console.log(`- worker: ${bundle.pipeline.workerVerdict}`);
    console.log(`- latest run: ${bundle.pipeline.latestRunStatus ?? 'n/a'} @ ${bundle.pipeline.latestRunAt ?? 'n/a'}`);
    console.log(`- latest success: ${bundle.pipeline.latestSuccessfulRunAt ?? 'n/a'}`);
    console.log(`- outbox counts: ${counts || '(none)'}`);
    console.log(`- stale processing: ${bundle.pipeline.staleProcessingCount}`);
    console.log(`- stale pending: ${bundle.pipeline.stalePendingCount}`);
    console.log(`- deferred pending: ${bundle.pipeline.deferredPendingCount}`);
  }

  console.log('');
  console.log('Picks');
  if (bundle.picks.length === 0) {
    console.log('- none');
  } else {
    for (const pick of bundle.picks) {
      console.log(
        `- ${pick.pickId}: ${pick.verdict} | status=${pick.status ?? 'n/a'} | promotion=${pick.promotionStatus ?? 'n/a'} -> ${pick.promotionTarget ?? 'n/a'}`,
      );
    }
  }

  console.log('');
  console.log(`Verdict: ${bundle.verdict}`);
}

function runSimple(command: string, commandArgs: string[]): CommandResult {
  return runCommand(command, commandArgs);
}

function runPnpm(commandArgs: string[]): CommandResult {
  return spawnShellCommand(`pnpm ${commandArgs.map(quoteArg).join(' ')}`);
}

function runCommand(command: string, commandArgs: string[]): CommandResult {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: 'pipe',
  });

  return {
    ok: result.status === 0,
    command: `${command} ${commandArgs.join(' ')}`,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status,
  };
}

function spawnShellCommand(command: string): CommandResult {
  const result = spawnSync(command, {
    encoding: 'utf8',
    stdio: 'pipe',
    shell: true,
  });

  return {
    ok: result.status === 0,
    command,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status,
  };
}

function ageMinutes(nowMs: number, timestamp: string): number {
  return Math.round((nowMs - new Date(timestamp).getTime()) / 60000);
}

function tail(value: string, lineCount: number): string {
  const lines = value.split(/\r?\n/).filter(Boolean);
  return lines.slice(Math.max(lines.length - lineCount, 0)).join('\n');
}

function extractString(haystack: string, prefix: string): string | undefined {
  const line = haystack.split(/\r?\n/).find((candidate) => candidate.includes(prefix));
  if (!line) {
    return undefined;
  }

  const match = line.match(/"verdict"\s*:\s*"([^"]+)"/);
  return match?.[1];
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function readOption(name: string): string | undefined {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === exact) {
      const next = args[index + 1];
      return next && !next.startsWith('--') ? next : undefined;
    }
    if (current.startsWith(prefix)) {
      return current.slice(prefix.length);
    }
  }
  return undefined;
}

function readMultiOption(name: string): string[] {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === exact) {
      const next = args[index + 1];
      if (next && !next.startsWith('--')) {
        values.push(next);
      }
      continue;
    }
    if (current.startsWith(prefix)) {
      values.push(current.slice(prefix.length));
    }
  }
  return values;
}

function quoteArg(value: string): string {
  if (/^[A-Za-z0-9._:/=-]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}
