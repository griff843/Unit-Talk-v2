import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ROOT,
  issueToManifestPath,
} from './ops/shared.js';

function currentBranch(): string {
  const result = spawnSync('git', ['branch', '--show-current'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function runCodexReceive(args: string[]) {
  return spawnSync(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/codex-receive.ts', '--', ...args],
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
}

function withManifest(
  issueId: string,
  status: 'started' | 'in_progress' | 'in_review' | 'merged' | 'done' | 'blocked' | 'reopened',
  branch: string,
  mutate?: (manifest: Record<string, unknown>) => void,
): void {
  const preflightToken = `.out/ops/preflight/${issueId.toLowerCase()}-token.json`;
  const preflightTokenPath = path.join(ROOT, preflightToken);
  fs.mkdirSync(path.dirname(preflightTokenPath), { recursive: true });
  fs.writeFileSync(preflightTokenPath, '{}\n', 'utf8');

  const manifest = {
    schema_version: 1,
    issue_id: issueId,
    lane_type: 'codex-cli',
    tier: 'T2',
    worktree_path: ROOT,
    branch,
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
    preflight_token: preflightToken,
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
  };
  if (mutate) {
    mutate(manifest);
  }

  const filePath = issueToManifestPath(issueId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function cleanup(issueId: string): void {
  fs.rmSync(issueToManifestPath(issueId), { force: true });
  fs.rmSync(path.join(ROOT, '.out', 'ops', 'preflight', `${issueId.toLowerCase()}-token.json`), {
    force: true,
  });
}

test('codex-receive no longer references legacy lane registry or verification gate identifiers', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'codex-receive.ts'), 'utf8');
  for (const banned of [
    'LANES_FILE',
    'readRegistry',
    'writeRegistry',
    'LaneEntry',
    'LaneRegistry',
    'skipTests',
    "['type-check']",
    "['test']",
  ]) {
    assert.ok(!source.includes(banned), `unexpected legacy identifier still present: ${banned}`);
  }
  assert.match(source, /ops:lane-link-pr/);
});

test('codex-receive rejects the removed --skip-tests flag', () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      'scripts/codex-receive.ts',
      '--',
      '--issue',
      'UTV2-999',
      '--branch',
      'codex/utv2-999-receive',
      '--pr',
      'https://github.com/example/unit-talk/pull/999',
      '--skip-tests',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );

  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /--skip-tests flag is removed/i);
});

test('codex-receive is idempotent when already in_review with the same PR URL', () => {
  const issueId = 'UTV2-99201';
  const branch = currentBranch();
  try {
    withManifest(issueId, 'in_review', branch, (manifest) => {
      manifest.pr_url = 'https://github.com/example/unit-talk/pull/201';
    });
    const result = runCodexReceive([
      '--issue',
      issueId,
      '--branch',
      branch,
      '--pr',
      'https://github.com/example/unit-talk/pull/201',
      '--no-linear',
      '--json',
    ]);
    assert.strictEqual(result.status, 0);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      code: string;
      status: string;
      pr_url: string;
      linear_comment: string;
    };
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.code, 'receive_noop');
    assert.strictEqual(payload.status, 'in_review');
    assert.strictEqual(payload.pr_url, 'https://github.com/example/unit-talk/pull/201');
    assert.strictEqual(payload.linear_comment, 'skipped');
  } finally {
    cleanup(issueId);
  }
});

test('codex-receive rejects conflicting PR URL from manifest truth', () => {
  const issueId = 'UTV2-99202';
  const branch = currentBranch();
  try {
    withManifest(issueId, 'in_review', branch, (manifest) => {
      manifest.pr_url = 'https://github.com/example/unit-talk/pull/202';
    });
    const result = runCodexReceive([
      '--issue',
      issueId,
      '--branch',
      branch,
      '--pr',
      'https://github.com/example/unit-talk/pull/999',
      '--no-linear',
      '--json',
    ]);
    assert.strictEqual(result.status, 1);
    const payload = JSON.parse(result.stdout) as { code: string };
    assert.strictEqual(payload.code, 'pr_url_mismatch');
  } finally {
    cleanup(issueId);
  }
});

test('codex-receive returns no-op for merged or done lanes when PR URL matches manifest truth', () => {
  const branch = currentBranch();
  for (const [issueId, status] of [
    ['UTV2-99203', 'merged'],
    ['UTV2-99204', 'done'],
  ] as const) {
    try {
      withManifest(issueId, status, branch, (manifest) => {
        manifest.pr_url = 'https://github.com/example/unit-talk/pull/203';
      });
      const result = runCodexReceive([
        '--issue',
        issueId,
        '--branch',
        branch,
        '--pr',
        'https://github.com/example/unit-talk/pull/203',
        '--no-linear',
        '--json',
      ]);
      assert.strictEqual(result.status, 0);
      const payload = JSON.parse(result.stdout) as { ok: boolean; code: string; status: string };
      assert.strictEqual(payload.ok, true);
      assert.strictEqual(payload.code, 'receive_noop');
      assert.strictEqual(payload.status, status);
    } finally {
      cleanup(issueId);
    }
  }
});

test('codex-receive parses lane-link-pr JSON when pnpm emits text before JSON', () => {
  const issueId = 'UTV2-99205';
  const branch = currentBranch();
  try {
    withManifest(issueId, 'started', branch);
    const result = runCodexReceive([
      '--issue',
      issueId,
      '--branch',
      branch,
      '--pr',
      'https://github.com/example/unit-talk/pull/205',
      '--no-linear',
      '--json',
    ]);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as { ok: boolean; code: string; status: string; pr_url: string };
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.code, 'receive_recorded');
    assert.strictEqual(payload.status, 'in_review');
    assert.strictEqual(payload.pr_url, 'https://github.com/example/unit-talk/pull/205');
  } finally {
    cleanup(issueId);
  }
});
