import assert from 'node:assert/strict';
import test from 'node:test';
import type { LaneManifest } from '../shared.js';
import {
  generatePRReviewPacket,
  type PacketInput,
} from '../pr-review-packet.js';

/**
 * Scope-override authorization in the return review packet, for repo-minted and
 * tracker-keyed identities alike.
 *
 * These tests live here rather than in `scripts/ops/pr-review-packet.test.ts`
 * for a mechanical reason, not a thematic one: this lane's `file_scope_lock` was
 * pinned at lane-start without that test file, and a lock cannot be widened by
 * an agent. Putting the coverage in the lane's own declared namespace keeps the
 * behaviour asserted without widening scope or asking for an override -- the
 * same move UTV2-1840 made when it could not add a new test file.
 *
 * The fixture helpers below are copied from `pr-review-packet.test.ts` rather
 * than exported from it, because exporting them would edit that file and put it
 * back outside this lane's scope.
 */

function createManifest(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    schema_version: 1,
    issue_id: 'UTV2-1057',
    lane_type: 'governance',
    executor: 'codex-cli',
    tier: 'T2',
    worktree_path: 'C:/Dev/Unit-Talk-v2-main',
    branch: 'codex/utv2-1057-automated-return-review-packet-for-t1t2-prs',
    base_branch: 'main',
    commit_sha: 'abc123',
    pr_url: 'https://github.com/unit-talk/unit-talk-v2/pull/1057',
    files_changed: [],
    file_scope_lock: [
      'scripts/ops/pr-review-packet.ts',
      'scripts/ops/pr-review-packet.test.ts',
      'package.json',
      '.github/workflows/return-review-packet.yml',
    ],
    expected_proof_paths: [
      'docs/06_status/proof/UTV2-1057/diff-summary.md',
      'docs/06_status/proof/UTV2-1057/verification.md',
    ],
    status: 'in_review',
    started_at: '2026-05-18T00:00:00.000Z',
    heartbeat_at: '2026-05-18T00:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: '.out/ops/preflight/codex/utv2-1057.json',
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
    notes: 'No open lanes share overlapping files.',
    ...overrides,
  };
}

function createInput(overrides: Partial<PacketInput['prebuilt']> = {}): PacketInput {
  return {
    issue_id: 'UTV2-1057',
    prebuilt: {
      manifest: createManifest(),
      pull_request: {
        number: 1057,
        url: 'https://github.com/unit-talk/unit-talk-v2/pull/1057',
        title: 'feat(ops): UTV2-1057 automated return review packet',
        headRefName: 'codex/utv2-1057-automated-return-review-packet-for-t1t2-prs',
        headRefOid: 'abc123def456',
        labels: [{ name: 'tier:T2' }],
        files: [
          { path: 'scripts/ops/pr-review-packet.ts' },
          { path: 'scripts/ops/pr-review-packet.test.ts' },
          { path: 'package.json' },
        ],
        statusCheckRollup: [
          { name: 'lint', conclusion: 'SUCCESS' },
          { name: 'type-check', conclusion: 'SUCCESS' },
        ],
      },
      present_proof_paths: [
        'docs/06_status/proof/UTV2-1057/diff-summary.md',
        'docs/06_status/proof/UTV2-1057/verification.md',
      ],
      r_level_compliance: {
        status: 'PASS',
        reason: 'Verdict: PASS',
      },
      sync_metadata: {
        status: 'PASS',
        path: '.ops/sync/UTV2-1057.yml',
        issue_id: 'UTV2-1057',
        reason: '.ops/sync/UTV2-1057.yml declares UTV2-1057',
      },
      diff_entries: [
        { status: 'M', file: 'scripts/ops/pr-review-packet.ts' },
        { status: 'A', file: 'scripts/ops/pr-review-packet.test.ts' },
        { status: 'M', file: 'package.json' },
      ],
      base_package_json: {
        scripts: {
          'test:ops': 'tsx --test scripts/ops/shared.test.ts',
        },
      },
      head_package_json: {
        scripts: {
          'test:ops': 'tsx --test scripts/ops/shared.test.ts scripts/ops/pr-review-packet.test.ts',
        },
      },
      untracked_artifacts: [],
      scope_override_comments: [],
      generated_at: '2026-05-18T00:00:00.000Z',
      ...overrides,
    },
  };
}

function scopeOverrideComment(overrides: {
  issueId?: string;
  prNumber?: number;
  headSha?: string;
  path?: string;
  login?: string;
  userType?: string;
} = {}) {
  const issueId = overrides.issueId ?? 'UTV2-1057';
  const prNumber = overrides.prNumber ?? 1057;
  const headSha = overrides.headSha ?? 'abc123def456';
  const authorizedPath = overrides.path ?? 'scripts/ops/authorized-by-review.ts';
  return {
    body: [
      'SCOPE_OVERRIDE: APPROVED',
      'schema: scope-override/v1',
      `Issue: ${issueId}`,
      `PR: #${prNumber}`,
      `Head-SHA: ${headSha}`,
      'Paths:',
      `- ${authorizedPath}`,
      'Reason: reviewed scope correction',
    ].join('\n'),
    user: {
      login: overrides.login ?? 'griff843',
      type: overrides.userType ?? 'User',
    },
  };
}

function inputWithScopeOverride(comment: ReturnType<typeof scopeOverrideComment> | null): PacketInput {
  return createInput({
    pull_request: {
      number: 1057,
      url: 'https://github.com/unit-talk/unit-talk-v2/pull/1057',
      title: 'feat(ops): UTV2-1057 automated return review packet',
      headRefName: 'codex/utv2-1057-automated-return-review-packet-for-t1t2-prs',
      headRefOid: 'abc123def456',
      labels: [{ name: 'tier:T2' }],
      files: [
        { path: 'scripts/ops/pr-review-packet.ts' },
        { path: 'scripts/ops/authorized-by-review.ts' },
      ],
      statusCheckRollup: [{ name: 'lint', conclusion: 'SUCCESS' }],
    },
    scope_override_comments: comment === null ? null : [comment],
  });
}

test('generatePRReviewPacket grants paths from an authorized exact-head scope override', async () => {
  const packet = await generatePRReviewPacket(inputWithScopeOverride(scopeOverrideComment()));

  assert.strictEqual(packet.verdict, 'PASS');
  assert.deepStrictEqual(packet.out_of_scope_files, []);
  assert.ok(packet.allowed_file_scope.includes('scripts/ops/authorized-by-review.ts'));
});

for (const [name, comment] of [
  ['stale head', scopeOverrideComment({headSha: 'deadbeef'})],
  ['wrong issue', scopeOverrideComment({issueId: 'WORK-999'})],
  ['wrong PR', scopeOverrideComment({prNumber: 999})],
  ['unauthorized human', scopeOverrideComment({login: 'outsider'})],
  ['bot author', scopeOverrideComment({userType: 'Bot'})],
] as const) {
  test(`generatePRReviewPacket rejects a ${name} scope override`, async () => {
    const packet = await generatePRReviewPacket(inputWithScopeOverride(comment));

    assert.strictEqual(packet.verdict, 'FAIL');
    assert.deepStrictEqual(packet.out_of_scope_files, ['scripts/ops/authorized-by-review.ts']);
  });
}

test('generatePRReviewPacket grants no paths when scope override comment fetch is unavailable', async () => {
  const packet = await generatePRReviewPacket(inputWithScopeOverride(null));

  assert.strictEqual(packet.verdict, 'FAIL');
  assert.deepStrictEqual(packet.out_of_scope_files, ['scripts/ops/authorized-by-review.ts']);
});
