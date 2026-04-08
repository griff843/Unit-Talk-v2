/**
 * scripts/lane.ts
 * Unified lane/worktree workflow manager for Unit Talk V2.
 *
 * Commands:
 *   spawn    — create a lane (branch + optional worktree) and register it
 *   list     — show all lanes with status, branch, age, snapshot age
 *   snapshot — capture continuation state for a lane
 *   resume   — print a structured resume packet for a lane
 *   cleanup  — remove merged/abandoned lanes and orphaned worktrees
 *
 * State:
 *   .claude/lanes.json      — live lane registry (gitignored, local only)
 *   .claude/snapshots/      — per-lane snapshot JSON files (gitignored, local only)
 *   .claude/worktrees/      — git worktrees for isolated lane execution (gitignored)
 *
 * Usage via pnpm:
 *   pnpm lane:spawn    -- --issue UTV2-XXX [--title "text"] [--owner claude|codex] [--worktree] [--base main]
 *   pnpm lane:list
 *   pnpm lane:snapshot -- --issue UTV2-XXX [--next "action"] [--obj "objective"] [--decisions "d1,d2"] [--blockers "b1"] [--drift "rule1,rule2"] [--progress "what's in progress"]
 *   pnpm lane:resume   -- --issue UTV2-XXX
 *   pnpm lane:cleanup  -- [--dry-run] [--force UTV2-XXX]
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ─── Types ───────────────────────────────────────────────────────────────────

type LaneStatus = 'active' | 'review' | 'merged' | 'abandoned';
type LaneOwner = 'claude' | 'codex' | 'codex-cli' | 'manual';

interface LaneEntry {
  id: string;
  title: string;
  branch: string;
  worktree: string | null;
  status: LaneStatus;
  owner: LaneOwner;
  createdAt: string;
  snapshotAt: string | null;
  pr: number | null;
  allowedFiles?: string[];
}

interface LaneRegistry {
  version: number;
  lanes: LaneEntry[];
}

interface LaneSnapshot {
  id: string;
  title: string;
  branch: string;
  worktree: string | null;
  capturedAt: string;
  objective: string;
  completed: string[];
  inProgress: string;
  filesTouched: string[];
  decisions: string[];
  blockers: string[];
  nextAction: string;
  mustNotDrift: string[];
  pr: number | null;
}

// ─── Repo Context ─────────────────────────────────────────────────────────────

function repoRoot(): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error('Not in a git repository');
  }
  return result.stdout.trim();
}

const ROOT = repoRoot();
const CLAUDE_DIR = path.join(ROOT, '.claude');
const LANES_FILE = path.join(CLAUDE_DIR, 'lanes.json');
const SNAPSHOTS_DIR = path.join(CLAUDE_DIR, 'snapshots');
const WORKTREES_DIR = path.join(CLAUDE_DIR, 'worktrees');
const REGISTRY_VERSION = 1;

// ─── Registry Helpers ─────────────────────────────────────────────────────────

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readRegistry(): LaneRegistry {
  if (!fs.existsSync(LANES_FILE)) {
    return { version: REGISTRY_VERSION, lanes: [] };
  }
  try {
    const raw = fs.readFileSync(LANES_FILE, 'utf8');
    return JSON.parse(raw) as LaneRegistry;
  } catch {
    console.warn('Warning: .claude/lanes.json is malformed. Starting with empty registry.');
    return { version: REGISTRY_VERSION, lanes: [] };
  }
}

function writeRegistry(registry: LaneRegistry): void {
  ensureDir(CLAUDE_DIR);
  fs.writeFileSync(LANES_FILE, JSON.stringify(registry, null, 2) + '\n', 'utf8');
}

function readSnapshot(id: string): LaneSnapshot | null {
  const file = path.join(SNAPSHOTS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as LaneSnapshot;
  } catch {
    return null;
  }
}

function writeSnapshot(snapshot: LaneSnapshot): void {
  ensureDir(SNAPSHOTS_DIR);
  const file = path.join(SNAPSHOTS_DIR, `${snapshot.id}.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
}

// ─── Git Helpers ──────────────────────────────────────────────────────────────

function git(...args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: 'pipe',
    cwd: ROOT,
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

function getCurrentBranch(): string {
  return git('branch', '--show-current').stdout || 'unknown';
}

function branchExists(branch: string): boolean {
  return git('rev-parse', '--verify', `refs/heads/${branch}`).ok;
}

function isBranchMergedToMain(branch: string): boolean {
  // Check if the branch tip is reachable from main
  const result = git('branch', '--merged', 'main', '--list', branch);
  return result.ok && result.stdout.length > 0;
}

function getFilesTouchedVsMain(branch: string): string[] {
  // Find the merge-base between branch and main, then diff
  const base = git('merge-base', branch, 'main');
  if (!base.ok || !base.stdout) {
    // Fallback: diff HEAD vs main
    const fallback = git('diff', '--name-only', 'main', 'HEAD');
    return fallback.ok ? fallback.stdout.split('\n').filter(Boolean) : [];
  }
  const diff = git('diff', '--name-only', base.stdout, branch);
  return diff.ok ? diff.stdout.split('\n').filter(Boolean) : [];
}

// ─── Formatting Helpers ───────────────────────────────────────────────────────

function humanAge(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 2) return 'just now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function inferIssueFromBranch(branch: string): string | null {
  const match = branch.match(/(UTV2-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

// ─── Arg Parser ───────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  command: string;
  flags: Record<string, string>;
  bools: Set<string>;
} {
  const command = argv[0] ?? '';
  const flags: Record<string, string> = {};
  const bools = new Set<string>();

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      bools.add(key);
    }
  }

  return { command, flags, bools };
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── Command: spawn ───────────────────────────────────────────────────────────

function cmdSpawn(flags: Record<string, string>, bools: Set<string>): void {
  const currentBranch = getCurrentBranch();
  const issueId = (flags.issue ?? inferIssueFromBranch(currentBranch))?.toUpperCase();

  if (!issueId) {
    console.error('Error: --issue <ID> is required.');
    console.error('  Example: pnpm lane:spawn -- --issue UTV2-384');
    process.exit(1);
  }

  const registry = readRegistry();
  const existing = registry.lanes.find((l) => l.id === issueId && l.status === 'active');

  if (existing) {
    console.error(`Error: Active lane for ${issueId} already exists.`);
    console.error(`  Branch:   ${existing.branch}`);
    console.error(`  Worktree: ${existing.worktree ?? 'none'}`);
    console.error(`  Use: pnpm lane:resume -- --issue ${issueId}`);
    process.exit(1);
  }

  const title = flags.title ?? issueId;
  const owner = (flags.owner ?? 'claude') as LaneOwner;
  const base = flags.base ?? 'main';
  const useWorktree = bools.has('worktree');

  // Enforce Codex cloud capacity (max 2)
  if (owner === 'codex') {
    const activeCodex = registry.lanes.filter(
      (l) => l.owner === 'codex' && l.status === 'active',
    ).length;
    if (activeCodex >= 2) {
      console.error(`Error: Codex cloud lane capacity reached (${activeCodex}/2 active).`);
      console.error('  Run pnpm lane:list to review.');
      console.error('  Run pnpm lane:cleanup to close finished lanes first.');
      process.exit(1);
    }
  }

  // Enforce Codex CLI capacity (max 3)
  if (owner === 'codex-cli') {
    const activeCodexCli = registry.lanes.filter(
      (l) => l.owner === 'codex-cli' && l.status === 'active',
    ).length;
    if (activeCodexCli >= 3) {
      console.error(`Error: Codex CLI lane capacity reached (${activeCodexCli}/3 active).`);
      console.error('  Run pnpm codex:status to review active Codex CLI lanes.');
      console.error('  Wait for a lane to return before dispatching another.');
      process.exit(1);
    }
  }

  // File-overlap guard: reject if any active lane owns overlapping files
  const candidateFiles: string[] = flags.allowed
    ? flags.allowed.split(',').map((f) => f.trim()).filter(Boolean)
    : [];
  if (candidateFiles.length > 0) {
    for (const activeLane of registry.lanes.filter((l) => l.status === 'active' && l.id !== issueId)) {
      if (!activeLane.allowedFiles || activeLane.allowedFiles.length === 0) continue;
      const overlap = candidateFiles.filter((f) =>
        activeLane.allowedFiles!.some((lf) => f === lf || f.startsWith(lf) || lf.startsWith(f)),
      );
      if (overlap.length > 0) {
        console.error(`Error: File overlap conflict with active lane ${activeLane.id}.`);
        console.error(`  Overlapping files: ${overlap.join(', ')}`);
        console.error('  Resolve the active lane before spawning this one.');
        process.exit(1);
      }
    }
  }

  // Derive branch name
  const idSlug = issueId.toLowerCase();
  const titleSlug = title !== issueId ? slugify(title) : '';
  const branch = titleSlug ? `feat/${idSlug}-${titleSlug}` : `feat/${idSlug}`;

  // Check for branch collision
  if (branchExists(branch)) {
    console.error(`Error: Branch '${branch}' already exists.`);
    console.error('  Use a different title or check existing lanes with pnpm lane:list.');
    process.exit(1);
  }

  let worktreePath: string | null = null;

  if (useWorktree) {
    ensureDir(WORKTREES_DIR);
    const wtAbs = path.join(WORKTREES_DIR, issueId);
    worktreePath = `.claude/worktrees/${issueId}`;

    if (fs.existsSync(wtAbs)) {
      console.error(`Error: Worktree directory already exists: ${worktreePath}`);
      console.error('  Remove it manually or use a different issue ID.');
      process.exit(1);
    }

    // git worktree add creates both the worktree directory AND the branch
    const wtResult = git('worktree', 'add', worktreePath, '-b', branch, base);
    if (!wtResult.ok) {
      console.error(`Error: Failed to create worktree: ${wtResult.stderr}`);
      process.exit(1);
    }

    console.log(`Created worktree: ${worktreePath}`);
    console.log(`Created branch:   ${branch}`);
  } else {
    // Create branch without switching
    const branchResult = git('branch', branch, base);
    if (!branchResult.ok) {
      console.error(`Error: Failed to create branch: ${branchResult.stderr}`);
      process.exit(1);
    }
    console.log(`Created branch: ${branch}`);
  }

  const now = new Date().toISOString();
  const lane: LaneEntry = {
    id: issueId,
    title,
    branch,
    worktree: worktreePath,
    status: 'active',
    owner,
    createdAt: now,
    snapshotAt: null,
    pr: null,
    allowedFiles: candidateFiles.length > 0 ? candidateFiles : undefined,
  };

  // Upsert (replace if a non-active entry existed for this ID)
  const existingIdx = registry.lanes.findIndex((l) => l.id === issueId);
  if (existingIdx >= 0) {
    registry.lanes[existingIdx] = lane;
  } else {
    registry.lanes.push(lane);
  }

  writeRegistry(registry);

  console.log('');
  console.log(`Lane registered: ${issueId}`);
  console.log(`  Title:  ${title}`);
  console.log(`  Owner:  ${owner}`);
  console.log(`  Branch: ${branch}`);
  if (worktreePath) {
    console.log(`  Worktree: ${worktreePath}`);
  }

  console.log('');
  if (useWorktree) {
    console.log(`Start work in the isolated worktree:`);
    console.log(`  cd ${worktreePath}`);
  } else {
    console.log(`Switch to the lane branch:`);
    console.log(`  git checkout ${branch}`);
  }
  console.log(`Snapshot when ready:`);
  console.log(`  pnpm lane:snapshot -- --issue ${issueId} --next "what to do next"`);

  if (owner === 'codex') {
    const activeCodex =
      registry.lanes.filter((l) => l.owner === 'codex' && l.status === 'active').length;
    console.log('');
    console.log(`Codex cloud dispatch info:`);
    console.log(`  Codex cloud lanes: ${activeCodex}/2`);
    if (worktreePath) {
      console.log(`  Worktree:    ${worktreePath}`);
    }
    console.log(`  Branch:      ${branch}`);
  }

  if (owner === 'codex-cli') {
    const activeCodexCli =
      registry.lanes.filter((l) => l.owner === 'codex-cli' && l.status === 'active').length;
    console.log('');
    console.log(`Codex CLI dispatch info:`);
    console.log(`  Codex CLI lanes: ${activeCodexCli}/3`);
    if (worktreePath) {
      console.log(`  Worktree:    ${worktreePath}`);
    }
    console.log(`  Branch:      ${branch}`);
    console.log(`  Generate packet: pnpm codex:dispatch -- --issue ${issueId}`);
  }
}

// ─── Command: list ────────────────────────────────────────────────────────────

function cmdList(bools: Set<string>): void {
  const showAll = bools.has('all');
  const registry = readRegistry();

  if (registry.lanes.length === 0) {
    console.log('No lanes registered.');
    console.log('  Create one with: pnpm lane:spawn -- --issue UTV2-XXX');
    return;
  }

  const active = registry.lanes.filter((l) => l.status === 'active');
  // Closed lanes: show last 7 days by default, all with --all
  const closedAll = registry.lanes.filter((l) => l.status !== 'active');
  const closedCutoff = 7 * 24 * 60 * 60 * 1000;
  const other = showAll
    ? closedAll
    : closedAll.filter((l) => Date.now() - new Date(l.createdAt).getTime() < closedCutoff);
  const hiddenCount = closedAll.length - other.length;

  const line = '─'.repeat(74);
  console.log(`LANES  (${registry.lanes.length} total, ${active.length} active)`);
  console.log(line);

  function printRow(lane: LaneEntry): void {
    const branchTrunc =
      lane.branch.length > 32 ? `${lane.branch.slice(0, 29)}...` : lane.branch;
    const snapInfo = lane.snapshotAt ? `${humanAge(lane.snapshotAt)} ago` : 'none';
    const prInfo = lane.pr ? `PR#${lane.pr}` : '—';

    console.log(
      [
        lane.id.padEnd(12),
        branchTrunc.padEnd(34),
        lane.owner.padEnd(8),
        lane.status.padEnd(10),
        humanAge(lane.createdAt).padEnd(6),
        `snap:${snapInfo}`.padEnd(14),
        prInfo,
      ].join('  '),
    );

    if (lane.worktree) {
      console.log(`${''.padEnd(14)}↳ worktree: ${lane.worktree}`);
    }
  }

  const header = [
    'ID'.padEnd(12),
    'BRANCH'.padEnd(34),
    'OWNER'.padEnd(8),
    'STATUS'.padEnd(10),
    'AGE'.padEnd(6),
    'SNAPSHOT'.padEnd(14),
    'PR',
  ].join('  ');

  console.log(header);
  console.log('');

  for (const lane of active) {
    printRow(lane);
  }

  if (other.length > 0) {
    console.log('');
    console.log('Closed:');
    for (const lane of other) {
      printRow(lane);
    }
  }

  console.log(line);

  const codexCount = active.filter((l) => l.owner === 'codex').length;
  const codexCliCount = active.filter((l) => l.owner === 'codex-cli').length;
  console.log(`Codex cloud capacity:  ${codexCount}/2`);
  console.log(`Codex CLI capacity:    ${codexCliCount}/3`);

  // Stale snapshot warnings
  const stale = active.filter((l) => {
    if (!l.snapshotAt) return true;
    const ageMs = Date.now() - new Date(l.snapshotAt).getTime();
    return ageMs > 2 * 24 * 60 * 60 * 1000; // 2 days
  });

  if (stale.length > 0) {
    console.log('');
    console.log(`Snapshot advisory (${stale.length} lane${stale.length > 1 ? 's' : ''} without a recent snapshot):`);
    for (const lane of stale) {
      const info = lane.snapshotAt
        ? `last snapshot ${humanAge(lane.snapshotAt)} ago`
        : 'never snapshotted';
      console.log(`  ${lane.id}: ${info}`);
    }
    console.log(`  → pnpm lane:snapshot -- --issue <ID> --next "what to do next"`);
  }

  if (hiddenCount > 0) {
    console.log('');
    console.log(`  (${hiddenCount} older closed lane(s) hidden — use --all to show)`);
  }
}

// ─── Command: snapshot ────────────────────────────────────────────────────────

function cmdSnapshot(flags: Record<string, string>): void {
  const currentBranch = getCurrentBranch();
  const issueId = (flags.issue ?? inferIssueFromBranch(currentBranch))?.toUpperCase();

  if (!issueId) {
    console.error('Error: --issue <ID> is required (or run from a feat/UTV2-XXX branch).');
    process.exit(1);
  }

  const registry = readRegistry();
  let lane = registry.lanes.find((l) => l.id === issueId);

  // Auto-register if missing (e.g. lane predates the registry)
  if (!lane) {
    console.log(`Note: ${issueId} not in lane registry. Auto-registering from current branch.`);
    const now = new Date().toISOString();
    lane = {
      id: issueId,
      title: flags.title ?? issueId,
      branch: currentBranch,
      worktree: null,
      status: 'active',
      owner: 'manual',
      createdAt: now,
      snapshotAt: null,
      pr: null,
    };
    registry.lanes.push(lane);
  }

  const filesTouched = getFilesTouchedVsMain(lane.branch);
  const now = new Date().toISOString();

  const snapshot: LaneSnapshot = {
    id: issueId,
    title: lane.title,
    branch: lane.branch,
    worktree: lane.worktree,
    capturedAt: now,
    objective: flags.obj ?? flags.objective ?? `Work in progress on ${issueId}`,
    completed: parseList(flags.completed),
    inProgress: flags.progress ?? '',
    filesTouched,
    decisions: parseList(flags.decisions),
    blockers: parseList(flags.blockers),
    nextAction:
      flags.next ??
      flags['next-action'] ??
      '(not specified — re-run with --next "exact next action")',
    mustNotDrift: parseList(flags.drift),
    pr: lane.pr,
  };

  writeSnapshot(snapshot);

  // Update snapshotAt in registry
  const idx = registry.lanes.findIndex((l) => l.id === issueId);
  if (idx >= 0) {
    registry.lanes[idx].snapshotAt = now;
  }
  writeRegistry(registry);

  console.log(`Snapshot captured: ${issueId}`);
  console.log(`  Time:    ${now}`);
  console.log(`  Branch:  ${lane.branch}`);
  console.log(`  Files:   ${filesTouched.length} touched vs main`);
  if (filesTouched.length > 0) {
    for (const f of filesTouched.slice(0, 5)) {
      console.log(`    ${f}`);
    }
    if (filesTouched.length > 5) {
      console.log(`    ... and ${filesTouched.length - 5} more`);
    }
  }
  console.log(`  Next:    ${snapshot.nextAction}`);
  console.log('');
  console.log(`Resume with: pnpm lane:resume -- --issue ${issueId}`);
}

// ─── Command: resume ──────────────────────────────────────────────────────────

function cmdResume(flags: Record<string, string>): void {
  const currentBranch = getCurrentBranch();
  const issueId = (flags.issue ?? inferIssueFromBranch(currentBranch))?.toUpperCase();

  if (!issueId) {
    console.error('Error: --issue <ID> is required (or run from a feat/UTV2-XXX branch).');
    process.exit(1);
  }

  const registry = readRegistry();
  const lane = registry.lanes.find((l) => l.id === issueId);
  const snapshot = readSnapshot(issueId);

  if (!lane && !snapshot) {
    console.error(`Error: No lane or snapshot found for ${issueId}.`);
    console.error(`  Run: pnpm lane:spawn -- --issue ${issueId}  to create a new lane.`);
    console.error('  Run: pnpm lane:list  to see registered lanes.');
    process.exit(1);
  }

  const border = '═'.repeat(62);
  console.log('');
  console.log(`LANE RESUME — ${issueId}`);
  console.log(border);

  if (snapshot) {
    const snapAge = humanAge(snapshot.capturedAt);
    console.log(`Snapshot:  ${snapshot.capturedAt.slice(0, 19)} (${snapAge} ago)`);
    console.log(`Branch:    ${snapshot.branch}`);
    if (snapshot.worktree) {
      console.log(`Worktree:  ${snapshot.worktree}`);
    }
    if (snapshot.pr) {
      console.log(`PR:        #${snapshot.pr}`);
    }

    console.log('');
    console.log('OBJECTIVE');
    console.log(`  ${snapshot.objective}`);

    if (snapshot.completed.length > 0) {
      console.log('');
      console.log('COMPLETED');
      for (const item of snapshot.completed) {
        console.log(`  ✓ ${item}`);
      }
    }

    if (snapshot.inProgress) {
      console.log('');
      console.log('IN PROGRESS');
      console.log(`  → ${snapshot.inProgress}`);
    }

    if (snapshot.filesTouched.length > 0) {
      console.log('');
      console.log('FILES TOUCHED');
      for (const f of snapshot.filesTouched.slice(0, 10)) {
        console.log(`  ${f}`);
      }
      if (snapshot.filesTouched.length > 10) {
        console.log(`  ... and ${snapshot.filesTouched.length - 10} more`);
      }
    }

    if (snapshot.decisions.length > 0) {
      console.log('');
      console.log('DECISIONS MADE');
      for (const d of snapshot.decisions) {
        console.log(`  • ${d}`);
      }
    }

    if (snapshot.blockers.length > 0) {
      console.log('');
      console.log('BLOCKERS');
      for (const b of snapshot.blockers) {
        console.log(`  ! ${b}`);
      }
    }

    if (snapshot.mustNotDrift.length > 0) {
      console.log('');
      console.log('MUST NOT DRIFT');
      for (const rule of snapshot.mustNotDrift) {
        console.log(`  ⚑ ${rule}`);
      }
    }

    console.log('');
    console.log('NEXT ACTION');
    console.log(`  ${snapshot.nextAction}`);
  } else if (lane) {
    console.log(`No snapshot yet for this lane.`);
    console.log('');
    console.log(`Branch:  ${lane.branch}`);
    console.log(`Status:  ${lane.status}`);
    console.log(`Owner:   ${lane.owner}`);
    console.log(`Created: ${lane.createdAt.slice(0, 19)} (${humanAge(lane.createdAt)} ago)`);
    if (lane.worktree) {
      console.log(`Worktree: ${lane.worktree}`);
    }
    console.log('');
    console.log(
      `Run pnpm lane:snapshot -- --issue ${issueId} --next "what to do next" to capture state.`,
    );
  }

  console.log('');
  console.log(border);

  // Branch switch advisory
  const activeBranch = snapshot?.branch ?? lane?.branch;
  if (activeBranch && currentBranch !== activeBranch) {
    console.log('');
    console.log(`Note: Currently on '${currentBranch}'.`);
    if (lane?.worktree) {
      console.log(`  Switch to worktree: cd ${lane.worktree}`);
    } else {
      console.log(`  Switch to branch:   git checkout ${activeBranch}`);
    }
  }
}

// ─── Command: cleanup ─────────────────────────────────────────────────────────

function cmdCleanup(flags: Record<string, string>, bools: Set<string>): void {
  const dryRun = bools.has('dry-run');
  const forceId = flags.force?.toUpperCase();
  const purgeClosed = bools.has('purge-closed');
  const purgeAgeDays = purgeClosed ? parseInt(flags['purge-days'] ?? '7', 10) : 0;

  const registry = readRegistry();

  type CleanupCandidate = {
    lane: LaneEntry;
    reason: string;
    safeAuto: boolean;
  };

  const candidates: CleanupCandidate[] = [];

  for (const lane of registry.lanes) {
    // Skip already-closed lanes (merged was handled in a previous cleanup run)
    if (lane.status === 'merged') continue;
    if (forceId && lane.id !== forceId) continue;

    // Safe auto-remove: explicitly abandoned
    if (lane.status === 'abandoned') {
      candidates.push({ lane, reason: 'status: abandoned', safeAuto: true });
      continue;
    }

    // Safe auto-remove: branch is merged to main
    if (isBranchMergedToMain(lane.branch)) {
      candidates.push({ lane, reason: 'branch merged to main', safeAuto: true });
      continue;
    }

    // Review-only: very old with no snapshot (14+ days)
    const ageMs = Date.now() - new Date(lane.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > 14 && !lane.snapshotAt) {
      candidates.push({
        lane,
        reason: `${Math.floor(ageDays)}d old, never snapshotted`,
        safeAuto: false,
      });
    } else if (ageDays > 21) {
      candidates.push({
        lane,
        reason: `${Math.floor(ageDays)}d old, possibly stale`,
        safeAuto: false,
      });
    }
  }

  // Orphaned worktrees: in .claude/worktrees/ but not in registry
  const orphanedWorktrees: string[] = [];
  if (fs.existsSync(WORKTREES_DIR)) {
    try {
      const registeredWorktreeNames = new Set(
        registry.lanes
          .filter((l) => l.worktree !== null)
          .map((l) => path.basename(l.worktree!)),
      );
      const entries = fs.readdirSync(WORKTREES_DIR);
      for (const entry of entries) {
        if (!registeredWorktreeNames.has(entry)) {
          orphanedWorktrees.push(entry);
        }
      }
    } catch {
      // non-fatal
    }
  }

  // --purge-closed: remove merged/abandoned entries older than N days from the registry
  const purgedEntries: LaneEntry[] = [];
  if (purgeClosed) {
    const cutoffMs = purgeAgeDays * 24 * 60 * 60 * 1000;
    registry.lanes = registry.lanes.filter((l) => {
      if (l.status !== 'merged' && l.status !== 'abandoned') return true;
      const ageMs = Date.now() - new Date(l.createdAt).getTime();
      if (ageMs < cutoffMs) return true;
      purgedEntries.push(l);
      return false;
    });
    if (purgedEntries.length > 0) {
      console.log(`PURGE CLOSED (entries older than ${purgeAgeDays}d removed from registry):`);
      for (const l of purgedEntries) {
        console.log(`  ${l.id}  (${l.status}, created ${humanAge(l.createdAt)} ago)`);
      }
      if (!dryRun) {
        writeRegistry(registry);
        console.log(`  Removed ${purgedEntries.length} entr${purgedEntries.length === 1 ? 'y' : 'ies'} from registry.`);
      } else {
        // Restore for dry-run reporting — we already printed; restore so the rest sees real data
        registry.lanes = registry.lanes.concat(purgedEntries);
      }
      console.log('');
    } else {
      console.log(`No closed entries older than ${purgeAgeDays}d to purge.`);
      console.log('');
    }
  }

  if (candidates.length === 0 && orphanedWorktrees.length === 0 && purgedEntries.length === 0) {
    if (!purgeClosed) console.log('Nothing to clean up. Lane registry is healthy.');
    return;
  }

  // Print plan
  const safeCandidates = candidates.filter((c) => c.safeAuto);
  const reviewCandidates = candidates.filter((c) => !c.safeAuto);

  if (safeCandidates.length > 0) {
    console.log(
      `WILL REMOVE (${safeCandidates.length} — merged or abandoned):`,
    );
    for (const { lane, reason } of safeCandidates) {
      console.log(`  ${lane.id}  (${reason})`);
      console.log(`    branch: ${lane.branch}`);
      if (lane.worktree) console.log(`    worktree: ${lane.worktree}`);
    }
  }

  if (reviewCandidates.length > 0) {
    console.log('');
    console.log(
      `NEEDS REVIEW (${reviewCandidates.length} — use --force <ID> to remove):`,
    );
    for (const { lane, reason } of reviewCandidates) {
      console.log(`  ${lane.id}  (${reason})`);
    }
  }

  if (orphanedWorktrees.length > 0) {
    console.log('');
    console.log(`ORPHANED WORKTREES (${orphanedWorktrees.length} — not in registry):`);
    for (const dir of orphanedWorktrees) {
      console.log(`  .claude/worktrees/${dir}`);
    }
    console.log('  Remove with: git worktree remove .claude/worktrees/<dir> --force');
  }

  if (dryRun) {
    console.log('');
    console.log('(dry-run — no changes made)');
    console.log('Run pnpm lane:cleanup to apply.');
    return;
  }

  if (safeCandidates.length === 0) {
    console.log('');
    console.log('No auto-safe removals. Review candidates above require --force <ID>.');
    return;
  }

  // Apply safe removals
  console.log('');
  for (const { lane } of safeCandidates) {
    if (lane.worktree) {
      const wtAbs = path.join(ROOT, lane.worktree);
      if (fs.existsSync(wtAbs)) {
        const wtResult = git('worktree', 'remove', lane.worktree, '--force');
        if (wtResult.ok) {
          console.log(`  Removed worktree: ${lane.worktree}`);
        } else {
          console.log(`  Warning: Could not remove worktree ${lane.worktree}: ${wtResult.stderr}`);
        }
      }
    }

    const idx = registry.lanes.findIndex((l) => l.id === lane.id);
    if (idx >= 0) {
      registry.lanes[idx].status = 'merged';
    }

    console.log(`  Closed lane: ${lane.id}`);
  }

  // Prune stale git worktree refs
  git('worktree', 'prune');
  writeRegistry(registry);

  console.log('');
  console.log(`Done. ${safeCandidates.length} lane(s) closed.`);
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

const { command, flags, bools } = parseArgs(process.argv.slice(2));

try {
  switch (command) {
    case 'spawn':
      cmdSpawn(flags, bools);
      break;
    case 'list':
      cmdList(bools);
      break;
    case 'snapshot':
      cmdSnapshot(flags);
      break;
    case 'resume':
      cmdResume(flags);
      break;
    case 'cleanup':
      cmdCleanup(flags, bools);
      break;
    default:
      console.error(
        command
          ? `Unknown command: ${command}`
          : 'No command given.',
      );
      console.error('');
      console.error('Usage:');
      console.error('  pnpm lane:spawn    -- --issue UTV2-XXX [--title "text"] [--owner claude|codex|codex-cli] [--worktree] [--base main] [--allowed "file1,file2"]');
      console.error('  pnpm lane:list');
      console.error('  pnpm lane:snapshot -- --issue UTV2-XXX [--next "action"] [--obj "objective"]');
      console.error('  pnpm lane:resume   -- --issue UTV2-XXX');
      console.error('  pnpm lane:cleanup  -- [--dry-run] [--force UTV2-XXX] [--purge-closed [--purge-days N]]');
      process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
