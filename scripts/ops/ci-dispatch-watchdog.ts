/**
 * CI dispatch watchdog (UTV2-1517).
 *
 * GitHub can silently fail to dispatch `pull_request`-triggered workflows for
 * a real commit with no error signal anywhere `gh pr checks` or a webhook
 * consumer can see -- observed for 10+ hours on PR #1182 (2026-07-10,
 * incident UTV2-1517). This script flags any open PR
 * whose latest commit has zero associated Actions runs after a threshold.
 *
 * Remediation is intentionally partial: of the four branch-protection-required
 * checks (`verify`, `Executor Result Validation`, `Merge Gate`, `P0 Protocol`),
 * only Merge Gate's `workflow_dispatch` trigger accepts a manual re-evaluation
 * (`pull_number` input, added for the P0 self-approval case). The other three
 * only trigger on `push`/`pull_request` events, so a genuinely dropped webhook
 * for those requires an actual `synchronize`-triggering push -- this watchdog
 * does not push to another lane's branch unattended, so it alerts instead so
 * (as a comment on the stalled PR itself) so a human/agent can apply the nudge deliberately (see NUDGE_FINDING below).
 *
 * Usage:
 *   tsx scripts/ops/ci-dispatch-watchdog.ts --output-json artifacts/ci-dispatch-watchdog.json
 *   tsx scripts/ops/ci-dispatch-watchdog.ts --dry-run   # detect + report only, no remediation/alerts
 *   tsx scripts/ops/ci-dispatch-watchdog.ts --threshold-minutes 20
 *
 * Exits 0 always (a monitor, not a merge gate). IO failures are recorded in
 * `errors` and reported, not thrown, so a scheduled run never goes red for a
 * transient `gh`/network hiccup.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_THRESHOLD_MINUTES = 15;
const ISSUE_BRANCH_PATTERN = /(?:^|[/_-])(UTV2-\d+)(?:$|[/_-])/i;
const STATE_MARKER = 'CI_DISPATCH_WATCHDOG_STATE:';

/**
 * Documented finding from the 2026-07-10 incident: an `--allow-empty` nudge
 * commit did NOT reliably re-trigger `synchronize` for ~10 minutes, while a
 * commit with a real, substantive diff did resume CI. Empty commits are not a
 * reliable nudge pattern in this repo/environment -- prefer a small but
 * genuine content change (e.g. a proof-file timestamp update) when a manual
 * nudge is needed for the three checks Merge Gate re-dispatch cannot reach.
 */
export const NUDGE_FINDING =
  'Empty commits (git commit --allow-empty) are not a reliable synchronize-retrigger in this repo -- ' +
  'they failed to resume CI for ~10 minutes in the 2026-07-10 incident. A commit with a real, ' +
  'substantive diff resumed CI immediately. If Merge Gate re-dispatch alone does not clear this alert, ' +
  'the remaining required checks (verify, Executor Result Validation, P0 Protocol) need a genuine ' +
  'content-change push to re-trigger, not an empty one.';

export interface OpenPr {
  number: number;
  headRefName: string;
  headRefOid: string;
  updatedAt: string;
}

export interface StalledPr extends OpenPr {
  minutesSinceUpdate: number;
  issueId: string | null;
}

export interface ClassifyResult {
  stalled: StalledPr[];
  ok: OpenPr[];
}

/** Pure decision logic -- no IO, unit-testable without gh/network access. */
export function classifyPrs(
  prs: OpenPr[],
  runCounts: Map<string, number>,
  now: Date,
  thresholdMinutes: number = DEFAULT_THRESHOLD_MINUTES,
): ClassifyResult {
  const stalled: StalledPr[] = [];
  const ok: OpenPr[] = [];

  for (const pr of prs) {
    const runs = runCounts.get(pr.headRefOid) ?? 0;
    const minutesSinceUpdate = (now.getTime() - Date.parse(pr.updatedAt)) / 60_000;

    if (runs === 0 && minutesSinceUpdate > thresholdMinutes) {
      const match = pr.headRefName.match(ISSUE_BRANCH_PATTERN);
      stalled.push({
        ...pr,
        minutesSinceUpdate,
        issueId: match ? match[1].toUpperCase() : null,
      });
    } else {
      ok.push(pr);
    }
  }

  return { stalled, ok };
}

// --- IO: gh CLI -------------------------------------------------------------

function runGh(args: string[]): { ok: boolean; stdout: string; error?: string } {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    return { ok: false, stdout: '', error: (result.stderr || result.stdout || `gh exited ${result.status}`).trim() };
  }
  return { ok: true, stdout: result.stdout };
}

function listOpenPrs(errors: string[]): OpenPr[] {
  const result = runGh([
    'pr',
    'list',
    '--state',
    'open',
    '--json',
    'number,headRefName,headRefOid,updatedAt',
    '--limit',
    '200',
  ]);
  if (!result.ok) {
    errors.push(`gh pr list failed: ${result.error}`);
    return [];
  }
  try {
    return JSON.parse(result.stdout) as OpenPr[];
  } catch (err) {
    errors.push(`gh pr list returned unparseable JSON: ${(err as Error).message}`);
    return [];
  }
}

function runsForSha(sha: string, errors: string[]): number {
  const result = runGh(['api', `repos/{owner}/{repo}/actions/runs?head_sha=${sha}`, '--jq', '.total_count']);
  if (!result.ok) {
    errors.push(`gh api actions/runs failed for ${sha}: ${result.error}`);
    return -1; // -1 = unknown, never treated as "confirmed zero"
  }
  const count = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(count) ? count : -1;
}

/** Best-effort re-evaluation via Merge Gate's workflow_dispatch (pull_number input). */
function remediateViaMergeGate(pr: StalledPr, errors: string[]): boolean {
  const result = runGh([
    'workflow',
    'run',
    'merge-gate.yml',
    '--ref',
    pr.headRefName,
    '-f',
    `pull_number=${pr.number}`,
  ]);
  if (!result.ok) {
    errors.push(`merge-gate re-dispatch failed for PR #${pr.number}: ${result.error}`);
    return false;
  }
  return true;
}

// --- IO: PR comment alert (dedup via a state marker in the comment body) ---

export function alreadyAlerted(comments: Array<{ body: string }>, headSha: string): boolean {
  return comments.some((c) => c.body.includes(STATE_MARKER) && c.body.includes(headSha));
}

function alertStalledPr(pr: StalledPr, remediated: boolean, errors: string[]): void {
  const existing = runGh(['api', `repos/{owner}/{repo}/issues/${pr.number}/comments?per_page=100`]);
  if (!existing.ok) {
    errors.push(`could not read comments for PR #${pr.number}: ${existing.error}`);
    return;
  }
  let comments: Array<{ body: string }> = [];
  try {
    comments = (JSON.parse(existing.stdout) as Array<{ body?: string }>).map((c) => ({ body: c.body ?? '' }));
  } catch (err) {
    errors.push(`PR #${pr.number} comments were unparseable: ${(err as Error).message}`);
    return;
  }
  if (alreadyAlerted(comments, pr.headRefOid)) {
    return; // already alerted for this exact commit -- do not spam every run
  }
  const body = [
    '## CI dispatch watchdog -- stalled PR detected',
    '',
    `PR #${pr.number} (\`${pr.headRefName}\`) has had **zero GitHub Actions runs** for its ` +
      `latest commit (\`${pr.headRefOid.slice(0, 12)}\`) for ${Math.round(pr.minutesSinceUpdate)} minutes.`,
    '',
    remediated
      ? 'Attempted remediation: re-dispatched Merge Gate via `workflow_dispatch`. This only covers ' +
        'one of the four required checks -- see note below.'
      : 'Remediation attempt failed or was skipped -- see workflow logs.',
    '',
    NUDGE_FINDING,
    '',
    `${STATE_MARKER} ${pr.headRefOid}`,
  ].join('\n');
  const posted = runGh(['pr', 'comment', String(pr.number), '--body', body]);
  if (!posted.ok) {
    errors.push(`PR comment alert failed for PR #${pr.number}: ${posted.error}`);
  }
}

// --- CLI ---------------------------------------------------------------------

interface Args {
  outputJson: string | null;
  dryRun: boolean;
  thresholdMinutes: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { outputJson: null, dryRun: false, thresholdMinutes: DEFAULT_THRESHOLD_MINUTES };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--output-json') out.outputJson = argv[++i] ?? null;
    else if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--threshold-minutes') {
      const parsed = Number.parseInt(argv[++i] ?? '', 10);
      if (Number.isFinite(parsed) && parsed > 0) out.thresholdMinutes = parsed;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const errors: string[] = [];

  const prs = listOpenPrs(errors);
  const runCounts = new Map<string, number>();
  for (const pr of prs) {
    const count = runsForSha(pr.headRefOid, errors);
    if (count >= 0) runCounts.set(pr.headRefOid, count);
    else runCounts.set(pr.headRefOid, 1); // unknown -> do not falsely flag as stalled
  }

  const { stalled, ok } = classifyPrs(prs, runCounts, new Date(), args.thresholdMinutes);

  const remediations: Array<{ pr: number; remediated: boolean }> = [];
  if (!args.dryRun) {
    for (const pr of stalled) {
      const remediated = remediateViaMergeGate(pr, errors);
      remediations.push({ pr: pr.number, remediated });
      alertStalledPr(pr, remediated, errors);
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    threshold_minutes: args.thresholdMinutes,
    dry_run: args.dryRun,
    open_prs_checked: prs.length,
    stalled: stalled.map((s) => ({
      pr: s.number,
      branch: s.headRefName,
      head_sha: s.headRefOid,
      issue_id: s.issueId,
      minutes_since_update: Math.round(s.minutesSinceUpdate),
    })),
    ok_count: ok.length,
    remediations,
    errors,
  };

  console.log(JSON.stringify(report, null, 2));
  if (args.outputJson) {
    mkdirSync(dirname(args.outputJson), { recursive: true });
    writeFileSync(args.outputJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  process.exitCode = 0;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 0; // monitor, never fails the workflow
  });
}
