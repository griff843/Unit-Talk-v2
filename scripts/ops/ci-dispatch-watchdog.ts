/**
 * CI dispatch watchdog (UTV2-1517).
 *
 * GitHub can silently fail to dispatch `pull_request`-triggered workflows for
 * a real commit with no error signal anywhere `gh pr checks` or a webhook
 * consumer can see -- observed for 10+ hours on PR #1182 (2026-07-10, see
 * Linear UTV2-1517 for the incident writeup). This script flags any open PR
 * whose latest commit has zero associated Actions runs after a threshold.
 *
 * Remediation is intentionally partial: of the four branch-protection-required
 * checks (`verify`, `Executor Result Validation`, `Merge Gate`, `P0 Protocol`),
 * only Merge Gate's `workflow_dispatch` trigger accepts a manual re-evaluation
 * (`pull_number` input, added for the P0 self-approval case). The other three
 * only trigger on `push`/`pull_request` events, so a genuinely dropped webhook
 * for those requires an actual `synchronize`-triggering push -- this watchdog
 * does not push to another lane's branch unattended, so it alerts instead so
 * a human/agent can apply the nudge deliberately (see NUDGE_FINDING below).
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
const LINEAR_TEAM_KEY = 'UTV2';

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

// --- IO: Linear alert (dedup via a state marker in the comment body) -------

async function linearGraphql<T>(token: string, query: string, variables: unknown): Promise<T> {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error(`Linear GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

interface IssueLookup {
  issues: { nodes: Array<{ id: string; comments: { nodes: Array<{ body: string }> } }> };
}

function alreadyAlerted(comments: Array<{ body: string }>, headSha: string): boolean {
  return comments.some((c) => c.body.includes(STATE_MARKER) && c.body.includes(headSha));
}

async function alertStalledPr(
  token: string,
  pr: StalledPr,
  remediated: boolean,
  errors: string[],
): Promise<void> {
  if (!pr.issueId) {
    errors.push(`PR #${pr.number} has no parseable UTV2-### in its branch name; cannot post a Linear alert`);
    return;
  }
  try {
    const data = await linearGraphql<IssueLookup>(
      token,
      `query($key:String!,$num:Float!){
        issues(filter:{team:{key:{eq:$key}},number:{eq:$num}},first:1){
          nodes{ id comments(first:50){ nodes{ body } } }
        }
      }`,
      { key: LINEAR_TEAM_KEY, num: Number(pr.issueId.split('-')[1]) },
    );
    const issue = data.issues.nodes[0];
    if (!issue) {
      errors.push(`Linear issue ${pr.issueId} not found; cannot post alert`);
      return;
    }
    if (alreadyAlerted(issue.comments.nodes, pr.headRefOid)) {
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
    await linearGraphql(
      token,
      `mutation($issueId:String!,$body:String!){ commentCreate(input:{issueId:$issueId,body:$body}){ success } }`,
      { issueId: issue.id, body },
    );
  } catch (err) {
    errors.push(`Linear alert failed for PR #${pr.number}: ${(err as Error).message}`);
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
      const token = process.env.LINEAR_API_TOKEN ?? '';
      if (token) {
        await alertStalledPr(token, pr, remediated, errors);
      } else {
        errors.push('LINEAR_API_TOKEN not set; skipped Linear alert');
      }
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
