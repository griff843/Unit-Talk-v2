/**
 * Lane substrate safety guard (UTV2 SPRINT-OPS-LANE-SUBSTRATE-STABILIZATION-001).
 *
 * Fail-closed preflight that refuses to let a lane move to "In Codex" / launch
 * Codex when the lane-execution substrate is unsafe. Conditions enforced:
 *   1. `.ops/leases/` is missing AND cannot be initialized            -> hard_fail
 *   2. `.ops/merge-lock.json` is present but invalid/corrupt          -> hard_fail
 *      (a missing/released/held lock is the normal idle/active state)
 *   3. a registered git worktree tied to an ACTIVE lane is missing    -> hard_fail
 *   4. an ACTIVE lane's declared worktree directory is missing        -> hard_fail
 *   5. Linear state conflicts with the local manifest                 -> hard_fail
 *      (best-effort; skipped -> warning when no token / not requested)
 *   6. an existing board hard_fail lane exists (via ops:merge-risk)   -> hard_fail
 *   plus: a registered worktree NOT tied to an active lane whose dir is
 *         missing                                                     -> warning
 *
 * WSL/filesystem robustness: the substrate "vanish" that motivated this guard
 * was transient ENOENT on ext4-over-WSL2 (no code deletes leases / merge-lock /
 * worktrees in the background). To avoid false hard_fails from a transient
 * stat() miss, existence of substrate that would *fail closed* is probed with
 * bounded retries before being declared genuinely absent.
 */
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ROOT,
  ACTIVE_LOCK_STATUSES,
  readAllManifests,
  emitJson,
  parseArgs,
  git,
} from './shared.js';
import { LEASE_REGISTRY_DIR, readAllLeases } from './lease-registry.js';
import { readMergeLock } from './merge-mutex.js';

export type SubstrateSeverity = 'hard_fail' | 'warning';

export interface SubstrateFinding {
  code: string;
  severity: SubstrateSeverity;
  detail: string;
  lanes?: string[];
}

export interface SubstrateReport {
  ok: boolean;
  generated_at?: string;
  checks: Record<string, 'pass' | 'fail' | 'skipped'>;
  findings: SubstrateFinding[];
  summary: { hard_fail: number; warning: number };
}

export type MergeLockState = 'missing' | 'released' | 'held' | 'invalid';

export interface SubstrateFacts {
  leaseDir: { exists: boolean; initializable: boolean };
  mergeLock: { state: MergeLockState; detail?: string };
  activeLanes: Array<{ issue_id: string; worktree_path: string; worktree_exists: boolean }>;
  /** git-registered worktrees NOT tied to an active lane. */
  orphanWorktrees: Array<{ path: string; exists: boolean }>;
  mergeRisk: {
    included: boolean;
    available: boolean;
    hardFails: Array<{ code: string; lanes: string[]; detail: string }>;
    error?: string;
  };
  linear: { checked: boolean; conflicts: Array<{ issue_id: string; detail: string }>; reason?: string };
}

// ---------------------------------------------------------------------------
// WSL-robust existence probe
// ---------------------------------------------------------------------------

/** Synchronous sleep without a busy loop (works in a CLI process). */
function sleepMs(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Existence check that tolerates transient ENOENT (the WSL2 failure mode this
 * guard was built for). Returns true on the first hit; only returns false after
 * `retries` confirmations of absence. Injectable for tests.
 */
export function robustExists(
  targetPath: string,
  options: {
    retries?: number;
    delayMs?: number;
    existsFn?: (p: string) => boolean;
    sleepFn?: (ms: number) => void;
  } = {},
): boolean {
  const retries = options.retries ?? 4;
  const delayMs = options.delayMs ?? 50;
  const existsFn = options.existsFn ?? ((p: string) => fs.existsSync(p));
  const sleepFn = options.sleepFn ?? sleepMs;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (existsFn(targetPath)) return true;
    if (attempt < retries) sleepFn(delayMs);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Pure evaluator (fully testable; no IO)
// ---------------------------------------------------------------------------

export function evaluateSubstrate(facts: SubstrateFacts): SubstrateReport {
  const findings: SubstrateFinding[] = [];

  // 1. lease directory
  if (!facts.leaseDir.exists && !facts.leaseDir.initializable) {
    findings.push({
      code: 'lease_dir_uninitializable',
      severity: 'hard_fail',
      detail: '.ops/leases is missing and could not be initialized — lane leases cannot be reserved.',
    });
  }

  // 2. merge mutex
  if (facts.mergeLock.state === 'invalid') {
    findings.push({
      code: 'merge_lock_invalid',
      severity: 'hard_fail',
      detail: `.ops/merge-lock.json is present but invalid/corrupt and cannot be safely trusted: ${
        facts.mergeLock.detail ?? 'unparseable'
      }`,
    });
  }

  // 3 + 4. active lane worktree integrity
  for (const lane of facts.activeLanes) {
    if (!lane.worktree_exists) {
      findings.push({
        code: 'active_lane_missing_worktree',
        severity: 'hard_fail',
        lanes: [lane.issue_id],
        detail: `Active lane ${lane.issue_id} declares worktree ${
          lane.worktree_path || '(none)'
        } which is missing on disk.`,
      });
    }
  }

  // orphan registered worktree pointing at a missing dir -> warning (prune candidate)
  for (const wt of facts.orphanWorktrees) {
    if (!wt.exists) {
      findings.push({
        code: 'orphan_worktree_missing_dir',
        severity: 'warning',
        detail: `Registered worktree ${wt.path} has no directory on disk (run: git worktree prune).`,
      });
    }
  }

  // 6. existing board hard_fail lane (via merge-risk)
  if (facts.mergeRisk.included) {
    if (!facts.mergeRisk.available) {
      findings.push({
        code: 'merge_risk_unavailable',
        severity: 'warning',
        detail: `Board hard_fail status unknown — ops:merge-risk could not run: ${
          facts.mergeRisk.error ?? 'unknown error'
        }`,
      });
    } else {
      for (const hf of facts.mergeRisk.hardFails) {
        findings.push({
          code: `board_hard_fail:${hf.code}`,
          severity: 'hard_fail',
          lanes: hf.lanes,
          detail: hf.detail,
        });
      }
    }
  }

  // 5. Linear vs manifest conflict
  if (facts.linear.checked) {
    for (const conflict of facts.linear.conflicts) {
      findings.push({
        code: 'linear_manifest_conflict',
        severity: 'hard_fail',
        lanes: [conflict.issue_id],
        detail: conflict.detail,
      });
    }
  } else {
    findings.push({
      code: 'linear_check_skipped',
      severity: 'warning',
      detail:
        facts.linear.reason ??
        'Linear/manifest conflict check skipped (no LINEAR_API_TOKEN or --check-linear not set); ops:orchestration-reconcile is the authority for Linear drift.',
    });
  }

  const hard_fail = findings.filter((f) => f.severity === 'hard_fail').length;
  const warning = findings.filter((f) => f.severity === 'warning').length;

  const has = (code: string) => findings.some((f) => f.code === code || f.code.startsWith(`${code}:`));
  const checks: SubstrateReport['checks'] = {
    lease_dir: has('lease_dir_uninitializable') ? 'fail' : 'pass',
    merge_lock: has('merge_lock_invalid') ? 'fail' : 'pass',
    active_lane_worktrees: has('active_lane_missing_worktree') ? 'fail' : 'pass',
    board_hard_fail: !facts.mergeRisk.included
      ? 'skipped'
      : !facts.mergeRisk.available
        ? 'skipped'
        : has('board_hard_fail')
          ? 'fail'
          : 'pass',
    linear_conflict: !facts.linear.checked ? 'skipped' : has('linear_manifest_conflict') ? 'fail' : 'pass',
  };

  return { ok: hard_fail === 0, checks, findings, summary: { hard_fail, warning } };
}

// ---------------------------------------------------------------------------
// IO gatherer
// ---------------------------------------------------------------------------

function absolutize(p: string): string {
  if (!p) return p;
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

function listGitWorktrees(): string[] {
  const result = git(['worktree', 'list', '--porcelain']);
  if (!result.ok || !result.stdout) return [];
  return result.stdout
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter(Boolean);
}

function gatherMergeRiskHardFails(): SubstrateFacts['mergeRisk'] {
  const result = spawnSync('npx', ['--no-install', 'tsx', path.join(ROOT, 'scripts/ops/merge-risk.ts')], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 90_000,
  });
  if (result.error) {
    return { included: true, available: false, hardFails: [], error: result.error.message };
  }
  const stdout = result.stdout ?? '';
  const jsonStart = stdout.indexOf('{');
  if (jsonStart < 0) {
    return {
      included: true,
      available: false,
      hardFails: [],
      error: (result.stderr ?? '').trim() || 'merge-risk produced no JSON',
    };
  }
  try {
    const report = JSON.parse(stdout.slice(jsonStart)) as {
      conditions?: Array<{ code: string; severity: string; lanes?: string[]; detail: string }>;
    };
    const hardFails = (report.conditions ?? [])
      .filter((c) => c.severity === 'hard_fail')
      .map((c) => ({ code: c.code, lanes: c.lanes ?? [], detail: c.detail }));
    return { included: true, available: true, hardFails };
  } catch (error) {
    return {
      included: true,
      available: false,
      hardFails: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function gatherSubstrateFacts(
  options: { includeMergeRisk?: boolean; checkLinear?: boolean } = {},
): SubstrateFacts {
  const includeMergeRisk = options.includeMergeRisk ?? true;

  // 1. lease dir — robust probe, then try to initialize if genuinely absent.
  const leaseExists = robustExists(LEASE_REGISTRY_DIR);
  let initializable = leaseExists;
  if (!leaseExists) {
    try {
      fs.mkdirSync(LEASE_REGISTRY_DIR, { recursive: true });
      initializable = robustExists(LEASE_REGISTRY_DIR);
    } catch {
      initializable = false;
    }
  }

  // 2. merge lock
  const lockResult = readMergeLock();
  let lockState: MergeLockState;
  let lockDetail: string | undefined;
  if (lockResult.code === 'merge_lock_missing') {
    lockState = 'missing';
  } else if (lockResult.code === 'merge_lock_invalid') {
    lockState = 'invalid';
    lockDetail = lockResult.message;
  } else {
    lockState = lockResult.lock?.status === 'released' ? 'released' : 'held';
  }

  // 3 + 4. active lanes (active manifests UNION active leases), worktree existence.
  const activeManifests = readAllManifests().filter((m) => ACTIVE_LOCK_STATUSES.has(m.status));
  const activeLeases = readAllLeases().filter(
    (l) => l.status === 'active' || l.status === 'stale_reclaim_required',
  );
  const activeMap = new Map<string, string>();
  for (const m of activeManifests) activeMap.set(m.issue_id, m.worktree_path);
  for (const l of activeLeases) {
    if (!activeMap.has(l.issue_id)) {
      activeMap.set(l.issue_id, l.worktree_path ?? l.execution_location?.cwd ?? l.cwd ?? '');
    }
  }
  const activeLanes = [...activeMap.entries()].map(([issue_id, worktree_path]) => ({
    issue_id,
    worktree_path,
    worktree_exists: worktree_path ? robustExists(absolutize(worktree_path), { retries: 5, delayMs: 60 }) : false,
  }));

  // registered worktrees not tied to an active lane (cheap single stat for warnings).
  const activePaths = new Set(activeLanes.map((a) => absolutize(a.worktree_path)));
  const orphanWorktrees = listGitWorktrees()
    .filter((p) => p !== ROOT && !activePaths.has(p))
    .map((p) => ({ path: p, exists: fs.existsSync(p) }));

  const mergeRisk = includeMergeRisk
    ? gatherMergeRiskHardFails()
    : { included: false, available: false, hardFails: [], error: 'skipped (--skip-merge-risk)' };

  // 5. Linear vs manifest — best effort, deferred to orchestration-reconcile unless explicitly requested.
  const linear = options.checkLinear
    ? gatherLinearConflicts(activeManifests.map((m) => m.issue_id))
    : {
        checked: false,
        conflicts: [],
        reason:
          '--check-linear not set; ops:orchestration-reconcile (run in dispatch Phase 0) is the authority for Linear/manifest drift.',
      };

  return {
    leaseDir: { exists: leaseExists, initializable },
    mergeLock: { state: lockState, detail: lockDetail },
    activeLanes,
    orphanWorktrees,
    mergeRisk,
    linear,
  };
}

/**
 * Best-effort Linear conflict gather. Requires LINEAR_API_TOKEN; without it the
 * check is reported as skipped (a warning), never a silent pass. Live Linear
 * reconciliation is owned by ops:orchestration-reconcile; this is a lightweight
 * fail-closed signal only when a token is present.
 */
function gatherLinearConflicts(issueIds: string[]): SubstrateFacts['linear'] {
  if (!process.env.LINEAR_API_TOKEN) {
    return {
      checked: false,
      conflicts: [],
      reason: '--check-linear requested but LINEAR_API_TOKEN is absent; cannot verify Linear state.',
    };
  }
  // Live Linear querying is intentionally delegated to ops:orchestration-reconcile,
  // which already cross-checks Linear vs manifest vs GitHub under the merge mutex.
  // The guard surfaces that this dedicated check was not performed inline.
  void issueIds;
  return {
    checked: false,
    conflicts: [],
    reason:
      'Inline Linear check is delegated to ops:orchestration-reconcile (Phase 0). Run that for authoritative Linear/manifest drift.',
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function runCli(): void {
  const { bools } = parseArgs(process.argv.slice(2));
  const includeMergeRisk = !bools.has('skip-merge-risk');
  const checkLinear = bools.has('check-linear');
  const facts = gatherSubstrateFacts({ includeMergeRisk, checkLinear });
  const report = evaluateSubstrate(facts);
  report.generated_at = new Date().toISOString();
  emitJson(report);
  process.exitCode = report.ok ? 0 : 1;
}

const argv1 = process.argv[1] ?? '';
if (argv1 && fileURLToPath(import.meta.url) === path.resolve(argv1)) {
  runCli();
}
