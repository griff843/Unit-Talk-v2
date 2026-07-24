import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addUnsupportedRuntimeChecks,
  checkCommitReachableFromMain,
  classifyRuntimeProofGap,
  evaluateCloseoutTruthGate,
  evaluateFableRoutingEvidence,
  evaluateRequiredChecksWithHeadFallback,
  evaluateT2ProofEvidence,
  evaluateTestRunLogEvidence,
  findLatestFableReview,
  findPostMergeTouches,
  formatP0Failures,
  hasRuntimeReferences,
  isLinearStatePermittedForL3,
  parseRequiredChecksFromBranchProtectionScript,
  type CommitCheckResult,
  type EvidenceBundleV1,
  type GitHubIssueComment,
} from './truth-check-lib.js';
import type { CheckResult, TruthCheckResult } from './shared.js';

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

test('G4 accepts admin-merged PR when only Merge Gate is stuck on head SHA', async () => {
  const result = await evaluateRequiredChecksWithHeadFallback({
    mergeSha: 'merge-sha',
    headSha: 'head-sha',
    requiredChecks: ['verify', 'Executor Result Validation', 'Merge Gate', 'P0 Protocol'],
    allowAdminMergeGateBypass: true,
    fetchChecks: async (sha): Promise<CommitCheckResult> => {
      if (sha === 'head-sha') {
        return { passed: false, missing: ['Merge Gate'] };
      }
      return {
        passed: false,
        missing: ['verify', 'Executor Result Validation', 'Merge Gate', 'P0 Protocol'],
      };
    },
  });

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.checkedSha, 'head-admin-merge');
  assert.deepStrictEqual(result.missing, []);
  assert.deepStrictEqual(result.bypassed, ['Merge Gate']);
});

test('G4 admin-merge recovery fails closed when non-governance checks are missing', async () => {
  const result = await evaluateRequiredChecksWithHeadFallback({
    mergeSha: 'merge-sha',
    headSha: 'head-sha',
    requiredChecks: ['verify', 'Executor Result Validation', 'Merge Gate'],
    allowAdminMergeGateBypass: true,
    fetchChecks: async (sha): Promise<CommitCheckResult> => {
      if (sha === 'head-sha') {
        return { passed: false, missing: ['verify', 'Merge Gate'] };
      }
      return { passed: false, missing: ['verify', 'Executor Result Validation', 'Merge Gate'] };
    },
  });

  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.checkedSha, 'merge');
  assert.deepStrictEqual(result.missing, ['verify', 'Executor Result Validation', 'Merge Gate']);
});

test('G4 admin-merge recovery is disabled unless caller confirms merged PR context', async () => {
  const result = await evaluateRequiredChecksWithHeadFallback({
    mergeSha: 'merge-sha',
    headSha: 'head-sha',
    requiredChecks: ['verify', 'Merge Gate'],
    fetchChecks: async (sha): Promise<CommitCheckResult> => {
      if (sha === 'head-sha') {
        return { passed: false, missing: ['Merge Gate'] };
      }
      return { passed: false, missing: ['verify', 'Merge Gate'] };
    },
  });

  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.checkedSha, 'merge');
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

test('G5 ignores commits before the lane start timestamp and merge timestamp', () => {
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
            'post-merge-sha\tfix(ops): UTV2-714 post merge\t2026-04-22T13:00:00.000Z',
            'pre-merge-sha\tfix(ops): UTV2-714 pre merge\t2026-04-22T11:00:00.000Z',
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

  assert.deepStrictEqual(result, ['post-merge-sha']);
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

test('G5 ignores manifest and proof closeout paths when checking post-merge implementation touches', () => {
  const filesChanged = [
    'docs/06_status/lanes/UTV2-1178.json',
    'docs/06_status/proof/UTV2-1178/evidence.json',
    'packages/invariants/src/engine.ts',
  ];
  const finalizedFiles = filesChanged.filter(
    (filePath) =>
      filePath !== 'docs/06_status/lanes/UTV2-1178.json' &&
      !filePath.startsWith('docs/06_status/proof/'),
  );

  const result = findPostMergeTouches({
    mergeSha: 'merge-sha',
    filesChanged: finalizedFiles,
    issueId: 'UTV2-1178',
    showCommit: () => ({
      timestamp: '2026-05-27T12:00:00.000Z',
      subject: 'feat(ops): UTV2-1178 primary merge',
    }),
    gitCommand: (args) => {
      if (args[0] === 'log') {
        return {
          ok: true,
          stdout: [
            'proof-sha\tchore(proof): UTV2-1178 bind proof evidence\t2026-05-27T13:00:00.000Z',
            'manifest-sha\tdocs(proof): UTV2-1178 record closeout\t2026-05-27T13:05:00.000Z',
          ].join('\n'),
          stderr: '',
        };
      }

      const sha = args.at(-1);
      return {
        ok: true,
        stdout: sha === 'proof-sha'
          ? 'docs/06_status/proof/UTV2-1178/evidence.json\n'
          : 'docs/06_status/lanes/UTV2-1178.json\n',
        stderr: '',
      };
    },
  });

  assert.deepStrictEqual(result, []);
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
      expected_proof_paths: ['docs/06_status/proof/UTV2-1058/verification.md'],
      created_by: 'codex-cli',
    },
    linear_state: 'Done',
    pr_merged: true,
    pr_merge_sha: mergeSha,
    pr_head_sha: 'head456',
    proof_artifacts: [
      {
        path: 'docs/06_status/proof/UTV2-1058/verification.md',
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
      path: 'docs/06_status/proof/UTV2-1058/verification.md',
      content: 'MERGE_SHA: abc123merge\npnpm verify pass',
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
            path: 'docs/06_status/proof/UTV2-1058/verification.md',
            content: 'pnpm verify pass without sha',
            mtime_ms: 2000,
          },
        ],
      }),
    ),
    ['C4'],
  );
});

test('closeout truth gate requires merge SHA binding when merge SHA is available', () => {
  assert.deepStrictEqual(
    failedCloseoutIds(
      closeoutInput({
        proof_artifacts: [
          {
            path: 'docs/06_status/proof/UTV2-1058/verification.md',
            content: 'HEAD_SHA: head456\npnpm verify pass',
            mtime_ms: 2000,
          },
        ],
      }),
    ),
    ['C4'],
  );
});

test('closeout truth gate can use head SHA only when no merge SHA is available', () => {
  const input = closeoutInput({
    linear_state: 'In Review',
    pr_merged: false,
    pr_merge_sha: null,
    merge_timestamp_ms: null,
  });
  input.manifest = {
    ...input.manifest,
    commit_sha: null,
    files_changed: [],
    expected_proof_paths: [],
  };
  input.proof_artifacts = [
    {
      path: 'docs/06_status/proof/UTV2-1058/verification.md',
      content: 'HEAD_SHA: head456\npnpm verify pass',
      mtime_ms: 2000,
    },
  ];

  assert.deepStrictEqual(failedCloseoutIds(input), []);
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

test('closeout truth gate rejects narrative text that only names live proof', () => {
  assert.deepStrictEqual(
    failedCloseoutIds(
      closeoutInput({
        runtime_proof_required: true,
        proof_artifacts: [
          {
            path: 'docs/06_status/proof/UTV2-1058/verification.md',
            content: 'MERGE_SHA: abc123merge\nLive DB was checked by the implementer.',
            mtime_ms: 2000,
          },
        ],
      }),
    ),
    ['C6'],
  );
});

test('closeout truth gate accepts text runtime proof with concrete row counts', () => {
  assert.deepStrictEqual(
    failedCloseoutIds(
      closeoutInput({
        runtime_proof_required: true,
        proof_artifacts: [
          {
            path: 'docs/06_status/proof/UTV2-1058/verification.md',
            content: 'MERGE_SHA: abc123merge\nruntime_proof.row_counts picks=12',
            mtime_ms: 2000,
          },
        ],
      }),
    ),
    [],
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

test('closeout truth gate fails Done manifest with unmerged PR', () => {
  assert.deepStrictEqual(
    failedCloseoutIds(
      closeoutInput({
        manifest: {
          ...closeoutInput().manifest,
          status: 'done',
        },
        linear_state: 'In Review',
        pr_merged: false,
        transition_age_ms: 60 * 60 * 1000,
      }),
    ),
    ['C7'],
  );
});

function t2ProofFailureIds(input: {
  proofPaths?: string[];
  proofContents?: string;
} = {}): string[] {
  return evaluateT2ProofEvidence({
    proofPaths: input.proofPaths ?? ['docs/06_status/proof/UTV2-1190/diff-summary.md'],
    proofContents: input.proofContents ?? [
      '## Diff Summary',
      'pnpm type-check: PASS',
      'pnpm test: PASS',
      'pnpm verify: PASS',
      'npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD: PASS',
    ].join('\n'),
  })
    .filter((check) => check.status === 'fail')
    .map((check) => check.id);
}

test('T2 proof evidence requires diff summary, focused checks, pnpm verify, and r-level check', () => {
  assert.deepStrictEqual(t2ProofFailureIds(), []);
});

test('T2 proof evidence fails closed when pnpm verify is absent', () => {
  assert.deepStrictEqual(
    t2ProofFailureIds({
      proofContents: [
        '## Diff Summary',
        'pnpm type-check: PASS',
        'pnpm test: PASS',
        'npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD: PASS',
      ].join('\n'),
    }),
    ['P13'],
  );
});

test('T2 proof evidence fails closed when r-level-check is absent', () => {
  assert.deepStrictEqual(
    t2ProofFailureIds({
      proofContents: [
        '## Diff Summary',
        'pnpm type-check: PASS',
        'pnpm test: PASS',
        'pnpm verify: PASS',
      ].join('\n'),
    }),
    ['P14'],
  );
});

test('T2 proof evidence does not treat verify:commands as pnpm verify', () => {
  assert.deepStrictEqual(
    t2ProofFailureIds({
      proofContents: [
        '## Diff Summary',
        'pnpm type-check: PASS',
        'pnpm test: PASS',
        'pnpm verify:commands: PASS',
        'npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD: PASS',
      ].join('\n'),
    }),
    ['P13'],
  );
});

// ── Fable pilot routing evidence (UTV2-1569) ──────────────────────────────────

function fableManifestFixture(
  planningModelRouting?: Parameters<typeof evaluateFableRoutingEvidence>[0]['manifest']['planning_model_routing'],
): Parameters<typeof evaluateFableRoutingEvidence>[0]['manifest'] {
  return {
    schema_version: 2,
    issue_id: 'UTV2-9001',
    lane_type: 'governance',
    executor: 'claude',
    tier: 'T1',
    worktree_path: '.out/worktrees/claude__utv2-9001-fixture',
    branch: 'claude/utv2-9001-fixture',
    base_branch: 'main',
    commit_sha: 'abc123',
    pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/9001',
    files_changed: [],
    file_scope_lock: ['scripts/ops/truth-check-lib.ts'],
    expected_proof_paths: ['docs/06_status/proof/UTV2-9001/evidence.json'],
    status: 'merged',
    started_at: '2026-07-21T00:00:00.000Z',
    heartbeat_at: '2026-07-21T00:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: '.out/ops/preflight/claude/utv2-9001-fixture.json',
    created_by: 'claude',
    truth_check_history: [],
    reopen_history: [],
    ...(planningModelRouting ? { planning_model_routing: planningModelRouting } : {}),
  };
}

const FABLE_HEAD_SHA = 'e37d28a9c0a471c7824ef35a1ab0f0338369af05';

function fableReviewComment(overrides: Partial<Record<string, string>> = {}, author = 'someone-else'): GitHubIssueComment {
  const fields = {
    Issue: 'UTV2-9001',
    'Trigger class': 'repeated_architecture_bounce',
    'Policy version': '1.0.0',
    'Reviewed head SHA': FABLE_HEAD_SHA,
    binding: 'false',
    advisory_only: 'true',
    reviewer_independent_of_author: 'true',
    ...overrides,
  };
  const body = [
    'FABLE_REVIEW: ADVISORY',
    'schema: fable-review/v1',
    ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`),
  ].join('\n');
  return { body, user: { login: author, type: 'User' } };
}

function fableFailureIds(input: {
  planningModelRouting?: Parameters<typeof evaluateFableRoutingEvidence>[0]['manifest']['planning_model_routing'];
  comments?: GitHubIssueComment[];
  reviewedHeadSha?: string | null;
}): string[] {
  return evaluateFableRoutingEvidence({
    manifest: fableManifestFixture(input.planningModelRouting),
    issueId: 'UTV2-9001',
    comments: input.comments ?? [],
    reviewedHeadSha: 'reviewedHeadSha' in input ? input.reviewedHeadSha! : FABLE_HEAD_SHA,
  })
    .filter((check) => check.status === 'fail')
    .map((check) => check.id);
}

const fableRouting = (overrides: Partial<NonNullable<Parameters<typeof evaluateFableRoutingEvidence>[0]['manifest']['planning_model_routing']>> = {}) => ({
  model: 'claude-fable-5' as const,
  profile: 'fable-pilot-advisory',
  selected_by: 'three-brain' as const,
  rationale: 'repeated architecture bounce',
  policy_version: '1.0.0',
  fallback_used: false,
  ...overrides,
});

test('Fable routing evidence check is a no-op skip for a lane with no planning_model_routing at all', () => {
  const results = evaluateFableRoutingEvidence({
    manifest: fableManifestFixture(undefined),
    issueId: 'UTV2-9001',
    comments: [],
    reviewedHeadSha: null,
  });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0]!.status, 'skip');
});

test('Fable routing evidence check is a no-op skip for a Sonnet planning_model_routing (not Fable)', () => {
  const results = evaluateFableRoutingEvidence({
    manifest: fableManifestFixture({
      model: 'claude-sonnet-5',
      profile: 'sonnet-default',
      selected_by: 'three-brain',
      rationale: 'ordinary work',
      policy_version: '1.0.0',
      fallback_used: false,
    }),
    issueId: 'UTV2-9001',
    comments: [],
    reviewedHeadSha: null,
  });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0]!.status, 'skip');
});

test('Fable routing evidence check fails closed on a Fable-routed lane with no review comment at all', () => {
  // policy_version deliberately matches the real shipped fable-pilot-policy.json here
  // so F3 (drift detection) passes and this test isolates F1/F2 (missing evidence)
  // specifically -- F3's own drift behavior is covered by the two tests below.
  assert.deepStrictEqual(
    fableFailureIds({ planningModelRouting: fableRouting(), comments: [] }).sort(),
    ['F1', 'F2'],
  );
});

test('Fable routing evidence check passes F1/F2 with a real, correctly-bound fable-review/v1 comment', () => {
  const failures = fableFailureIds({
    planningModelRouting: fableRouting(),
    comments: [fableReviewComment()],
  });
  assert.ok(!failures.includes('F1'), 'F1 should pass with a valid fable-review/v1 record');
  assert.ok(!failures.includes('F2'), 'F2 should pass when the record is bound to the exact reviewed head');
});

test('Fable routing evidence check F1 rejects loose text that merely mentions the right keywords without the real schema header', () => {
  const failures = fableFailureIds({
    planningModelRouting: fableRouting(),
    comments: [
      {
        body: [
          '## Diff Summary',
          'reviewer_independent_of_author: true',
          'binding: false',
          'advisory_only: true',
          'this text mentions the right words but is not a real fable-review/v1 comment',
        ].join('\n'),
      },
    ],
  });
  assert.ok(failures.includes('F1'), 'F1 must fail closed on loose text lacking the exact schema header');
});

test('Fable routing evidence check F1 rejects a record with an unrecognized trigger class', () => {
  const failures = fableFailureIds({
    planningModelRouting: fableRouting(),
    comments: [fableReviewComment({ 'Trigger class': 'i_made_this_up' })],
  });
  assert.ok(failures.includes('F1'), 'F1 must reject a trigger class outside the four ratified classes');
});

test('Fable routing evidence check F1 rejects a record missing reviewer_independent_of_author: true (no override)', () => {
  const failures = fableFailureIds({
    planningModelRouting: fableRouting(),
    comments: [fableReviewComment({ reviewer_independent_of_author: 'false' })],
  });
  assert.ok(failures.includes('F1'), 'F1 must reject when reviewer_independent_of_author is not exactly true');
});

test('Fable routing evidence check F1 rejects a record asserting binding: true or missing advisory_only: true', () => {
  const boundFailures = fableFailureIds({
    planningModelRouting: fableRouting(),
    comments: [fableReviewComment({ binding: 'true' })],
  });
  assert.ok(boundFailures.includes('F1'), 'F1 must reject binding: true');

  const noAdvisoryFailures = fableFailureIds({
    planningModelRouting: fableRouting(),
    comments: [fableReviewComment({ advisory_only: 'false' })],
  });
  assert.ok(noAdvisoryFailures.includes('F1'), 'F1 must reject advisory_only anything other than true');
});

test('Fable routing evidence check F2 fails closed when the review comment is bound to a DIFFERENT (stale or copy-pasted) head SHA', () => {
  const failures = fableFailureIds({
    planningModelRouting: fableRouting(),
    comments: [fableReviewComment({ 'Reviewed head SHA': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })],
    reviewedHeadSha: FABLE_HEAD_SHA,
  });
  assert.ok(failures.includes('F2'), 'F2 must fail when the record is bound to a different head than the one being evaluated');
});

test('Fable routing evidence check F2 fails closed when there is no reviewedHeadSha to bind against at all', () => {
  const failures = fableFailureIds({
    planningModelRouting: fableRouting(),
    comments: [fableReviewComment()],
    reviewedHeadSha: null,
  });
  assert.ok(failures.includes('F2'), 'F2 must fail when there is nothing to bind the record to');
});

test('Fable routing evidence check only trusts the LATEST matching fable-review/v1 comment (mirrors pm-verdict/v1 "latest wins")', () => {
  const failures = fableFailureIds({
    planningModelRouting: fableRouting(),
    comments: [
      fableReviewComment({ 'Reviewed head SHA': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
      fableReviewComment(), // the latest one, correctly bound
    ],
    reviewedHeadSha: FABLE_HEAD_SHA,
  });
  assert.ok(!failures.includes('F1'));
  assert.ok(!failures.includes('F2'));
});

test('Fable routing evidence check F3 fails closed when policy_version has drifted from the current fable-pilot-policy.json', () => {
  const failures = fableFailureIds({
    planningModelRouting: fableRouting({ policy_version: '0.0.1-stale' }),
    comments: [fableReviewComment()],
  });
  assert.ok(failures.includes('F3'), 'F3 should fail when policy_version does not match the current policy file');
});

test('Fable routing evidence check F3 passes when policy_version matches the real shipped fable-pilot-policy.json', () => {
  const failures = fableFailureIds({
    planningModelRouting: fableRouting(),
    comments: [fableReviewComment()],
  });
  assert.ok(!failures.includes('F3'), 'F3 should pass when policy_version matches the real shipped policy');
});

test('findLatestFableReview directly: returns null when no comment matches the exact schema header', () => {
  assert.strictEqual(
    findLatestFableReview([{ body: 'not a fable review at all' }], 'UTV2-9001'),
    null,
  );
});

test('findLatestFableReview directly: parses a well-formed record and returns its fields', () => {
  const match = findLatestFableReview([fableReviewComment()], 'UTV2-9001');
  assert.ok(match);
  assert.strictEqual(match!.triggerClass, 'repeated_architecture_bounce');
  assert.strictEqual(match!.policyVersion, '1.0.0');
  assert.strictEqual(match!.reviewedHeadSha, FABLE_HEAD_SHA);
});

test('findLatestFableReview directly: ignores a record addressed to a different issue', () => {
  assert.strictEqual(
    findLatestFableReview([fableReviewComment({ Issue: 'UTV2-1234' })], 'UTV2-9001'),
    null,
  );
});

// ── G3 ancestry regression tests (UTV2-1160) ──────────────────────────────────
//
// G3 must PASS when the merge SHA is reachable via any ancestor path (first-parent
// OR secondary-parent).  It must only FAIL when the SHA is genuinely absent from
// all of main's history.

/**
 * Build a minimal git() stub that mimics the two commands G3 invokes:
 *   1. `git merge-base --is-ancestor <sha> main`  → ok: true/false
 *   2. `git rev-list --first-parent main`          → lines of SHAs
 */
function makeGitStub(options: {
  isAncestor: boolean;
  firstParentShas: string[];
}): (args: string[]) => { ok: boolean; stdout: string; stderr: string } {
  return (args: string[]) => {
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      return { ok: options.isAncestor, stdout: '', stderr: '' };
    }
    if (args[0] === 'rev-list' && args.includes('--first-parent')) {
      return { ok: true, stdout: options.firstParentShas.join('\n'), stderr: '' };
    }
    return { ok: false, stdout: '', stderr: 'unexpected args in stub' };
  };
}

test('G3: SHA on first-parent chain → reachable=true, firstParent=true', () => {
  const sha = '01952daa';
  const stub = makeGitStub({ isAncestor: true, firstParentShas: [sha, 'aaaabbbb'] });
  const result = checkCommitReachableFromMain(sha, stub);
  assert.strictEqual(result.reachable, true);
  assert.strictEqual(result.firstParent, true);
});

test('G3: SHA reachable only via secondary-parent (squash-merge anomaly) → reachable=true, firstParent=false', () => {
  // Reproduces the UTV2-1087 closeout scenario: squash merge SHA 01952daa was
  // reachable from main but NOT on the first-parent chain because local main was
  // synced with --no-ff, placing it on a secondary-parent chain.
  const sha = '01952daa';
  const stub = makeGitStub({
    isAncestor: true,
    firstParentShas: ['aaaabbbb', 'ccccdddd'], // sha absent from first-parent list
  });
  const result = checkCommitReachableFromMain(sha, stub);
  assert.strictEqual(result.reachable, true, 'SHA must be reachable (is an ancestor)');
  assert.strictEqual(result.firstParent, false, 'SHA is not on first-parent chain');
  // Callers must treat this as PASS (with optional warning), not FAIL.
});

test('G3: SHA absent from all of main history → reachable=false, firstParent=false', () => {
  const sha = 'deadbeef';
  const stub = makeGitStub({
    isAncestor: false,
    firstParentShas: ['aaaabbbb', 'ccccdddd'],
  });
  const result = checkCommitReachableFromMain(sha, stub);
  assert.strictEqual(result.reachable, false);
  assert.strictEqual(result.firstParent, false);
});

test('L3: accepts the actual workspace PM-review state "In PM Review"', () => {
  assert.strictEqual(isLinearStatePermittedForL3('In PM Review'), true);
});

test('L3: accepts "Done"', () => {
  assert.strictEqual(isLinearStatePermittedForL3('Done'), true);
});

test('L3: rejects the stale "In Review" state that does not exist in this workspace', () => {
  assert.strictEqual(isLinearStatePermittedForL3('In Review'), false);
});

test('L3: rejects unrelated workflow states (backlog, blocked, cancelled, abandoned)', () => {
  for (const state of ['Backlog', 'Blocked', 'Cancelled', 'Abandoned', 'Todo', 'In Progress']) {
    assert.strictEqual(isLinearStatePermittedForL3(state), false, `expected ${state} to fail closed`);
  }
});

test('L3: rejects empty/unknown state', () => {
  assert.strictEqual(isLinearStatePermittedForL3(''), false);
  assert.strictEqual(isLinearStatePermittedForL3(undefined), false);
});

// ── classifyRuntimeProofGap (UTV2-1537) ─────────────────────────────────────────
//
// Regression coverage for docs/06_status/INCIDENTS/INC-2026-07-14-utv2-1533-direct-main-push.md:
// the exact failure shape a T1 lane produces when it merges to main without runtime
// evidence -- C6/P7/P9/P10/R1/R2/R3 all fail together, nothing else does. This is the
// precise pattern that, when it hit an ambiguous "push a new commit" remediation
// message and no scripted repair path, led to an unauthorized direct-main push.

function checkResult(id: string, status: CheckResult['status'], detail = ''): CheckResult {
  return { id, status, detail };
}

/** Reproduces the exact check-result set observed in the real incident's CI log. */
function originalIncidentFailureFixture(): CheckResult[] {
  return [
    checkResult('M1', 'pass'),
    checkResult('M2', 'pass'),
    checkResult('M3', 'pass'),
    checkResult('L1', 'pass'),
    checkResult('L2', 'pass'),
    checkResult('G1', 'pass'),
    checkResult('G2', 'pass'),
    checkResult('P1', 'pass'),
    checkResult('P2', 'pass'),
    checkResult('P3', 'pass'),
    checkResult('P4', 'pass'),
    checkResult('P5', 'pass'),
    checkResult('P6', 'pass'),
    checkResult('C1', 'pass'),
    checkResult('C2', 'pass'),
    checkResult('C3', 'pass'),
    checkResult('C4', 'pass'),
    checkResult('C5', 'pass'),
    checkResult('C7', 'pass'),
    checkResult('C6', 'fail', 'runtime-proof closeout requires live/runtime evidence, not narrative-only proof'),
    checkResult('P7', 'fail', 'evidence bundle must include populated static_proof and runtime_proof sections'),
    checkResult('P9', 'fail', 'runtime_proof must reference live DB queries, row counts, or receipts'),
    checkResult('P10', 'fail', 'verifier.identity must be set and not equal to manifest.created_by'),
    checkResult('R1', 'fail', 'runtime_proof.queries must be non-empty: run pnpm test:db and include live query evidence'),
    checkResult('R2', 'fail', 'runtime_proof.row_counts must be non-empty: include monitored-table row counts from pnpm test:db'),
    checkResult('R3', 'fail', 'evidence bundle verifier.identity must be set for T1 phase-boundary-guard'),
  ];
}

test('classifyRuntimeProofGap: reproduces the exact original incident failure mode as an isolated runtime-proof gap', () => {
  const classification = classifyRuntimeProofGap(originalIncidentFailureFixture());
  assert.strictEqual(classification.isRuntimeProofGap, true);
  assert.deepStrictEqual(
    [...classification.missingRuntimeProofCheckIds].sort(),
    ['C6', 'P10', 'P7', 'P9', 'R1', 'R2', 'R3'].sort(),
  );
  assert.deepStrictEqual(classification.otherFailingCheckIds, []);
  assert.match(classification.remediation, /pnpm ops:proof-repair scaffold/);
  assert.match(classification.remediation, /Do NOT hand-edit proof files on main directly/);
});

test('classifyRuntimeProofGap: does not classify a mixed failure (non-runtime check also failing) as a pure runtime-proof gap', () => {
  const mixed = [...originalIncidentFailureFixture(), checkResult('G4', 'fail', 'required GitHub checks are not green')];
  const classification = classifyRuntimeProofGap(mixed);
  assert.strictEqual(classification.isRuntimeProofGap, false);
  assert.deepStrictEqual(classification.otherFailingCheckIds, ['G4']);
  assert.strictEqual(classification.remediation, '');
});

test('classifyRuntimeProofGap: an all-pass check set is not a runtime-proof gap', () => {
  const allPass = originalIncidentFailureFixture().map((check) =>
    check.status === 'fail' ? { ...check, status: 'pass' as const, detail: 'ok' } : check,
  );
  const classification = classifyRuntimeProofGap(allPass);
  assert.strictEqual(classification.isRuntimeProofGap, false);
  assert.deepStrictEqual(classification.missingRuntimeProofCheckIds, []);
});

// ── integration-style: truth-check sees repaired evidence and now passes ───────

test('integration: R1/R2/R3 fail against a pre-repair bundle and pass against the same bundle after an additive repair', () => {
  const preRepairBundle: { bundle: EvidenceBundleV1 } = {
    bundle: {
      schema_version: 1,
      // No verifier, no runtime_proof -- the exact pre-repair shape from the incident.
    },
  };

  const preRepairChecks: CheckResult[] = [];
  const addPre = (id: string, status: 'pass' | 'fail' | 'skip', detail: string): void => {
    preRepairChecks.push({ id, status, detail });
  };
  addUnsupportedRuntimeChecks(addPre, false, 'T1', preRepairBundle);
  assert.deepStrictEqual(
    preRepairChecks.map((c) => c.status),
    ['fail', 'fail', 'fail'],
  );

  // Simulate the additive repair: only verifier + runtime_proof are added, exactly
  // as scripts/ops/proof-repair.ts's mergeRuntimeProofIntoEvidence does.
  const postRepairBundle: { bundle: EvidenceBundleV1 } = {
    bundle: {
      ...preRepairBundle.bundle,
      verifier: { identity: 'claude/utv2-9999-proof-repair' },
      runtime_proof: {
        queries: [{ table: 'picks', description: 'live query evidence' }],
        row_counts: [{ table: 'picks', count: 100, status: 'healthy' }],
      },
    },
  };

  const postRepairChecks: CheckResult[] = [];
  const addPost = (id: string, status: 'pass' | 'fail' | 'skip', detail: string): void => {
    postRepairChecks.push({ id, status, detail });
  };
  addUnsupportedRuntimeChecks(addPost, false, 'T1', postRepairBundle);
  assert.deepStrictEqual(
    postRepairChecks.map((c) => c.status),
    ['pass', 'pass', 'pass'],
  );

  const postClassification = classifyRuntimeProofGap(postRepairChecks);
  assert.strictEqual(postClassification.isRuntimeProofGap, false);
  assert.strictEqual(hasRuntimeReferences(postRepairBundle.bundle.runtime_proof), true);
});
