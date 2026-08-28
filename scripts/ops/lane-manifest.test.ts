import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyPrMergeToManifest, createCommand, main } from './lane-manifest.js';
import {
  type LaneManifest,
  ROOT,
  createManifest,
  defaultProofPaths,
  issueToManifestPath,
  worktreePathForBranch,
} from './shared.js';

// The audited scope-release suite (UTV2-1762) lives in its own module beside
// the implementation it covers. `package.json`'s `test:ops` script is an
// explicit file list and is outside this lane's frozen file_scope_lock, so the
// sibling suite is chained here to guarantee it actually executes under
// `pnpm test` rather than sitting unwired. Wiring it directly into `test:ops`
// is tracked as follow-up work.
import './scope-release.test.js';

const PR_URL = 'https://github.com/unit-talk/Unit-Talk-v2/pull/1066';
const MERGE_SHA = 'abc123merge456';

function manifest(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    ...createManifest({
      issue_id: 'UTV2-1066',
      tier: 'T2',
      branch: 'codex/utv2-1066-record-merge-sha',
      worktree_path: worktreePathForBranch('codex/utv2-1066-record-merge-sha'),
      file_scope_lock: ['scripts/ops/lane-manifest.ts'],
      expected_proof_paths: defaultProofPaths('UTV2-1066', 'T2'),
      preflight_token: '.out/ops/preflight/codex/utv2-1066-record-merge-sha.json',
      status: 'in_review',
      now: '2026-05-19T12:00:00.000Z',
    }),
    ...overrides,
  };
}

function mergedPr(overrides = {}) {
  return {
    input: PR_URL,
    url: PR_URL,
    merged: true,
    mergeSha: MERGE_SHA,
    state: 'merged',
    ...overrides,
  };
}

test('applyPrMergeToManifest records merge SHA, PR URL, heartbeat, and status -- but no truth_check_history entry', () => {
  const result = applyPrMergeToManifest({
    manifest: manifest(),
    pr: mergedPr(),
    now: '2026-05-19T13:00:00.000Z',
  });

  assert.strictEqual(result.manifest.status, 'merged');
  assert.strictEqual(result.manifest.commit_sha, MERGE_SHA);
  assert.strictEqual(result.manifest.pr_url, PR_URL);
  assert.strictEqual(result.manifest.heartbeat_at, '2026-05-19T13:00:00.000Z');
  // UTV2-1613: this used to assert historyAppended === true and a fabricated
  // { verdict: 'pass', runner: 'manual', source: 'github_pr_merge_commit' }
  // entry -- a governance verdict this function never measured. record-merge
  // only binds GitHub merge state; it must never write to
  // truth_check_history at all.
  assert.strictEqual(result.historyAppended, false);
  assert.deepStrictEqual(result.manifest.truth_check_history, []);
});

test('applyPrMergeToManifest preserves Done status and existing PR URL', () => {
  const result = applyPrMergeToManifest({
    manifest: manifest({
      status: 'done',
      pr_url: 'https://github.com/unit-talk/Unit-Talk-v2/pull/999',
    }),
    pr: mergedPr(),
    now: '2026-05-19T13:00:00.000Z',
  });

  assert.strictEqual(result.manifest.status, 'done');
  assert.strictEqual(result.manifest.pr_url, 'https://github.com/unit-talk/Unit-Talk-v2/pull/999');
  assert.strictEqual(result.manifest.commit_sha, MERGE_SHA);
});

test('applyPrMergeToManifest never touches pre-existing truth_check_history, including a legacy fabricated entry', () => {
  // UTV2-1613: this manifest carries a legacy entry of exactly the shape
  // record-merge used to fabricate. A re-run must not deduplicate it, must
  // not add a second one, and must not delete it either -- historical entries
  // are corrected by governed PRs (see ops:truth-history-audit), never by a
  // tool silently rewriting history on an ordinary call.
  const existing = manifest({
    status: 'merged',
    commit_sha: MERGE_SHA,
    pr_url: PR_URL,
    truth_check_history: [
      {
        checked_at: '2026-05-19T13:00:00.000Z',
        verdict: 'pass',
        merge_sha: MERGE_SHA,
        failures: [],
        runner: 'manual',
        source: 'github_pr_merge_commit',
        pr_url: PR_URL,
      } as LaneManifest['truth_check_history'][number],
    ],
  });

  const result = applyPrMergeToManifest({
    manifest: existing,
    pr: mergedPr(),
    now: '2026-05-19T14:00:00.000Z',
  });

  assert.strictEqual(result.manifest.truth_check_history.length, 1);
  assert.strictEqual(result.historyAppended, false);
  assert.strictEqual(result.manifest.heartbeat_at, '2026-05-19T14:00:00.000Z');
});

test('applyPrMergeToManifest starting from empty history stays empty -- it never fabricates one', () => {
  const result = applyPrMergeToManifest({
    manifest: manifest({ truth_check_history: [] }),
    pr: mergedPr(),
    now: '2026-05-19T15:00:00.000Z',
  });

  assert.deepStrictEqual(result.manifest.truth_check_history, []);
  assert.strictEqual(result.historyAppended, false);
});

test('applyPrMergeToManifest fails clearly for unmerged PRs', () => {
  assert.throws(
    () =>
      applyPrMergeToManifest({
        manifest: manifest(),
        pr: mergedPr({ merged: false, mergeSha: null, state: 'open' }),
        now: '2026-05-19T13:00:00.000Z',
      }),
    /not merged or has no merge commit SHA/,
  );
});

test('applyPrMergeToManifest fails clearly when existing manifest SHA conflicts', () => {
  assert.throws(
    () =>
      applyPrMergeToManifest({
        manifest: manifest({ commit_sha: 'different-sha' }),
        pr: mergedPr(),
        now: '2026-05-19T13:00:00.000Z',
      }),
    /conflicts with PR merge SHA/,
  );
});

// UTV2-1526: the manual/repair `ops:lane-manifest create` entry point bypasses
// ops:lane-start entirely and previously had no --executor/--model-profile support at
// all -- a Codex manifest created this way had executor left undefined. These tests
// close that gap so this caller is held to the same model-routing rules as lane-start.

test('lane-manifest create requires --model-profile when --executor is codex-cli', () => {
  const flags = new Map<string, string[]>([
    ['issue', ['UTV2-9901']],
    ['tier', ['T2']],
    ['branch', ['codex/utv2-9901-repair']],
    ['files', ['scripts/ops/lane-manifest.ts']],
    ['preflight-token', ['.out/ops/preflight/codex/utv2-9901-repair.json']],
    ['executor', ['codex-cli']],
  ]);
  assert.throws(() => createCommand(flags), /--model-profile is required/);
});

test('lane-manifest create rejects --model-profile for a non-Codex executor', () => {
  const flags = new Map<string, string[]>([
    ['issue', ['UTV2-9902']],
    ['tier', ['T2']],
    ['branch', ['claude/utv2-9902-repair']],
    ['files', ['scripts/ops/lane-manifest.ts']],
    ['preflight-token', ['.out/ops/preflight/claude/utv2-9902-repair.json']],
    ['executor', ['claude']],
    ['model-profile', ['codex-terra-medium']],
  ]);
  assert.throws(() => createCommand(flags), /model_routing is Codex-only/);
});

test('lane-manifest create resolves and persists model_routing for a valid Codex --model-profile', () => {
  const issueId = 'UTV2-9903';
  const manifestPath = issueToManifestPath(issueId);
  const tokenPath = '.out/ops/preflight/codex/utv2-9903-repair.json';
  const tokenAbsolutePath = path.join(ROOT, tokenPath);
  fs.mkdirSync(path.dirname(tokenAbsolutePath), { recursive: true });
  fs.writeFileSync(
    tokenAbsolutePath,
    JSON.stringify({
      schema_version: 1,
      branch: 'codex/utv2-9903-repair',
      head_sha: '0'.repeat(40),
      tier: 'T2',
      issue_id: issueId,
      generated_at: '2026-07-13T00:00:00.000Z',
      expires_at: '2099-01-01T00:00:00.000Z',
      checks: { git: 'pass', env: 'pass', deps: 'pass' },
      status: 'pass',
    }),
  );
  try {
    const flags = new Map<string, string[]>([
      ['issue', [issueId]],
      ['tier', ['T2']],
      ['branch', ['codex/utv2-9903-repair']],
      ['files', ['scripts/ops/lane-manifest.ts']],
      ['preflight-token', [tokenPath]],
      ['executor', ['codex-cli']],
      ['model-profile', ['codex-terra-medium']],
    ]);
    createCommand(flags);
    const written = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LaneManifest;
    assert.strictEqual(written.model_routing?.profile, 'codex-terra-medium');
    assert.strictEqual(written.model_routing?.model, 'gpt-5.6-terra');
    assert.strictEqual(written.schema_version, 2);
  } finally {
    fs.rmSync(manifestPath, { force: true });
    fs.rmSync(tokenAbsolutePath, { force: true });
  }
});

// ── UTV2-1762: scope-release command surface ────────────────────────────────

test('scope-release is a routed subcommand and refuses an incomplete invocation', () => {
  const captured: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
  };
  try {
    // Unknown subcommands fall through to usage(); a routed one does not.
    assert.equal(main(['definitely-not-a-command']), 1);
    const usageText = captured.join('\n');
    assert.match(usageText, /scope-release UTV2-123 --pr 456/);

    captured.length = 0;
    // Routed, but missing --release-path: it must fail on its own argument
    // validation before any git/GitHub call, and must not print usage.
    assert.equal(main(['scope-release', 'UTV2-1729', '--pr', '1436']), 1);
    assert.match(captured.join('\n'), /Missing --release-path/);

    captured.length = 0;
    assert.equal(
      main(['scope-release', 'UTV2-1729', '--pr', 'not-a-number', '--release-path', 'a.ts']),
      1,
    );
    assert.match(captured.join('\n'), /--pr must be a PR number/);
  } finally {
    console.error = originalError;
  }
});
