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
    issue_id: 'UTV2-971',
    lane_type: 'governance',
    executor: 'codex-cli',
    tier: 'T2',
    worktree_path: 'C:/Dev/Unit-Talk-v2-main',
    branch: 'codex/utv2-971-generate-standardized-pr-review-packets',
    base_branch: 'main',
    commit_sha: 'abc123',
    pr_url: 'https://github.com/unit-talk/unit-talk-v2/pull/688',
    files_changed: [],
    file_scope_lock: [
      'scripts/ops/pr-review-packet.ts',
      'scripts/ops/pr-review-packet.test.ts',
      'docs/05_operations/schemas/pr-review-packet-v1.md',
    ],
    expected_proof_paths: [
      'docs/06_status/proof/UTV2-971/diff-summary.md',
      'docs/06_status/proof/UTV2-971/verification.log',
    ],
    status: 'in_review',
    started_at: '2026-05-15T00:00:00.000Z',
    heartbeat_at: '2026-05-15T00:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: '.out/ops/preflight/codex/utv2-971.json',
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
    notes: 'Must merge after PR #688 (UTV2-969).',
    ...overrides,
  };
}

function createInput(overrides: Partial<PacketInput['prebuilt']> = {}): PacketInput {
  return {
    issue_id: 'UTV2-971',
    prebuilt: {
      manifest: createManifest(),
      pull_request: {
        number: 701,
        url: 'https://github.com/unit-talk/unit-talk-v2/pull/701',
        title: 'feat(ops): UTV2-971 standardized PR review packet generator',
        headRefName: 'codex/utv2-971-generate-standardized-pr-review-packets',
        labels: [{ name: 'tier:T2' }],
        files: [
          { path: 'scripts/ops/pr-review-packet.ts' },
          { path: 'scripts/ops/pr-review-packet.test.ts' },
        ],
        statusCheckRollup: [
          { name: 'lint', conclusion: 'SUCCESS' },
          { name: 'type-check', conclusion: 'SUCCESS' },
        ],
      },
      present_proof_paths: [
        'docs/06_status/proof/UTV2-971/diff-summary.md',
        'docs/06_status/proof/UTV2-971/verification.log',
      ],
      r_level_compliance: {
        status: 'PASS',
        reason: 'Verdict: PASS',
      },
      ...overrides,
    },
  };
}

test('generatePRReviewPacket returns a clean PR packet', async () => {
  const packet = await generatePRReviewPacket(createInput());

  assert.deepStrictEqual(packet.scope_bleed, []);
  assert.strictEqual(packet.missing_tier_label, false);
  assert.strictEqual(packet.missing_proof, false);
  assert.deepStrictEqual(packet.ci_status_summary, [
    { name: 'lint', status: 'pass' },
    { name: 'type-check', status: 'pass' },
  ]);
});

test('generatePRReviewPacket detects scope bleed', async () => {
  const packet = await generatePRReviewPacket(
    createInput({
      pull_request: {
        number: 701,
        url: 'https://github.com/unit-talk/unit-talk-v2/pull/701',
        title: 'feat(ops): UTV2-971 standardized PR review packet generator',
        headRefName: 'codex/utv2-971-generate-standardized-pr-review-packets',
        labels: [{ name: 'tier:T2' }],
        files: [
          { path: 'scripts/ops/pr-review-packet.ts' },
          { path: 'scripts/ops/unexpected.ts' },
        ],
        statusCheckRollup: [{ name: 'lint', conclusion: 'SUCCESS' }],
      },
    }),
  );

  assert.deepStrictEqual(packet.scope_bleed, ['scripts/ops/unexpected.ts']);
});

test('generatePRReviewPacket detects missing proof artifacts', async () => {
  const packet = await generatePRReviewPacket(
    createInput({
      present_proof_paths: ['docs/06_status/proof/UTV2-971/diff-summary.md'],
    }),
  );

  assert.strictEqual(packet.missing_proof, true);
  assert.deepStrictEqual(packet.proof_artifact_checklist, [
    {
      artifact: 'docs/06_status/proof/UTV2-971/diff-summary.md',
      present: true,
    },
    {
      artifact: 'docs/06_status/proof/UTV2-971/verification.log',
      present: false,
    },
  ]);
});

test('generatePRReviewPacket detects Tier C paths', async () => {
  const packet = await generatePRReviewPacket(
    createInput({
      pull_request: {
        number: 701,
        url: 'https://github.com/unit-talk/unit-talk-v2/pull/701',
        title: 'feat(ops): UTV2-971 standardized PR review packet generator',
        headRefName: 'codex/utv2-971-generate-standardized-pr-review-packets',
        labels: [{ name: 'tier:T2' }],
        files: [
          { path: 'scripts/ops/pr-review-packet.ts' },
          { path: 'packages/domain/src/foo.ts' },
        ],
        statusCheckRollup: [{ name: 'lint', conclusion: 'SUCCESS' }],
      },
    }),
  );

  assert.deepStrictEqual(packet.tier_c_paths, ['packages/domain/src/foo.ts']);
});

test('generatePRReviewPacket detects missing tier label', async () => {
  const packet = await generatePRReviewPacket(
    createInput({
      pull_request: {
        number: 701,
        url: 'https://github.com/unit-talk/unit-talk-v2/pull/701',
        title: 'feat(ops): UTV2-971 standardized PR review packet generator',
        headRefName: 'codex/utv2-971-generate-standardized-pr-review-packets',
        labels: [{ name: 'ops:governance' }],
        files: [{ path: 'scripts/ops/pr-review-packet.ts' }],
        statusCheckRollup: [{ name: 'lint', conclusion: 'SUCCESS' }],
      },
    }),
  );

  assert.strictEqual(packet.missing_tier_label, true);
  assert.strictEqual(packet.tier_label_present, false);
});

test('generatePRReviewPacket is deterministic for the same input', async () => {
  const input = createInput();
  const first = await generatePRReviewPacket(input);
  const second = await generatePRReviewPacket(input);

  assert.strictEqual(JSON.stringify(first), JSON.stringify(second));
});

test('generatePRReviewPacket preserves the packet shape', async () => {
  const packet: PRReviewPacket = await generatePRReviewPacket(createInput());

  assert.strictEqual(packet.issue_id, 'UTV2-971');
  assert.strictEqual(packet.pr_number, 701);
  assert.strictEqual(packet.branch, 'codex/utv2-971-generate-standardized-pr-review-packets');
  assert.strictEqual(packet.merge_order_notes, 'Must merge after PR #688 (UTV2-969).');
});
