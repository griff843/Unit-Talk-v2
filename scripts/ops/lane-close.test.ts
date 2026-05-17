import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapFailuresToCode,
  remediationForCode,
  requireCloseCommitSha,
  type CloseoutFailureCode,
} from './lane-close.js';
import type { LaneManifest } from './shared.js';

function createManifest(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    schema_version: 1,
    issue_id: 'UTV2-1001',
    lane_type: 'governance',
    executor: 'codex-cli',
    tier: 'T3',
    worktree_path: '.',
    branch: 'codex/utv2-1001-enforce-non-null-merge-sha',
    base_branch: 'main',
    commit_sha: 'abc123',
    pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1001',
    files_changed: ['scripts/ops/lane-close.ts'],
    file_scope_lock: ['scripts/**'],
    expected_proof_paths: [],
    status: 'merged',
    started_at: '2026-05-17T09:00:00.000Z',
    heartbeat_at: '2026-05-17T09:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: 'dispatch-auto',
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
    ...overrides,
  };
}

// ── Scenario 1: clean closeout ────────────────────────────────────────────────

test('clean closeout: pass verdict with no failures maps to lane_closed', () => {
  const code = mapFailuresToCode([], 'pass');
  assert.strictEqual(code, 'lane_closed');
});

test('clean closeout: lane_closed remediation is empty string', () => {
  assert.strictEqual(remediationForCode('lane_closed'), '');
});

test('lane close commit guard: null commit_sha throws', () => {
  assert.throws(
    () => requireCloseCommitSha(createManifest({ commit_sha: null })),
    /ERROR: Lane close requires commit_sha — run ops:truth-check first/,
  );
});

test('lane close commit guard: undefined commit_sha throws', () => {
  const manifest = createManifest() as LaneManifest & {
    commit_sha?: string | null;
  };
  delete manifest.commit_sha;

  assert.throws(
    () => requireCloseCommitSha(manifest),
    /ERROR: Lane close requires commit_sha — run ops:truth-check first/,
  );
});

test('lane close commit guard: empty commit_sha throws', () => {
  assert.throws(
    () => requireCloseCommitSha(createManifest({ commit_sha: '   ' })),
    /ERROR: Lane close requires commit_sha — run ops:truth-check first/,
  );
});

test('lane close commit guard: valid commit_sha proceeds normally', () => {
  assert.doesNotThrow(() =>
    requireCloseCommitSha(createManifest({ commit_sha: 'abc123' })),
  );
});

test('lane close commit guard: already done lane is not retroactively failed', () => {
  assert.doesNotThrow(() =>
    requireCloseCommitSha(createManifest({ commit_sha: null, status: 'done' })),
  );
});

// ── Scenario 2: missing proof ─────────────────────────────────────────────────

test('missing proof: P1 failure maps to missing_proof', () => {
  const code = mapFailuresToCode(['P1'], 'fail');
  assert.strictEqual(code, 'missing_proof');
});

test('missing proof: P2 failure maps to missing_proof', () => {
  const code = mapFailuresToCode(['G4', 'P2'], 'fail');
  assert.strictEqual(code, 'missing_proof');
});

test('missing proof: P1 and P2 together map to missing_proof', () => {
  const code = mapFailuresToCode(['P1', 'P2'], 'fail');
  assert.strictEqual(code, 'missing_proof');
});

test('stale proof: P3 failure maps to stale_proof', () => {
  const code = mapFailuresToCode(['P3'], 'fail');
  assert.strictEqual(code, 'stale_proof');
});

test('stale proof: P4 failure maps to stale_proof', () => {
  const code = mapFailuresToCode(['P4'], 'fail');
  assert.strictEqual(code, 'stale_proof');
});

test('missing proof takes priority over stale proof when both present', () => {
  const code = mapFailuresToCode(['P1', 'P3'], 'fail');
  assert.strictEqual(code, 'missing_proof');
});

// ── Scenario 3: failing truth-check (general) ─────────────────────────────────

test('failing truth-check: L2 failure (bad tier label) maps to truth_check_failed', () => {
  const code = mapFailuresToCode(['L2'], 'fail');
  assert.strictEqual(code, 'truth_check_failed');
});

test('failing truth-check: L5 failure (missing t1-approved) maps to truth_check_failed', () => {
  const code = mapFailuresToCode(['L5'], 'fail');
  assert.strictEqual(code, 'truth_check_failed');
});

test('failing truth-check: S1 scope bleed maps to truth_check_failed', () => {
  const code = mapFailuresToCode(['S1'], 'fail');
  assert.strictEqual(code, 'truth_check_failed');
});

test('failing truth-check: G3 (not on main) maps to truth_check_failed', () => {
  const code = mapFailuresToCode(['G3'], 'fail');
  assert.strictEqual(code, 'truth_check_failed');
});

test('failing truth-check: G4 (required checks failing) maps to truth_check_failed', () => {
  const code = mapFailuresToCode(['G4'], 'fail');
  assert.strictEqual(code, 'truth_check_failed');
});

// ── Scenario 4: PR/Linear mismatch ────────────────────────────────────────────

test('PR not merged: G1 failure maps to pr_not_merged', () => {
  const code = mapFailuresToCode(['G1'], 'fail');
  assert.strictEqual(code, 'pr_not_merged');
});

test('PR SHA mismatch: G2 failure maps to pr_sha_mismatch', () => {
  const code = mapFailuresToCode(['G2'], 'fail');
  assert.strictEqual(code, 'pr_sha_mismatch');
});

test('registry mismatch: L4 (Linear missing PR attachment) maps to registry_mismatch', () => {
  const code = mapFailuresToCode(['L4'], 'fail');
  assert.strictEqual(code, 'registry_mismatch');
});

test('PR not merged takes priority over registry mismatch when both present', () => {
  const code = mapFailuresToCode(['G1', 'L4'], 'fail');
  assert.strictEqual(code, 'pr_not_merged');
});

test('PR SHA mismatch takes priority over registry mismatch when both present', () => {
  const code = mapFailuresToCode(['G2', 'L4'], 'fail');
  assert.strictEqual(code, 'pr_sha_mismatch');
});

// ── Infra errors ──────────────────────────────────────────────────────────────

test('infra_error verdict maps to infra_error regardless of failures', () => {
  const code = mapFailuresToCode([], 'infra_error');
  assert.strictEqual(code, 'infra_error');
});

test('M1 (missing manifest) maps to infra_error', () => {
  const code = mapFailuresToCode(['M1'], 'fail');
  assert.strictEqual(code, 'infra_error');
});

test('L1 (missing LINEAR_API_TOKEN) maps to infra_error', () => {
  const code = mapFailuresToCode(['L1'], 'fail');
  assert.strictEqual(code, 'infra_error');
});

// ── Manifest not ready ────────────────────────────────────────────────────────

test('ineligible verdict maps to manifest_not_ready', () => {
  const code = mapFailuresToCode([], 'ineligible');
  assert.strictEqual(code, 'manifest_not_ready');
});

test('M4 (wrong manifest status) maps to manifest_not_ready', () => {
  const code = mapFailuresToCode(['M4'], 'fail');
  assert.strictEqual(code, 'manifest_not_ready');
});

// ── Remediation messages are non-empty for all failure codes ──────────────────

const allFailureCodes: CloseoutFailureCode[] = [
  'manifest_not_ready',
  'missing_proof',
  'stale_proof',
  'pr_not_merged',
  'pr_sha_mismatch',
  'registry_mismatch',
  'infra_error',
  'truth_check_failed',
];

for (const code of allFailureCodes) {
  test(`remediation message for ${code} is a non-empty string`, () => {
    const msg = remediationForCode(code);
    assert.ok(
      typeof msg === 'string' && msg.length > 0,
      `Expected non-empty remediation for ${code}`,
    );
  });
}
