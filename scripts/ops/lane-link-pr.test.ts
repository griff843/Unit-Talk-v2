import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ROOT,
  issueToManifestPath,
} from './shared.js';

function runLaneLinkPr(args: string[]) {
  return spawnSync(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/ops/lane-link-pr.ts', ...args],
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
}

function withManifest(
  issueId: string,
  status: 'started' | 'in_progress' | 'in_review' | 'blocked' | 'reopened',
  laneType: 'codex-cli' | 'claude' | 'codex-cloud' = 'codex-cli',
  mutate?: (manifest: Record<string, unknown>) => void,
): string {
  const manifest = {
    schema_version: 1,
    issue_id: issueId,
    lane_type: laneType,
    tier: 'T2',
    worktree_path: path.join(ROOT, '.out', 'worktrees', `codex__${issueId.toLowerCase()}-receive`),
    branch: `codex/${issueId.toLowerCase()}-receive`,
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: ['scripts/codex-receive.ts'],
    expected_proof_paths: ['docs/06_status/proof/placeholder.md'],
    status,
    started_at: '2026-04-11T00:00:00.000Z',
    heartbeat_at: '2026-04-11T00:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: '.out/ops/preflight/token.json',
    created_by: laneType === 'claude' ? 'claude' : 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
  };
  if (mutate) {
    mutate(manifest);
  }
  const filePath = issueToManifestPath(issueId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return filePath;
}

function cleanup(issueId: string): void {
  fs.rmSync(issueToManifestPath(issueId), { force: true });
}

test('lane-link-pr transitions a codex-cli lane to in_review', () => {
  const issueId = 'UTV2-99101';
  try {
    withManifest(issueId, 'started');
    const result = runLaneLinkPr([
      issueId,
      '--branch',
      `codex/${issueId.toLowerCase()}-receive`,
      '--pr',
      'https://github.com/example/unit-talk/pull/123',
    ]);
    assert.strictEqual(result.status, 0);
    const payload = JSON.parse(result.stdout) as { ok: boolean; code: string; status: string; pr_url: string };
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.code, 'lane_linked');
    assert.strictEqual(payload.status, 'in_review');
    assert.strictEqual(payload.pr_url, 'https://github.com/example/unit-talk/pull/123');
  } finally {
    cleanup(issueId);
  }
});

test('lane-link-pr fails branch_mismatch from manifest truth', () => {
  const issueId = 'UTV2-99102';
  try {
    withManifest(issueId, 'started');
    const result = runLaneLinkPr([
      issueId,
      '--branch',
      'codex/utv2-99102-other',
      '--pr',
      'https://github.com/example/unit-talk/pull/124',
    ]);
    assert.strictEqual(result.status, 1);
    const payload = JSON.parse(result.stdout) as { code: string };
    assert.strictEqual(payload.code, 'branch_mismatch');
  } finally {
    cleanup(issueId);
  }
});

test('lane-link-pr returns exit 2 when already in_review', () => {
  const issueId = 'UTV2-99103';
  try {
    withManifest(issueId, 'in_review');
    const result = runLaneLinkPr([
      issueId,
      '--branch',
      `codex/${issueId.toLowerCase()}-receive`,
      '--pr',
      'https://github.com/example/unit-talk/pull/125',
    ]);
    assert.strictEqual(result.status, 2);
    const payload = JSON.parse(result.stdout) as { code: string };
    assert.strictEqual(payload.code, 'already_in_review');
  } finally {
    cleanup(issueId);
  }
});

test('lane-link-pr rejects non-transitionable blocked status', () => {
  const issueId = 'UTV2-99104';
  try {
    withManifest(issueId, 'blocked');
    const result = runLaneLinkPr([
      issueId,
      '--branch',
      `codex/${issueId.toLowerCase()}-receive`,
      '--pr',
      'https://github.com/example/unit-talk/pull/126',
    ]);
    assert.strictEqual(result.status, 1);
    const payload = JSON.parse(result.stdout) as { code: string };
    assert.strictEqual(payload.code, 'status_not_transitionable');
  } finally {
    cleanup(issueId);
  }
});

test('lane-link-pr rejects invalid pr urls', () => {
  const issueId = 'UTV2-99105';
  try {
    withManifest(issueId, 'started');
    const result = runLaneLinkPr([
      issueId,
      '--branch',
      `codex/${issueId.toLowerCase()}-receive`,
      '--pr',
      'not-a-pr-url',
    ]);
    assert.strictEqual(result.status, 1);
    const payload = JSON.parse(result.stdout) as { code: string };
    assert.strictEqual(payload.code, 'pr_url_invalid');
  } finally {
    cleanup(issueId);
  }
});

test('lane-link-pr rejects non-codex-cli lanes', () => {
  const issueId = 'UTV2-99106';
  try {
    withManifest(issueId, 'started', 'claude');
    const result = runLaneLinkPr([
      issueId,
      '--branch',
      `codex/${issueId.toLowerCase()}-receive`,
      '--pr',
      'https://github.com/example/unit-talk/pull/127',
    ]);
    assert.strictEqual(result.status, 1);
    const payload = JSON.parse(result.stdout) as { code: string };
    assert.strictEqual(payload.code, 'lane_type_mismatch');
  } finally {
    cleanup(issueId);
  }
});
