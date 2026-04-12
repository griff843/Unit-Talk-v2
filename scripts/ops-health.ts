/**
 * scripts/ops-health.ts
 * Fast workflow drift monitor for Unit Talk V2.
 *
 * Checks (all local/git, no network by default):
 *   1. Lane registry — stale lanes, missing snapshots, merged-but-still-active
 *   2. Worktrees     — orphaned dirs in .claude/worktrees/ not in registry
 *   3. Branches      — feat/* branches not in registry, stale unmerged branches
 *   4. Status docs   — PROGRAM_STATUS.md age vs last commit
 *
 * Severity levels: blocker | warn | info | ok
 *
 * Exit codes:
 *   0 — HEALTHY or DEGRADED (warnings only)
 *   1 — BLOCKED (at least one blocker item)
 *
 * Usage:
 *   pnpm ops:health
 *   pnpm ops:health -- --json
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readAllManifests } from './ops/shared.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type Severity = 'blocker' | 'warn' | 'info' | 'ok';

interface HealthItem {
  severity: Severity;
  category: string;
  message: string;
}

interface ManifestEntry {
  issue_id: string;
  lane_type: string;
  branch: string;
  worktree_path: string;
  status: string;
  started_at: string;
  heartbeat_at: string;
  pr_url: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function repoRoot(): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) throw new Error('Not in a git repository');
  return result.stdout.trim();
}

const ROOT = repoRoot();
const WORKTREES_DIR = path.join(ROOT, '.claude', 'worktrees');
const SNAPSHOTS_DIR = path.join(ROOT, '.claude', 'snapshots');
const ACTIVE_STATUSES = new Set(['started', 'in_progress', 'in_review', 'blocked', 'reopened']);

function git(...args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: 'pipe',
    cwd: ROOT,
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
  };
}

function readManifests(): ManifestEntry[] {
  try {
    return readAllManifests() as ManifestEntry[];
  } catch {
    return [];
  }
}

function humanAge(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.floor(diffHr / 24)}d`;
}

function daysSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}

function isBranchMergedToMain(branch: string): boolean {
  const result = git('branch', '--merged', 'main', '--list', branch);
  return result.ok && result.stdout.length > 0;
}

// ─── Check: Lane Registry ────────────────────────────────────────────────────

function checkLaneRegistry(): HealthItem[] {
  const items: HealthItem[] = [];
  const manifests = readManifests();
  const active = manifests.filter((m) => ACTIVE_STATUSES.has(m.status));

  if (active.length === 0) {
    items.push({ severity: 'info', category: 'Lanes', message: 'No active lanes in canonical manifests' });
    return items;
  }

  items.push({
    severity: 'ok',
    category: 'Lanes',
    message: `${active.length} active lane(s) in canonical manifests`,
  });

  for (const m of active) {
    // Merged but still active
    if (isBranchMergedToMain(m.branch)) {
      items.push({
        severity: 'warn',
        category: 'Lanes',
        message: `${m.issue_id}: branch merged to main but manifest still '${m.status}'`,
      });
      continue;
    }

    // Branch does not exist locally
    const branchExists = git('rev-parse', '--verify', `refs/heads/${m.branch}`).ok;
    if (!branchExists) {
      items.push({
        severity: 'warn',
        category: 'Lanes',
        message: `${m.issue_id}: branch '${m.branch}' not found locally`,
      });
    }

    // Heartbeat staleness (replaces legacy snapshot staleness)
    const heartbeatHours = (Date.now() - new Date(m.heartbeat_at).getTime()) / (1000 * 60 * 60);
    if (heartbeatHours > 24) {
      items.push({
        severity: 'warn',
        category: 'Lanes',
        message: `${m.issue_id}: STRANDED — heartbeat is ${humanAge(m.heartbeat_at)} old (>24h)`,
      });
    } else if (heartbeatHours > 4) {
      items.push({
        severity: 'warn',
        category: 'Lanes',
        message: `${m.issue_id}: STALE — heartbeat is ${humanAge(m.heartbeat_at)} old (>4h)`,
      });
    }

    // Dangerously old lane
    const laneDays = daysSince(m.started_at);
    if (laneDays > 14) {
      items.push({
        severity: 'warn',
        category: 'Lanes',
        message: `${m.issue_id}: ${Math.floor(laneDays)}d old — consider closing or cleaning up`,
      });
    }
  }

  return items;
}

// ─── Check: Worktrees ────────────────────────────────────────────────────────

function checkWorktrees(): HealthItem[] {
  const items: HealthItem[] = [];

  if (!fs.existsSync(WORKTREES_DIR)) {
    items.push({ severity: 'info', category: 'Worktrees', message: '.claude/worktrees/ not present' });
    return items;
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(WORKTREES_DIR).filter((e) => {
      // Only count directories
      return fs.statSync(path.join(WORKTREES_DIR, e)).isDirectory();
    });
  } catch {
    items.push({ severity: 'warn', category: 'Worktrees', message: 'Cannot read .claude/worktrees/' });
    return items;
  }

  if (entries.length === 0) {
    items.push({ severity: 'ok', category: 'Worktrees', message: 'No worktree directories present' });
    return items;
  }

  const manifests = readManifests();
  const registeredPaths = new Set(
    manifests
      .filter((m) => m.worktree_path)
      .map((m) => path.basename(m.worktree_path)),
  );
  const registeredNames = registeredPaths;

  const orphans = entries.filter((e) => !registeredNames.has(e));
  const registered = entries.filter((e) => registeredNames.has(e));

  if (registered.length > 0) {
    items.push({
      severity: 'ok',
      category: 'Worktrees',
      message: `${registered.length} worktree(s) registered: ${registered.join(', ')}`,
    });
  }

  // Classify orphans: filesystem debris (no .git) vs git-tracked-but-unregistered
  if (orphans.length > 0) {
    const wtListResult = git('worktree', 'list', '--porcelain');
    const gitWtPaths = wtListResult.ok
      ? new Set(
          wtListResult.stdout
            .split('\n')
            .filter((l) => l.startsWith('worktree '))
            .map((l) => path.normalize(l.slice('worktree '.length))),
        )
      : new Set<string>();

    for (const entry of orphans) {
      const absPath = path.normalize(path.join(WORKTREES_DIR, entry));
      const hasGitFile = fs.existsSync(path.join(WORKTREES_DIR, entry, '.git'));
      const isGitTracked = gitWtPaths.has(absPath);

      if (!hasGitFile && !isGitTracked) {
        items.push({
          severity: 'warn',
          category: 'Worktrees',
          message: `[no-git orphan] '${entry}': filesystem dir only, no .git — safe to rm -rf`,
        });
      } else {
        items.push({
          severity: 'warn',
          category: 'Worktrees',
          message: `[unregistered worktree] '${entry}': git-tracked but not in lane registry — run pnpm lane:cleanup`,
        });
      }
    }
  }

  // Verify registered worktrees are in git's worktree list
  const wtListResult2 = git('worktree', 'list', '--porcelain');
  if (wtListResult2.ok) {
    const gitWtPaths = wtListResult2.stdout
      .split('\n')
      .filter((l) => l.startsWith('worktree '))
      .map((l) => path.normalize(l.slice('worktree '.length)));

    for (const entry of registered) {
      const absPath = path.normalize(path.join(WORKTREES_DIR, entry));
      if (!gitWtPaths.some((p) => p === absPath)) {
        items.push({
          severity: 'warn',
          category: 'Worktrees',
          message: `'${entry}' in registry but not in git worktree list — run: git worktree prune`,
        });
      }
    }
  }

  return items;
}

// ─── Check: Branches ─────────────────────────────────────────────────────────

function checkBranches(): HealthItem[] {
  const items: HealthItem[] = [];
  const manifests = readManifests();
  const registeredBranches = new Set(manifests.map((m) => m.branch));

  // All local feat/* and codex/* branches
  const localFeat = git('branch', '--list', 'feat/*');
  if (!localFeat.ok || !localFeat.stdout) {
    items.push({ severity: 'info', category: 'Branches', message: 'No feat/* branches found' });
    return items;
  }

  const branches = localFeat.stdout
    .split('\n')
    .map((b) => b.replace(/^\*?\s+/, '').trim())
    .filter(Boolean);

  const unregistered = branches.filter((b) => !registeredBranches.has(b));
  const registeredCount = branches.filter((b) => registeredBranches.has(b)).length;

  if (registeredCount > 0) {
    items.push({
      severity: 'ok',
      category: 'Branches',
      message: `${registeredCount} feat branch(es) in registry`,
    });
  }

  for (const branch of unregistered) {
    // Check age via last commit date
    const lastCommitResult = git('log', '-1', '--format=%ct', branch);
    if (!lastCommitResult.ok || !lastCommitResult.stdout) continue;

    const commitTime = parseInt(lastCommitResult.stdout, 10) * 1000;
    const ageDays = (Date.now() - commitTime) / (1000 * 60 * 60 * 24);

    if (ageDays > 3) {
      items.push({
        severity: 'warn',
        category: 'Branches',
        message: `'${branch}': ${Math.floor(ageDays)}d old, not in lane registry`,
      });
    }
  }

  if (unregistered.length === 0 && registeredCount === 0) {
    items.push({ severity: 'info', category: 'Branches', message: 'No feat/* branches' });
  }

  return items;
}

// ─── Check: Status Docs ───────────────────────────────────────────────────────

function checkStatusDocs(): HealthItem[] {
  const items: HealthItem[] = [];
  const statusFile = path.join(ROOT, 'docs', '06_status', 'PROGRAM_STATUS.md');

  if (!fs.existsSync(statusFile)) {
    items.push({ severity: 'warn', category: 'Status Docs', message: 'PROGRAM_STATUS.md not found' });
    return items;
  }

  // Age of last commit to PROGRAM_STATUS.md
  const lastCommit = git('log', '-1', '--format=%ct', '--', 'docs/06_status/PROGRAM_STATUS.md');
  if (lastCommit.ok && lastCommit.stdout) {
    const commitTime = parseInt(lastCommit.stdout, 10) * 1000;
    const ageDays = (Date.now() - commitTime) / (1000 * 60 * 60 * 24);

    if (ageDays > 7) {
      items.push({
        severity: 'warn',
        category: 'Status Docs',
        message: `PROGRAM_STATUS.md last committed ${Math.floor(ageDays)}d ago — may be stale`,
      });
    } else {
      items.push({
        severity: 'ok',
        category: 'Status Docs',
        message: `PROGRAM_STATUS.md committed ${humanAge(new Date(commitTime).toISOString())} ago`,
      });
    }
  } else {
    items.push({
      severity: 'info',
      category: 'Status Docs',
      message: 'PROGRAM_STATUS.md exists (cannot determine last commit date)',
    });
  }

  // Count commits to main since last status update (rough activity signal)
  if (lastCommit.ok && lastCommit.stdout) {
    const commitTime = parseInt(lastCommit.stdout, 10);
    const recentResult = git(
      'log',
      'main',
      `--after=${commitTime}`,
      '--oneline',
      '--no-merges',
    );
    if (recentResult.ok) {
      const commitsSince = recentResult.stdout.split('\n').filter(Boolean).length;
      if (commitsSince > 8) {
        items.push({
          severity: 'info',
          category: 'Status Docs',
          message: `${commitsSince} commits to main since last status update — worth reviewing`,
        });
      }
    }
  }

  return items;
}

// ─── Check: Orphaned Snapshots ───────────────────────────────────────────────

function checkOrphanedSnapshots(): HealthItem[] {
  const items: HealthItem[] = [];

  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    return items;
  }

  let snapshotFiles: string[];
  try {
    snapshotFiles = fs.readdirSync(SNAPSHOTS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    items.push({ severity: 'warn', category: 'Snapshots', message: 'Cannot read .claude/snapshots/' });
    return items;
  }

  if (snapshotFiles.length === 0) {
    return items;
  }

  const manifests = readManifests();
  const registeredIds = new Set(manifests.map((m) => m.issue_id.toUpperCase()));

  const orphaned = snapshotFiles.filter((f) => !registeredIds.has(path.basename(f, '.json').toUpperCase()));

  if (orphaned.length > 0) {
    for (const f of orphaned) {
      items.push({
        severity: 'warn',
        category: 'Snapshots',
        message: `Orphaned snapshot '${f}' — no matching lane in registry (safe to delete from .claude/snapshots/)`,
      });
    }
  } else {
    items.push({
      severity: 'ok',
      category: 'Snapshots',
      message: `${snapshotFiles.length} snapshot(s), all have registered lanes`,
    });
  }

  return items;
}

// ─── Check: Working Directory ─────────────────────────────────────────────────

function checkWorkingDir(): HealthItem[] {
  const items: HealthItem[] = [];
  const result = git('status', '--porcelain');

  if (!result.ok) return items;

  if (result.stdout) {
    const count = result.stdout.split('\n').filter(Boolean).length;
    items.push({
      severity: 'info',
      category: 'Working Dir',
      message: `${count} uncommitted change(s) — snapshots captured now reflect in-flight state`,
    });
  } else {
    items.push({
      severity: 'ok',
      category: 'Working Dir',
      message: 'Working directory clean',
    });
  }

  return items;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');

const allItems: HealthItem[] = [
  ...checkLaneRegistry(),
  ...checkWorktrees(),
  ...checkBranches(),
  ...checkStatusDocs(),
  ...checkOrphanedSnapshots(),
  ...checkWorkingDir(),
];

const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
const blockers = allItems.filter((i) => i.severity === 'blocker');
const warns = allItems.filter((i) => i.severity === 'warn');

if (jsonMode) {
  console.log(
    JSON.stringify(
      {
        timestamp: now,
        verdict: blockers.length > 0 ? 'BLOCKED' : warns.length > 0 ? 'DEGRADED' : 'HEALTHY',
        items: allItems,
      },
      null,
      2,
    ),
  );
  process.exit(blockers.length > 0 ? 1 : 0);
}

// Human-readable output
const line = '─'.repeat(62);
console.log(`ops:health — ${now}`);
console.log(line);

const categories = [...new Set(allItems.map((i) => i.category))];
for (const category of categories) {
  const categoryItems = allItems.filter((i) => i.category === category);
  console.log('');
  console.log(category.toUpperCase());
  for (const item of categoryItems) {
    const tag =
      item.severity === 'blocker'
        ? '[BLOCKER]'
        : item.severity === 'warn'
          ? '[WARN]   '
          : item.severity === 'ok'
            ? '[OK]     '
            : '[INFO]   ';
    console.log(`  ${tag}  ${item.message}`);
  }
}

console.log('');
console.log(line);

if (blockers.length > 0) {
  console.log(
    `VERDICT: BLOCKED — ${blockers.length} blocker(s) require attention before new work`,
  );
  process.exit(1);
} else if (warns.length > 0) {
  console.log(
    `VERDICT: DEGRADED — ${warns.length} warning(s) (safe to work, but review when convenient)`,
  );
} else {
  console.log('VERDICT: HEALTHY');
}
