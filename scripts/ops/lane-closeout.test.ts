import test from 'node:test';
import assert from 'node:assert/strict';
import { runLaneCloseout, type LaneCloseoutDeps } from './lane-closeout.js';
import type { LaneManifest } from './shared.js';
import type { TruthCheckResult } from './shared.js';

function manifest(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    schema_version: 1,
    issue_id: 'UTV2-2001',
    lane_type: 'governance',
    executor: 'codex-cli',
    tier: 'T2',
    worktree_path: '.',
    branch: 'codex/utv2-2001-closeout',
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: ['scripts/ops/lane-closeout.ts'],
    expected_proof_paths: ['docs/06_status/proof/UTV2-2001/diff-summary.md'],
    status: 'in_review',
    started_at: '2026-06-01T09:00:00.000Z',
    heartbeat_at: '2026-06-01T09:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: 'dispatch-auto',
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
    ...overrides,
  };
}

function passingTruthCheck(overrides: Partial<TruthCheckResult> = {}): TruthCheckResult {
  return {
    schema_version: 1,
    issue_id: 'UTV2-2001',
    tier: 'T2',
    verdict: 'pass',
    exit_code: 0,
    merge_sha: 'deadbeef',
    pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/2001',
    checked_at: '2026-06-01T10:00:00.000Z',
    checks: [],
    failures: [],
    reopen_reasons: [],
    manifest_path: 'docs/06_status/lanes/UTV2-2001.json',
    ...overrides,
  };
}

/**
 * Builds a fully-stubbed deps object. Every real I/O call (manifest
 * read/write, GitHub calls, truth-check, lock lifecycle) is replaced with an
 * in-memory fake, and every call is recorded in `calls` so tests can assert
 * on both outcome and call order/count without touching disk or network.
 */
function makeDeps(input: {
  manifest: LaneManifest;
  truthCheckResult?: TruthCheckResult | ((call: number) => TruthCheckResult);
  calls: string[];
}): LaneCloseoutDeps {
  let currentManifest = input.manifest;
  let truthCheckCallCount = 0;

  return {
    manifestExists: () => {
      input.calls.push('manifestExists');
      return true;
    },
    readManifest: () => {
      input.calls.push('readManifest');
      return currentManifest;
    },
    writeManifest: (next) => {
      input.calls.push('writeManifest');
      currentManifest = next;
    },
    fetchPrMergeInfo: (prInput) => {
      input.calls.push('fetchPrMergeInfo');
      return { input: prInput, url: `https://github.com/griff843/Unit-Talk-v2/pull/${prInput}`, merged: true, mergeSha: 'deadbeef', state: 'merged' };
    },
    applyPrMergeToManifest: ({ manifest: m, pr, now }) => {
      input.calls.push('applyPrMergeToManifest');
      const next: LaneManifest = {
        ...m,
        status: 'merged',
        commit_sha: pr.mergeSha,
        pr_url: pr.url,
        heartbeat_at: now,
      };
      return { manifest: next, changed: true, historyAppended: true };
    },
    runTruthCheck: async () => {
      input.calls.push('runTruthCheck');
      truthCheckCallCount += 1;
      if (typeof input.truthCheckResult === 'function') {
        return input.truthCheckResult(truthCheckCallCount);
      }
      return input.truthCheckResult ?? passingTruthCheck();
    },
    ensureCloseoutMergeLock: () => {
      input.calls.push('ensureCloseoutMergeLock');
      return { ok: true, code: 'merge_lock_acquired', message: 'ok' } as ReturnType<
        LaneCloseoutDeps['ensureCloseoutMergeLock']
      >;
    },
    requireCloseCommitSha: (m) => {
      input.calls.push('requireCloseCommitSha');
      if (m.status !== 'done' && !m.commit_sha) {
        throw new Error('ERROR: Lane close requires commit_sha — run ops:truth-check first');
      }
    },
    releaseCloseoutLocks: () => {
      input.calls.push('releaseCloseoutLocks');
      return { warnings: [] };
    },
    applyTierLabel: () => {
      input.calls.push('applyTierLabel');
      return { ok: true, message: 'tier:T2 label applied' };
    },
    now: () => new Date('2026-06-01T12:00:00.000Z'),
  };
}

test('happy path: all four steps run in order and report success', async () => {
  const calls: string[] = [];
  const deps = makeDeps({ manifest: manifest(), calls });

  const result = await runLaneCloseout({ issueId: 'UTV2-2001', pr: '2001' }, deps);

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.steps.map((s) => s.id),
    ['record-merge', 'truth-check', 'lane-close', 'lane-finalize'],
  );
  assert.ok(result.steps.every((s) => s.status === 'pass'));
  assert.deepEqual(calls, [
    'manifestExists',
    'readManifest',
    'fetchPrMergeInfo',
    'applyPrMergeToManifest',
    'writeManifest',
    'runTruthCheck',
    'readManifest',
    'ensureCloseoutMergeLock',
    'requireCloseCommitSha',
    'runTruthCheck',
    'writeManifest',
    'releaseCloseoutLocks',
    'applyTierLabel',
  ]);
});

test('stop-on-first-failure: truth-check failure prevents lane-close and lane-finalize from running', async () => {
  const calls: string[] = [];
  const deps = makeDeps({
    manifest: manifest(),
    truthCheckResult: passingTruthCheck({ verdict: 'fail', exit_code: 1, failures: ['P1'] }),
    calls,
  });

  const result = await runLaneCloseout({ issueId: 'UTV2-2001', pr: '2001' }, deps);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.steps.map((s) => s.id),
    ['record-merge', 'truth-check'],
  );
  assert.equal(result.steps[1]?.status, 'fail');
  assert.equal(calls.includes('ensureCloseoutMergeLock'), false, 'lane-close must not run after truth-check fails');
  assert.equal(calls.includes('applyTierLabel'), false, 'lane-finalize must not run after truth-check fails');
});

test('--dry-run reports planned actions and calls no mutating function', async () => {
  const calls: string[] = [];
  const deps = makeDeps({ manifest: manifest(), calls });

  const result = await runLaneCloseout({ issueId: 'UTV2-2001', pr: '2001', dryRun: true }, deps);

  assert.equal(result.ok, true);
  assert.equal(result.dry_run, true);
  assert.ok(result.steps.every((s) => s.status === 'planned' || s.status === 'skipped'));
  const mutatingCalls = [
    'writeManifest',
    'fetchPrMergeInfo',
    'applyPrMergeToManifest',
    'runTruthCheck',
    'ensureCloseoutMergeLock',
    'releaseCloseoutLocks',
    'applyTierLabel',
  ];
  for (const mutating of mutatingCalls) {
    assert.equal(calls.includes(mutating), false, `${mutating} must not be called during --dry-run`);
  }
});

test('idempotent skip: record-merge is skipped when manifest already shows the merge recorded, but later steps still run', async () => {
  const calls: string[] = [];
  const deps = makeDeps({
    manifest: manifest({ status: 'merged', commit_sha: 'deadbeef', pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/2001' }),
    calls,
  });

  const result = await runLaneCloseout({ issueId: 'UTV2-2001' }, deps);

  assert.equal(result.ok, true);
  assert.equal(result.steps[0]?.id, 'record-merge');
  assert.equal(result.steps[0]?.status, 'skipped');
  assert.equal(calls.includes('applyPrMergeToManifest'), false, 'record-merge mutation must not run when already recorded');
  assert.deepEqual(
    result.steps.map((s) => s.id),
    ['record-merge', 'truth-check', 'lane-close', 'lane-finalize'],
  );
  assert.ok(result.steps.slice(1).every((s) => s.status === 'pass'), 'steps after the skip must still run');
});
