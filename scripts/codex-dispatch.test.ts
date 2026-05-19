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
      execution_location: {
        mode: 'worktree',
        cwd: 'C:/Dev/Unit-Talk-v2-main/.out/worktrees/codex__utv2-999-dispatch',
        package_install: 'verified',
        setup_command: 'pnpm install --frozen-lockfile',
        main_checkout_control_only: true,
      },
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
  assert.match(packet, /Worktree entrypoint:/);
  assert.match(packet, /pnpm install --frozen-lockfile/);
  assert.match(packet, /Main checkout: control and merge only/);
  assert.match(packet, /Tier:\s+T2/);
  assert.match(packet, /Preflight:\s+\.out\/ops\/preflight\/codex\/utv2-999-dispatch\.json/);
  assert.match(packet, /\* scripts\/codex-dispatch\.ts/);
  assert.match(packet, /\* apps\/api\/src\/server\.ts/);
  assert.match(packet, /pnpm ops:lane-finalize -- --issue UTV2-999/);
  assert.doesNotMatch(packet, /git checkout main/);
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

test('codex-dispatch forwards --fast to ops:preflight', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'codex-dispatch.ts'), 'utf8');
  assert.match(source, /bools\.has\('fast'\)/, 'dispatch should parse --fast');
  assert.match(source, /args\.push\('--fast'\)/, 'dispatch should forward --fast to preflight');
});

test('codex-dispatch starts canonical lane types with codex-cli executor', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'codex-dispatch.ts'), 'utf8');
  assert.match(source, /inferLaneType/, 'dispatch should infer or accept a canonical lane type');
  assert.match(source, /--executor', 'codex-cli'/, 'lane-start should receive executor=codex-cli');
  assert.doesNotMatch(source, /--lane-type', 'codex-cli'/, 'dispatch must not use legacy lane_type=codex-cli');
});

test('codex-dispatch leaves lease reservation to lane-start', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'codex-dispatch.ts'), 'utf8');
  assert.doesNotMatch(source, /reserveLease/, 'dispatch should not pre-reserve a lease before lane-start');
  assert.doesNotMatch(source, /defaultLeaseOwner/, 'dispatch should not own lease creation');
  assert.match(source, /laneStartJson\.lease_path/, 'dispatch should report the lease created by lane-start');
});

test('dispatch skill documents the Codex lane workflow', () => {
  const skill = fs.readFileSync(
    path.join(ROOT, '.agents', 'skills', 'dispatch', 'SKILL.md'),
    'utf8',
  );

  assert.match(skill, /name: dispatch/);
  assert.match(skill, /pnpm codex:dispatch -- --issue UTV2-###/);
  assert.match(skill, /pnpm codex:status/);
  assert.match(skill, /pnpm codex:receive -- --issue UTV2-###/);
  assert.match(skill, /pnpm ops:lane-finalize -- --issue UTV2-###/);
  assert.match(skill, /main checkout is control and merge only/i);
  assert.match(skill, /Do not use the removed `--allowed` flag/);
});
