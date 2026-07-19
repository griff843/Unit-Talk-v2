import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildRepairRequiredViaPrPacket,
  ensureCloseoutMergeLock,
  finalizeLaneCloseManifest,
  guardRepairAgainstMainCheckout,
  mapFailuresToCode,
  repairMergedLaneManifest,
  releaseCloseoutLocks,
  remediationForCode,
  requireCloseCommitSha,
  type CloseoutFailureCode,
} from './lane-close.js';
import { acquireMergeLock, readMergeLock } from './merge-mutex.js';
import { readAllLeases, reserveLease } from './lease-registry.js';
import { MANIFEST_DIR, readManifest, writeManifest, type LaneManifest } from './shared.js';

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

function withTempCloseoutState(
  run: (paths: { leaseRegistryDir: string; mergeLockPath: string }) => void,
): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-lane-close-'));
  try {
    run({
      leaseRegistryDir: path.join(dir, 'leases'),
      mergeLockPath: path.join(dir, 'merge-lock.json'),
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function withTempRepairState(
  run: (paths: { repoRoot: string; artifactRoot: string; tokenPath: string }) => void,
): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-lane-repair-'));
  try {
    const tokenPath = path.join(dir, '.out', 'ops', 'preflight', 'codex', 'utv2-1001.json');
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, '{}\n');
    run({
      repoRoot: dir,
      artifactRoot: path.join(dir, '.out', 'ops', 'lane-close-repair'),
      tokenPath: '.out/ops/preflight/codex/utv2-1001.json',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

test('finalizeLaneCloseManifest preserves a truth_check_history entry written by a concurrent runTruthCheck side effect', () => {
  // Regression for the exact bug found reconciling UTV2-1543: runTruthCheck()
  // persists its own updated manifest (with a fresh truth_check_history entry)
  // as a side effect. A caller holding a manifest snapshot from BEFORE that
  // call must not write it back verbatim afterward -- that would silently
  // revert the just-persisted history entry even though the close succeeded.
  const issueId = 'UTV2-9999999';
  const manifestPath = path.join(MANIFEST_DIR, `${issueId}.json`);
  try {
    // Stale in-memory snapshot a caller might hold from before truth-check ran.
    const staleSnapshot = createManifest({
      issue_id: issueId,
      status: 'merged',
      truth_check_history: [],
    });
    writeManifest(staleSnapshot);

    // Simulate runTruthCheck()'s side effect: it writes ITS OWN updated
    // manifest to disk, independent of any caller-held in-memory copy.
    const afterTruthCheck = readManifest(issueId);
    afterTruthCheck.truth_check_history = [
      {
        checked_at: '2026-07-19T16:33:59.885Z',
        verdict: 'pass',
        merge_sha: 'c17e1f64e2ae20d7df80e2d4c030c99c6e01bcc6',
        failures: [],
        runner: 'ops:lane-close',
      },
    ];
    writeManifest(afterTruthCheck);

    const finalized = finalizeLaneCloseManifest(issueId);

    assert.strictEqual(finalized.status, 'done');
    assert.strictEqual(finalized.truth_check_history.length, 1);
    assert.strictEqual(finalized.truth_check_history[0].verdict, 'pass');
    assert.strictEqual(finalized.truth_check_history[0].runner, 'ops:lane-close');

    // What's actually persisted on disk must match -- not just the return value.
    const onDisk = readManifest(issueId);
    assert.strictEqual(onDisk.status, 'done');
    assert.strictEqual(onDisk.truth_check_history.length, 1);
    assert.strictEqual(onDisk.truth_check_history[0].verdict, 'pass');
  } finally {
    fs.rmSync(manifestPath, { force: true });
  }
});

test('lane close releases dispatch lease and merge lock after successful closeout', () => {
  withTempCloseoutState(({ leaseRegistryDir, mergeLockPath }) => {
    const issueId = 'UTV2-1001';
    const branch = 'codex/utv2-1001-enforce-non-null-merge-sha';
    const lease = reserveLease(
      {
        issue_id: issueId,
        branch,
        executor: 'codex-cli',
        cwd: process.cwd(),
        file_scope_lock: ['scripts/ops/lane-close.ts'],
        owner: {
          user: 'codex-test',
          host: 'unit-test',
          pid: 1001,
          session_id: 'lane-close-test',
        },
      },
      { registryDir: leaseRegistryDir, now: new Date('2026-05-18T12:00:00.000Z') },
    );
    const lock = acquireMergeLock(
      {
        issue_id: issueId,
        branch,
        pr: '1001',
        cwd: process.cwd(),
        reason: 'ops:lane-close',
        owner: {
          user: 'codex-test',
          host: 'unit-test',
          pid: 1001,
          session_id: 'lane-close-test',
        },
      },
      { lockPath: mergeLockPath, now: new Date('2026-05-18T12:00:00.000Z') },
    );

    assert.strictEqual(lease.ok, true);
    assert.strictEqual(lock.ok, true);

    releaseCloseoutLocks(issueId, branch, { leaseRegistryDir, mergeLockPath });

    const releasedLease = readAllLeases(leaseRegistryDir).find((entry) => entry.issue_id === issueId);
    const releasedLock = readMergeLock(mergeLockPath);
    assert.strictEqual(releasedLease?.status, 'released');
    assert.strictEqual(releasedLock.ok ? releasedLock.lock.status : '', 'released');
  });
});

test('lane close release is idempotent when closeout locks are already released', () => {
  withTempCloseoutState(({ leaseRegistryDir, mergeLockPath }) => {
    const issueId = 'UTV2-1001';
    const branch = 'codex/utv2-1001-enforce-non-null-merge-sha';
    reserveLease(
      {
        issue_id: issueId,
        branch,
        executor: 'codex-cli',
        cwd: process.cwd(),
        file_scope_lock: ['scripts/ops/lane-close.ts'],
        owner: {
          user: 'codex-test',
          host: 'unit-test',
          pid: 1001,
          session_id: 'lane-close-test',
        },
      },
      { registryDir: leaseRegistryDir, now: new Date('2026-05-18T12:00:00.000Z') },
    );
    acquireMergeLock(
      {
        issue_id: issueId,
        branch,
        pr: '1001',
        cwd: process.cwd(),
        reason: 'ops:lane-close',
        owner: {
          user: 'codex-test',
          host: 'unit-test',
          pid: 1001,
          session_id: 'lane-close-test',
        },
      },
      { lockPath: mergeLockPath, now: new Date('2026-05-18T12:00:00.000Z') },
    );

    releaseCloseoutLocks(issueId, branch, { leaseRegistryDir, mergeLockPath });
    assert.doesNotThrow(() =>
      releaseCloseoutLocks(issueId, branch, { leaseRegistryDir, mergeLockPath }),
    );
  });
});

test('lane close release is idempotent when closeout locks are already missing', () => {
  withTempCloseoutState(({ leaseRegistryDir, mergeLockPath }) => {
    assert.doesNotThrow(() =>
      releaseCloseoutLocks('UTV2-1001', 'codex/utv2-1001-enforce-non-null-merge-sha', {
        leaseRegistryDir,
        mergeLockPath,
      }),
    );
  });
});

test('lane close merge lock guard still requires an existing lock by default', () => {
  withTempCloseoutState(({ mergeLockPath }) => {
    const result = ensureCloseoutMergeLock(createManifest(), {
      mergeLockPath,
      now: new Date('2026-05-18T12:00:00.000Z'),
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_lock_missing');
  });
});

test('lane close can acquire the merge lock when explicitly requested', () => {
  withTempCloseoutState(({ mergeLockPath }) => {
    const manifest = createManifest();
    const result = ensureCloseoutMergeLock(manifest, {
      acquireLock: true,
      mergeLockPath,
      now: new Date('2026-05-18T12:00:00.000Z'),
      cwd: process.cwd(),
    });
    const loaded = readMergeLock(mergeLockPath);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'merge_lock_acquired');
    assert.strictEqual(loaded.ok ? loaded.lock.issue_id : '', manifest.issue_id);
    assert.strictEqual(loaded.ok ? loaded.lock.branch : '', manifest.branch);
    assert.strictEqual(loaded.ok ? loaded.lock.reason : '', 'ops:lane-close');
  });
});

test('lane close uses an existing matching merge lock even with acquire requested', () => {
  withTempCloseoutState(({ mergeLockPath }) => {
    const manifest = createManifest();
    acquireMergeLock(
      {
        issue_id: manifest.issue_id,
        branch: manifest.branch,
        pr: '1001',
        cwd: process.cwd(),
        reason: 'ops:lane-close',
        owner: {
          user: 'codex-test',
          host: 'unit-test',
          pid: 1001,
          session_id: 'lane-close-test',
        },
      },
      { lockPath: mergeLockPath, now: new Date('2026-05-18T12:00:00.000Z') },
    );

    const result = ensureCloseoutMergeLock(manifest, {
      acquireLock: true,
      mergeLockPath,
      now: new Date('2026-05-18T12:05:00.000Z'),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'merge_lock_held');
  });
});

test('repair merged lane replaces stale SHA with authoritative PR merge SHA', () => {
  withTempRepairState(({ repoRoot, artifactRoot, tokenPath }) => {
    const result = repairMergedLaneManifest(
      createManifest({
        status: 'merged',
        commit_sha: 'stale-sha',
        preflight_token: tokenPath,
      }),
      {
        repoRoot,
        artifactRoot,
        now: new Date('2026-05-26T04:00:00.000Z'),
        fetchPr: () => ({
          url: 'https://github.com/griff843/Unit-Talk-v2/pull/1001',
          state: 'merged',
          merged: true,
          mergeSha: 'authoritative-sha',
        }),
      },
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.manifest.status, 'merged');
    assert.strictEqual(result.manifest.commit_sha, 'authoritative-sha');
    assert.ok(result.changed_fields.includes('commit_sha'));
    assert.ok(result.artifact_path);
    assert.ok(fs.existsSync(result.artifact_path ?? ''));
  });
});

test('repair merged lane emits repair artifact and safe token when preflight token is missing', () => {
  withTempRepairState(({ repoRoot, artifactRoot }) => {
    const result = repairMergedLaneManifest(
      createManifest({
        status: 'in_review',
        commit_sha: null,
        preflight_token: '.out/ops/preflight/codex/missing-token.json',
      }),
      {
        repoRoot,
        artifactRoot,
        now: new Date('2026-05-26T04:05:00.000Z'),
        fetchPr: () => ({
          url: 'https://github.com/griff843/Unit-Talk-v2/pull/1001',
          state: 'merged',
          merged: true,
          mergeSha: 'merged-sha',
        }),
      },
    );
    const artifact = JSON.parse(fs.readFileSync(result.artifact_path ?? '', 'utf8')) as {
      preflight_repair?: string;
      next?: { preflight_token?: string };
    };

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.manifest.status, 'merged');
    assert.strictEqual(result.manifest.commit_sha, 'merged-sha');
    assert.strictEqual(result.manifest.preflight_token, 'dispatch-auto');
    assert.ok(result.changed_fields.includes('preflight_token'));
    assert.match(artifact.preflight_repair ?? '', /preflight token repaired/);
    assert.strictEqual(artifact.next?.preflight_token, 'dispatch-auto');
  });
});

test('repair merged lane releases an active lease for an already done lane and is idempotent', () => {
  withTempCloseoutState(({ leaseRegistryDir, mergeLockPath }) => {
    const manifest = createManifest({ status: 'done', commit_sha: null });
    const lease = reserveLease(
      {
        issue_id: manifest.issue_id,
        branch: manifest.branch,
        executor: 'codex-cli',
        cwd: process.cwd(),
        file_scope_lock: ['scripts/ops/lane-close.ts'],
        owner: {
          user: 'codex-test',
          host: 'unit-test',
          pid: 1001,
          session_id: 'lane-close-test',
        },
      },
      { registryDir: leaseRegistryDir, now: new Date('2026-05-18T12:00:00.000Z') },
    );
    assert.strictEqual(lease.ok, true);

    const options = {
      leaseRegistryDir,
      mergeLockPath,
      releaseLocksIfAlreadyDone: true,
      fetchPr: () => {
        throw new Error('fetch should not be called for done lanes');
      },
    };
    const result = repairMergedLaneManifest(manifest, options);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'already_closed');
    assert.strictEqual(result.outcome, 'already_closed');
    assert.strictEqual(result.manifest, manifest);
    assert.deepStrictEqual(result.changed_fields, []);
    assert.strictEqual(
      readAllLeases(leaseRegistryDir).find((entry) => entry.issue_id === manifest.issue_id)?.status,
      'released',
    );

    assert.doesNotThrow(() => repairMergedLaneManifest(manifest, options));
  });
});

test('repair merged lane does not touch lease/merge-lock state for an already done lane by default', () => {
  withTempCloseoutState(({ leaseRegistryDir, mergeLockPath }) => {
    const manifest = createManifest({ status: 'done', commit_sha: null });
    const lease = reserveLease(
      {
        issue_id: manifest.issue_id,
        branch: manifest.branch,
        executor: 'codex-cli',
        cwd: process.cwd(),
        file_scope_lock: ['scripts/ops/lane-close.ts'],
        owner: {
          user: 'codex-test',
          host: 'unit-test',
          pid: 1001,
          session_id: 'lane-close-test',
        },
      },
      { registryDir: leaseRegistryDir, now: new Date('2026-05-18T12:00:00.000Z') },
    );
    assert.strictEqual(lease.ok, true);

    const result = repairMergedLaneManifest(manifest, {
      leaseRegistryDir,
      mergeLockPath,
      fetchPr: () => {
        throw new Error('fetch should not be called for done lanes');
      },
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'already_closed');
    assert.strictEqual(
      readAllLeases(leaseRegistryDir).find((entry) => entry.issue_id === manifest.issue_id)?.status,
      'active',
    );
  });
});

test('repair merged lane refuses unmerged PRs without changing manifest', () => {
  const manifest = createManifest({ status: 'in_review', commit_sha: null });
  const result = repairMergedLaneManifest(manifest, {
    fetchPr: () => ({
      url: 'https://github.com/griff843/Unit-Talk-v2/pull/1001',
      state: 'open',
      merged: false,
      mergeSha: null,
    }),
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'pr_not_merged');
  assert.strictEqual(result.outcome, 'blocked');
  assert.strictEqual(result.manifest, manifest);
  assert.deepStrictEqual(result.changed_fields, []);
});

test('lane close acquire request does not override another held merge lock', () => {
  withTempCloseoutState(({ mergeLockPath }) => {
    acquireMergeLock(
      {
        issue_id: 'UTV2-1002',
        branch: 'codex/utv2-1002-other-lane',
        pr: '1002',
        cwd: process.cwd(),
        reason: 'ops:lane-close',
        owner: {
          user: 'codex-test',
          host: 'unit-test',
          pid: 1002,
          session_id: 'lane-close-test-other',
        },
      },
      { lockPath: mergeLockPath, now: new Date('2026-05-18T12:00:00.000Z') },
    );

    const result = ensureCloseoutMergeLock(createManifest(), {
      acquireLock: true,
      mergeLockPath,
      now: new Date('2026-05-18T12:05:00.000Z'),
      cwd: process.cwd(),
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_lock_held');
    assert.strictEqual(result.lock?.issue_id, 'UTV2-1002');
  });
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

test('missing merge SHA: C1 failure maps to missing_merge_sha', () => {
  const code = mapFailuresToCode(['C1'], 'fail');
  assert.strictEqual(code, 'missing_merge_sha');
});

test('missing merge SHA: C2 failure maps to missing_merge_sha', () => {
  const code = mapFailuresToCode(['C2'], 'fail');
  assert.strictEqual(code, 'missing_merge_sha');
});

test('stale proof: C4 proof SHA binding failure maps to stale_proof', () => {
  const code = mapFailuresToCode(['C4'], 'fail');
  assert.strictEqual(code, 'stale_proof');
});

test('runtime proof: C6 narrative-only runtime proof maps to runtime_proof_required', () => {
  const code = mapFailuresToCode(['C6'], 'fail');
  assert.strictEqual(code, 'runtime_proof_required');
});

// UTV2-1537: this exact remediation message is what post-merge-lane-close.yml
// surfaces to the operator when a T1 lane merges without runtime proof -- the
// precise moment that, worded ambiguously ("push a new commit"), previously led to
// an unauthorized direct-main push (see
// docs/06_status/INCIDENTS/INC-2026-07-14-utv2-1533-direct-main-push.md). It must
// name the governed repair path and must never suggest editing main directly.
test('runtime_proof_required remediation names the governed proof-repair path and never suggests editing main directly', () => {
  const message = remediationForCode('runtime_proof_required');
  assert.match(message, /ops:proof-repair scaffold/);
  assert.match(message, /Do NOT hand-edit proof files on main directly/);
  assert.doesNotMatch(message, /push a new commit/i);
});

test('state drift: C7 drift maps to state_drift', () => {
  const code = mapFailuresToCode(['C7'], 'fail');
  assert.strictEqual(code, 'state_drift');
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
  'missing_merge_sha',
  'missing_proof',
  'stale_proof',
  'runtime_proof_required',
  'state_drift',
  'pr_not_merged',
  'pr_sha_mismatch',
  'registry_mismatch',
  'infra_error',
  'truth_check_failed',
  'repair_required_via_pr',
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

test('post-merge lane close workflow delegates to repair-merged lane closeout', () => {
  const workflow = fs.readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'post-merge-lane-close.yml'),
    'utf8',
  );

  assert.match(workflow, /pnpm ops:lane-close "\$ISSUE_ID" --repair-merged --explain/);
  assert.match(workflow, /Bind proof artifacts to merge SHA/);
  assert.match(workflow, /git add docs\/06_status\/proof\/"\$ISSUE_ID"\//);
  assert.doesNotMatch(workflow, /pnpm ops:truth-check "\$ISSUE_ID"/);
  assert.doesNotMatch(workflow, /manifest\.status = 'done'/);
  assert.match(workflow, /git add "\$MANIFEST_PATH"/);
});

// ── UTV2-1542: --repair-merged must never leave a commit-ready main checkout ──
// Regression coverage reproducing the exact UTV2-1497 failure mode: an operator
// ran `ops:lane-close --repair-merged` from the shared main checkout, got back a
// manifest with real tracked-file changes and no warning, and committed +
// pushed the result directly to `origin/main`. guardRepairAgainstMainCheckout()
// must intercept that condition and block the normal write path.

test('guard blocks and emits a repair packet when repair-merged produces changes on a main checkout (UTV2-1497 repro)', () => {
  withTempRepairState(({ repoRoot, artifactRoot, tokenPath }) => {
    const repair = repairMergedLaneManifest(
      createManifest({
        issue_id: 'UTV2-1497',
        status: 'started',
        commit_sha: null,
        pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1221',
        preflight_token: tokenPath,
      }),
      {
        repoRoot,
        artifactRoot,
        now: new Date('2026-07-15T05:27:10.000Z'),
        fetchPr: () => ({
          url: 'https://github.com/griff843/Unit-Talk-v2/pull/1221',
          state: 'merged',
          merged: true,
          mergeSha: 'fd3f50d7c95e26e353f3857ec2684d1ff8ad99f7',
        }),
      },
    );
    assert.strictEqual(repair.ok, true);
    assert.ok(repair.changed_fields.length > 0, 'precondition: repair must actually produce changes');

    const guard = guardRepairAgainstMainCheckout(repair, {
      currentBranch: 'main',
      repoRoot,
    });

    assert.ok(guard, 'guard must not be null when repair-merged changed files on a main checkout');
    assert.strictEqual(guard?.ok, false);
    assert.strictEqual(guard?.code, 'repair_required_via_pr');
    assert.strictEqual(guard?.outcome, 'blocked');
    assert.strictEqual(guard?.issue_id, 'UTV2-1497');
    assert.deepStrictEqual(guard?.changed_files, ['docs/06_status/lanes/UTV2-1497.json']);
    assert.strictEqual(guard?.original_implementation_merge_sha, 'fd3f50d7c95e26e353f3857ec2684d1ff8ad99f7');
    assert.strictEqual(guard?.recommended_repair_branch, 'claude/utv2-1497-lane-close-repair');
    assert.match(guard?.direct_main_prohibition ?? '', /DIRECT_MAIN_BYPASS_POLICY\.md/);
    assert.match(guard?.direct_main_prohibition ?? '', /must NOT be committed or pushed directly to main/);

    // The repair packet must exist and contain the full repaired manifest --
    // this is the "patch or repair packet" the operator applies on the correct
    // branch instead of hand-retyping the repaired content.
    const packetAbsolutePath = path.join(repoRoot, guard?.repair_packet_path ?? '');
    assert.ok(fs.existsSync(packetAbsolutePath), 'repair packet file must be written');
    const packetContent = JSON.parse(fs.readFileSync(packetAbsolutePath, 'utf8')) as { commit_sha?: string };
    assert.strictEqual(packetContent.commit_sha, 'fd3f50d7c95e26e353f3857ec2684d1ff8ad99f7');
  });
});

test('guard commands never suggest git push origin main and always route through a governed PR', () => {
  withTempRepairState(({ repoRoot, artifactRoot, tokenPath }) => {
    const repair = repairMergedLaneManifest(
      createManifest({ issue_id: 'UTV2-1497', status: 'started', commit_sha: null, preflight_token: tokenPath }),
      {
        repoRoot,
        artifactRoot,
        fetchPr: () => ({
          url: 'https://github.com/griff843/Unit-Talk-v2/pull/1221',
          state: 'merged',
          merged: true,
          mergeSha: 'fd3f50d7c95e26e353f3857ec2684d1ff8ad99f7',
        }),
      },
    );
    const guard = guardRepairAgainstMainCheckout(repair, { currentBranch: 'main', repoRoot });

    assert.ok(guard);
    for (const command of guard?.commands ?? []) {
      assert.doesNotMatch(command, /git push(\s+-u)?\s+origin\s+main\b/);
    }
    assert.ok(
      guard?.commands.some((c) => /gh pr create --base main/.test(c)),
      'commands must include opening a PR against main',
    );
    assert.ok(
      guard?.commands.some((c) => /ops:lane-start/.test(c)),
      'commands must route through the sanctioned ops:lane-start lane lifecycle',
    );
  });
});

test('guard is a no-op (returns null) when running from a dedicated lane branch, not main', () => {
  withTempRepairState(({ repoRoot, artifactRoot, tokenPath }) => {
    const repair = repairMergedLaneManifest(
      createManifest({ issue_id: 'UTV2-1497', status: 'started', commit_sha: null, preflight_token: tokenPath }),
      {
        repoRoot,
        artifactRoot,
        fetchPr: () => ({
          url: 'https://github.com/griff843/Unit-Talk-v2/pull/1221',
          state: 'merged',
          merged: true,
          mergeSha: 'fd3f50d7c95e26e353f3857ec2684d1ff8ad99f7',
        }),
      },
    );

    const guard = guardRepairAgainstMainCheckout(repair, {
      currentBranch: 'claude/utv2-1497-lane-close-repair',
      repoRoot,
    });

    assert.strictEqual(guard, null);
  });
});

test('guard is a no-op when repair-merged made no changes (already_closed)', () => {
  const manifest = createManifest({ status: 'done' });
  const repair = repairMergedLaneManifest(manifest, {
    fetchPr: () => {
      throw new Error('fetch should not be called for done lanes');
    },
  });

  const guard = guardRepairAgainstMainCheckout(repair, { currentBranch: 'main', repoRoot: process.cwd() });

  assert.strictEqual(guard, null);
});

test('buildRepairRequiredViaPrPacket names the exact preflight + lane-start commands for the repair branch', () => {
  withTempRepairState(({ repoRoot }) => {
    const manifest = createManifest({ issue_id: 'UTV2-1497' });
    const result = buildRepairRequiredViaPrPacket({
      issueId: 'UTV2-1497',
      manifest,
      changedFields: ['commit_sha', 'status'],
      pr: {
        url: 'https://github.com/griff843/Unit-Talk-v2/pull/1221',
        state: 'merged',
        merged: true,
        mergeSha: 'fd3f50d7c95e26e353f3857ec2684d1ff8ad99f7',
      },
      repoRoot,
    });

    assert.ok(
      result.commands.some((c) => c.includes('generate-preflight-token.ts --issue UTV2-1497')),
    );
    assert.ok(
      result.commands.some((c) => c.includes('ops:lane-start UTV2-1497') && c.includes('claude/utv2-1497-lane-close-repair')),
    );
  });
});
