/**
 * ops:reconcile — scheduled stranded lane detection (EXECUTION_TRUTH_MODEL.md §7)
 *
 * Detects and mutates manifests for stale/stranded/orphaned lanes:
 *   stale:        heartbeat_at 4-24h old → logged in digest, no manifest write
 *   stranded:     heartbeat_at >24h → status → blocked, truth_check_history appended
 *   orphaned:     branch deleted on remote but manifest active → logged in digest
 *   ghost_merged: the lane's PR is MERGED on GitHub while the manifest is still
 *                 in an active status → status → merged, commit_sha bound
 *
 * Does not modify branches or Linear state. Idempotent — safe to re-run.
 *
 * ## ghost_merged (UTV2-1613)
 *
 * A manifest left in `started`/`in_progress`/`in_review` after its PR merged
 * keeps holding its `file_scope_lock` against every other lane and keeps
 * consuming a concurrency slot, indefinitely — nothing in the ordinary flow
 * ever revisits it. Live examples at the time of writing: UTV2-1553
 * (`started`, PR #1322 merged) blocking any lane that touches its files, and
 * UTV2-1612's stale `package.json` lock blocking UTV2-1604.
 *
 * Reconciling such a manifest to `merged` is not a judgement about the lane's
 * quality — it is copying down what GitHub already says. It deliberately
 * stops at `merged` and never advances to `done`: `done` is a governance
 * verdict that only a passing `ops:truth-check` may grant, and this reconciler
 * measures nothing. `merged` is enough to release the locks, because
 * `merged` is outside both `ACTIVE_LOCK_STATUSES` and the file-scope guard's
 * `LOCK_CONFLICT_STATUSES`.
 *
 * The appended history entry is a `fail` under the canonical `ops:reconcile`
 * runner, recording exactly why the lane was reconciled. It is never a pass:
 * see UTV2-1613 for what happened the last time a repair path wrote one.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTIVE_LOCK_STATUSES,
  ROOT,
  parseArgs,
  readAllManifests,
  type LaneManifest,
} from './shared.js';

// ── Thresholds (EXECUTION_TRUTH_MODEL.md §7) ─────────────────────────────────

const STALE_MS = 4 * 60 * 60 * 1000;    // 4 hours  → stale (report only)
const STRANDED_MS = 24 * 60 * 60 * 1000; // 24 hours → blocked (write manifest)

/**
 * `ACTIVE_LOCK_STATUSES` minus `reopened`. See the doc comment at the
 * `ghost_merged` check site in `reconcileManifest` for why `reopened` must
 * never be eligible for this rule.
 */
const GHOST_ELIGIBLE_STATUSES = new Set(
  [...ACTIVE_LOCK_STATUSES].filter((status) => status !== 'reopened'),
);

// ── Types ──────────────────────────────────────────────────────────────────────

export type ReconcileVerdict = 'stale' | 'stranded' | 'orphaned' | 'ghost_merged' | 'clean';

export interface ReconcileEntry {
  issue_id: string;
  verdict: ReconcileVerdict;
  detail: string;
  branch: string;
  heartbeat_age_h: number | null;
  action_taken: string;
  planned_mutation: string | null;
}

interface ReconcileDigest {
  schema_version: 1;
  run_at: string;
  mode: 'local' | 'scheduled';
  dry_run: boolean;
  manifest_count: number;
  active_count: number;
  planned_mutations: number;
  mutations: number;
  entries: ReconcileEntry[];
}

export interface MergedPrForLane {
  url: string | null;
  mergeSha: string | null;
}

export interface ReconcileManifestOptions {
  apply: boolean;
  now?: Date;
  branchExists?: (branch: string) => boolean | null;
  writeManifest?: (manifest: LaneManifest) => void;
  /**
   * Resolves the merged PR authoritatively backing this lane, or null when the
   * lane has no merged PR. Injectable so the ghost-lane rule is testable
   * without a network round trip.
   */
  resolveMergedPr?: (manifest: LaneManifest) => MergedPrForLane | null;
}

/**
 * Asks GitHub whether this lane's PR is merged. Resolves via the manifest's
 * own `pr_url` when it has one, otherwise by the lane branch's merged head PR
 * — the stranded case where the lane never recorded its own binding.
 *
 * Every failure mode returns null (no ghost detected) rather than guessing:
 * `gh` missing, unauthenticated, rate-limited, ambiguous results, or a PR
 * whose head ref is not this lane's branch. A reconciler that mutates
 * governance state on an unclear answer would be worse than one that does
 * nothing.
 */
function escapeRegExpForIssueMatch(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function resolveMergedPrForLane(manifest: LaneManifest): MergedPrForLane | null {
  // Explicit identity (`pr_url` already on the manifest) resolves exactly
  // that PR by URL -- no further identity check is needed. The branch-only
  // fallback below is the risky, inferred path: a stale or reused branch name
  // could otherwise match an unrelated merged PR, so it additionally requires
  // the candidate's own title to name this issue (UTV2-1613 adversarial
  // review finding, mirroring the equivalent fix to selectInferredMergedPr in
  // lane-close.ts -- never accept the branch name itself as a stand-in for a
  // real title check).
  const usingBranchFallback = !manifest.pr_url;
  const selector = manifest.pr_url
    ? ['view', manifest.pr_url]
    : ['list', '--head', manifest.branch, '--state', 'merged', '--limit', '5'];
  const result = spawnSync(
    'gh',
    [
      'pr',
      ...selector,
      '--repo',
      'griff843/Unit-Talk-v2',
      '--json',
      'url,state,mergedAt,mergeCommit,headRefName,title',
    ],
    { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' },
  );
  if (result.error || result.status !== 0 || !result.stdout) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return null;
  }

  type PrShape = {
    url?: string;
    state?: string | null;
    mergedAt?: string | null;
    mergeCommit?: { oid?: string | null } | null;
    headRefName?: string | null;
    title?: string | null;
  };
  const candidates: PrShape[] = Array.isArray(parsed) ? (parsed as PrShape[]) : [parsed as PrShape];
  const issuePattern = new RegExp(
    `(^|[^A-Z0-9])${escapeRegExpForIssueMatch(manifest.issue_id)}([^A-Z0-9]|$)`,
    'iu',
  );
  const merged = candidates.filter(
    (candidate) =>
      (candidate.state?.toLowerCase() === 'merged' || Boolean(candidate.mergedAt)) &&
      Boolean(candidate.mergeCommit?.oid) &&
      candidate.headRefName === manifest.branch &&
      (!usingBranchFallback || issuePattern.test(candidate.title ?? '')),
  );
  if (merged.length !== 1) return null;

  return {
    url: merged[0]?.url ?? manifest.pr_url,
    mergeSha: merged[0]?.mergeCommit?.oid ?? null,
  };
}

// ── Branch existence check ────────────────────────────────────────────────────

function branchExistsOnRemote(branch: string): boolean | null {
  try {
    const result = spawnSync(
      'git',
      ['ls-remote', '--exit-code', '--heads', 'origin', branch],
      { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' },
    );
    if (result.error) return null;
    // exit code 0 = exists, 2 = not found
    return result.status === 0;
  } catch {
    return null;
  }
}

// ── Manifest write helpers ────────────────────────────────────────────────────

function manifestPath(issueId: string): string {
  return path.join(ROOT, 'docs', '06_status', 'lanes', `${issueId}.json`);
}

function writeManifestJson(manifest: LaneManifest): void {
  const filePath = manifestPath(manifest.issue_id);
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

// ── Reconcile a single manifest ───────────────────────────────────────────────

export function reconcileManifest(
  manifest: LaneManifest,
  options: ReconcileManifestOptions,
): ReconcileEntry {
  const now = options.now?.getTime() ?? Date.now();
  const heartbeatMs = manifest.heartbeat_at ? Date.parse(manifest.heartbeat_at) : null;
  const ageMs = heartbeatMs != null ? now - heartbeatMs : null;
  const ageH = ageMs != null ? Math.round(ageMs / (60 * 60 * 1000) * 10) / 10 : null;
  const branchExists = options.branchExists ?? branchExistsOnRemote;
  const writeManifest = options.writeManifest ?? writeManifestJson;
  const resolveMergedPr = options.resolveMergedPr ?? resolveMergedPrForLane;

  // Ghost-merged is checked FIRST. A merged lane's branch is routinely deleted
  // afterwards, so the orphaned-branch check below would otherwise classify
  // every ghost as merely "orphaned — manual close required" and leave its
  // locks in place, which is exactly the state UTV2-1613 is fixing.
  // Only manifests in a genuinely lock-HOLDING status are eligible. This is
  // the exact `ACTIVE_LOCK_STATUSES` set from shared.ts -- the population that
  // reserves files and concurrency slots. Anything already terminal (including
  // the legacy `closed` status that predates the current schema) is left
  // strictly alone: reconciling a terminal manifest "forward" to `merged`
  // would be moving it backwards, rewriting hundreds of settled records to fix
  // a lock problem they do not have.
  //
  // UTV2-1613 adversarial review finding: `ACTIVE_LOCK_STATUSES` includes
  // `reopened`, which is NOT eligible here. A manifest only ever reaches
  // `reopened` when `runTruthCheck` detects a genuine regression on a
  // previously-`done` lane (exitCode 4) -- which means it already has a
  // merged `pr_url` from its first close. Every `reopened` manifest would
  // therefore deterministically match the ghost rule below, and this
  // unattended, scheduled, contents:write reconciler would silently rewrite
  // its "this needs urgent re-verification" signal back to a generic
  // pre-verification `merged` status -- indistinguishable from an ordinary
  // ghost lane, with no human in the loop. `GHOST_ELIGIBLE_STATUSES` is
  // `ACTIVE_LOCK_STATUSES` minus exactly that one status.
  const merged = GHOST_ELIGIBLE_STATUSES.has(manifest.status) ? resolveMergedPr(manifest) : null;
  if (merged && merged.mergeSha) {
    const updated: LaneManifest = {
      ...manifest,
      status: 'merged',
      commit_sha: merged.mergeSha,
      pr_url: merged.url ?? manifest.pr_url,
      truth_check_history: [
        ...(manifest.truth_check_history ?? []),
        {
          checked_at: new Date(now).toISOString(),
          verdict: 'fail',
          merge_sha: merged.mergeSha,
          failures: [
            `ghost lane: PR ${merged.url ?? '(unknown)'} merged while manifest status was "${manifest.status}"; ` +
              'merge binding reconciled from GitHub and locks released. NOT closed — closing still requires a passing ops:truth-check.',
          ],
          runner: 'ops:reconcile',
        },
      ],
    };
    const plannedMutation = 'status -> merged, commit_sha bound, locks released';
    if (options.apply) {
      writeManifest(updated);
    }
    return {
      issue_id: manifest.issue_id,
      verdict: 'ghost_merged',
      detail: `PR ${merged.url ?? '(unknown)'} is merged (${merged.mergeSha}) but manifest status is "${manifest.status}"`,
      branch: manifest.branch,
      heartbeat_age_h: ageH,
      action_taken: options.apply ? plannedMutation : `DRY-RUN - WOULD ${plannedMutation}`,
      planned_mutation: plannedMutation,
    };
  }

  // Check orphaned next (branch gone → higher priority than heartbeat)
  const remoteBranchExists = branchExists(manifest.branch);
  if (remoteBranchExists === false) {
    return {
      issue_id: manifest.issue_id,
      verdict: 'orphaned',
      detail: `branch "${manifest.branch}" deleted on remote but manifest still active`,
      branch: manifest.branch,
      heartbeat_age_h: ageH,
      action_taken: 'logged — manual close required (ops:lane-close)',
      planned_mutation: null,
    };
  }

  // Heartbeat checks
  if (ageMs != null && ageMs > STRANDED_MS) {
    const updated: LaneManifest = {
      ...manifest,
      status: 'blocked',
      heartbeat_at: manifest.heartbeat_at,
      truth_check_history: [
        ...(manifest.truth_check_history ?? []),
        {
          checked_at: new Date(now).toISOString(),
          verdict: 'fail',
          merge_sha: null,
          failures: [`heartbeat_at ${ageH}h old — exceeded 24h stranded threshold`],
          runner: 'ops:reconcile',
        },
      ],
    };
    const plannedMutation = 'status -> blocked, truth_check_history appended';
    if (options.apply) {
      writeManifest(updated);
    }
    return {
      issue_id: manifest.issue_id,
      verdict: 'stranded',
      detail: `heartbeat_at ${ageH}h old (threshold: 24h)`,
      branch: manifest.branch,
      heartbeat_age_h: ageH,
      action_taken: options.apply ? plannedMutation : `DRY-RUN - WOULD ${plannedMutation}`,
      planned_mutation: plannedMutation,
    };
  }

  if (ageMs != null && ageMs > STALE_MS) {
    return {
      issue_id: manifest.issue_id,
      verdict: 'stale',
      detail: `heartbeat_at ${ageH}h old (threshold: 4h)`,
      branch: manifest.branch,
      heartbeat_age_h: ageH,
      action_taken: 'logged — PM notified, no manifest write',
      planned_mutation: null,
    };
  }

  return {
    issue_id: manifest.issue_id,
    verdict: 'clean',
    detail: ageH != null ? `heartbeat ${ageH}h ago` : 'no heartbeat field',
    branch: manifest.branch,
    heartbeat_age_h: ageH,
    action_taken: 'none',
    planned_mutation: null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function main(argv = process.argv.slice(2)): void {
  const runAt = new Date().toISOString();
  const mode: ReconcileDigest['mode'] =
    process.env.GITHUB_ACTIONS === 'true' ? 'scheduled' : 'local';
  const parsed = parseArgs(argv);
  const jsonMode = parsed.bools.has('json');
  const apply = parsed.bools.has('apply');

  const allManifests = readAllManifests();
  // `--issue UTV2-###` (repeatable) narrows a run to specific lanes. The
  // scheduled job never passes it and still sweeps everything; an operator
  // reconciling one known ghost should not have to mutate fourteen unrelated
  // stranded manifests as collateral in the same commit.
  const issueFilter = new Set(
    (parsed.flags.get('issue') ?? []).map((value) => value.trim().toUpperCase()).filter(Boolean),
  );
  const activeManifests = allManifests.filter(
    (m) =>
      m.status !== 'done' &&
      m.status !== 'merged' &&
      (issueFilter.size === 0 || issueFilter.has(m.issue_id.toUpperCase())),
  );

  const entries: ReconcileEntry[] = [];
  let mutations = 0;

  for (const manifest of activeManifests) {
    const entry = reconcileManifest(manifest, { apply });
    entries.push(entry);
    if ((entry.verdict === 'stranded' || entry.verdict === 'ghost_merged') && apply) mutations++;
  }

  const digest: ReconcileDigest = {
    schema_version: 1,
    run_at: runAt,
    mode,
    dry_run: !apply,
    manifest_count: allManifests.length,
    active_count: activeManifests.length,
    planned_mutations: entries.filter((entry) => entry.planned_mutation !== null).length,
    mutations,
    entries: entries.filter((e) => e.verdict !== 'clean'),
  };

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(digest, null, 2)}\n`);
  } else {
    console.log(`[ops:reconcile] run_at=${runAt} mode=${mode} dry_run=${!apply}`);
    if (!apply) {
      console.log('  DRY-RUN: no filesystem writes will be made. Pass --apply to mutate lane manifests.');
    }
    console.log(`  manifests: ${allManifests.length} total, ${activeManifests.length} active`);
    console.log(`  planned_mutations: ${digest.planned_mutations}`);
    console.log(`  mutations_applied: ${mutations}`);

    const byVerdict = (v: ReconcileVerdict) => entries.filter((e) => e.verdict === v);
    for (const e of byVerdict('stranded')) {
      const label = apply ? 'STRANDED' : 'DRY-RUN WOULD MUTATE';
      console.log(`  [${label}] ${e.issue_id}: ${e.detail} -> ${e.action_taken}`);
    }
    for (const e of byVerdict('ghost_merged')) {
      const label = apply ? 'GHOST-MERGED' : 'DRY-RUN WOULD MUTATE';
      console.log(`  [${label}] ${e.issue_id}: ${e.detail} -> ${e.action_taken}`);
    }
    for (const e of byVerdict('orphaned')) {
      console.log(`  [ORPHANED] ${e.issue_id}: ${e.detail} -> ${e.action_taken}`);
    }
    for (const e of byVerdict('stale')) {
      console.log(`  [STALE]    ${e.issue_id}: ${e.detail}`);
    }

    console.log(
      `  verdict: ${mutations > 0 ? 'MUTATIONS_APPLIED' : entries.some((e) => e.verdict !== 'clean') ? 'ISSUES_DETECTED' : 'CLEAN'}`,
    );
  }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/ops/reconcile.ts')) {
  main();
}
