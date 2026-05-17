import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileManifest } from './reconcile.js';
import type { LaneManifest } from './shared.js';

const STALE_MS = 4 * 60 * 60 * 1000;
const STRANDED_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-05-17T12:00:00.000Z');

function classifyAge(ageMs: number): 'clean' | 'stale' | 'stranded' {
  if (ageMs > STRANDED_MS) return 'stranded';
  if (ageMs > STALE_MS) return 'stale';
  return 'clean';
}

function manifestWithHeartbeat(heartbeatAt: string): LaneManifest {
  return {
    schema_version: 1,
    issue_id: 'UTV2-1003',
    lane_type: 'codex-cli',
    executor: 'codex-cli',
    tier: 'T3',
    worktree_path: 'C:/Dev/Unit-Talk-v2-main',
    branch: 'codex/utv2-1003-opsreconcile-dry-run-default',
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: ['scripts/ops/reconcile.ts'],
    expected_proof_paths: [],
    status: 'in_progress',
    started_at: '2026-05-17T10:00:00.000Z',
    heartbeat_at: heartbeatAt,
    closed_at: null,
    blocked_by: [],
    preflight_token: 'test-token',
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
  };
}

test('ops:reconcile threshold logic classifies fresh heartbeat as clean', () => {
  assert.equal(classifyAge(1 * 60 * 60 * 1000), 'clean');
});

test('ops:reconcile threshold logic classifies 4h+ as stale', () => {
  assert.equal(classifyAge(5 * 60 * 60 * 1000), 'stale');
});

test('ops:reconcile threshold logic classifies 24h+ as stranded', () => {
  assert.equal(classifyAge(25 * 60 * 60 * 1000), 'stranded');
});

test('ops:reconcile threshold boundary just under stale threshold is clean', () => {
  assert.equal(classifyAge(STALE_MS - 1), 'clean');
});

test('ops:reconcile threshold boundary just over stale threshold is stale', () => {
  assert.equal(classifyAge(STALE_MS + 1), 'stale');
});

test('ops:reconcile threshold boundary just over stranded threshold is stranded', () => {
  assert.equal(classifyAge(STRANDED_MS + 1), 'stranded');
});

test('ops:reconcile default dry-run does not write stranded manifest changes', () => {
  let writes = 0;
  const entry = reconcileManifest(manifestWithHeartbeat('2026-05-16T10:00:00.000Z'), {
    apply: false,
    now: NOW,
    branchExists: () => true,
    writeManifest: () => {
      writes += 1;
    },
  });

  assert.equal(entry.verdict, 'stranded');
  assert.equal(entry.action_taken, 'DRY-RUN - WOULD status -> blocked, truth_check_history appended');
  assert.equal(entry.planned_mutation, 'status -> blocked, truth_check_history appended');
  assert.equal(writes, 0);
});

test('ops:reconcile --apply writes stranded manifest changes', () => {
  let written: LaneManifest | null = null;
  const entry = reconcileManifest(manifestWithHeartbeat('2026-05-16T10:00:00.000Z'), {
    apply: true,
    now: NOW,
    branchExists: () => true,
    writeManifest: (manifest) => {
      written = manifest;
    },
  });

  assert.equal(entry.verdict, 'stranded');
  assert.equal(entry.action_taken, 'status -> blocked, truth_check_history appended');
  assert.equal(written?.status, 'blocked');
  assert.equal(written?.truth_check_history.length, 1);
});
