/**
 * scripts/codex-status.ts
 * Show status of all Codex CLI lanes.
 *
 * Reads .claude/lanes.json and displays lanes with owner='codex-cli',
 * color-coded by health: merged=green, returned/review=yellow, stale>4h=red.
 *
 * Usage:
 *   pnpm codex:status [--all]
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LaneEntry {
  id: string;
  title: string;
  branch: string;
  worktree: string | null;
  status: 'active' | 'review' | 'merged' | 'abandoned';
  owner: 'claude' | 'codex' | 'codex-cli' | 'manual';
  createdAt: string;
  snapshotAt: string | null;
  pr: number | null;
  allowedFiles?: string[];
}

interface LaneRegistry {
  version: number;
  lanes: LaneEntry[];
}

// ─── Repo Context ─────────────────────────────────────────────────────────────

function repoRoot(): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) throw new Error('Not in a git repository');
  return result.stdout.trim();
}

const ROOT = repoRoot();
const LANES_FILE = path.join(ROOT, '.claude', 'lanes.json');
const CODEX_QUEUE_DIR = path.join(ROOT, '.claude', 'codex-queue');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readRegistry(): LaneRegistry {
  if (!fs.existsSync(LANES_FILE)) return { version: 1, lanes: [] };
  try {
    return JSON.parse(fs.readFileSync(LANES_FILE, 'utf8')) as LaneRegistry;
  } catch {
    return { version: 1, lanes: [] };
  }
}

function humanAge(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 2) return 'just now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.floor(diffHr / 24)}d`;
}

function isStale(isoDate: string, thresholdHours = 4): boolean {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  return diffMs > thresholdHours * 60 * 60 * 1000;
}

// ANSI colors — gracefully disabled if not a TTY
const isTTY = process.stdout.isTTY;
const c = {
  green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  dim: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
};

function packetExists(issueId: string): boolean {
  return fs.existsSync(path.join(CODEX_QUEUE_DIR, `${issueId}.md`));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const showAll = args.includes('--all');

const registry = readRegistry();
const codexLanes = registry.lanes.filter(
  (l) => l.owner === 'codex-cli' && (showAll || l.status !== 'merged'),
);

const line = '─'.repeat(78);
console.log('');
console.log(c.bold('CODEX CLI LANES'));
console.log(line);

if (codexLanes.length === 0) {
  console.log(c.dim('  No Codex CLI lanes registered.'));
  console.log(c.dim('  Dispatch one with: pnpm codex:dispatch -- --issue UTV2-XXX'));
  console.log('');
  process.exit(0);
}

// Count active
const active = codexLanes.filter((l) => l.status === 'active');
const inReview = codexLanes.filter((l) => l.status === 'review');
const merged = codexLanes.filter((l) => l.status === 'merged');
const abandoned = codexLanes.filter((l) => l.status === 'abandoned');

console.log(
  `  Active: ${active.length}/3    In Review: ${inReview.length}    Merged: ${merged.length}    Abandoned: ${abandoned.length}`,
);
console.log('');

// Header
const header = [
  'ID'.padEnd(12),
  'STATUS'.padEnd(12),
  'AGE'.padEnd(8),
  'BRANCH'.padEnd(36),
  'PR',
].join('  ');
console.log(c.dim(header));
console.log(c.dim('─'.repeat(78)));

for (const lane of codexLanes) {
  const age = humanAge(lane.createdAt);
  const prDisplay = lane.pr ? `PR #${lane.pr}` : '—';
  const branchTrunc =
    lane.branch.length > 34 ? `${lane.branch.slice(0, 31)}...` : lane.branch;

  const stale = lane.status === 'active' && isStale(lane.createdAt);

  const statusDisplay = (() => {
    switch (lane.status) {
      case 'merged':
        return c.green('merged');
      case 'review':
        return c.yellow('in-review');
      case 'active':
        return stale ? c.red('active (STALE)') : c.yellow('active');
      case 'abandoned':
        return c.dim('abandoned');
      default:
        return lane.status;
    }
  })();

  const row = [
    lane.id.padEnd(12),
    statusDisplay.padEnd(stale ? 24 : 12),
    age.padEnd(8),
    branchTrunc.padEnd(36),
    prDisplay,
  ].join('  ');

  console.log(row);

  // Show title (truncated)
  const titleTrunc = lane.title.length > 60 ? `${lane.title.slice(0, 57)}...` : lane.title;
  console.log(c.dim(`  ↳ ${titleTrunc}`));

  // Show packet status
  if (lane.status === 'active') {
    const hasPacket = packetExists(lane.id);
    if (hasPacket) {
      console.log(c.dim(`  ↳ packet: .claude/codex-queue/${lane.id}.md`));
    } else {
      console.log(c.yellow(`  ↳ packet: not found (re-run pnpm codex:dispatch -- --issue ${lane.id})`));
    }
  }

  // Show allowed files
  if (lane.allowedFiles && lane.allowedFiles.length > 0) {
    const filesDisplay =
      lane.allowedFiles.length <= 3
        ? lane.allowedFiles.join(', ')
        : `${lane.allowedFiles.slice(0, 3).join(', ')} +${lane.allowedFiles.length - 3} more`;
    console.log(c.dim(`  ↳ allowed: ${filesDisplay}`));
  }

  console.log('');
}

console.log(line);

// Stale warnings
const staleActive = active.filter((l) => isStale(l.createdAt));
if (staleActive.length > 0) {
  console.log('');
  console.log(c.red(`STALE LANES (active >4h with no PR):`));
  for (const lane of staleActive) {
    console.log(c.red(`  ${lane.id}: ${humanAge(lane.createdAt)} old — consider following up or cleaning up`));
  }
}

// Capacity info
console.log('');
if (active.length >= 3) {
  console.log(c.yellow(`Capacity: ${active.length}/3 — at max. Wait for a lane to return before dispatching.`));
} else {
  console.log(c.dim(`Capacity: ${active.length}/3 — ${3 - active.length} slot(s) available`));
}

console.log('');
console.log(c.dim(`Dispatch:  pnpm codex:dispatch -- --issue UTV2-XXX`));
console.log(c.dim(`Receive:   pnpm codex:receive -- --issue UTV2-XXX --branch <b> --pr <url>`));
console.log(c.dim(`All lanes: pnpm codex:status --all`));
console.log('');
