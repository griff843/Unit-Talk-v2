import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './ops/shared.js';
import { buildDispatchPacket, resolveDispatchModelProfile } from './codex-dispatch.js';

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

test('UTV2-1526 scenario 1: codex-dispatch resolves codex-terra-medium for T2 by default', () => {
  assert.strictEqual(resolveDispatchModelProfile('T2', undefined), 'codex-terra-medium');
});

test('UTV2-1526 scenario 2: codex-dispatch resolves codex-sol-high for T1 by default', () => {
  assert.strictEqual(resolveDispatchModelProfile('T1', undefined), 'codex-sol-high');
});

test('UTV2-1526: codex-dispatch honors an explicit --model-profile override from an already-run /three-brain routing decision', () => {
  assert.strictEqual(resolveDispatchModelProfile('T2', 'codex-sol-high'), 'codex-sol-high');
});

test('UTV2-1526: codex-dispatch fails closed on an unknown --model-profile rather than silently falling back', () => {
  assert.throws(() => resolveDispatchModelProfile('T2', 'codex-nonexistent'), /model-profile resolution failed/);
});

test('UTV2-1526: codex-dispatch fails closed when the resolved profile is disabled (codex-luna-low)', () => {
  assert.throws(() => resolveDispatchModelProfile('T2', 'codex-luna-low'), /PROFILE_DISABLED/);
});

test('UTV2-1526: codex-dispatch passes --model-profile through to ops:lane-start', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'codex-dispatch.ts'), 'utf8');
  assert.match(source, /'--model-profile',\s*\n?\s*modelProfile/, 'lane-start invocation should include the resolved --model-profile');
  assert.match(source, /would_run_lane_start:.*'--model-profile', modelProfile/, 'dry-run preview should also report --model-profile');
});

// UTV2-1533: a Codex verification-lane dispatch must never guess its real verification
// target from the lane's own issue ID -- an explicit, validated --verification-target is
// required and threaded through to ops:lane-start unchanged, or the dispatch fails closed
// before the lane is ever created. Mirrors lane-maximizer.ts's own explicit-target contract.
test('UTV2-1533: codex-dispatch never defaults verification_target to issueId', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'codex-dispatch.ts'), 'utf8');

  assert.doesNotMatch(
    source,
    /\?\?\s*issueId\)\s*:\s*undefined/,
    'verificationTarget must never fall back to the lane\'s own issueId',
  );

  assert.match(
    source,
    /if\s*\(laneType === 'verification'\)\s*\{\s*\n\s*if\s*\(!explicitVerificationTarget\)\s*\{\s*\n\s*throw new Error\(/,
    'a verification-lane dispatch with no --verification-target must throw (fail closed) before the lane is created',
  );

  assert.match(
    source,
    /verificationTarget = requireVerificationTarget\(explicitVerificationTarget\);/,
    'an explicitly-supplied --verification-target must be validated via requireVerificationTarget, not accepted as-is',
  );

  const runLaneStartDefIndex = source.indexOf('function runLaneStart(');
  assert.notStrictEqual(runLaneStartDefIndex, -1, 'expected the runLaneStart function definition');
  const runLaneStartDefEnd = source.indexOf('): ChildResult {', runLaneStartDefIndex);
  const runLaneStartSignature = source.slice(runLaneStartDefIndex, runLaneStartDefEnd);
  assert.match(
    runLaneStartSignature,
    /verificationTarget\?: string/,
    'runLaneStart must accept an optional verificationTarget parameter',
  );

  assert.match(
    source,
    /if \(verificationTarget\) \{\s*\n\s*args\.push\('--verification-target', verificationTarget\);/,
    'runLaneStart must conditionally push --verification-target into the lane-start args when present',
  );

  const callSiteIndex = source.indexOf('const laneStart = runLaneStart(');
  assert.notStrictEqual(callSiteIndex, -1, 'expected the runLaneStart call site');
  const callSiteLine = source.slice(callSiteIndex, source.indexOf('\n', callSiteIndex));
  assert.match(
    callSiteLine,
    /runLaneStart\(issueId, tier, branch, files, laneType, modelProfile, verificationTarget\)/,
    'the real (non-dry-run) call site must pass verificationTarget through unchanged',
  );

  assert.match(
    source,
    /would_run_lane_start:.*\.\.\.\(verificationTarget \? \['--verification-target', verificationTarget\] : \[\]\)/,
    'the dry-run preview must also report --verification-target when applicable',
  );
});

test('UTV2-1533: codex-dispatch imports requireVerificationTarget from shared.js', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'codex-dispatch.ts'), 'utf8');
  assert.match(source, /requireVerificationTarget/);
  assert.match(source, /from '\.\/ops\/shared\.js'/);
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
