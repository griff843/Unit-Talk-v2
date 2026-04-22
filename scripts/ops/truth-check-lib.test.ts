import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addUnsupportedRuntimeChecks,
  evaluateRequiredChecksWithHeadFallback,
  evaluateTestRunLogEvidence,
  findPostMergeTouches,
  hasRuntimeReferences,
  type CommitCheckResult,
} from './truth-check-lib.js';

function resolveExitCode(
  manifestStatus: 'merged' | 'done',
  failingIds: string[],
): 0 | 1 | 4 {
  if (failingIds.includes('G5')) {
    return 4;
  }
  if (failingIds.length > 0) {
    return 1;
  }
  return 0;
}

test('truth-check verdict mapping preserves reopen semantics for G5', () => {
  assert.strictEqual(resolveExitCode('done', ['G5']), 4);
  assert.strictEqual(resolveExitCode('merged', ['G4']), 1);
  assert.strictEqual(resolveExitCode('merged', []), 0);
});

function scopeDiffCheck(
  filesChanged: string[],
  fileScopeLock: string[],
  expectedProofPaths: string[],
): { status: 'pass' | 'fail'; outOfScope: string[] } {
  if (filesChanged.length === 0 || fileScopeLock.length === 0) {
    return { status: 'pass', outOfScope: [] };
  }
  const allowedPaths = new Set([...fileScopeLock, ...expectedProofPaths]);
  const outOfScope = filesChanged.filter(
    (f) =>
      !allowedPaths.has(f) &&
      !f.includes('deleted-file') &&
      !f.startsWith('docs/06_status/proof/'),
  );
  return { status: outOfScope.length > 0 ? 'fail' : 'pass', outOfScope };
}

test('scope-diff check passes when files_changed within scope', () => {
  const result = scopeDiffCheck(
    ['scripts/ops/truth-check-lib.ts'],
    ['scripts/ops/truth-check-lib.ts', 'scripts/ops/shared.ts'],
    [],
  );
  assert.strictEqual(result.status, 'pass');
  assert.strictEqual(result.outOfScope.length, 0);
});

test('scope-diff check fails when files_changed outside scope', () => {
  const result = scopeDiffCheck(
    ['scripts/ops/truth-check-lib.ts', 'apps/api/src/index.ts'],
    ['scripts/ops/truth-check-lib.ts'],
    [],
  );
  assert.strictEqual(result.status, 'fail');
  assert.deepStrictEqual(result.outOfScope, ['apps/api/src/index.ts']);
});

test('scope-diff check allows proof paths outside scope', () => {
  const result = scopeDiffCheck(
    ['scripts/ops/shared.ts', 'docs/06_status/proof/UTV2-100/diff-summary.md'],
    ['scripts/ops/shared.ts'],
    ['docs/06_status/proof/UTV2-100/diff-summary.md'],
  );
  assert.strictEqual(result.status, 'pass');
});

test('scope-diff check allows deleted-file markers', () => {
  const result = scopeDiffCheck(
    ['scripts/ops/shared.ts', 'docs/06_status/lanes/deleted-file.json'],
    ['scripts/ops/shared.ts'],
    [],
  );
  assert.strictEqual(result.status, 'pass');
});

test('scope-diff check passes when files_changed is empty', () => {
  const result = scopeDiffCheck([], ['scripts/ops/shared.ts'], []);
  assert.strictEqual(result.status, 'pass');
});

test('G4 falls back to PR head SHA when merge commit checks are missing', async () => {
  const checkedShas: string[] = [];
  const result = await evaluateRequiredChecksWithHeadFallback({
    mergeSha: 'merge-sha',
    headSha: 'head-sha',
    requiredChecks: ['Executor Result Validation', 'Merge Gate CI'],
    fetchChecks: async (sha): Promise<CommitCheckResult> => {
      checkedShas.push(sha);
      return sha === 'head-sha'
        ? { passed: true, missing: [] }
        : { passed: false, missing: ['Executor Result Validation'] };
    },
  });

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.checkedSha, 'head');
  assert.deepStrictEqual(checkedShas, ['merge-sha', 'head-sha']);
});

test('G5 ignores commits before the lane start timestamp', () => {
  const result = findPostMergeTouches({
    mergeSha: 'merge-sha',
    filesChanged: ['scripts/ops/truth-check-lib.ts'],
    issueId: 'UTV2-714',
    laneStartedAt: '2026-04-22T10:00:00.000Z',
    showCommit: () => ({
      timestamp: '2026-04-22T12:00:00.000Z',
      subject: 'fix(ops): UTV2-714 merge',
    }),
    gitCommand: (args) => {
      if (args[0] === 'log') {
        return {
          ok: true,
          stdout: [
            'post-lane-sha\tfix(ops): UTV2-714 post lane\t2026-04-22T11:00:00.000Z',
            'pre-lane-sha\tfix(ops): UTV2-714 pre lane\t2026-04-22T09:00:00.000Z',
          ].join('\n'),
          stderr: '',
        };
      }

      return {
        ok: true,
        stdout: 'scripts/ops/truth-check-lib.ts\n',
        stderr: '',
      };
    },
  });

  assert.deepStrictEqual(result, ['post-lane-sha']);
});

test('P8 skips absent test_run_logs and fails present logs without merge SHA', () => {
  assert.strictEqual(evaluateTestRunLogEvidence({}, 'merge-sha'), 'skip');
  assert.strictEqual(evaluateTestRunLogEvidence({ test_run_logs: [] }, 'merge-sha'), 'skip');
  assert.strictEqual(
    evaluateTestRunLogEvidence({ test_run_logs: [{ merge_sha: 'other-sha' }] }, 'merge-sha'),
    'fail',
  );
  assert.strictEqual(
    evaluateTestRunLogEvidence({ test_run_logs: [{ merge_sha: 'merge-sha' }] }, 'merge-sha'),
    'pass',
  );
});

test('P9 accepts flat key-value runtime proof entries', () => {
  assert.strictEqual(hasRuntimeReferences({ closing_line_coverage_after: '403/780' }), true);
  assert.strictEqual(hasRuntimeReferences({ checked_rows: 12 }), true);
  assert.strictEqual(hasRuntimeReferences({ closing_line_coverage_after: '   ', checked_rows: 0 }), false);
});

test('R1 R2 R3 skip for T1 when phase contracts are not required', () => {
  const checks: Array<{ id: string; status: 'pass' | 'fail' | 'skip'; detail: string }> = [];
  addUnsupportedRuntimeChecks((id, status, detail) => checks.push({ id, status, detail }), false, 'T1', false);

  assert.deepStrictEqual(
    checks.map((check) => [check.id, check.status]),
    [
      ['R1', 'skip'],
      ['R2', 'skip'],
      ['R3', 'skip'],
    ],
  );
});
