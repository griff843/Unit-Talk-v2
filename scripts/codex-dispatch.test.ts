import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './ops/shared.js';
import { buildDispatchPacket } from './codex-dispatch.js';

test('buildDispatchPacket uses manifest truth for the canonical header block', () => {
  const packet = buildDispatchPacket({
    issue: {
      id: '1',
      identifier: 'UTV2-999',
      title: 'Dispatch integration',
      url: 'https://linear.app/unit-talk/issue/UTV2-999',
      description: 'Test packet generation',
      priority: 2,
      labels: { nodes: [{ name: 'T2' }] },
      project: { name: 'Ops' },
      state: { name: 'Ready' },
    },
    manifest: {
      schema_version: 1,
      issue_id: 'UTV2-999',
      lane_type: 'codex-cli',
      tier: 'T2',
      worktree_path: 'C:/Dev/Unit-Talk-v2-main/.out/worktrees/codex__utv2-999-dispatch',
      branch: 'codex/utv2-999-dispatch',
      base_branch: 'main',
      commit_sha: null,
      pr_url: null,
      files_changed: [],
      file_scope_lock: ['scripts/codex-dispatch.ts', 'scripts/ops/lane-start.ts'],
      expected_proof_paths: ['docs/06_status/proof/UTV2-999/diff-summary.md'],
      status: 'started',
      started_at: '2026-04-11T00:00:00.000Z',
      heartbeat_at: '2026-04-11T00:00:00.000Z',
      closed_at: null,
      blocked_by: [],
      preflight_token: '.out/ops/preflight/codex/utv2-999-dispatch.json',
      created_by: 'codex-cli',
      truth_check_history: [],
      reopen_history: [],
    },
    manifestPath: 'docs/06_status/lanes/UTV2-999.json',
    forbiddenFiles: ['apps/api/src/server.ts'],
  });

  assert.match(packet, /Lane manifest: docs\/06_status\/lanes\/UTV2-999\.json/);
  assert.match(packet, /Branch:\s+codex\/utv2-999-dispatch/);
  assert.match(packet, /Worktree:\s+C:\/Dev\/Unit-Talk-v2-main\/\.out\/worktrees\/codex__utv2-999-dispatch/);
  assert.match(packet, /Tier:\s+T2/);
  assert.match(packet, /Preflight:\s+\.out\/ops\/preflight\/codex\/utv2-999-dispatch\.json/);
  assert.match(packet, /\* scripts\/codex-dispatch\.ts/);
  assert.match(packet, /\* apps\/api\/src\/server\.ts/);
});

test('codex-dispatch no longer references legacy lane registry identifiers', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'codex-dispatch.ts'), 'utf8');
  for (const banned of ['LANES_FILE', 'readRegistry', 'writeRegistry', 'checkFileOverlap', 'activeCodexCli', 'LaneEntry', 'LaneRegistry']) {
    assert.ok(!source.includes(banned), `unexpected legacy identifier still present: ${banned}`);
  }
});

test('codex-dispatch rejects the removed --allowed flag', () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      'scripts/codex-dispatch.ts',
      '--',
      '--issue',
      'UTV2-999',
      '--tier',
      'T2',
      '--branch',
      'codex/utv2-999-dispatch',
      '--allowed',
      'scripts/codex-dispatch.ts',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );

  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /--allowed flag is removed/i);
});
