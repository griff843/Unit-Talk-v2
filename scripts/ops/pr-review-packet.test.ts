import assert from 'node:assert/strict';
import test from 'node:test';
import type { LaneManifest } from './shared.js';
import {
  generatePRReviewPacket,
  type PacketInput,
  type PRReviewPacket,
} from './pr-review-packet.js';

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
      'docs/06_status/proof/UTV2-1057/verification.log',
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
        'docs/06_status/proof/UTV2-1057/verification.log',
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
      generated_at: '2026-05-18T00:00:00.000Z',
      ...overrides,
    },
  };
}

test('generatePRReviewPacket returns PASS for a clean T2 return packet', async () => {
  const packet = await generatePRReviewPacket(createInput());

  assert.strictEqual(packet.verdict, 'PASS');
  assert.strictEqual(packet.issue_id, 'UTV2-1057');
  assert.strictEqual(packet.pr_head_sha, 'abc123def456');
  assert.strictEqual(packet.expected_executor, 'codex-cli');
  assert.deepStrictEqual(packet.out_of_scope_files, []);
  assert.deepStrictEqual(packet.package_test_drift.missing_test_wiring, []);
  assert.deepStrictEqual(packet.package_test_drift.dropped_tests, []);
  assert.strictEqual(packet.sync_metadata.status, 'PASS');
  assert.strictEqual(packet.r_level_compliance.status, 'PASS');
  assert.strictEqual(packet.missing_proof, false);
});

test('generatePRReviewPacket detects out-of-scope files', async () => {
  const packet = await generatePRReviewPacket(
    createInput({
      pull_request: {
        number: 1057,
        url: 'https://github.com/unit-talk/unit-talk-v2/pull/1057',
        title: 'feat(ops): UTV2-1057 automated return review packet',
        headRefName: 'codex/utv2-1057-automated-return-review-packet-for-t1t2-prs',
        headRefOid: 'abc123def456',
        labels: [{ name: 'tier:T2' }],
        files: [
          { path: 'scripts/ops/pr-review-packet.ts' },
          { path: 'scripts/ops/unexpected.ts' },
        ],
        statusCheckRollup: [{ name: 'lint', conclusion: 'SUCCESS' }],
      },
    }),
  );

  assert.strictEqual(packet.verdict, 'FAIL');
  assert.deepStrictEqual(packet.out_of_scope_files, ['scripts/ops/unexpected.ts']);
  assert.equal(packet.checks.find((check) => check.id === 'scope')?.status, 'FAIL');
});

test('generatePRReviewPacket allows same-issue lane metadata outside explicit scope lock', async () => {
  const packet = await generatePRReviewPacket(
    createInput({
      pull_request: {
        number: 1057,
        url: 'https://github.com/unit-talk/unit-talk-v2/pull/1057',
        title: 'feat(ops): UTV2-1057 automated return review packet',
        headRefName: 'codex/utv2-1057-automated-return-review-packet-for-t1t2-prs',
        headRefOid: 'abc123def456',
        labels: [{ name: 'tier:T2' }],
        files: [
          { path: 'scripts/ops/pr-review-packet.ts' },
          { path: '.ops/sync/UTV2-1057.yml' },
          { path: 'docs/06_status/lanes/UTV2-1057.json' },
        ],
        statusCheckRollup: [{ name: 'lint', conclusion: 'SUCCESS' }],
      },
    }),
  );

  assert.strictEqual(packet.verdict, 'PASS');
  assert.deepStrictEqual(packet.out_of_scope_files, []);
  assert.equal(packet.checks.find((check) => check.id === 'scope')?.status, 'PASS');
});

test('generatePRReviewPacket still flags wrong-issue lane metadata as scope bleed', async () => {
  const packet = await generatePRReviewPacket(
    createInput({
      pull_request: {
        number: 1057,
        url: 'https://github.com/unit-talk/unit-talk-v2/pull/1057',
        title: 'feat(ops): UTV2-1057 automated return review packet',
        headRefName: 'codex/utv2-1057-automated-return-review-packet-for-t1t2-prs',
        headRefOid: 'abc123def456',
        labels: [{ name: 'tier:T2' }],
        files: [
          { path: 'scripts/ops/pr-review-packet.ts' },
          { path: '.ops/sync/UTV2-9999.yml' },
          { path: 'docs/06_status/lanes/UTV2-9999.json' },
        ],
        statusCheckRollup: [{ name: 'lint', conclusion: 'SUCCESS' }],
      },
    }),
  );

  assert.strictEqual(packet.verdict, 'FAIL');
  assert.deepStrictEqual(packet.out_of_scope_files, [
    '.ops/sync/UTV2-9999.yml',
    'docs/06_status/lanes/UTV2-9999.json',
  ]);
  assert.equal(packet.checks.find((check) => check.id === 'scope')?.status, 'FAIL');
});

test('generatePRReviewPacket detects missing package script wiring for new tests', async () => {
  const packet = await generatePRReviewPacket(
    createInput({
      head_package_json: {
        scripts: {
          'test:ops': 'tsx --test scripts/ops/shared.test.ts',
        },
      },
    }),
  );

  assert.strictEqual(packet.verdict, 'FAIL');
  assert.deepStrictEqual(packet.package_test_drift.newly_added_test_files, [
    {
      file: 'scripts/ops/pr-review-packet.test.ts',
      wired: false,
      matched_scripts: [],
    },
  ]);
  assert.deepStrictEqual(packet.package_test_drift.missing_test_wiring, [
    'scripts/ops/pr-review-packet.test.ts',
  ]);
});

test('generatePRReviewPacket treats repo-wide tsx --test as test discovery wiring', async () => {
  const packet = await generatePRReviewPacket(
    createInput({
      base_package_json: {
        scripts: {
          test: 'tsx --test',
        },
      },
      head_package_json: {
        scripts: {
          test: 'tsx --test',
        },
      },
    }),
  );

  assert.strictEqual(packet.verdict, 'PASS');
  assert.deepStrictEqual(packet.package_test_drift.newly_added_test_files, [
    {
      file: 'scripts/ops/pr-review-packet.test.ts',
      wired: true,
      matched_scripts: ['test'],
    },
  ]);
  assert.deepStrictEqual(packet.package_test_drift.missing_test_wiring, []);
});

test('generatePRReviewPacket passes PR 866 style same-issue metadata scope changes', async () => {
  const packet = await generatePRReviewPacket(
    createInput({
      pull_request: {
        number: 866,
        url: 'https://github.com/unit-talk/unit-talk-v2/pull/866',
        title: 'fix(ops): UTV2-1057 update return review packet',
        headRefName: 'codex/utv2-1057-automated-return-review-packet-for-t1t2-prs',
        headRefOid: 'def456abc123',
        labels: [{ name: 'tier:T2' }],
        files: [
          { path: 'scripts/ops/pr-review-packet.ts' },
          { path: 'scripts/ops/pr-review-packet.test.ts' },
          { path: '.ops/sync/UTV2-1057.yml' },
          { path: 'docs/06_status/lanes/UTV2-1057.json' },
        ],
        statusCheckRollup: [
          { name: 'lint', conclusion: 'SUCCESS' },
          { name: 'type-check', conclusion: 'SUCCESS' },
        ],
      },
      diff_entries: [
        { status: 'M', file: 'scripts/ops/pr-review-packet.ts' },
        { status: 'M', file: 'scripts/ops/pr-review-packet.test.ts' },
        { status: 'M', file: '.ops/sync/UTV2-1057.yml' },
        { status: 'M', file: 'docs/06_status/lanes/UTV2-1057.json' },
      ],
    }),
  );

  assert.strictEqual(packet.verdict, 'PASS');
  assert.deepStrictEqual(packet.out_of_scope_files, []);
  assert.equal(packet.risk_packet.signals.scope_bleed_count, 0);
});

test('generatePRReviewPacket detects dropped tests versus base package scripts', async () => {
  const packet = await generatePRReviewPacket(
    createInput({
      diff_entries: [
        { status: 'M', file: 'package.json' },
        { status: 'D', file: 'scripts/ops/old-return-review.test.ts' },
      ],
      base_package_json: {
        scripts: {
          'test:ops': 'tsx --test scripts/ops/old-return-review.test.ts scripts/ops/shared.test.ts',
        },
      },
      head_package_json: {
        scripts: {
          'test:ops': 'tsx --test scripts/ops/shared.test.ts scripts/ops/pr-review-packet.test.ts',
        },
      },
    }),
  );

  assert.strictEqual(packet.verdict, 'FAIL');
  assert.deepStrictEqual(packet.package_test_drift.dropped_tests, [
    'scripts/ops/old-return-review.test.ts',
  ]);
  assert.equal(packet.checks.find((check) => check.id === 'dropped_tests')?.status, 'FAIL');
});

test('generatePRReviewPacket allows test deletion when matching implementation is deleted', async () => {
  const packet = await generatePRReviewPacket(
    createInput({
      diff_entries: [
        { status: 'M', file: 'package.json' },
        { status: 'D', file: 'scripts/ops/retired-sync.test.ts' },
        { status: 'D', file: 'scripts/ops/retired-sync.ts' },
      ],
      base_package_json: {
        scripts: {
          'test:ops': 'tsx --test scripts/ops/retired-sync.test.ts scripts/ops/shared.test.ts',
        },
      },
      head_package_json: {
        scripts: {
          'test:ops': 'tsx --test scripts/ops/shared.test.ts scripts/ops/pr-review-packet.test.ts',
        },
      },
    }),
  );

  assert.deepStrictEqual(packet.package_test_drift.dropped_tests, []);
  assert.equal(packet.checks.find((check) => check.id === 'dropped_tests')?.status, 'PASS');
});

test('generatePRReviewPacket detects missing proof artifacts', async () => {
  const packet = await generatePRReviewPacket(
    createInput({
      present_proof_paths: ['docs/06_status/proof/UTV2-1057/diff-summary.md'],
    }),
  );

  assert.strictEqual(packet.verdict, 'FAIL');
  assert.strictEqual(packet.missing_proof, true);
  assert.deepStrictEqual(packet.proof_requirement.missing, [
    'docs/06_status/proof/UTV2-1057/verification.log',
  ]);
});

test('generatePRReviewPacket fails missing sync metadata and R-level result', async () => {
  const packet = await generatePRReviewPacket(
    createInput({
      sync_metadata: {
        status: 'FAIL',
        path: null,
        issue_id: null,
        reason: 'missing sync metadata for UTV2-1057',
      },
      r_level_compliance: {
        status: 'UNKNOWN',
        reason: 'unable to determine r-level compliance',
      },
    }),
  );

  assert.strictEqual(packet.verdict, 'FAIL');
  assert.equal(packet.checks.find((check) => check.id === 'sync_metadata')?.status, 'FAIL');
  assert.equal(packet.checks.find((check) => check.id === 'r_level')?.status, 'FAIL');
});

test('generatePRReviewPacket is deterministic for the same input', async () => {
  const input = createInput();
  const first = await generatePRReviewPacket(input);
  const second = await generatePRReviewPacket(input);

  assert.strictEqual(JSON.stringify(first), JSON.stringify(second));
});

test('generatePRReviewPacket preserves packet shape for prompt consumers', async () => {
  const packet: PRReviewPacket = await generatePRReviewPacket(createInput());

  assert.strictEqual(packet.schema_version, 2);
  assert.strictEqual(packet.branch, 'codex/utv2-1057-automated-return-review-packet-for-t1t2-prs');
  assert.deepStrictEqual(packet.allowed_file_scope, [
    '.github/workflows/return-review-packet.yml',
    '.ops/sync/UTV2-1057.yml',
    'docs/06_status/lanes/UTV2-1057.json',
    'package.json',
    'scripts/ops/pr-review-packet.test.ts',
    'scripts/ops/pr-review-packet.ts',
  ]);
  assert.strictEqual(packet.merge_order_notes, 'No open lanes share overlapping files.');
});
