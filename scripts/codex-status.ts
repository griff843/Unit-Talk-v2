/**
 * scripts/codex-status.ts
 * Show status of all Codex CLI lanes from the canonical manifest directory.
 *
 * Reads docs/06_status/lanes/*.json and displays lanes with lane_type='codex-cli',
 * color-coded by health: merged/done=green, in-review=yellow, stale>4h=red.
 *
 * Usage:
 *   pnpm codex:status [--all] [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  type LaneManifest,
  ACTIVE_LOCK_STATUSES,
  ROOT,
  readAllManifests,
  relativeToRoot,
} from './ops/shared.js';

const CODEX_QUEUE_DIR = path.join(ROOT, '.claude', 'codex-queue');

function humanAge(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 2) return 'just now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.floor(diffHr / 24)}d`;
}

function ageMinutes(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 60_000);
}

function isStale(heartbeatAt: string): boolean {
  return ageMinutes(heartbeatAt) > 240; // 4h
}

function isStranded(heartbeatAt: string): boolean {
  return ageMinutes(heartbeatAt) > 1440; // 24h
}

type DisplayBucket = 'active' | 'in-review' | 'merged' | 'done' | 'blocked' | 'reopened';

function displayBucket(status: string): DisplayBucket {
  switch (status) {
    case 'started':
    case 'in_progress':
      return 'active';
    case 'in_review':
      return 'in-review';
    case 'merged':
      return 'merged';
    case 'done':
      return 'done';
    case 'blocked':
      return 'blocked';
    case 'reopened':
      return 'reopened';
    default:
      return 'active';
  }
}

function packetExists(issueId: string): boolean {
  return fs.existsSync(path.join(CODEX_QUEUE_DIR, `${issueId}.md`));
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

// ─── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const showAll = args.includes('--all');
const jsonMode = args.includes('--json');

let allManifests: LaneManifest[];
try {
  allManifests = readAllManifests();
} catch {
  allManifests = [];
}

const codexLanes = allManifests
  .filter((m) => m.lane_type === 'codex-cli')
  .filter((m) => showAll || (m.status !== 'merged' && m.status !== 'done'))
  .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

if (jsonMode) {
  const output = codexLanes.map((m) => ({
    issue_id: m.issue_id,
    lane_type: m.lane_type,
    tier: m.tier,
    branch: m.branch,
    worktree_path: m.worktree_path,
    status: m.status,
    display_bucket: displayBucket(m.status),
    started_at: m.started_at,
    heartbeat_at: m.heartbeat_at,
    age_minutes: ageMinutes(m.started_at),
    heartbeat_age_minutes: ageMinutes(m.heartbeat_at),
    stale: ACTIVE_LOCK_STATUSES.has(m.status) && isStale(m.heartbeat_at),
    stranded: ACTIVE_LOCK_STATUSES.has(m.status) && isStranded(m.heartbeat_at),
    pr_url: m.pr_url,
    file_scope_lock: m.file_scope_lock,
    expected_proof_paths: m.expected_proof_paths,
    packet_present: packetExists(m.issue_id),
    manifest_path: relativeToRoot(path.join(ROOT, 'docs', '06_status', 'lanes', `${m.issue_id}.json`)),
  }));
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

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

// Count by bucket
const active = codexLanes.filter((m) => m.status === 'started' || m.status === 'in_progress');
const inReview = codexLanes.filter((m) => m.status === 'in_review');
const merged = codexLanes.filter((m) => m.status === 'merged');
const done = codexLanes.filter((m) => m.status === 'done');
const blocked = codexLanes.filter((m) => m.status === 'blocked' || m.status === 'reopened');

console.log(
  `  Active: ${active.length}    In Review: ${inReview.length}    Merged: ${merged.length}    Done: ${done.length}    Blocked: ${blocked.length}`,
);
console.log('');

// Header
const header = [
  'ID'.padEnd(12),
  'STATUS'.padEnd(16),
  'AGE'.padEnd(8),
  'BRANCH'.padEnd(36),
  'PR',
].join('  ');
console.log(c.dim(header));
console.log(c.dim('─'.repeat(78)));

for (const m of codexLanes) {
  const age = humanAge(m.started_at);
  const bucket = displayBucket(m.status);
  const prDisplay = m.pr_url ? m.pr_url.replace(/.*\/pull\//, 'PR #') : '—';
  const branchTrunc = m.branch.length > 34 ? `${m.branch.slice(0, 31)}...` : m.branch;

  const stale = ACTIVE_LOCK_STATUSES.has(m.status) && isStale(m.heartbeat_at);
  const stranded = ACTIVE_LOCK_STATUSES.has(m.status) && isStranded(m.heartbeat_at);

  const statusDisplay = (() => {
    if (stranded) return c.red(`${bucket} (STRANDED)`);
    if (stale) return c.red(`${bucket} (STALE)`);
    switch (bucket) {
      case 'merged':
      case 'done':
        return c.green(bucket);
      case 'in-review':
        return c.yellow(bucket);
      case 'active':
        return c.yellow(bucket);
      case 'blocked':
      case 'reopened':
        return c.red(bucket);
      default:
        return bucket;
    }
  })();

  const displayWidth = stranded ? 28 : stale ? 24 : 16;
  const row = [
    m.issue_id.padEnd(12),
    statusDisplay.padEnd(displayWidth),
    age.padEnd(8),
    branchTrunc.padEnd(36),
    prDisplay,
  ].join('  ');

  console.log(row);

  // Show file scope (truncated)
  if (m.file_scope_lock.length > 0) {
    const filesDisplay =
      m.file_scope_lock.length <= 3
        ? m.file_scope_lock.join(', ')
        : `${m.file_scope_lock.slice(0, 3).join(', ')} +${m.file_scope_lock.length - 3} more`;
    console.log(c.dim(`  ↳ scope: ${filesDisplay}`));
  }

  // Show packet status for active lanes
  if (ACTIVE_LOCK_STATUSES.has(m.status) && m.status !== 'in_review') {
    const hasPacket = packetExists(m.issue_id);
    if (hasPacket) {
      console.log(c.dim(`  ↳ packet: .claude/codex-queue/${m.issue_id}.md`));
    } else {
      console.log(c.yellow(`  ↳ packet: not found`));
    }
  }

  console.log('');
}

console.log(line);

// Stale warnings
const staleActive = codexLanes.filter(
  (m) => ACTIVE_LOCK_STATUSES.has(m.status) && isStale(m.heartbeat_at),
);
if (staleActive.length > 0) {
  console.log('');
  console.log(c.red('STALE LANES (heartbeat >4h):'));
  for (const m of staleActive) {
    const suffix = isStranded(m.heartbeat_at) ? ' (STRANDED >24h)' : '';
    console.log(c.red(`  ${m.issue_id}: heartbeat ${humanAge(m.heartbeat_at)} old${suffix}`));
  }
}

console.log('');
console.log(c.dim(`Dispatch:  pnpm codex:dispatch -- --issue UTV2-XXX`));
console.log(c.dim(`Receive:   pnpm codex:receive -- --issue UTV2-XXX --branch <b> --pr <url>`));
console.log(c.dim(`All lanes: pnpm codex:status --all`));
console.log('');
