import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  ROOT,
  emitJson,
  getFlag,
  parseArgs,
  readManifest,
  requireIssueId,
  type LaneManifest,
} from './shared.js';

export interface LaneFinalizeStep {
  id:
    | 'record_merge'
    | 'apply_tier_label'
    | 'generate_proof'
    | 'generate_t2_proof_bundle'
    | 'close_lane'
    | 'reconcile_current';
  command: string;
  args: string[];
  required: boolean;
}

export interface LaneFinalizePlan {
  issue_id: string;
  branch: string;
  pr: string;
  dry_run: boolean;
  already_closed: boolean;
  steps: LaneFinalizeStep[];
}

export interface LaneFinalizeResult {
  ok: boolean;
  code: 'lane_finalize_dry_run' | 'lane_finalized' | 'lane_already_finalized' | 'lane_finalize_failed';
  issue_id: string;
  branch: string;
  pr: string;
  dry_run: boolean;
  steps: Array<LaneFinalizeStep & { status: 'planned' | 'passed' | 'skipped' | 'failed'; stdout?: string; stderr?: string }>;
  message: string;
}

export type LaneFinalizeRunner = (
  command: string,
  args: string[],
  options: { cwd: string; encoding: 'utf8'; stdio: 'pipe' },
) => { status: number | null; stdout?: string | Buffer | null; stderr?: string | Buffer | null };

export function buildLaneFinalizePlan(input: {
  manifest: LaneManifest;
  pr: string;
  branch?: string | null;
  dryRun?: boolean;
}): LaneFinalizePlan {
  const alreadyClosed = input.manifest.status === 'done';
  const issueId = input.manifest.issue_id;
  const steps: LaneFinalizeStep[] = [];

  if (!alreadyClosed) {
    steps.push({
      id: 'record_merge',
      command: 'pnpm',
      args: ['ops:lane-manifest', 'record-merge', issueId, '--pr', input.pr, '--json'],
      required: true,
    });
    // Apply tier label to PR — non-blocking so a missing label doesn't stall closeout
    if (input.manifest.tier) {
      steps.push({
        id: 'apply_tier_label',
        command: 'gh',
        args: ['pr', 'edit', normalizePrUrl(input.pr), '--add-label', `tier:${input.manifest.tier}`],
        required: false,
      });
    }
    steps.push({
      id: 'generate_proof',
      command: 'pnpm',
      args: [
        'ops:proof-generate',
        issueId,
        '--json',
        '--current',
        '--branch',
        input.branch ?? input.manifest.branch,
        '--pr-url',
        normalizePrUrl(input.pr),
      ],
      required: true,
    });
    if (shouldGenerateT2ProofBundle(input.manifest)) {
      steps.push({
        id: 'generate_t2_proof_bundle',
        command: 'pnpm',
        args: [
          'exec',
          'tsx',
          'scripts/ops/t2-proof-bundle.ts',
          issueId,
          '--json',
          '--force',
          '--diff-summary',
          standardProofPath(issueId, 'diff-summary.md'),
          '--verification-log',
          standardProofPath(issueId, 'runtime-verification.md'),
        ],
        required: true,
      });
    }
    steps.push({
      id: 'close_lane',
      command: 'pnpm',
      args: ['ops:lane-close', issueId, '--acquire-lock'],
      required: true,
    });
  }

  steps.push({
    id: 'reconcile_current',
    command: 'pnpm',
    args: ['ops:orchestration-reconcile', '--current', '--json'],
    required: true,
  });

  return {
    issue_id: issueId,
    branch: input.manifest.branch,
    pr: input.pr,
    dry_run: input.dryRun ?? false,
    already_closed: alreadyClosed,
    steps,
  };
}

export function resolveLaneFinalizeInput(input: {
  issueId?: string | null;
  pr?: string | null;
  manifest: LaneManifest;
}): { issueId: string; pr: string } {
  const issueId = requireIssueId(input.issueId ?? input.manifest.issue_id);
  if (issueId !== input.manifest.issue_id) {
    throw new Error(`Issue ${issueId} does not match manifest issue ${input.manifest.issue_id}.`);
  }
  const pr = input.pr ?? extractPrNumber(input.manifest.pr_url);
  if (!pr) {
    throw new Error('Missing required --pr and manifest.pr_url does not contain a PR number.');
  }

  return { issueId, pr };
}

function extractPrNumber(prUrl: string | null): string | null {
  if (!prUrl) return null;
  const match = prUrl.match(/\/pull\/(\d+)(?:$|[/?#])/);
  return match?.[1] ?? null;
}

function normalizePrUrl(pr: string): string {
  return pr.startsWith('http')
    ? pr
    : `https://github.com/griff843/Unit-Talk-v2/pull/${pr}`;
}

function standardProofPath(issueId: string, fileName: 'diff-summary.md' | 'runtime-verification.md'): string {
  return `docs/06_status/proof/${issueId}/${fileName}`;
}

function shouldGenerateT2ProofBundle(manifest: LaneManifest): boolean {
  if (manifest.tier !== 'T2') {
    return false;
  }
  return ['governance', 'hygiene', 'verification', 'delivery-ui', 'codex-cli'].includes(
    manifest.lane_type,
  );
}

export function runLaneFinalizePlan(
  plan: LaneFinalizePlan,
  options: { runner?: LaneFinalizeRunner } = {},
): LaneFinalizeResult {
  const runner = options.runner ?? spawnSync;
  const steps: LaneFinalizeResult['steps'] = [];

  if (plan.dry_run) {
    return {
      ok: true,
      code: 'lane_finalize_dry_run',
      issue_id: plan.issue_id,
      branch: plan.branch,
      pr: plan.pr,
      dry_run: true,
      steps: plan.steps.map((step) => ({ ...step, status: 'planned' })),
      message: 'Lane finalize dry-run only; no closeout commands executed.',
    };
  }

  for (const step of plan.steps) {
    const result = runner(step.command, step.args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    const status = result.status ?? 1;
    const output = {
      stdout: String(result.stdout ?? '').trim(),
      stderr: String(result.stderr ?? '').trim(),
    };
    if (status !== 0) {
      if (!step.required) {
        steps.push({ ...step, status: 'skipped', ...output });
        continue;
      }
      steps.push({ ...step, status: 'failed', ...output });
      return {
        ok: false,
        code: 'lane_finalize_failed',
        issue_id: plan.issue_id,
        branch: plan.branch,
        pr: plan.pr,
        dry_run: false,
        steps,
        message: `Lane finalize failed at ${step.id}.`,
      };
    }
    steps.push({ ...step, status: 'passed', ...output });
  }

  return {
    ok: true,
    code: plan.already_closed ? 'lane_already_finalized' : 'lane_finalized',
    issue_id: plan.issue_id,
    branch: plan.branch,
    pr: plan.pr,
    dry_run: false,
    steps,
    message: plan.already_closed
      ? 'Lane was already closed; reconciliation completed.'
      : 'Lane finalize completed.',
  };
}

function main(argv = process.argv.slice(2)): number {
  const { flags, bools } = parseArgs(argv);
  const rawIssueId = getFlag(flags, 'issue') ?? '';
  const json = bools.has('json');
  const manifest = readManifest(requireIssueId(rawIssueId));
  const { pr } = resolveLaneFinalizeInput({
    issueId: rawIssueId,
    pr: getFlag(flags, 'pr') ?? getFlag(flags, 'pr-url') ?? getFlag(flags, 'pr-number'),
    manifest,
  });

  const plan = buildLaneFinalizePlan({
    manifest,
    pr,
    branch: getFlag(flags, 'branch') ?? null,
    dryRun: bools.has('dry-run') || bools.has('explain'),
  });
  const result = runLaneFinalizePlan(plan);
  if (json) {
    emitJson(result);
  } else {
    process.stdout.write(`${result.message}\n`);
    for (const step of result.steps) {
      process.stdout.write(`${step.status}: ${step.command} ${step.args.join(' ')}\n`);
    }
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    emitJson({
      ok: false,
      code: 'lane_finalize_failed',
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}
