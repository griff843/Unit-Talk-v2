import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addUnsupportedRuntimeChecks,
  evaluateCloseoutTruthGate,
  evaluateRequiredChecksWithHeadFallback,
  evaluateTestRunLogEvidence,
  findPostMergeTouches,
  formatP0Failures,
  hasRuntimeReferences,
  parseRequiredChecksFromBranchProtectionScript,
  type CommitCheckResult,
} from './truth-check-lib.js';
import type { TruthCheckResult } from './shared.js';

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

test('required check fallback parses branch-protection script contexts', () => {
  const checks = parseRequiredChecksFromBranchProtectionScript(`
gh api -X PATCH "repos/\${REPO}/branches/\${BRANCH}/protection/required_status_checks" \\
  -f strict=true \\
  -f 'contexts[]=verify' \\
  -f 'contexts[]=Executor Result Validation' \\
  -f 'contexts[]=Merge Gate' \\
  -f 'contexts[]=P0 Protocol' \\
  -f 'contexts[]=verify'
`);

  assert.deepStrictEqual(checks, [
    'verify',
    'Executor Result Validation',
    'Merge Gate',
    'P0 Protocol',
  ]);
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

test('G5 allows same-issue closeout repair commits before lane is done', () => {
  const result = findPostMergeTouches({
    mergeSha: 'merge-sha',
    filesChanged: ['scripts/ops/truth-check-lib.ts'],
    issueId: 'UTV2-1062',
    allowSameIssueCommits: true,
    showCommit: () => ({
      timestamp: '2026-05-18T20:00:00.000Z',
      subject: 'feat(ops): UTV2-1062 primary merge',
    }),
    gitCommand: (args) => {
      if (args[0] === 'log') {
        return {
          ok: true,
          stdout: [
            'same-issue-sha\tfix(ops): UTV2-1062 closeout repair\t2026-05-18T21:00:00.000Z',
            'unlinked-sha\tfix(ops): closeout repair\t2026-05-18T21:30:00.000Z',
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

  assert.deepStrictEqual(result, ['unlinked-sha']);
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

test('R1 R2 R3 skip for non-T1 tier', () => {
  const checks: Array<{ id: string; status: 'pass' | 'fail' | 'skip'; detail: string }> = [];
  addUnsupportedRuntimeChecks((id, status, detail) => checks.push({ id, status, detail }), false, 'T2', null);

  assert.deepStrictEqual(
    checks.map((check) => [check.id, check.status]),
    [
      ['R1', 'skip'],
      ['R2', 'skip'],
      ['R3', 'skip'],
    ],
  );
});

test('R1 R2 R3 fail for T1 when --no-runtime is set', () => {
  const checks: Array<{ id: string; status: 'pass' | 'fail' | 'skip'; detail: string }> = [];
  addUnsupportedRuntimeChecks((id, status, detail) => checks.push({ id, status, detail }), true, 'T1', null);

  assert.deepStrictEqual(
    checks.map((check) => [check.id, check.status]),
    [
      ['R1', 'fail'],
      ['R2', 'fail'],
      ['R3', 'fail'],
    ],
  );
});

test('R1 R2 R3 fail for T1 when evidence bundle is null', () => {
  const checks: Array<{ id: string; status: 'pass' | 'fail' | 'skip'; detail: string }> = [];
  addUnsupportedRuntimeChecks((id, status, detail) => checks.push({ id, status, detail }), false, 'T1', null);

  assert.deepStrictEqual(
    checks.map((check) => [check.id, check.status]),
    [
      ['R1', 'fail'],
      ['R2', 'fail'],
      ['R3', 'fail'],
    ],
  );
});

test('R1 R2 R3 pass for T1 with valid evidence bundle', () => {
  const checks: Array<{ id: string; status: 'pass' | 'fail' | 'skip'; detail: string }> = [];
  addUnsupportedRuntimeChecks(
    (id, status, detail) => checks.push({ id, status, detail }),
    false,
    'T1',
    {
      bundle: {
        schema_version: 1,
        verifier: { identity: 'runtime-verifier' },
        runtime_proof: {
          queries: [{ table: 'picks', count: 5 }],
          row_counts: [{ table: 'picks', count: 5 }],
        },
      },
    },
  );

  assert.deepStrictEqual(
    checks.map((check) => [check.id, check.status]),
    [
      ['R1', 'pass'],
      ['R2', 'pass'],
      ['R3', 'pass'],
    ],
  );
});

test('R1 fails for T1 when queries empty, R2 fails when row_counts empty, R3 fails when verifier identity missing', () => {
  const checks: Array<{ id: string; status: 'pass' | 'fail' | 'skip'; detail: string }> = [];
  addUnsupportedRuntimeChecks(
    (id, status, detail) => checks.push({ id, status, detail }),
    false,
    'T1',
    {
      bundle: {
        schema_version: 1,
        runtime_proof: {
          queries: [],
          row_counts: [],
        },
      },
    },
  );

  assert.deepStrictEqual(
    checks.map((check) => [check.id, check.status]),
    [
      ['R1', 'fail'],
      ['R2', 'fail'],
      ['R3', 'fail'],
    ],
  );
});

function makeResult(overrides: Partial<TruthCheckResult> = {}): TruthCheckResult {
  return {
    schema_version: 1,
    issue_id: 'UTV2-949',
    tier: 'T2',
    verdict: 'fail',
    exit_code: 1,
    merge_sha: null,
    pr_url: null,
    checked_at: '2026-05-13T00:00:00.000Z',
    checks: [],
    failures: [],
    reopen_reasons: [],
    manifest_path: 'docs/06_status/lanes/UTV2-949.json',
    ...overrides,
  };
}

test('formatP0Failures returns empty string when no H-check failures', () => {
  const result = makeResult({
    checks: [
      { id: 'G1', status: 'pass', detail: 'manifest present' },
      { id: 'H1', status: 'pass', detail: 'claude-critique present' },
    ],
  });
  assert.strictEqual(formatP0Failures(result), '');
});

test('formatP0Failures returns empty string when H-check is present but passed', () => {
  const result = makeResult({
    checks: [
      { id: 'H2', status: 'pass', detail: 'runtime-verification present and passing' },
    ],
  });
  assert.strictEqual(formatP0Failures(result), '');
});

test('formatP0Failures emits one JSON line per failing H-check', () => {
  const result = makeResult({
    issue_id: 'UTV2-949',
    verdict: 'fail',
    checks: [
      { id: 'H2', status: 'fail', detail: 'missing required artifact: docs/06_status/proof/UTV2-949/runtime-verification.md' },
      { id: 'H3', status: 'fail', detail: 'runtime-verification.md does not contain result: pass' },
    ],
  });
  const output = formatP0Failures(result);
  const lines = output.split('\n');
  assert.strictEqual(lines.length, 2);

  const first = JSON.parse(lines[0]!);
  assert.strictEqual(first.event, 'p0_protocol.h_check_failed');
  assert.strictEqual(first.check_id, 'H2');
  assert.strictEqual(first.issue_id, 'UTV2-949');
  assert.strictEqual(first.block_reason, 'missing required artifact: docs/06_status/proof/UTV2-949/runtime-verification.md');
  assert.strictEqual(first.verdict, 'fail');
  assert.strictEqual(first.runbook, 'docs/05_operations/P0_PROTOCOL_SPEC.md');

  const second = JSON.parse(lines[1]!);
  assert.strictEqual(second.check_id, 'H3');
  assert.strictEqual(second.block_reason, 'runtime-verification.md does not contain result: pass');
});

test('formatP0Failures ignores non-H check failures', () => {
  const result = makeResult({
    checks: [
      { id: 'G4', status: 'fail', detail: 'required checks missing' },
      { id: 'P1', status: 'fail', detail: 'proof bundle missing' },
    ],
  });
  assert.strictEqual(formatP0Failures(result), '');
});

function closeoutInput(
  overrides: Partial<Parameters<typeof evaluateCloseoutTruthGate>[0]> = {},
): Parameters<typeof evaluateCloseoutTruthGate>[0] {
  const mergeSha = 'abc123merge';
  return {
    manifest: {
      issue_id: 'UTV2-1058',
      status: 'merged',
      commit_sha: mergeSha,
      pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1058',
      files_changed: ['scripts/ops/truth-check-lib.ts'],
      expected_proof_paths: ['docs/06_status/proof/UTV2-1058/verification.log'],
      created_by: 'codex-cli',
    },
    linear_state: 'Done',
    pr_merged: true,
    pr_merge_sha: mergeSha,
    pr_head_sha: 'head456',
    proof_artifacts: [
      {
        path: 'docs/06_status/proof/UTV2-1058/verification.log',
        content: `MERGE_SHA: ${mergeSha}\npnpm verify pass`,
        mtime_ms: 2000,
      },
    ],
    merge_timestamp_ms: 1000,
    runtime_proof_required: false,
    transition_age_ms: 0,
    ...overrides,
  };
}

function failedCloseoutIds(input: Parameters<typeof evaluateCloseoutTruthGate>[0]): string[] {
  return evaluateCloseoutTruthGate(input)
    .filter((check) => check.status === 'fail')
    .map((check) => check.id);
}

test('closeout truth gate passes clean merged closeout', () => {
  assert.deepStrictEqual(failedCloseoutIds(closeoutInput()), []);
});

test('closeout truth gate fails Done without merged PR SHA', () => {
  assert.deepStrictEqual(
    failedCloseoutIds(closeoutInput({ pr_merge_sha: null })),
    ['C1'],
  );
});

test('closeout truth gate fails completed work without manifest merge SHA', () => {
  const input = closeoutInput();
  input.manifest = { ...input.manifest, commit_sha: null };
  input.proof_artifacts = [
    {
      path: 'docs/06_status/proof/UTV2-1058/verification.log',
      content: 'HEAD_SHA: head456\npnpm verify pass',
      mtime_ms: 2000,
    },
  ];

  assert.deepStrictEqual(failedCloseoutIds(input), ['C2']);
});

test('closeout truth gate fails proof without merge or head SHA binding', () => {
  assert.deepStrictEqual(
    failedCloseoutIds(
      closeoutInput({
        proof_artifacts: [
          {
            path: 'docs/06_status/proof/UTV2-1058/verification.log',
            content: 'pnpm verify pass without sha',
            mtime_ms: 2000,
          },
        ],
      }),
    ),
    ['C4'],
  );
});

test('closeout truth gate fails runtime-proof narrative closure', () => {
  assert.deepStrictEqual(
    failedCloseoutIds(
      closeoutInput({
        runtime_proof_required: true,
        proof_artifacts: [
          {
            path: 'docs/06_status/proof/UTV2-1058/evidence.json',
            content: '{"schema_version":1,"merge_sha":"abc123merge","static_proof":{"summary":"tests passed"}}',
            mtime_ms: 2000,
          },
        ],
      }),
    ),
    ['C6'],
  );
});

test('closeout truth gate accepts runtime-proof with live evidence references', () => {
  assert.deepStrictEqual(
    failedCloseoutIds(
      closeoutInput({
        runtime_proof_required: true,
        proof_artifacts: [
          {
            path: 'docs/06_status/proof/UTV2-1058/evidence.json',
            content: JSON.stringify({
              schema_version: 1,
              merge_sha: 'abc123merge',
              runtime_proof: { row_counts: [{ table: 'picks', count: 1 }] },
            }),
            mtime_ms: 2000,
          },
        ],
      }),
    ),
    [],
  );
});

test('closeout truth gate fails manifest and Linear drift beyond transition window', () => {
  assert.deepStrictEqual(
    failedCloseoutIds(
      closeoutInput({
        linear_state: 'In Review',
        pr_merged: true,
        transition_age_ms: 60 * 60 * 1000,
        allowed_transition_ms: 30 * 60 * 1000,
      }),
    ),
    ['C7'],
  );
});
