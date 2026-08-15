import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildRepairRequiredViaPrPacket,
  completeAlreadyClosedLaneCleanup,
  completeSuccessfulLaneClose,
  createRepairRollbackTransaction,
  ensureCloseoutMergeLock,
  finalizeLaneCloseManifest,
  guardRepairAgainstMainCheckout,
  implementationFilesFromTrustedRepair,
  manifestForFailedRepairClose,
  isTrustedPostMergeAutomation,
  mapFailuresToCode,
  rebindRepairedLaneProof,
  repairMergedLaneManifest,
  releaseCloseoutLocks,
  remediationForCode,
  requireCloseCommitSha,
  TruthCheckDriftError,
  validateTrustedPostMergeRepair,
  type RepairMergedPrInfo,
  type CloseoutFailureCode,
  classifyTruthCheckAuthorization,
  completeIdempotentReclose,
  releaseSelfAcquiredMergeLock,
  selectInferredMergedPr,
  evaluateIssueCompletionEligibility,
} from './lane-close.js';
import { acquireMergeLock, readMergeLock } from './merge-mutex.js';
import {
  CANONICAL_TRUTH_CHECK_RUNNERS,
  hashState,
  isMeasuredPass,
  measuredTruthCheckReceipt,
  truthHistoryEntryForMeasuredReceipt,
  unexecutedTruthCheckReceipt,
} from './lane-close-repair-packet.js';
import {
  beginTerminalLeaseRelease,
  readAllLeases,
  reserveLease,
} from './lease-registry.js';
import { ModelRoutingRebindError } from './proof-generate.js';
import { evaluateCloseoutTruthGate } from './truth-check-lib.js';
import {
  MANIFEST_DIR,
  ROOT,
  readManifest,
  writeManifest,
  type LaneManifest,
  type TruthCheckResult,
} from './shared.js';

test('UTV2-1690: lane PR binding cleanly ignores an issue-bearing branch owned by another lane', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'lane-pr-binding.yml'), 'utf8');
  const resolveStart = workflow.indexOf('- name: Resolve lane from branch');
  const setupStart = workflow.indexOf('- name: Setup pnpm');
  assert.ok(resolveStart >= 0 && setupStart > resolveStart, 'resolve step must precede dependency setup');
  const resolveStep = workflow.slice(resolveStart, setupStart);
  const mismatchStart = resolveStep.indexOf('if [ "$manifest_branch" != "$BRANCH" ]; then');
  const bindTrue = resolveStep.indexOf('echo "bind=true"');
  assert.ok(mismatchStart >= 0, 'registered manifest branch must be compared with the PR head');
  assert.ok(bindTrue > mismatchStart, 'branch mismatch must be decided before enabling binding');
  const mismatchBlock = resolveStep.slice(mismatchStart, bindTrue);
  assert.match(mismatchBlock, /echo "bind=false"/);
  assert.match(mismatchBlock, /not its registered lane branch/);
  assert.match(mismatchBlock, /exit 0/);
  assert.doesNotMatch(mismatchBlock, /exit 1/);

  assert.match(workflow, /if: steps\.lane\.outputs\.bind == 'true'[\s\S]*lane-link-pr\.ts/);
  assert.match(workflow, /--branch "\$BRANCH"[\s\S]*--base "\$BASE_BRANCH"/);
});

function createTruthCheckResult(overrides: Partial<TruthCheckResult> = {}): TruthCheckResult {
  return {
    schema_version: 1,
    issue_id: 'UTV2-1001',
    tier: 'T3',
    verdict: 'pass',
    exit_code: 0,
    merge_sha: 'c17e1f64e2ae20d7df80e2d4c030c99c6e01bcc6',
    pr_url: null,
    checked_at: '2026-07-19T16:33:59.885Z',
    checks: [],
    failures: [],
    reopen_reasons: [],
    manifest_path: '',
    ...overrides,
  };
}

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

function createTrustedRepairPr(
  manifest: LaneManifest,
  overrides: Partial<RepairMergedPrInfo> = {},
): RepairMergedPrInfo {
  const number = 1305;
  return {
    url: `https://github.com/griff843/Unit-Talk-v2/pull/${number}`,
    number,
    repository: 'griff843/Unit-Talk-v2',
    state: 'merged',
    merged: true,
    mergeSha: '97527b791fc37acce41f4f46fd88699dce054b66',
    headRefName: manifest.branch,
    title: `feat(ops): ${manifest.issue_id} implementation`,
    files: [
      `docs/06_status/lanes/${manifest.issue_id}.json`,
      ...manifest.expected_proof_paths,
      'scripts/ops/lane-close.ts',
    ],
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

    const authorizedTruthCheck = createTruthCheckResult({
      issue_id: issueId,
      checked_at: '2026-07-19T16:33:59.885Z',
      merge_sha: 'c17e1f64e2ae20d7df80e2d4c030c99c6e01bcc6',
    });
    const finalized = finalizeLaneCloseManifest(issueId, authorizedTruthCheck);

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

test('finalizeLaneCloseManifest refuses to close when the manifest truth-check advanced past the authorized result', () => {
  // Regression for the PM-flagged Codex P2 on UTV2-1553/PR #1261: a concurrent
  // truth-check run landing between runTruthCheck() returning a passing result
  // and finalizeLaneCloseManifest() reading the manifest must not be silently
  // overwritten by an unconditional status:'done' write. If the manifest's
  // latest history entry no longer matches the result that authorized this
  // close (different timestamp, different merge_sha, or a later fail), closing
  // must be refused rather than certifying a close nobody actually authorized.
  const issueId = 'UTV2-9999998';
  const manifestPath = path.join(MANIFEST_DIR, `${issueId}.json`);
  try {
    const authorizedTruthCheck = createTruthCheckResult({
      issue_id: issueId,
      checked_at: '2026-07-19T16:33:59.885Z',
      merge_sha: 'c17e1f64e2ae20d7df80e2d4c030c99c6e01bcc6',
    });

    // The manifest this authorization was based on.
    const beforeConcurrentRun = createManifest({
      issue_id: issueId,
      status: 'merged',
      truth_check_history: [
        {
          checked_at: authorizedTruthCheck.checked_at,
          verdict: 'pass',
          merge_sha: authorizedTruthCheck.merge_sha,
          failures: [],
          runner: 'ops:lane-close',
        },
      ],
    });
    writeManifest(beforeConcurrentRun);

    // A second truth-check run lands after authorization but before
    // finalization -- and this one fails.
    const afterConcurrentRun = readManifest(issueId);
    afterConcurrentRun.truth_check_history = [
      ...afterConcurrentRun.truth_check_history,
      {
        checked_at: '2026-07-19T16:40:00.000Z',
        verdict: 'fail',
        merge_sha: authorizedTruthCheck.merge_sha,
        failures: ['L3'],
        runner: 'ops:lane-close',
      },
    ];
    writeManifest(afterConcurrentRun);

    assert.throws(
      () => finalizeLaneCloseManifest(issueId, authorizedTruthCheck),
      (error) => error instanceof TruthCheckDriftError,
    );

    // The manifest must remain exactly as the concurrent run left it -- not done.
    const onDisk = readManifest(issueId);
    assert.strictEqual(onDisk.status, 'merged');
    assert.strictEqual(onDisk.truth_check_history.length, 2);
    assert.strictEqual(onDisk.truth_check_history[1].verdict, 'fail');
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

test('UTV2-1690: a genuine lease-release failure is raised, not downgraded to a warning', () => {
  withTempCloseoutState(({ leaseRegistryDir, mergeLockPath }) => {
    const issueId = 'UTV2-1002';
    const branch = 'codex/utv2-1002-terminal-release';
    // A corrupt lease is NOT the idempotent "already released" case: it must
    // surface, or a lane closes while still holding capacity.
    fs.mkdirSync(leaseRegistryDir, { recursive: true });
    fs.writeFileSync(
      path.join(leaseRegistryDir, `${issueId}.json`),
      JSON.stringify({ issue_id: issueId, status: 'active' }),
    );
    assert.throws(
      () => releaseCloseoutLocks(issueId, branch, { leaseRegistryDir, mergeLockPath }),
      /Failed to release dispatch lease/,
    );
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

test('UTV2-1589 trusted done-lane replay validates PR and performs idempotent cleanup without rewriting terminal truth', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1589-terminal-cleanup-'));
  const mergeSha = '8f4a4dba64c49b68aa3fbd8135be5d4f42996bd5';
  const manifest = createManifest({
    issue_id: 'UTV2-1589',
    status: 'done',
    branch: 'codex/utv2-1589-proof-sha-binding',
    pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1308',
    commit_sha: mergeSha,
    closed_at: '2026-07-26T01:00:00.000Z',
    expected_proof_paths: [
      'docs/06_status/proof/UTV2-1589/evidence.json',
      'docs/06_status/proof/UTV2-1589/model-routing.json',
    ],
    file_scope_lock: ['scripts/ops/lane-close.ts'],
    truth_check_history: [{
      checked_at: '2026-07-26T00:59:00.000Z',
      verdict: 'pass',
      merge_sha: mergeSha,
      failures: [],
      runner: 'ops:lane-close',
    }],
  });
  const pr = createTrustedRepairPr(manifest, {
    url: manifest.pr_url ?? '',
    number: 1308,
    mergeSha,
    headRefName: manifest.branch,
    title: `feat(ops): ${manifest.issue_id} proof SHA binding`,
    files: [
      `docs/06_status/lanes/${manifest.issue_id}.json`,
      ...manifest.expected_proof_paths,
      'scripts/ops/lane-close.ts',
    ],
  });
  const syncPath = path.join(repoRoot, '.ops', 'sync', `${manifest.issue_id}.yml`);
  fs.mkdirSync(path.dirname(syncPath), { recursive: true });
  fs.writeFileSync(syncPath, 'entities:\n  issues: [UTV2-1589]\n');
  const before = structuredClone(manifest);
  const cleanupCalls: string[] = [];
  let cleanupCount = 0;

  try {
    const validation = validateTrustedPostMergeRepair(manifest, '#1308', {
      repairMerged: true,
      trustedPostMerge: true,
      fetchPr: () => pr,
      isMergeReachable: () => true,
    });
    assert.strictEqual(validation.ok, true);

    const repair = repairMergedLaneManifest(manifest, {
      validatedPr: validation.pr ?? undefined,
    });
    assert.strictEqual(repair.code, 'already_closed');

    const cleanupOptions = {
      repoRoot,
      releaseLocks: (issueId: string, branch: string) => {
        cleanupCalls.push(`locks:${issueId}:${branch}`);
        return { warnings: [] };
      },
      cleanupWorktree: () => {
        cleanupCount += 1;
        cleanupCalls.push('worktree');
        return cleanupCount === 1 ? 'removed' as const : 'already_absent' as const;
      },
    };
    const first = completeAlreadyClosedLaneCleanup(manifest, cleanupOptions);
    const second = completeAlreadyClosedLaneCleanup(manifest, cleanupOptions);

    assert.deepStrictEqual(manifest, before);
    assert.strictEqual(first.manifest, manifest);
    assert.strictEqual(first.sync_removed, true);
    assert.strictEqual(first.worktree_cleanup, 'removed');
    assert.strictEqual(second.sync_removed, false);
    assert.strictEqual(second.worktree_cleanup, 'already_absent');
    assert.strictEqual(fs.existsSync(syncPath), false);
    assert.deepStrictEqual(cleanupCalls, [
      `locks:${manifest.issue_id}:${manifest.branch}`,
      'worktree',
      `locks:${manifest.issue_id}:${manifest.branch}`,
      'worktree',
    ]);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('UTV2-1564: repair merged lane is a true no-op when the manifest already reflects the PR\'s authoritative state', () => {
  withTempRepairState(({ repoRoot, artifactRoot }) => {
    const manifest = createManifest({
      status: 'merged',
      commit_sha: 'authoritative-sha',
      pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1001',
      preflight_token: 'dispatch-auto',
      truth_check_history: [],
    });

    const result = repairMergedLaneManifest(manifest, {
      repoRoot,
      artifactRoot,
      now: new Date('2026-05-26T04:00:00.000Z'),
      fetchPr: () => ({
        url: 'https://github.com/griff843/Unit-Talk-v2/pull/1001',
        state: 'merged',
        merged: true,
        mergeSha: 'authoritative-sha',
      }),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'already_repaired');
    assert.strictEqual(result.outcome, 'already_repaired');
    assert.strictEqual(result.manifest, manifest);
    assert.deepStrictEqual(result.changed_fields, []);
    assert.deepStrictEqual(result.manifest.truth_check_history, []);
    assert.strictEqual(result.artifact_path, null);

    // The main-checkout repair guard must treat this exactly like
    // "nothing to repair" -- never block a genuine no-op re-run.
    const guard = guardRepairAgainstMainCheckout(result, { currentBranch: 'main', repoRoot });
    assert.strictEqual(guard, null);
  });
});

test('UTV2-1564: a second --repair-merged call against an already-correctly-repaired manifest does not grow truth_check_history', () => {
  withTempRepairState(({ repoRoot, artifactRoot, tokenPath }) => {
    const staleManifest = createManifest({
      status: 'merged',
      commit_sha: 'stale-sha',
      preflight_token: tokenPath,
      truth_check_history: [],
    });
    const fetchPr = () => ({
      url: 'https://github.com/griff843/Unit-Talk-v2/pull/1001',
      state: 'merged',
      merged: true,
      mergeSha: 'authoritative-sha',
    });

    const firstRun = repairMergedLaneManifest(staleManifest, {
      repoRoot,
      artifactRoot,
      now: new Date('2026-05-26T04:00:00.000Z'),
      fetchPr,
    });
    assert.strictEqual(firstRun.code, 'repaired');
    // UTV2-1613: this assertion used to be `.length === 1` -- the one entry
    // being the synthesized `verdict: 'pass'` record that no truth-check had
    // produced. Repair now writes NO history at all; only a real
    // runTruthCheck() run may append.
    assert.strictEqual(firstRun.manifest.truth_check_history.length, 0);

    // Simulates the CI auto-closer (post-merge-lane-close.yml) re-triggering
    // --repair-merged against the manifest the first run just wrote --
    // exactly the scenario that permanently tripped
    // guardRepairAgainstMainCheckout before this fix.
    const secondRun = repairMergedLaneManifest(firstRun.manifest, {
      repoRoot,
      artifactRoot,
      now: new Date('2026-05-26T05:00:00.000Z'),
      fetchPr,
    });

    assert.strictEqual(secondRun.code, 'already_repaired');
    assert.strictEqual(secondRun.manifest.truth_check_history.length, 0);
    assert.deepStrictEqual(secondRun.manifest.truth_check_history, firstRun.manifest.truth_check_history);
    assert.deepStrictEqual(secondRun.changed_fields, []);
  });
});

test('repair mode rebinds proof from the repair PR SHA to the implementation PR merge SHA', () => {
  withTempRepairState(({ repoRoot }) => {
    const proofDir = path.join(repoRoot, 'docs', '06_status', 'proof', 'UTV2-1001');
    fs.mkdirSync(proofDir, { recursive: true });
    fs.writeFileSync(
      path.join(proofDir, 'evidence.json'),
      `${JSON.stringify({
        status: 'merged',
        sha_binding: {
          verified_source_sha: 'repair-pr-merge-sha',
          sha_type: 'merge_sha',
          bound_at: '2026-05-26T03:00:00.000Z',
        },
      }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(proofDir, 'verification.md'),
      [
        '| Commit SHA(s) | `repair-pr-merge-sha` (merge SHA) |',
        '',
        '## Merge SHA Binding',
        '',
        'Merge SHA: `repair-pr-merge-sha`',
        'PR: https://github.com/griff843/Unit-Talk-v2/pull/1296',
        '',
      ].join('\n'),
    );

    const outcomes = rebindRepairedLaneProof(
      createManifest({
        commit_sha: 'implementation-pr-merge-sha',
        pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1291',
      }),
      { repoRoot, now: new Date('2026-05-26T04:00:00.000Z') },
    );

    assert.deepStrictEqual(outcomes.map((outcome) => outcome.status), ['updated', 'updated']);
    const evidence = fs.readFileSync(path.join(proofDir, 'evidence.json'), 'utf8');
    const verification = fs.readFileSync(path.join(proofDir, 'verification.md'), 'utf8');
    assert.match(evidence, /implementation-pr-merge-sha/);
    assert.doesNotMatch(evidence, /repair-pr-merge-sha/);
    assert.match(verification, /implementation-pr-merge-sha/);
    assert.match(verification, /pull\/1291/);
    assert.doesNotMatch(verification, /repair-pr-merge-sha|pull\/1296/);
  });
});

// ── UTV2-1589: model-routing sidecar rebind through the actual repair path ───

function preMergeModelRoutingJson(overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify(
    {
      issue_id: 'UTV2-1001',
      model_profile: 'codex-sol-high',
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
      policy_version: '1.0.0',
      generated_at: '2026-05-25T10:00:00.000Z',
      ...overrides,
    },
    null,
    2,
  )}\n`;
}

function writeModelRoutingFixture(
  repoRoot: string,
  issueId: string,
  content: string,
): string {
  const proofDir = path.join(repoRoot, 'docs', '06_status', 'proof', issueId);
  fs.mkdirSync(proofDir, { recursive: true });
  const routingPath = path.join(proofDir, 'model-routing.json');
  fs.writeFileSync(routingPath, content);
  return routingPath;
}

test('rebindRepairedLaneProof binds a declared model-routing.json sidecar in addition to evidence/verification', () => {
  withTempRepairState(({ repoRoot }) => {
    const routingPath = writeModelRoutingFixture(repoRoot, 'UTV2-1001', preMergeModelRoutingJson());
    const proofDir = path.dirname(routingPath);
    fs.writeFileSync(
      path.join(proofDir, 'evidence.json'),
      `${JSON.stringify({
        status: 'merged',
        sha_binding: { verified_source_sha: 'stale', sha_type: 'merge_sha', bound_at: '2026-07-01T00:00:00.000Z' },
      }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(proofDir, 'verification.md'),
      ['| Commit SHA(s) | `stale` (merge SHA) |', '', '## Merge SHA Binding', '', 'Merge SHA: `stale`', 'PR: N/A', ''].join('\n'),
    );

    const outcomes = rebindRepairedLaneProof(
      createManifest({
        commit_sha: '97527b791fc37acce41f4f46fd88699dce054b66',
        pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1305',
        expected_proof_paths: ['docs/06_status/proof/UTV2-1001/model-routing.json'],
      }),
      { repoRoot, now: new Date('2026-07-25T12:00:00.000Z') },
    );

    assert.deepStrictEqual(outcomes.map((outcome) => outcome.status), ['updated', 'updated', 'updated']);
    const routing = JSON.parse(fs.readFileSync(routingPath, 'utf8'));
    assert.deepStrictEqual(routing.closeout_binding, {
      sha_type: 'merge_sha',
      merge_sha: '97527b791fc37acce41f4f46fd88699dce054b66',
      pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1305',
      bound_at: '2026-07-25T12:00:00.000Z',
    });
    assert.strictEqual(routing.model, 'gpt-5.6-sol', 'pre-merge execution provenance is preserved');
  });
});

for (const fixture of [
  {
    issueId: 'UTV2-1585',
    prUrl: 'https://github.com/griff843/Unit-Talk-v2/pull/1305',
    mergeSha: '97527b791fc37acce41f4f46fd88699dce054b66',
  },
  {
    issueId: 'UTV2-1586',
    prUrl: 'https://github.com/griff843/Unit-Talk-v2/pull/1306',
    mergeSha: 'fe09f637a7eeebf216e062dd4a003d7e38932d1a',
  },
]) {
  test(`rebindRepairedLaneProof binds the real ${fixture.issueId}/${fixture.prUrl.split('/').pop()} trusted-repair fixture to its authoritative merge SHA`, () => {
    withTempRepairState(({ repoRoot }) => {
      // Real committed sidecar, not a synthesized stand-in, so this proves
      // the actual historical record survives the new manifest-agreement
      // validation through the real repair path (UTV2-1589 PM directive).
      const realSidecarContent = fs.readFileSync(
        path.join(process.cwd(), 'docs/06_status/proof', fixture.issueId, 'model-routing.json'),
        'utf8',
      );
      const routingPath = writeModelRoutingFixture(repoRoot, fixture.issueId, realSidecarContent);
      // Read the REAL lane manifest's own model_routing block too -- not
      // derived from the sidecar just read, which would make this
      // comparison tautological and unable to catch a future drift between
      // the two real, independently-authored files (independent review
      // finding on the first version of this fixture).
      const realManifest = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'docs/06_status/lanes', `${fixture.issueId}.json`), 'utf8'),
      ) as LaneManifest;
      assert.ok(realManifest.model_routing, `${fixture.issueId} manifest must declare model_routing`);

      const manifest = createManifest({
        issue_id: fixture.issueId,
        commit_sha: fixture.mergeSha,
        pr_url: fixture.prUrl,
        expected_proof_paths: [`docs/06_status/proof/${fixture.issueId}/model-routing.json`],
        model_routing: realManifest.model_routing,
      });

      rebindRepairedLaneProof(manifest, { repoRoot, now: new Date('2026-07-25T12:00:00.000Z') });

      const routing = JSON.parse(fs.readFileSync(routingPath, 'utf8'));
      assert.strictEqual(routing.closeout_binding.merge_sha, fixture.mergeSha);
      assert.strictEqual(routing.closeout_binding.pr_url, fixture.prUrl);

      // Same PR/SHA replayed through the identical repair path is an idempotent no-op.
      const replay = rebindRepairedLaneProof(manifest, {
        repoRoot,
        now: new Date('2026-07-25T13:00:00.000Z'),
      });
      assert.ok(replay.some((outcome) => outcome.status === 'unchanged'));
      const afterReplay = JSON.parse(fs.readFileSync(routingPath, 'utf8'));
      assert.deepStrictEqual(afterReplay.closeout_binding, routing.closeout_binding);
    });
  });
}

test('rebindRepairedLaneProof through the real repair path satisfies the C4 closeout gate, and the bound sidecar satisfies P3', () => {
  withTempRepairState(({ repoRoot }) => {
    const mergeSha = 'fe09f637a7eeebf216e062dd4a003d7e38932d1a';
    const prUrl = 'https://github.com/griff843/Unit-Talk-v2/pull/1306';
    const routingPath = writeModelRoutingFixture(
      repoRoot,
      'UTV2-1586',
      preMergeModelRoutingJson({ issue_id: 'UTV2-1586' }),
    );
    const expectedProofPaths = ['docs/06_status/proof/UTV2-1586/model-routing.json'];

    const preRebind = fs.readFileSync(routingPath, 'utf8');
    const c4Before = evaluateCloseoutTruthGate({
      manifest: {
        issue_id: 'UTV2-1586',
        status: 'merged',
        commit_sha: mergeSha,
        pr_url: prUrl,
        files_changed: [],
        expected_proof_paths: expectedProofPaths,
        created_by: 'codex-cli',
      },
      linear_state: 'Done',
      pr_merged: true,
      pr_merge_sha: mergeSha,
      pr_head_sha: 'head456',
      proof_artifacts: [{ path: routingPath, content: preRebind, mtime_ms: 2000 }],
      merge_timestamp_ms: 1000,
      runtime_proof_required: false,
      transition_age_ms: 0,
    }).filter((check) => check.status === 'fail').map((check) => check.id);
    assert.deepStrictEqual(c4Before, ['C4']);

    rebindRepairedLaneProof(
      createManifest({
        issue_id: 'UTV2-1586',
        commit_sha: mergeSha,
        pr_url: prUrl,
        expected_proof_paths: expectedProofPaths,
      }),
      { repoRoot, now: new Date('2026-07-25T00:00:00.000Z') },
    );

    const postRebind = fs.readFileSync(routingPath, 'utf8');
    // P3 (scripts/ops/truth-check-lib.ts) considers a proof file stale unless its
    // content includes the literal merge SHA or a `merge_sha: <sha>` reference --
    // this is the exact predicate P3 applies, evaluated directly against what the
    // real repair path wrote (P3 itself reads from ROOT-relative paths only, so it
    // is not separately invokable in a temp-root unit test).
    const p3Passes = postRebind.includes(mergeSha) || new RegExp(`merge_sha:\\s*${mergeSha}`, 'i').test(postRebind);
    assert.strictEqual(p3Passes, true);

    const c4After = evaluateCloseoutTruthGate({
      manifest: {
        issue_id: 'UTV2-1586',
        status: 'merged',
        commit_sha: mergeSha,
        pr_url: prUrl,
        files_changed: [],
        expected_proof_paths: expectedProofPaths,
        created_by: 'codex-cli',
      },
      linear_state: 'Done',
      pr_merged: true,
      pr_merge_sha: mergeSha,
      pr_head_sha: 'head456',
      proof_artifacts: [{ path: routingPath, content: postRebind, mtime_ms: 2000 }],
      merge_timestamp_ms: 1000,
      runtime_proof_required: false,
      transition_age_ms: 0,
    }).filter((check) => check.status === 'fail').map((check) => check.id);
    assert.deepStrictEqual(c4After, []);
  });
});

test('rebindRepairedLaneProof fails closed on a conflicting prior PR binding and mutates nothing', () => {
  withTempRepairState(({ repoRoot }) => {
    const routingPath = writeModelRoutingFixture(
      repoRoot,
      'UTV2-1001',
      preMergeModelRoutingJson({
        closeout_binding: {
          sha_type: 'merge_sha',
          merge_sha: '97527b791fc37acce41f4f46fd88699dce054b66',
          pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1305',
          bound_at: '2026-07-24T00:00:00.000Z',
        },
      }),
    );
    const evidencePath = path.join(repoRoot, 'docs', '06_status', 'proof', 'UTV2-1001', 'evidence.json');
    fs.writeFileSync(evidencePath, `${JSON.stringify({
      status: 'merged',
      sha_binding: { verified_source_sha: 'stale', sha_type: 'merge_sha', bound_at: '2026-07-01T00:00:00.000Z' },
    }, null, 2)}\n`);
    const routingBefore = fs.readFileSync(routingPath, 'utf8');
    const evidenceBefore = fs.readFileSync(evidencePath, 'utf8');

    assert.throws(
      () => rebindRepairedLaneProof(
        createManifest({
          commit_sha: 'different-merge-sha',
          pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1305',
          expected_proof_paths: ['docs/06_status/proof/UTV2-1001/model-routing.json'],
        }),
        { repoRoot },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'binding_conflict',
    );

    assert.strictEqual(fs.readFileSync(routingPath, 'utf8'), routingBefore, 'conflicting sidecar is never mutated');
    assert.strictEqual(fs.readFileSync(evidencePath, 'utf8'), evidenceBefore, 'evidence.json is never written when validation fails first');
  });
});

test('rebindRepairedLaneProof fails closed on a conflicting prior SHA binding for the same PR', () => {
  withTempRepairState(({ repoRoot }) => {
    writeModelRoutingFixture(
      repoRoot,
      'UTV2-1001',
      preMergeModelRoutingJson({
        closeout_binding: {
          sha_type: 'merge_sha',
          merge_sha: 'sha-a',
          pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1305',
          bound_at: '2026-07-24T00:00:00.000Z',
        },
      }),
    );

    assert.throws(
      () => rebindRepairedLaneProof(
        createManifest({
          commit_sha: 'sha-b',
          pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1305',
          expected_proof_paths: ['docs/06_status/proof/UTV2-1001/model-routing.json'],
        }),
        { repoRoot },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'binding_conflict',
    );
  });
});

test('rebindRepairedLaneProof fails closed on invalid JSON in a required sidecar', () => {
  withTempRepairState(({ repoRoot }) => {
    writeModelRoutingFixture(repoRoot, 'UTV2-1001', '{ not valid json');

    assert.throws(
      () => rebindRepairedLaneProof(
        createManifest({
          commit_sha: '97527b791fc37acce41f4f46fd88699dce054b66',
          pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1305',
          expected_proof_paths: ['docs/06_status/proof/UTV2-1001/model-routing.json'],
        }),
        { repoRoot },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'malformed_required_sidecar',
    );
  });
});

test('rebindRepairedLaneProof fails closed on a required sidecar whose issue_id belongs to another lane', () => {
  withTempRepairState(({ repoRoot }) => {
    writeModelRoutingFixture(
      repoRoot,
      'UTV2-1001',
      preMergeModelRoutingJson({ issue_id: 'UTV2-9999' }),
    );

    assert.throws(
      () => rebindRepairedLaneProof(
        createManifest({
          commit_sha: '97527b791fc37acce41f4f46fd88699dce054b66',
          pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1305',
          expected_proof_paths: ['docs/06_status/proof/UTV2-1001/model-routing.json'],
        }),
        { repoRoot },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'sidecar_identity_mismatch',
    );
  });
});

test('rebindRepairedLaneProof fails closed on an identity-less sidecar (e.g. {})', () => {
  withTempRepairState(({ repoRoot }) => {
    writeModelRoutingFixture(repoRoot, 'UTV2-1001', '{}\n');

    assert.throws(
      () => rebindRepairedLaneProof(
        createManifest({
          commit_sha: '97527b791fc37acce41f4f46fd88699dce054b66',
          pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1305',
          expected_proof_paths: ['docs/06_status/proof/UTV2-1001/model-routing.json'],
        }),
        { repoRoot },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'sidecar_identity_mismatch',
    );
  });
});

test('rebindRepairedLaneProof fails closed when a required model-routing.json sidecar is missing from disk', () => {
  withTempRepairState(({ repoRoot }) => {
    assert.throws(
      () => rebindRepairedLaneProof(
        createManifest({
          commit_sha: '97527b791fc37acce41f4f46fd88699dce054b66',
          pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1305',
          expected_proof_paths: ['docs/06_status/proof/UTV2-1001/model-routing.json'],
        }),
        { repoRoot },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'missing_required_sidecar',
    );
  });
});

test('rebindRepairedLaneProof refuses a declared model-routing.json path that escapes the repo root', () => {
  withTempRepairState(({ repoRoot }) => {
    assert.throws(
      () => rebindRepairedLaneProof(
        createManifest({
          commit_sha: '97527b791fc37acce41f4f46fd88699dce054b66',
          pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1305',
          expected_proof_paths: ['../../../../tmp/escaped/model-routing.json'],
        }),
        { repoRoot },
      ),
      /escapes repo root/,
    );
  });
});

test('rebindRepairedLaneProof is unaffected for a lane with no required model-routing sidecar (ordinary closeout behavior unchanged)', () => {
  withTempRepairState(({ repoRoot }) => {
    const proofDir = path.join(repoRoot, 'docs', '06_status', 'proof', 'UTV2-1001');
    fs.mkdirSync(proofDir, { recursive: true });
    fs.writeFileSync(
      path.join(proofDir, 'evidence.json'),
      `${JSON.stringify({
        status: 'merged',
        sha_binding: { verified_source_sha: 'stale', sha_type: 'merge_sha', bound_at: '2026-07-01T00:00:00.000Z' },
      }, null, 2)}\n`,
    );

    const outcomes = rebindRepairedLaneProof(
      createManifest({
        commit_sha: 'ordinary-merge-sha',
        pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1400',
        expected_proof_paths: [],
      }),
      { repoRoot },
    );

    // verification.md was never created for this lane -- rebindMergeSha() reports
    // it 'missing' (not an error) exactly as it did before this change; only
    // evidence.json exists and is rebound. No model-routing outcome is present at
    // all since expected_proof_paths declares no such sidecar.
    assert.deepStrictEqual(outcomes.map((outcome) => outcome.status), ['updated', 'missing']);
    const evidence = JSON.parse(fs.readFileSync(path.join(proofDir, 'evidence.json'), 'utf8'));
    assert.strictEqual(evidence.sha_binding.verified_source_sha, 'ordinary-merge-sha');
  });
});

test('a failed model-routing rebind rolls back the manifest and every proof file through the existing repair transaction', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1589-rollback-'));
  const issueId = 'UTV2-1001';
  const manifestPath = path.join(repoRoot, 'docs', '06_status', 'lanes', `${issueId}.json`);
  const evidencePath = path.join(repoRoot, 'docs', '06_status', 'proof', issueId, 'evidence.json');
  const routingPath = path.join(repoRoot, 'docs', '06_status', 'proof', issueId, 'model-routing.json');
  try {
    const original = createManifest({
      issue_id: issueId,
      status: 'merged',
      commit_sha: 'pre-repair-sha',
      pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1200',
      expected_proof_paths: [`docs/06_status/proof/${issueId}/model-routing.json`],
    });
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(original, null, 2)}\n`);
    fs.writeFileSync(evidencePath, '{"sha":"pre-repair"}\n');
    // A sidecar already bound to a DIFFERENT PR than the one this repair will
    // attempt -- rebindRepairedLaneProof must throw binding_conflict.
    fs.writeFileSync(
      routingPath,
      preMergeModelRoutingJson({
        issue_id: issueId,
        closeout_binding: {
          sha_type: 'merge_sha',
          merge_sha: 'conflicting-sha',
          pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/9999',
          bound_at: '2026-07-20T00:00:00.000Z',
        },
      }),
    );

    const transaction = createRepairRollbackTransaction(issueId, repoRoot);

    // Simulate what main() does on the repair path: write the repaired manifest,
    // then attempt the proof rebind, which fails.
    const repairedManifest = {
      ...original,
      pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1305',
      commit_sha: '97527b791fc37acce41f4f46fd88699dce054b66',
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(repairedManifest, null, 2)}\n`);

    let threw = false;
    try {
      rebindRepairedLaneProof(repairedManifest, { repoRoot });
    } catch (error) {
      threw = true;
      assert.ok(error instanceof ModelRoutingRebindError);
      assert.strictEqual(error.code, 'binding_conflict');
    }
    assert.strictEqual(threw, true);
    transaction.rollback();

    const restoredManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LaneManifest;
    assert.strictEqual(restoredManifest.commit_sha, 'pre-repair-sha');
    assert.strictEqual(restoredManifest.pr_url, 'https://github.com/griff843/Unit-Talk-v2/pull/1200');
    assert.strictEqual(fs.readFileSync(evidencePath, 'utf8'), '{"sha":"pre-repair"}\n');
    assert.ok(
      JSON.parse(fs.readFileSync(routingPath, 'utf8')).closeout_binding.pr_url.endsWith('/9999'),
      'model-routing.json is restored to its pre-repair conflicting-binding state, not left partially rebound',
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('a sidecar/manifest routing mismatch through the real repair path rolls back manifest, evidence, verification, sidecar, and sync/lease/merge-lock state', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1589-routing-mismatch-rollback-'));
  const issueId = 'UTV2-1001';
  const manifestPath = path.join(repoRoot, 'docs', '06_status', 'lanes', `${issueId}.json`);
  const proofDir = path.join(repoRoot, 'docs', '06_status', 'proof', issueId);
  const evidencePath = path.join(proofDir, 'evidence.json');
  const verificationPath = path.join(proofDir, 'verification.md');
  const routingPath = path.join(proofDir, 'model-routing.json');
  const syncPath = path.join(repoRoot, '.ops', 'sync', `${issueId}.yml`);
  const leasePath = path.join(repoRoot, '.ops', 'leases', `${issueId}.json`);
  const mergeLockPath = path.join(repoRoot, '.ops', 'merge-lock.json');
  try {
    const original = createManifest({
      issue_id: issueId,
      status: 'merged',
      commit_sha: 'pre-repair-sha',
      pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1200',
      expected_proof_paths: [`docs/06_status/proof/${issueId}/model-routing.json`],
      model_routing: {
        profile: 'codex-sol-high',
        model: 'gpt-5.6-sol',
        reasoning_effort: 'high',
        selected_by: 'three-brain',
        policy_version: '1.0.0',
      },
    });
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.mkdirSync(proofDir, { recursive: true });
    fs.mkdirSync(path.dirname(syncPath), { recursive: true });
    fs.mkdirSync(path.dirname(leasePath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(original, null, 2)}\n`);
    fs.writeFileSync(evidencePath, '{"sha":"pre-repair"}\n');
    fs.writeFileSync(verificationPath, '| Commit SHA(s) | `pre-repair` (merge SHA) |\n');
    fs.writeFileSync(syncPath, 'entities:\n  issues: [UTV2-1001]\n');
    fs.writeFileSync(leasePath, '{"status":"active"}\n');
    fs.writeFileSync(mergeLockPath, '{"status":"held"}\n');
    // The sidecar carries a DIFFERENT model than the lane manifest's own
    // model_routing.model -- a mismatch that must fail closed before any
    // proof write, distinct from the binding_conflict case above.
    fs.writeFileSync(
      routingPath,
      preMergeModelRoutingJson({ issue_id: issueId, model: 'claude-sonnet-5' }),
    );

    const transaction = createRepairRollbackTransaction(issueId, repoRoot);

    const repairedManifest = {
      ...original,
      pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1305',
      commit_sha: '97527b791fc37acce41f4f46fd88699dce054b66',
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(repairedManifest, null, 2)}\n`);
    fs.rmSync(syncPath);
    fs.writeFileSync(leasePath, '{"status":"released"}\n');
    fs.writeFileSync(mergeLockPath, '{"status":"released"}\n');

    let threw = false;
    try {
      rebindRepairedLaneProof(repairedManifest, { repoRoot });
    } catch (error) {
      threw = true;
      assert.ok(error instanceof ModelRoutingRebindError);
      assert.strictEqual(error.code, 'sidecar_manifest_routing_mismatch');
    }
    assert.strictEqual(threw, true);
    transaction.rollback();

    const restoredManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LaneManifest;
    assert.strictEqual(restoredManifest.commit_sha, 'pre-repair-sha');
    assert.strictEqual(restoredManifest.pr_url, 'https://github.com/griff843/Unit-Talk-v2/pull/1200');
    assert.strictEqual(fs.readFileSync(evidencePath, 'utf8'), '{"sha":"pre-repair"}\n');
    assert.strictEqual(
      fs.readFileSync(verificationPath, 'utf8'),
      '| Commit SHA(s) | `pre-repair` (merge SHA) |\n',
    );
    assert.strictEqual(
      JSON.parse(fs.readFileSync(routingPath, 'utf8')).model,
      'claude-sonnet-5',
      'model-routing.json is restored to its pre-repair (mismatched, unbound) content, not left partially rebound',
    );
    assert.strictEqual(fs.readFileSync(syncPath, 'utf8'), 'entities:\n  issues: [UTV2-1001]\n');
    assert.strictEqual(fs.readFileSync(leasePath, 'utf8'), '{"status":"active"}\n');
    assert.strictEqual(fs.readFileSync(mergeLockPath, 'utf8'), '{"status":"held"}\n');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
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
  'untrusted_invocation',
  'explicit_pr_requires_repair',
  'pr_not_found',
  'wrong_repository',
  'issue_identity_mismatch',
  'pr_base_mismatch',
  'conflicting_pr_binding',
  'repair_pr_substitution',
  'missing_implementation_artifacts',
  'unreachable_merge_sha',
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

  assert.match(workflow, /close_args=\("\$ISSUE_ID" --repair-merged --explain --post-merge-trusted\)/);
  assert.match(workflow, /pnpm ops:lane-close "\$\{close_args\[@\]\}"/);
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
    // UTV2-1613: the packet is now a schema-v2 repair packet rather than a bare
    // manifest dump, so the repaired content lives under proposed_manifest and
    // is accompanied by the hashes and the explicit truth-check receipt.
    const packetContent = JSON.parse(fs.readFileSync(packetAbsolutePath, 'utf8')) as {
      schema_version?: number;
      proposed_manifest?: { commit_sha?: string };
      truth_check?: { executed?: boolean; verdict?: unknown };
      input_manifest_hash?: string;
      candidate_manifest_hash?: string;
    };
    assert.strictEqual(packetContent.schema_version, 2);
    assert.strictEqual(
      packetContent.proposed_manifest?.commit_sha,
      'fd3f50d7c95e26e353f3857ec2684d1ff8ad99f7',
    );
    // Reaching this guard means the close was blocked before any truth-check
    // ran, so the packet must say exactly that and claim no verdict.
    assert.strictEqual(packetContent.truth_check?.executed, false);
    assert.strictEqual(packetContent.truth_check?.verdict, null);
    assert.match(packetContent.input_manifest_hash ?? '', /^sha256:[0-9a-f]{64}$/);
    assert.match(packetContent.candidate_manifest_hash ?? '', /^sha256:[0-9a-f]{64}$/);
    assert.notStrictEqual(packetContent.input_manifest_hash, packetContent.candidate_manifest_hash);
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

// ── UTV2-1576: trusted post-merge automation capability ──
// PR #1296 workflow run 30002061214 proved guardRepairAgainstMainCheckout blocks
// post-merge-lane-close.yml itself: actions/checkout@v4 on a `push` trigger
// leaves a real local branch named `main` (not detached HEAD), so the workflow
// this guard exists to let operate safely on `main` was always caught by it too.
// isTrustedPostMergeAutomation() is the narrow, multi-invariant exception: every
// GitHub-set marker for that exact workflow file/repo/ref PLUS an explicit CLI
// flag must all agree, or the guard still blocks as before.

const TRUSTED_POST_MERGE_ENV = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'griff843/Unit-Talk-v2',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKFLOW_REF: 'griff843/Unit-Talk-v2/.github/workflows/post-merge-lane-close.yml@refs/heads/main',
};

test('isTrustedPostMergeAutomation is true only for the exact trusted context plus the explicit flag', () => {
  assert.strictEqual(
    isTrustedPostMergeAutomation(TRUSTED_POST_MERGE_ENV, { postMergeTrusted: true }),
    true,
  );
});

test('isTrustedPostMergeAutomation is false for a local shell with no GitHub Actions env at all, even with the flag', () => {
  assert.strictEqual(isTrustedPostMergeAutomation({}, { postMergeTrusted: true }), false);
});

test('isTrustedPostMergeAutomation is false for ordinary GitHub Actions automation (a different workflow) even on main with the flag', () => {
  assert.strictEqual(
    isTrustedPostMergeAutomation(
      { ...TRUSTED_POST_MERGE_ENV, GITHUB_WORKFLOW_REF: 'griff843/Unit-Talk-v2/.github/workflows/merge-gate.yml@refs/heads/main' },
      { postMergeTrusted: true },
    ),
    false,
  );
});

test('isTrustedPostMergeAutomation is false for the exact trusted context when the explicit CLI flag is missing', () => {
  assert.strictEqual(
    isTrustedPostMergeAutomation(TRUSTED_POST_MERGE_ENV, { postMergeTrusted: false }),
    false,
  );
});

test('isTrustedPostMergeAutomation is false when the flag is passed but GITHUB_ACTIONS is unset (a forged/incomplete context)', () => {
  const { GITHUB_ACTIONS: _omit, ...rest } = TRUSTED_POST_MERGE_ENV;
  assert.strictEqual(isTrustedPostMergeAutomation(rest, { postMergeTrusted: true }), false);
});

test('isTrustedPostMergeAutomation is false for the trusted workflow running on a non-main ref (e.g. a PR branch)', () => {
  assert.strictEqual(
    isTrustedPostMergeAutomation(
      {
        ...TRUSTED_POST_MERGE_ENV,
        GITHUB_REF: 'refs/heads/codex/utv2-1576-governance-capacity-recovery',
        GITHUB_WORKFLOW_REF:
          'griff843/Unit-Talk-v2/.github/workflows/post-merge-lane-close.yml@refs/heads/codex/utv2-1576-governance-capacity-recovery',
      },
      { postMergeTrusted: true },
    ),
    false,
  );
});

test('isTrustedPostMergeAutomation is false for a fork or renamed repo presenting an otherwise-identical context', () => {
  assert.strictEqual(
    isTrustedPostMergeAutomation(
      { ...TRUSTED_POST_MERGE_ENV, GITHUB_REPOSITORY: 'someone-else/Unit-Talk-v2' },
      { postMergeTrusted: true },
    ),
    false,
  );
});

test('guard still blocks a plain main checkout with no trustedPostMerge option at all (pre-UTV2-1576 behavior unchanged)', () => {
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
    assert.ok(guard, 'guard must still fire when trustedPostMerge is not passed');
    assert.strictEqual(guard?.code, 'repair_required_via_pr');
  });
});

test('guard still blocks a plain main checkout when trustedPostMerge is explicitly false', () => {
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

    const guard = guardRepairAgainstMainCheckout(repair, { currentBranch: 'main', repoRoot, trustedPostMerge: false });
    assert.ok(guard, 'guard must still fire when trustedPostMerge is false');
    assert.strictEqual(guard?.code, 'repair_required_via_pr');
  });
});

test('guard is a no-op on main when trustedPostMerge is true — the one exception this capability exists to grant', () => {
  withTempRepairState(({ repoRoot, artifactRoot, tokenPath }) => {
    const repair = repairMergedLaneManifest(
      createManifest({ issue_id: 'UTV2-1571', status: 'started', commit_sha: null, preflight_token: tokenPath }),
      {
        repoRoot,
        artifactRoot,
        fetchPr: () => ({
          url: 'https://github.com/griff843/Unit-Talk-v2/pull/1291',
          state: 'merged',
          merged: true,
          mergeSha: 'a192cd78f649131e0716578713c2ca3bc1c0bb06',
        }),
      },
    );
    assert.strictEqual(repair.ok, true);
    assert.ok(repair.changed_fields.length > 0, 'precondition: repair must actually produce changes');

    const guard = guardRepairAgainstMainCheckout(repair, { currentBranch: 'main', repoRoot, trustedPostMerge: true });
    assert.strictEqual(guard, null, 'trusted post-merge automation must be allowed to proceed on main');
  });
});

test('guard on a non-main branch remains a no-op regardless of trustedPostMerge (never needed, never harmful)', () => {
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
      trustedPostMerge: false,
    });
    assert.strictEqual(guard, null);
  });
});

// ── UTV2-1586: trusted missing-PR binding ────────────────────────────────────

function createMissingBindingManifest(
  overrides: Partial<LaneManifest> = {},
): LaneManifest {
  return createManifest({
    issue_id: 'UTV2-1585',
    branch: 'codex/utv2-1585-merge-gate-canonical-check-identity',
    status: 'started',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    expected_proof_paths: [
      'docs/06_status/proof/UTV2-1585/evidence.json',
      'docs/06_status/proof/UTV2-1585/model-routing.json',
    ],
    ...overrides,
  });
}

test('UTV2-1586 #1 trusted workflow invocation may bind a missing PR', () => {
  const manifest = createMissingBindingManifest();
  const pr = createTrustedRepairPr(manifest);
  const validation = validateTrustedPostMergeRepair(manifest, '#1305', {
    repairMerged: true,
    trustedPostMerge: true,
    fetchPr: () => pr,
    isMergeReachable: () => true,
  });

  assert.strictEqual(validation.ok, true);
  assert.ok(validation.pr);
  const repair = repairMergedLaneManifest(manifest, {
    validatedPr: validation.pr ?? undefined,
  });
  assert.strictEqual(repair.ok, true);
  assert.strictEqual(repair.manifest.pr_url, pr.url);
  assert.strictEqual(repair.manifest.commit_sha, pr.mergeSha);
  assert.deepStrictEqual(
    repair.manifest.files_changed,
    implementationFilesFromTrustedRepair(manifest, pr.files ?? []),
  );
  assert.doesNotMatch(
    repair.manifest.files_changed.join('\n'),
    /^(?:docs\/06_status\/lanes\/|\.ops\/sync\/)/mu,
  );
});

test('UTV2-1586 #2 local invocation cannot bind a missing PR', () => {
  const manifest = createMissingBindingManifest();
  const result = validateTrustedPostMergeRepair(manifest, '1305', {
    repairMerged: true,
    trustedPostMerge: false,
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'untrusted_invocation');
});

test('UTV2-1586 #3 --post-merge-trusted alone cannot grant trust', () => {
  const manifest = createMissingBindingManifest();
  const trusted = isTrustedPostMergeAutomation({}, { postMergeTrusted: true });
  const result = validateTrustedPostMergeRepair(manifest, '1305', {
    repairMerged: true,
    trustedPostMerge: trusted,
  });
  assert.strictEqual(trusted, false);
  assert.strictEqual(result.code, 'untrusted_invocation');
});

test('UTV2-1586 #4 supplied --pr requires --repair-merged', () => {
  const manifest = createMissingBindingManifest();
  const result = validateTrustedPostMergeRepair(manifest, '1305', {
    repairMerged: false,
    trustedPostMerge: true,
  });
  assert.strictEqual(result.code, 'explicit_pr_requires_repair');
});

test('UTV2-1586 #5 matching existing PR binding is an idempotent no-op', () => {
  const base = createMissingBindingManifest({
    status: 'merged',
    commit_sha: '97527b791fc37acce41f4f46fd88699dce054b66',
    pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1305',
    preflight_token: 'dispatch-auto',
  });
  const pr = createTrustedRepairPr(base);
  const manifest = {
    ...base,
    files_changed: implementationFilesFromTrustedRepair(base, pr.files ?? []),
  };
  const validation = validateTrustedPostMergeRepair(manifest, '#1305', {
    repairMerged: true,
    trustedPostMerge: true,
    fetchPr: () => pr,
    isMergeReachable: () => true,
  });
  assert.strictEqual(validation.ok, true);

  const repair = repairMergedLaneManifest(manifest, {
    validatedPr: validation.pr ?? undefined,
  });
  assert.strictEqual(repair.code, 'already_repaired');
  assert.deepStrictEqual(repair.changed_fields, []);
});

test('UTV2-1586 #6 conflicting existing PR binding fails distinctly', () => {
  const manifest = createMissingBindingManifest({
    pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1304',
  });
  const result = validateTrustedPostMergeRepair(manifest, '1305', {
    repairMerged: true,
    trustedPostMerge: true,
  });
  assert.strictEqual(result.code, 'conflicting_pr_binding');
});

test('UTV2-1586 #7 wrong-repository PR fails distinctly', () => {
  const result = validateTrustedPostMergeRepair(
    createMissingBindingManifest(),
    'https://github.com/someone-else/Unit-Talk-v2/pull/1305',
    { repairMerged: true, trustedPostMerge: true },
  );
  assert.strictEqual(result.code, 'wrong_repository');
});

test('UTV2-1586 PR lookup failure maps to pr_not_found', () => {
  const manifest = createMissingBindingManifest();
  const result = validateTrustedPostMergeRepair(manifest, '1305', {
    repairMerged: true,
    trustedPostMerge: true,
    fetchPr: () => {
      throw new Error('not found');
    },
  });
  assert.strictEqual(result.code, 'pr_not_found');
});

test('UTV2-1586 #8 unmerged PR fails distinctly', () => {
  const manifest = createMissingBindingManifest();
  const result = validateTrustedPostMergeRepair(manifest, '1305', {
    repairMerged: true,
    trustedPostMerge: true,
    fetchPr: () => createTrustedRepairPr(manifest, {
      state: 'open',
      merged: false,
      mergeSha: null,
    }),
  });
  assert.strictEqual(result.code, 'pr_not_merged');
});

test('UTV2-1586 #9 wrong issue or branch identity fails distinctly', () => {
  const manifest = createMissingBindingManifest();
  const result = validateTrustedPostMergeRepair(manifest, '1305', {
    repairMerged: true,
    trustedPostMerge: true,
    fetchPr: () => createTrustedRepairPr(manifest, {
      headRefName: 'codex/utv2-9999-unrelated',
      title: 'feat(ops): UTV2-9999 unrelated',
    }),
  });
  assert.strictEqual(result.code, 'issue_identity_mismatch');
});

test('UTV2-1586 #10 later repair PR cannot substitute for implementation PR', () => {
  const manifest = createMissingBindingManifest();
  const result = validateTrustedPostMergeRepair(manifest, '1305', {
    repairMerged: true,
    trustedPostMerge: true,
    fetchPr: () => createTrustedRepairPr(manifest, {
      files: ['docs/06_status/proof/UTV2-1585/verification.md'],
    }),
  });
  assert.strictEqual(result.code, 'repair_pr_substitution');
});

test('UTV2-1586 missing declared implementation proof fails distinctly', () => {
  const manifest = createMissingBindingManifest();
  const result = validateTrustedPostMergeRepair(manifest, '1305', {
    repairMerged: true,
    trustedPostMerge: true,
    fetchPr: () => createTrustedRepairPr(manifest, {
      files: [`docs/06_status/lanes/${manifest.issue_id}.json`],
    }),
  });
  assert.strictEqual(result.code, 'missing_implementation_artifacts');
});

test('UTV2-1586 fabricated PR with only the manifest and proof artifacts cannot substitute for the real implementation', () => {
  const manifest = createMissingBindingManifest();
  const result = validateTrustedPostMergeRepair(manifest, '1305', {
    repairMerged: true,
    trustedPostMerge: true,
    fetchPr: () => createTrustedRepairPr(manifest, {
      files: [
        `docs/06_status/lanes/${manifest.issue_id}.json`,
        ...manifest.expected_proof_paths,
      ],
    }),
    isMergeReachable: () => true,
  });
  assert.strictEqual(result.code, 'repair_pr_substitution');
});

test('UTV2-1586 #11 changed or unreachable merge SHA fails closed', () => {
  const staleManifest = createMissingBindingManifest({ commit_sha: 'caller-changed-sha' });
  const mismatch = validateTrustedPostMergeRepair(staleManifest, '1305', {
    repairMerged: true,
    trustedPostMerge: true,
    fetchPr: () => createTrustedRepairPr(staleManifest),
    isMergeReachable: () => true,
  });
  assert.strictEqual(mismatch.code, 'pr_sha_mismatch');

  const manifest = createMissingBindingManifest();
  const unreachable = validateTrustedPostMergeRepair(manifest, '1305', {
    repairMerged: true,
    trustedPostMerge: true,
    fetchPr: () => createTrustedRepairPr(manifest),
    isMergeReachable: () => false,
  });
  assert.strictEqual(unreachable.code, 'unreachable_merge_sha');
});

test('UTV2-1586 #12 failed truth-check rollback restores null PR binding and proof bytes', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1586-rollback-'));
  const issueId = 'UTV2-1585';
  const manifestPath = path.join(repoRoot, 'docs', '06_status', 'lanes', `${issueId}.json`);
  const proofPath = path.join(repoRoot, 'docs', '06_status', 'proof', issueId, 'evidence.json');
  const syncPath = path.join(repoRoot, '.ops', 'sync', `${issueId}.yml`);
  const leasePath = path.join(repoRoot, '.ops', 'leases', `${issueId}.json`);
  const mergeLockPath = path.join(repoRoot, '.ops', 'merge-lock.json');
  try {
    const original = createMissingBindingManifest();
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.mkdirSync(path.dirname(proofPath), { recursive: true });
    fs.mkdirSync(path.dirname(syncPath), { recursive: true });
    fs.mkdirSync(path.dirname(leasePath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(original, null, 2)}\n`);
    fs.writeFileSync(proofPath, '{"sha":"pre-repair"}\n');
    fs.writeFileSync(syncPath, 'entities:\n  issues: [UTV2-1585]\n');
    fs.writeFileSync(leasePath, '{"status":"active"}\n');
    fs.writeFileSync(mergeLockPath, '{"status":"held"}\n');

    const transaction = createRepairRollbackTransaction(issueId, repoRoot);
    fs.writeFileSync(manifestPath, `${JSON.stringify({
      ...original,
      pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1305',
      commit_sha: '97527b791fc37acce41f4f46fd88699dce054b66',
    }, null, 2)}\n`);
    fs.writeFileSync(proofPath, '{"sha":"partially-rebound"}\n');
    fs.rmSync(syncPath);
    fs.writeFileSync(leasePath, '{"status":"released"}\n');
    fs.writeFileSync(mergeLockPath, '{"status":"released"}\n');
    transaction.rollback();

    const restored = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LaneManifest;
    assert.strictEqual(restored.pr_url, null);
    assert.strictEqual(restored.commit_sha, null);
    assert.strictEqual(fs.readFileSync(proofPath, 'utf8'), '{"sha":"pre-repair"}\n');
    assert.strictEqual(fs.readFileSync(syncPath, 'utf8'), 'entities:\n  issues: [UTV2-1585]\n');
    assert.strictEqual(fs.readFileSync(leasePath, 'utf8'), '{"status":"active"}\n');
    assert.strictEqual(fs.readFileSync(mergeLockPath, 'utf8'), '{"status":"held"}\n');

    fs.rmSync(mergeLockPath);
    const beforeAutoAcquire = createRepairRollbackTransaction(issueId, repoRoot);
    fs.writeFileSync(mergeLockPath, '{"status":"acquired-for-failed-repair"}\n');
    beforeAutoAcquire.rollback();
    assert.strictEqual(
      fs.existsSync(mergeLockPath),
      false,
      'rollback removes a mutex acquired after the pre-invocation snapshot',
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('UTV2-1586 #13 successful repair reaches done with terminal fields and cleanup', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1586-success-'));
  const manifest = createMissingBindingManifest();
  const pr = createTrustedRepairPr(manifest);
  const repair = repairMergedLaneManifest(manifest, { validatedPr: pr });
  const truthCheck = createTruthCheckResult({
    issue_id: manifest.issue_id,
    tier: manifest.tier,
    merge_sha: pr.mergeSha,
    pr_url: pr.url,
  });
  const cleanupCalls: string[] = [];
  const syncPath = path.join(repoRoot, '.ops', 'sync', `${manifest.issue_id}.yml`);
  fs.mkdirSync(path.dirname(syncPath), { recursive: true });
  fs.writeFileSync(syncPath, 'entities:\n  issues: [UTV2-1585]\n');

  try {
    const completion = await completeSuccessfulLaneClose(
      manifest.issue_id,
      repair.manifest,
      truthCheck,
      {
        trustedBindingRepair: true,
        repoRoot,
        finalizeManifest: () => ({
          ...repair.manifest,
          status: 'done',
          closed_at: '2026-07-24T21:00:00.000Z',
        }),
        transitionLinear: async () => {
          cleanupCalls.push('linear');
        },
        beginLeaseRelease: () => ({
          warnings: [],
          commit: () => undefined,
          rollback: () => undefined,
        }),
        releaseLocks: (issueId, branch) => {
          cleanupCalls.push(`locks:${issueId}:${branch}`);
          return { warnings: [] };
        },
        cleanupWorktree: () => {
          cleanupCalls.push('worktree');
          return 'removed';
        },
      },
    );

    assert.strictEqual(repair.ok, true);
    assert.strictEqual(completion.manifest.status, 'done');
    assert.strictEqual(completion.manifest.closed_at, '2026-07-24T21:00:00.000Z');
    assert.strictEqual(completion.manifest.pr_url, pr.url);
    assert.strictEqual(completion.manifest.commit_sha, pr.mergeSha);
    assert.deepStrictEqual(
      completion.manifest.files_changed,
      implementationFilesFromTrustedRepair(manifest, pr.files ?? []),
    );
    // UTV2-1613: the repair itself contributes no history at all. In
    // production the passing entry on a successful close comes from the real
    // runTruthCheck() call in main() (which writes it before
    // finalizeLaneCloseManifest re-reads the manifest), never from repair --
    // this stubbed finalizeManifest deliberately does not fabricate one, and
    // the repaired manifest must therefore carry no pass.
    assert.strictEqual(
      completion.manifest.truth_check_history.some((entry) => entry.verdict === 'pass'),
      false,
      'repair must never contribute a passing truth_check_history entry',
    );
    assert.strictEqual(
      completion.manifest.truth_check_history.some(
        (entry) => !CANONICAL_TRUTH_CHECK_RUNNERS.includes(entry.runner),
      ),
      false,
      'every history entry must use a canonical runner',
    );
    assert.strictEqual(completion.sync_removed, true);
    assert.strictEqual(fs.existsSync(syncPath), false);
    assert.strictEqual(completion.worktree_cleanup, 'removed');
    assert.deepStrictEqual(cleanupCalls, [
      // UTV2-1619 capability 17: 'linear' is deliberately absent. This lane
      // closes successfully, but no explicit final-completion intent was
      // declared, so the ISSUE is left open. Lane completion is not issue
      // completion.
      `locks:${manifest.issue_id}:${manifest.branch}`,
      'worktree',
    ]);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('UTV2-1586 #14 ordinary lane-close repair usage without --pr is unchanged', () => {
  const manifest = createManifest();
  const result = repairMergedLaneManifest(manifest, {
    fetchPr: () => ({
      url: manifest.pr_url ?? '',
      state: 'merged',
      merged: true,
      mergeSha: 'ordinary-authoritative-sha',
    }),
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.manifest.commit_sha, 'ordinary-authoritative-sha');
});

test('UTV2-1586 #15 pre-existing repair path with populated pr_url is unchanged', () => {
  const manifest = createManifest({
    status: 'in_review',
    commit_sha: null,
    pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1001',
  });
  const result = repairMergedLaneManifest(manifest, {
    fetchPr: () => ({
      url: manifest.pr_url ?? '',
      state: 'merged',
      merged: true,
      mergeSha: 'pre-existing-path-sha',
    }),
  });
  assert.strictEqual(result.code, 'repaired');
  assert.strictEqual(result.manifest.pr_url, manifest.pr_url);
});

test('UTV2-1586 #16 workflow dispatch forwards PR only to trusted repair command', () => {
  const workflow = fs.readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'post-merge-lane-close.yml'),
    'utf8',
  );
  assert.match(workflow, /pr:\n\s+description: "Original implementation PR URL or number/);
  assert.match(workflow, /close_args=\("\$ISSUE_ID" --repair-merged --explain --post-merge-trusted\)/);
  assert.match(workflow, /close_args\+=\(--pr "\$EXPLICIT_PR"\)/);
  assert.strictEqual((workflow.match(/--pr "\$EXPLICIT_PR"/gu) ?? []).length, 1);
  assert.match(workflow, /git ls-files -- "\$per_issue_sync"/);
  assert.match(workflow, /git add -A -- "\$per_issue_sync"/);
  assert.doesNotMatch(workflow, /if \[ -f "\$per_issue_sync" \]/);
});

test('UTV2-1590 done push remains skipped while explicit workflow dispatch reaches cleanup', () => {
  const workflow = fs.readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'post-merge-lane-close.yml'),
    'utf8',
  );
  const statusStepIndex = workflow.indexOf('- name: Check manifest status');
  const nextStepIndex = workflow.indexOf('\n      - name:', statusStepIndex + 1);
  const statusStep = workflow.slice(statusStepIndex, nextStepIndex);

  assert.match(statusStep, /EVENT_NAME: \$\{\{ github\.event_name \}\}/u);
  assert.match(statusStep, /EXPLICIT_PR: \$\{\{ steps\.extract\.outputs\.pr_input \}\}/u);
  assert.match(
    statusStep,
    /if \[ "\$EVENT_NAME" = "workflow_dispatch" \] && \[ -n "\$EXPLICIT_PR" \]; then/u,
  );
  assert.match(statusStep, /Trusted terminal cleanup replay requested with explicit PR/u);
  assert.match(statusStep, /Push handling remains a no-op; manual cleanup replay requires an explicit PR/u);
  assert.match(statusStep, /echo "closeable=true" >> "\$GITHUB_OUTPUT"/u);
  assert.match(statusStep, /echo "closeable=false" >> "\$GITHUB_OUTPUT"/u);
});

test('UTV2-1684 workflow_dispatch binds proof from resolved merge SHA authority', () => {
  const workflow = fs.readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'post-merge-lane-close.yml'),
    'utf8',
  );
  const bindStepIndex = workflow.indexOf('Bind proof artifacts to merge SHA');
  assert.notStrictEqual(bindStepIndex, -1);
  const bindStepIfLine = workflow.slice(bindStepIndex).match(/^ {8}if: (.+)$/mu);
  assert.ok(bindStepIfLine, 'expected an `if:` condition immediately following the step name');
  assert.match(bindStepIfLine[1], /steps\.resolve_sha\.outputs\.merge_sha != ''/u);
  assert.doesNotMatch(bindStepIfLine[1], /github\.event_name/u);
});

test('UTV2-1684 "Bind proof artifacts to merge SHA" fails closed on a mismatched receipt', () => {
  const workflow = fs.readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'post-merge-lane-close.yml'),
    'utf8',
  );
  const bindStepIndex = workflow.indexOf('Bind proof artifacts to merge SHA');
  assert.notStrictEqual(bindStepIndex, -1);
  const nextStepIndex = workflow.indexOf('\n      - name:', bindStepIndex + 1);
  const stepBody = workflow.slice(bindStepIndex, nextStepIndex === -1 ? undefined : nextStepIndex);

  // A pre-existing receipt is accepted only when it agrees with the
  // authoritative merge SHA resolved from manifest.pr_url.
  assert.match(stepBody, /jq -r '\.commit_sha \/\/ empty' "\$MANIFEST_PATH"/u);
  assert.match(stepBody, /if \[ -n "\$existing_commit_sha" \] && \[ "\$existing_commit_sha" != "\$MERGE_SHA" \]/u);
  assert.match(stepBody, /does not match authoritative PR merge SHA/u);
  assert.match(stepBody, /exit 1/u);
  const guardIndex = stepBody.indexOf('existing_commit_sha" != "$MERGE_SHA"');
  const proofGenerateIndex = stepBody.indexOf('pnpm ops:proof-generate');
  assert.ok(guardIndex !== -1 && proofGenerateIndex > guardIndex);
});

test('UTV2-1589 "Bind proof artifacts to merge SHA" never binds model-routing.json itself -- only the trusted repair step does', () => {
  const workflow = fs.readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'post-merge-lane-close.yml'),
    'utf8',
  );
  const bindStepIndex = workflow.indexOf('Bind proof artifacts to merge SHA');
  assert.notStrictEqual(bindStepIndex, -1);
  const nextStepIndex = workflow.indexOf('\n      - name:', bindStepIndex + 1);
  const stepBody = workflow.slice(bindStepIndex, nextStepIndex === -1 ? undefined : nextStepIndex);

  // On a genuine first-time closeout (github.sha correct, commit_sha not yet
  // set), this call still resolves manifest.pr_url from disk with no
  // GitHub-backed validation -- binding model-routing.json's immutable
  // closeout_binding from that unvalidated identity here, before the
  // trusted repair step's rollback snapshot is even taken, would let a
  // stale/incorrect pr_url (e.g. after a PR rename/reopen) get baked in
  // permanently. model-routing.json must only ever be bound by the
  // validated ops:lane-close --repair-merged step that always runs next.
  // ops:proof-generate defaults to never binding model-routing.json
  // (bindModelRouting defaults to false); this invocation must not opt in.
  const proofGenerateLine = stepBody.match(/^ {12}pnpm ops:proof-generate.*$/mu);
  assert.ok(proofGenerateLine, 'expected the pnpm ops:proof-generate invocation line');
  assert.doesNotMatch(proofGenerateLine[0], /--bind-model-routing\b/u);
});

test('UTV2-1586 #17 real UTV2-1585 PR #1305 fixture validates and binds exact merge SHA', () => {
  const manifest = createMissingBindingManifest();
  const pr = createTrustedRepairPr(manifest, {
    title: 'feat(ops): UTV2-1585 canonicalize Merge Gate check identity',
    files: [
      '.github/workflows/merge-gate.yml',
      '.ops/sync/UTV2-1585.yml',
      'docs/06_status/lanes/UTV2-1585.json',
      'docs/06_status/proof/UTV2-1585/evidence.json',
      'docs/06_status/proof/UTV2-1585/model-routing.json',
      'docs/06_status/proof/UTV2-1585/verification.md',
      'scripts/ops/workflow-hardening.test.ts',
    ],
  });
  const validation = validateTrustedPostMergeRepair(manifest, '#1305', {
    repairMerged: true,
    trustedPostMerge: true,
    fetchPr: () => pr,
    isMergeReachable: (sha) => sha === '97527b791fc37acce41f4f46fd88699dce054b66',
  });
  assert.strictEqual(validation.ok, true);
  const repair = repairMergedLaneManifest(manifest, {
    validatedPr: validation.pr ?? undefined,
  });
  assert.strictEqual(repair.manifest.pr_url, 'https://github.com/griff843/Unit-Talk-v2/pull/1305');
  assert.strictEqual(repair.manifest.commit_sha, '97527b791fc37acce41f4f46fd88699dce054b66');
  assert.deepStrictEqual(repair.manifest.files_changed, [
    '.github/workflows/merge-gate.yml',
    'docs/06_status/proof/UTV2-1585/evidence.json',
    'docs/06_status/proof/UTV2-1585/model-routing.json',
    'docs/06_status/proof/UTV2-1585/verification.md',
    'scripts/ops/workflow-hardening.test.ts',
  ]);
});

// ── UTV2-1613: idempotent, non-self-poisoning closeout ────────────────────────
//
// Five regressions, each corresponding to a failure measured on the live
// system rather than imagined from the code.

test('UTV2-1690: terminal manifest persistence cannot outrun lease release', async () => {
  const leaseRegistryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-terminal-release-'));
  const manifest = createManifest({ status: 'merged' });
  try {
    reserveLease(
      {
        issue_id: manifest.issue_id,
        branch: manifest.branch,
        executor: 'codex-cli',
        cwd: process.cwd(),
        file_scope_lock: ['scripts/ops/lane-close.ts'],
        owner: { user: 'u', host: 'unit-test', pid: 4242, session_id: 's' },
      },
      { registryDir: leaseRegistryDir, now: new Date('2026-08-15T12:00:00.000Z') },
    );

    const completion = await completeSuccessfulLaneClose(
        manifest.issue_id,
        manifest,
        createTruthCheckResult(),
        {
          beginLeaseRelease: (issue) => beginTerminalLeaseRelease(
            {
              issue_id: issue,
              actor: 'ops:lane-close',
              reason: 'terminal manifest transition',
            },
            { registryDir: leaseRegistryDir },
          ),
          finalizeManifest: () => {
            assert.strictEqual(
              readAllLeases(leaseRegistryDir)[0]?.status,
              'released',
              'lease must be released before status=done can be persisted',
            );
            return { ...manifest, status: 'done', closed_at: '2026-08-15T12:01:00.000Z' };
          },
          releaseLocks: () => ({ warnings: [] }),
        },
      );
    assert.strictEqual(completion.manifest.status, 'done');
    assert.strictEqual(readAllLeases(leaseRegistryDir)[0]?.status, 'released');
  } finally {
    fs.rmSync(leaseRegistryDir, { recursive: true, force: true });
  }
});

test('UTV2-1690: failed terminal manifest persistence restores the active lease', async () => {
  const leaseRegistryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-terminal-rollback-'));
  const manifest = createManifest({ status: 'merged' });
  try {
    reserveLease(
      {
        issue_id: manifest.issue_id,
        branch: manifest.branch,
        executor: 'codex-cli',
        cwd: process.cwd(),
        file_scope_lock: ['scripts/ops/lane-close.ts'],
        owner: { user: 'u', host: 'unit-test', pid: 4242, session_id: 's' },
      },
      { registryDir: leaseRegistryDir, now: new Date('2026-08-15T12:00:00.000Z') },
    );

    await assert.rejects(
      completeSuccessfulLaneClose(
        manifest.issue_id,
        manifest,
        createTruthCheckResult(),
        {
          beginLeaseRelease: (issue) => beginTerminalLeaseRelease(
            {
              issue_id: issue,
              actor: 'ops:lane-close',
              reason: 'terminal manifest transition',
            },
            { registryDir: leaseRegistryDir },
          ),
          finalizeManifest: () => {
            throw new Error('manifest write failed');
          },
          releaseLocks: () => ({ warnings: [] }),
        },
      ),
      /manifest write failed/,
    );
    assert.strictEqual(readAllLeases(leaseRegistryDir)[0]?.status, 'active');
  } finally {
    fs.rmSync(leaseRegistryDir, { recursive: true, force: true });
  }
});

test('UTV2-1613 R1: a normal successful close releases the dispatch lease', () => {
  withTempCloseoutState(({ leaseRegistryDir, mergeLockPath }) => {
    const manifest = createManifest({ status: 'merged' });
    reserveLease(
      {
        issue_id: manifest.issue_id,
        branch: manifest.branch,
        executor: 'codex-cli',
        cwd: process.cwd(),
        file_scope_lock: ['scripts/ops/lane-close.ts'],
        owner: { user: 'u', host: 'unit-test', pid: 4242, session_id: 's' },
      },
      { registryDir: leaseRegistryDir, now: new Date('2026-07-30T12:00:00.000Z') },
    );

    const { warnings } = releaseCloseoutLocks(manifest.issue_id, manifest.branch, {
      leaseRegistryDir,
      mergeLockPath,
    });

    const lease = readAllLeases(leaseRegistryDir).find(
      (entry) => entry.issue_id === manifest.issue_id,
    );
    assert.strictEqual(lease?.status, 'released', 'the issue lease must not remain active');
    // A missing merge lock is benign here -- the lease is the authority under test.
    assert.ok(warnings.every((warning) => /merge lock/.test(warning)));
  });
});

test('UTV2-1613 R2: a second close invocation is a clean no-op that leaves nothing behind', () => {
  withTempCloseoutState(({ leaseRegistryDir, mergeLockPath }) => {
    const manifest = createManifest({ status: 'done', closed_at: '2026-07-30T12:00:00.000Z' });
    reserveLease(
      {
        issue_id: manifest.issue_id,
        branch: manifest.branch,
        executor: 'codex-cli',
        cwd: process.cwd(),
        file_scope_lock: ['scripts/ops/lane-close.ts'],
        owner: { user: 'u', host: 'unit-test', pid: 4242, session_id: 's' },
      },
      { registryDir: leaseRegistryDir, now: new Date('2026-07-30T12:00:00.000Z') },
    );

    const releaseCalls: string[] = [];
    const first = completeIdempotentReclose(manifest, {
      repoRoot: os.tmpdir(),
      releaseLocks: (issue, branch) => {
        releaseCalls.push(`${issue}:${branch}`);
        return releaseCloseoutLocks(issue, branch, { leaseRegistryDir, mergeLockPath });
      },
    });
    const second = completeIdempotentReclose(manifest, {
      repoRoot: os.tmpdir(),
      releaseLocks: (issue, branch) => {
        releaseCalls.push(`${issue}:${branch}`);
        return releaseCloseoutLocks(issue, branch, { leaseRegistryDir, mergeLockPath });
      },
    });

    assert.strictEqual(releaseCalls.length, 2, 'both invocations attempt release');
    assert.strictEqual(first.manifest.status, 'done');
    assert.strictEqual(second.manifest.status, 'done');
    // Crucially: closed_at is not rewritten by the re-run, and no new lock or
    // lease exists afterwards.
    assert.strictEqual(second.manifest.closed_at, '2026-07-30T12:00:00.000Z');
    const lease = readAllLeases(leaseRegistryDir).find(
      (entry) => entry.issue_id === manifest.issue_id,
    );
    assert.strictEqual(lease?.status, 'released');
    const lock = readMergeLock(mergeLockPath);
    assert.strictEqual(lock.ok, false, 'a no-op re-close must not create a merge lock');
  });
});

test('UTV2-1613 R3: a failed truth-check releases no authority and does not mark the lane done', () => {
  const failing = createTruthCheckResult({
    verdict: 'fail',
    exit_code: 1,
    failures: ['P3'],
    checks: [{ id: 'P3', status: 'fail', detail: 'proof does not reference merge sha' }],
  });
  const receipt = measuredTruthCheckReceipt({
    command: 'ops:truth-check UTV2-1001',
    runner: 'ops:lane-close',
    result: failing,
    evaluatedStateHash: hashState(createManifest()),
  });

  assert.strictEqual(isMeasuredPass(receipt), false);
  const entry = truthHistoryEntryForMeasuredReceipt(receipt);
  assert.strictEqual(entry?.verdict, 'fail');

  // The manifest that a failed close leaves behind may be `merged` (the
  // authoritative GitHub binding) but must never be `done`, and its history
  // must contain the measured failure rather than any pass.
  const afterFailedClose = createManifest({
    status: 'merged',
    truth_check_history: [entry as NonNullable<typeof entry>],
  });
  assert.notStrictEqual(afterFailedClose.status, 'done');
  assert.strictEqual(
    afterFailedClose.truth_check_history.some((historyEntry) => historyEntry.verdict === 'pass'),
    false,
  );

  // And finalize must refuse to promote it: a failing latest entry is drift,
  // not authorization.
  assert.strictEqual(classifyTruthCheckAuthorization(afterFailedClose, failing), 'drift');
});

test('UTV2-1613 R4: re-closing an already-done lane does not raise spurious truth_check_drift', () => {
  // The exact live shape: truth-check-lib refuses to append history to a done
  // manifest (UTV2-1224), so the fresh in-run pass carries a NEW checked_at
  // that can never equal the persisted one. Before this fix that mismatch was
  // reported as concurrent drift on every single re-close.
  const persistedPass = {
    checked_at: '2026-07-30T12:00:00.000Z',
    verdict: 'pass' as const,
    merge_sha: 'c17e1f64e2ae20d7df80e2d4c030c99c6e01bcc6',
    failures: [],
    runner: 'ops:lane-close' as const,
  };
  const doneManifest = createManifest({
    status: 'done',
    closed_at: '2026-07-30T12:00:00.000Z',
    truth_check_history: [persistedPass],
  });
  const freshPass = createTruthCheckResult({ checked_at: '2026-07-31T08:15:00.000Z' });

  assert.strictEqual(
    classifyTruthCheckAuthorization(doneManifest, freshPass),
    'already_closed',
    'a re-close of a done lane on the same merge SHA is benign, not drift',
  );

  // The narrowing must not swallow anything real. A different merge SHA is
  // still drift even on a done lane...
  assert.strictEqual(
    classifyTruthCheckAuthorization(
      doneManifest,
      createTruthCheckResult({ checked_at: '2026-07-31T08:15:00.000Z', merge_sha: 'other-sha' }),
    ),
    'drift',
  );
  // ...and a NON-done lane whose latest entry does not match is still drift,
  // which is the genuine concurrent-run case this guard exists for.
  assert.strictEqual(
    classifyTruthCheckAuthorization(
      createManifest({ status: 'merged', truth_check_history: [persistedPass] }),
      freshPass,
    ),
    'drift',
  );
  // ...and an exact match is still ordinary authorization.
  assert.strictEqual(
    classifyTruthCheckAuthorization(
      createManifest({ status: 'merged', truth_check_history: [persistedPass] }),
      createTruthCheckResult({
        checked_at: persistedPass.checked_at,
        merge_sha: persistedPass.merge_sha,
      }),
    ),
    'authorized',
  );
});

test('UTV2-1613 R5: an orphaned-pid merge lock is reaped rather than compounding', () => {
  withTempCloseoutState(({ mergeLockPath }) => {
    const manifest = createManifest();
    // A previous blocked run of THIS lane left a held lock behind, owned by a
    // PID that no longer exists on this host.
    acquireMergeLock(
      {
        issue_id: manifest.issue_id,
        branch: manifest.branch,
        pr: '1001',
        cwd: process.cwd(),
        reason: 'ops:lane-close',
        owner: {
          user: 'u',
          host: os.hostname() || 'unknown',
          pid: 999_999_999,
          session_id: 'abandoned-run',
        },
      },
      { lockPath: mergeLockPath, now: new Date('2026-07-30T12:00:00.000Z') },
    );

    // Before the fix this returned merge_lock_stale_reclaim_required and the
    // retry then left its own residue on top.
    const result = ensureCloseoutMergeLock(manifest, {
      acquireLock: true,
      mergeLockPath,
      cwd: process.cwd(),
      now: new Date('2026-07-30T12:05:00.000Z'),
    });

    assert.strictEqual(result.ok, true, `expected reap+acquire, got ${result.code}`);
    assert.strictEqual(result.code, 'merge_lock_reclaimed');
    const lock = readMergeLock(mergeLockPath);
    assert.strictEqual(lock.ok ? lock.lock.issue_id : '', manifest.issue_id);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'held');
    assert.strictEqual(lock.ok ? lock.lock.owner.pid : -1, process.pid);
  });
});

test('UTV2-1613 R5: reaping never takes another lane\'s orphaned lock', () => {
  withTempCloseoutState(({ mergeLockPath }) => {
    const manifest = createManifest();
    acquireMergeLock(
      {
        issue_id: 'UTV2-9999',
        branch: 'codex/utv2-9999-other-lane',
        pr: '9999',
        cwd: process.cwd(),
        reason: 'ops:lane-close',
        owner: {
          user: 'u',
          host: os.hostname() || 'unknown',
          pid: 999_999_998,
          session_id: 'other-lane',
        },
      },
      { lockPath: mergeLockPath, now: new Date('2026-07-30T12:00:00.000Z') },
    );

    const result = ensureCloseoutMergeLock(manifest, {
      acquireLock: true,
      mergeLockPath,
      cwd: process.cwd(),
      now: new Date('2026-07-30T12:05:00.000Z'),
    });

    assert.strictEqual(result.ok, false, 'another lane\'s lock must never be reaped');
    const lock = readMergeLock(mergeLockPath);
    assert.strictEqual(lock.ok ? lock.lock.issue_id : '', 'UTV2-9999');
  });
});

test('UTV2-1613 R5: an expired (not orphaned) lock still requires an explicit reclaim', () => {
  withTempCloseoutState(({ mergeLockPath }) => {
    const manifest = createManifest();
    acquireMergeLock(
      {
        issue_id: manifest.issue_id,
        branch: manifest.branch,
        pr: '1001',
        cwd: process.cwd(),
        reason: 'ops:lane-close',
        owner: { user: 'u', host: os.hostname() || 'unknown', pid: process.pid, session_id: 's' },
      },
      { lockPath: mergeLockPath, now: new Date('2026-07-30T12:00:00.000Z') },
    );

    // Far past the TTL, but the owning PID (this process) is alive -- a merge
    // may genuinely still be in flight, so this must not be auto-reaped.
    const result = ensureCloseoutMergeLock(manifest, {
      acquireLock: true,
      mergeLockPath,
      cwd: process.cwd(),
      now: new Date('2026-08-30T12:00:00.000Z'),
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_lock_stale_reclaim_required');
  });
});

test('UTV2-1613: a run that gives up releases the merge lock it acquired for itself', () => {
  withTempCloseoutState(({ mergeLockPath }) => {
    const manifest = createManifest();
    const acquired = ensureCloseoutMergeLock(manifest, {
      acquireLock: true,
      mergeLockPath,
      cwd: process.cwd(),
      now: new Date('2026-07-30T12:00:00.000Z'),
    });
    assert.strictEqual(acquired.code, 'merge_lock_acquired');

    releaseSelfAcquiredMergeLock(acquired, manifest, { mergeLockPath });

    const lock = readMergeLock(mergeLockPath);
    assert.strictEqual(
      lock.ok ? lock.lock.status : '',
      'released',
      'an abandoned run must not leave its own lock held for the next retry to trip over',
    );
  });
});

test('UTV2-1613: a pre-existing lock this run did not acquire is left untouched', () => {
  withTempCloseoutState(({ mergeLockPath }) => {
    const manifest = createManifest();
    acquireMergeLock(
      {
        issue_id: manifest.issue_id,
        branch: manifest.branch,
        pr: '1001',
        cwd: process.cwd(),
        reason: 'ops:merge-lock acquire',
        owner: { user: 'u', host: os.hostname() || 'unknown', pid: process.pid, session_id: 's' },
      },
      { lockPath: mergeLockPath, now: new Date('2026-07-30T12:00:00.000Z') },
    );
    const held = ensureCloseoutMergeLock(manifest, {
      acquireLock: true,
      mergeLockPath,
      cwd: process.cwd(),
      now: new Date('2026-07-30T12:01:00.000Z'),
    });
    assert.strictEqual(held.code, 'merge_lock_held');

    releaseSelfAcquiredMergeLock(held, manifest, { mergeLockPath });

    const lock = readMergeLock(mergeLockPath);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'held');
  });
});

test('UTV2-1613: releaseCloseoutLocks warns, never throws, on another lane\'s merge lock', () => {
  withTempCloseoutState(({ leaseRegistryDir, mergeLockPath }) => {
    acquireMergeLock(
      {
        issue_id: 'UTV2-9999',
        branch: 'codex/utv2-9999-other-lane',
        pr: '9999',
        cwd: process.cwd(),
        reason: 'ops:lane-close',
        owner: { user: 'u', host: os.hostname() || 'unknown', pid: process.pid, session_id: 's' },
      },
      { lockPath: mergeLockPath, now: new Date('2026-07-30T12:00:00.000Z') },
    );

    let result: { warnings: string[] } | null = null;
    assert.doesNotThrow(() => {
      result = releaseCloseoutLocks('UTV2-1001', 'codex/utv2-1001-enforce-non-null-merge-sha', {
        leaseRegistryDir,
        mergeLockPath,
      });
    });
    assert.ok(result);
    assert.ok(
      (result as unknown as { warnings: string[] }).warnings.some((warning) =>
        /held by another lane/.test(warning),
      ),
    );
    const lock = readMergeLock(mergeLockPath);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'held', 'the other lane keeps its lock');
  });
});

// ── UTV2-1613: merge-binding inference for ghost lanes ────────────────────────

test('UTV2-1613: a merged PR is inferred from the lane branch when pr_url is null', () => {
  withTempRepairState(({ repoRoot, artifactRoot, tokenPath }) => {
    const ghost = createManifest({
      issue_id: 'UTV2-1553',
      branch: 'claude/utv2-1553-release-merged-lane-lock',
      status: 'started',
      commit_sha: null,
      pr_url: null,
      preflight_token: tokenPath,
    });

    const repair = repairMergedLaneManifest(ghost, {
      repoRoot,
      artifactRoot,
      now: new Date('2026-07-31T09:00:00.000Z'),
      inferMergedPrForBranch: (branch, issueId) => {
        assert.strictEqual(branch, 'claude/utv2-1553-release-merged-lane-lock');
        assert.strictEqual(issueId, 'UTV2-1553');
        return {
          url: 'https://github.com/griff843/Unit-Talk-v2/pull/1322',
          number: 1322,
          repository: 'griff843/Unit-Talk-v2',
          state: 'merged',
          merged: true,
          mergeSha: '965872d378caa3e88ef4987f8bbb0bab0214856e',
          headRefName: 'claude/utv2-1553-release-merged-lane-lock',
          baseRefName: 'main',
          title: 'fix(lanes): UTV2-1553 release merged-lane lock from active accounting',
        };
      },
      isMergeReachable: () => true,
    });

    assert.strictEqual(repair.ok, true);
    assert.strictEqual(repair.code, 'repaired');
    assert.strictEqual(repair.manifest.status, 'merged');
    assert.strictEqual(repair.manifest.commit_sha, '965872d378caa3e88ef4987f8bbb0bab0214856e');
    assert.strictEqual(repair.merge_binding?.selected_by, 'branch_merged_head');
    assert.strictEqual(repair.merge_binding?.pr_number, 1322);
    // The whole point: a repaired binding, and still zero truth-check history.
    assert.deepStrictEqual(repair.manifest.truth_check_history, []);
  });
});

test('UTV2-1613: a null pr_url with no inferable merged PR is refused, never guessed', () => {
  withTempRepairState(({ repoRoot, artifactRoot, tokenPath }) => {
    const repair = repairMergedLaneManifest(
      createManifest({ status: 'started', commit_sha: null, pr_url: null, preflight_token: tokenPath }),
      { repoRoot, artifactRoot, inferMergedPrForBranch: () => null },
    );
    assert.strictEqual(repair.ok, false);
    assert.strictEqual(repair.code, 'infra_error');
    assert.match(repair.remediation, /must not be guessed/);
  });
});

test('UTV2-1690: repair refuses to replace a binding invalidated by a PR base mismatch', () => {
  withTempRepairState(({ repoRoot, artifactRoot, tokenPath }) => {
    let inferenceCalled = false;
    const manifest = createManifest({
      status: 'started',
      commit_sha: null,
      pr_url: null,
      blocked_by: ['pr-base-mismatch'],
      preflight_token: tokenPath,
    });

    const repair = repairMergedLaneManifest(manifest, {
      repoRoot,
      artifactRoot,
      inferMergedPrForBranch: () => {
        inferenceCalled = true;
        throw new Error('base-mismatch blocker must stop before PR inference');
      },
    });

    assert.strictEqual(repair.ok, false);
    assert.strictEqual(repair.code, 'pr_base_mismatch');
    assert.strictEqual(repair.outcome, 'blocked');
    assert.strictEqual(inferenceCalled, false);
    assert.strictEqual(repair.manifest, manifest);
    assert.match(repair.remediation, /pr-base-mismatch/);
  });
});

test('UTV2-1690: repair refuses an inferred PR whose base is wrong or unresolved', () => {
  for (const baseRefName of ['release', null] as const) {
    withTempRepairState(({ repoRoot, artifactRoot, tokenPath }) => {
      const manifest = createManifest({
        status: 'started',
        commit_sha: null,
        pr_url: null,
        base_branch: 'main',
        preflight_token: tokenPath,
      });
      let reachabilityCalled = false;
      const repair = repairMergedLaneManifest(manifest, {
        repoRoot,
        artifactRoot,
        inferMergedPrForBranch: () => ({
          url: 'https://github.com/griff843/Unit-Talk-v2/pull/1705',
          number: 1705,
          repository: 'griff843/Unit-Talk-v2',
          state: 'merged',
          merged: true,
          mergeSha: '965872d378caa3e88ef4987f8bbb0bab0214856e',
          headRefName: manifest.branch,
          baseRefName,
          title: `fix(ops): ${manifest.issue_id} wrong-base repair regression`,
        }),
        isMergeReachable: () => {
          reachabilityCalled = true;
          return true;
        },
      });

      assert.strictEqual(repair.ok, false);
      assert.strictEqual(repair.code, 'pr_base_mismatch');
      assert.strictEqual(reachabilityCalled, false, 'base identity must fail before merge reachability');
      assert.strictEqual(repair.manifest, manifest);
      assert.match(repair.remediation, /manifest\.base_branch is main/);
    });
  }
});

test('UTV2-1613: PR inference refuses an ambiguous or identity-mismatched candidate set', () => {
  const branch = 'claude/utv2-1553-release-merged-lane-lock';
  const base = {
    repository: 'griff843/Unit-Talk-v2',
    state: 'merged',
    merged: true,
    headRefName: branch,
    title: 'fix(lanes): UTV2-1553 release merged-lane lock',
  };

  // Exactly one match is required.
  assert.ok(
    selectInferredMergedPr(
      [{ ...base, url: 'u1', number: 1322, mergeSha: 'sha1' }],
      branch,
      'UTV2-1553',
    ),
  );
  // Two merged PRs on the same head ref: ambiguous authority is never resolved
  // by picking one.
  assert.strictEqual(
    selectInferredMergedPr(
      [
        { ...base, url: 'u1', number: 1322, mergeSha: 'sha1' },
        { ...base, url: 'u2', number: 1323, mergeSha: 'sha2' },
      ],
      branch,
      'UTV2-1553',
    ),
    null,
  );
  // A different head ref never matches, even if the title looks right.
  assert.strictEqual(
    selectInferredMergedPr(
      [{ ...base, url: 'u1', number: 1322, mergeSha: 'sha1', headRefName: 'claude/other' }],
      branch,
      'UTV2-1553',
    ),
    null,
  );
  // Merged-but-no-merge-SHA is not a usable binding.
  assert.strictEqual(
    selectInferredMergedPr(
      [{ ...base, url: 'u1', number: 1322, mergeSha: null }],
      branch,
      'UTV2-1553',
    ),
    null,
  );
  // Not merged at all.
  assert.strictEqual(
    selectInferredMergedPr(
      [{ ...base, url: 'u1', number: 1322, mergeSha: 'sha1', merged: false, state: 'open' }],
      branch,
      'UTV2-1553',
    ),
    null,
  );
});

test('UTV2-1613 adversarial review fix: a matching branch name is never accepted as a stand-in for a real title match', () => {
  // The first version of selectInferredMergedPr accepted
  // `issuePattern.test(title) || issuePattern.test(branch)`. Since a
  // conforming lane branch already embeds the issue ID by this repo's own
  // BRANCH_PATTERN convention, that OR made the title check vacuous -- the
  // only real gate left was headRefName === branch. A PR whose title has
  // nothing to do with this issue, sitting on a stale/reused branch name,
  // must be refused rather than silently bound.
  const branch = 'claude/utv2-1553-release-merged-lane-lock';
  const unrelatedTitleCandidate = {
    repository: 'griff843/Unit-Talk-v2',
    state: 'merged',
    merged: true,
    headRefName: branch,
    title: 'chore: unrelated cleanup with no issue reference',
    url: 'u1',
    number: 9999,
    mergeSha: 'deadbeef',
  };
  assert.strictEqual(
    selectInferredMergedPr([unrelatedTitleCandidate], branch, 'UTV2-1553'),
    null,
    'a title with no reference to the issue must never match merely because the branch name does',
  );
});

test('UTV2-1613: repair refuses an inferred PR whose merge SHA is not reachable from origin/main', () => {
  withTempRepairState(({ repoRoot, artifactRoot, tokenPath }) => {
    const ghost = createManifest({
      issue_id: 'UTV2-1553',
      branch: 'claude/utv2-1553-release-merged-lane-lock',
      status: 'started',
      commit_sha: null,
      pr_url: null,
      preflight_token: tokenPath,
    });

    const repair = repairMergedLaneManifest(ghost, {
      repoRoot,
      artifactRoot,
      inferMergedPrForBranch: () => ({
        url: 'https://github.com/griff843/Unit-Talk-v2/pull/1322',
        number: 1322,
        repository: 'griff843/Unit-Talk-v2',
        state: 'merged',
        merged: true,
        mergeSha: 'not-actually-reachable-sha',
        headRefName: 'claude/utv2-1553-release-merged-lane-lock',
        baseRefName: 'main',
        title: 'fix(lanes): UTV2-1553 release merged-lane lock',
      }),
      isMergeReachable: () => false,
    });

    assert.strictEqual(repair.ok, false);
    assert.strictEqual(repair.code, 'unreachable_merge_sha');
    assert.strictEqual(ghost.status, 'started', 'the original manifest object must be untouched');
  });
});

test('UTV2-1613 adversarial review fix: a failed repaired close persists the measured failure, not the stale pre-run history', () => {
  const repairedManifest = createManifest({
    status: 'merged',
    commit_sha: 'abc123merge456',
    truth_check_history: [], // stale: captured before runTruthCheck ran
  });
  const failing = createTruthCheckResult({
    verdict: 'fail',
    exit_code: 1,
    failures: ['P3'],
    checked_at: '2026-07-31T13:00:00.000Z',
    checks: [{ id: 'P3', status: 'fail', detail: 'proof does not reference merge sha' }],
  });
  const receipt = measuredTruthCheckReceipt({
    command: 'ops:truth-check UTV2-1001',
    runner: 'ops:lane-close',
    result: failing,
    evaluatedStateHash: hashState(repairedManifest),
  });

  const persisted = manifestForFailedRepairClose(repairedManifest, receipt);

  assert.strictEqual(persisted.truth_check_history.length, 1);
  assert.strictEqual(persisted.truth_check_history[0]?.verdict, 'fail');
  assert.deepStrictEqual(persisted.truth_check_history[0]?.failures, ['P3']);
  assert.strictEqual(persisted.truth_check_history[0]?.runner, 'ops:lane-close');
  assert.strictEqual(persisted.status, 'merged', 'the merge binding fields are untouched');
  assert.notStrictEqual(persisted.status, 'done');
});

test('UTV2-1613: manifestForFailedRepairClose is a no-op when the receipt never executed', () => {
  const repairedManifest = createManifest({ status: 'merged', truth_check_history: [] });
  const unexecuted = unexecutedTruthCheckReceipt({
    command: 'ops:lane-close --repair-merged',
    mergeSha: 'abc123merge456',
  });

  const persisted = manifestForFailedRepairClose(repairedManifest, unexecuted);

  assert.deepStrictEqual(persisted, repairedManifest);
  assert.deepStrictEqual(persisted.truth_check_history, []);
});

// ── UTV2-1619 capability 17: truth-gated lifecycle completion ────────────────
// Acceptance is stated as three preventions, and they are deliberately
// different in kind. A design that stops only the first two is incomplete:
//   1. closeout FAILED  -> Done            (no receipt at all)
//   2. bootstrap/no lane -> Done           (no lane, so no receipt possible)
//   3. completed LANE   -> multi-increment issue Done   (valid receipt!)
// The third is the one a receipt-only gate lets through, because its receipt is
// real and honest. It is why the gate needs five conditions rather than one.

function completionManifest(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    issue_id: 'UTV2-9500',
    status: 'done',
    commit_sha: 'a'.repeat(40),
    file_scope_lock: ['scripts/ops/lane-close.ts'],
    files_changed: ['scripts/ops/lane-close.ts'],
    ...overrides,
  } as unknown as LaneManifest;
}

function completionReceipt(overrides: Partial<TruthCheckResult> = {}): TruthCheckResult {
  return {
    verdict: 'pass',
    merge_sha: 'a'.repeat(40),
    runner: 'ops:lane-close',
    checked_at: '2026-08-05T00:00:00.000Z',
    failures: [],
    ...overrides,
  } as unknown as TruthCheckResult;
}

test('TGC-1: all five conditions satisfied -> the issue may be completed', () => {
  const result = evaluateIssueCompletionEligibility({
    manifest: completionManifest(),
    truthCheck: completionReceipt(),
    completionIntent: true,
  });
  assert.strictEqual(result.eligible, true, JSON.stringify(result.unsatisfied));
  assert.strictEqual(result.satisfied.length, 5);
});

test('TGC-2: PREVENTION 1 -- a failing closeout can never complete an issue', () => {
  const result = evaluateIssueCompletionEligibility({
    manifest: completionManifest(),
    truthCheck: completionReceipt({ verdict: 'fail' } as never),
    completionIntent: true,
  });
  assert.strictEqual(result.eligible, false);
  assert.ok(result.unsatisfied.some((u) => u.condition === 'evidence_truth'));
});

test('TGC-3: PREVENTION 2 -- no lane means no receipt, so no completion', () => {
  // The bootstrap case: no manifest existed, so there is no commit_sha, no
  // delivered scope, and no receipt bound to anything.
  const result = evaluateIssueCompletionEligibility({
    manifest: completionManifest({ commit_sha: null, files_changed: [] } as never),
    truthCheck: completionReceipt({ merge_sha: '' } as never),
    completionIntent: true,
  });
  assert.strictEqual(result.eligible, false);
  const failed = result.unsatisfied.map((u) => u.condition);
  assert.ok(failed.includes('authority_truth'));
  assert.ok(failed.includes('scope_truth'));
});

test('TGC-4: PREVENTION 3 -- a truthfully completed lane does NOT complete a multi-increment issue', () => {
  // Every evidence condition holds: passing receipt, canonical runner, bound to
  // the merge SHA, scope delivered, terminal success state. Only the explicit
  // completion intent is absent -- which is exactly the observed reproduction.
  const result = evaluateIssueCompletionEligibility({
    manifest: completionManifest(),
    truthCheck: completionReceipt(),
    // completionIntent deliberately omitted
  });
  assert.strictEqual(result.eligible, false, 'a valid receipt alone must not complete an issue');
  assert.deepStrictEqual(
    result.unsatisfied.map((u) => u.condition),
    ['completion_intent'],
    'evidence, authority, scope and state all hold; only intent is missing',
  );
  assert.strictEqual(result.satisfied.length, 4);
});

test('TGC-5: a receipt bound to a different commit cannot complete the issue', () => {
  const result = evaluateIssueCompletionEligibility({
    manifest: completionManifest({ commit_sha: 'b'.repeat(40) } as never),
    truthCheck: completionReceipt(),
    completionIntent: true,
  });
  assert.strictEqual(result.eligible, false);
  assert.ok(result.unsatisfied.some((u) => u.condition === 'authority_truth'));
});

test('TGC-6: a non-canonical runner is not evidence', () => {
  const result = evaluateIssueCompletionEligibility({
    manifest: completionManifest(),
    truthCheck: completionReceipt({ runner: 'some-script' } as never),
    completionIntent: true,
  });
  assert.strictEqual(result.eligible, false);
  assert.ok(result.unsatisfied.some((u) => u.condition === 'evidence_truth'));
});

test('TGC-7: terminal states that assert no success cannot complete an issue', () => {
  for (const status of ['failed', 'superseded', 'cancelled'] as const) {
    const result = evaluateIssueCompletionEligibility({
      manifest: completionManifest({ status } as never),
      truthCheck: completionReceipt(),
      completionIntent: true,
    });
    assert.strictEqual(result.eligible, false, `"${status}" must never complete an issue`);
    assert.ok(result.unsatisfied.some((u) => u.condition === 'state_truth'));
  }
});

test('TGC-8: delivering outside the declared scope lock fails scope truth', () => {
  const result = evaluateIssueCompletionEligibility({
    manifest: completionManifest({
      files_changed: ['scripts/ops/lane-close.ts', 'apps/worker/src/index.ts'],
    } as never),
    truthCheck: completionReceipt(),
    completionIntent: true,
  });
  assert.strictEqual(result.eligible, false);
  assert.ok(result.unsatisfied.some((u) => u.condition === 'scope_truth'));
});

test('TGC-9: every failing condition is reported, not just the first', () => {
  const result = evaluateIssueCompletionEligibility({
    manifest: completionManifest({ status: 'failed', commit_sha: null, files_changed: [] } as never),
    truthCheck: completionReceipt({ verdict: 'fail', merge_sha: '' } as never),
  });
  assert.strictEqual(result.eligible, false);
  // Fixing these one CI cycle at a time is the failure mode the truth-check M2
  // short-circuit already demonstrated.
  assert.strictEqual(result.unsatisfied.length, 5);
});
