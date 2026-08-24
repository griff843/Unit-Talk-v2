import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildClaudePrompt,
  main as claudeExecMain,
  checkClaudeHealth,
  resolveClaudeExecutionPacket,
  resolveLaneCwd,
  transcriptPathForIssue,
} from './claude-exec.js';
import {
  buildSyncYmlWithTaskContract,
  buildTaskContract,
  renderTaskContract,
  type ExecutionPacket,
} from './execution-packet.js';
import { ROOT, type LaneManifest } from './shared.js';

test('checkClaudeHealth accepts a working Claude CLI', () => {
  const health = checkClaudeHealth(() => ({
    status: 0,
    stdout: '1.2.3\n',
    stderr: '',
    error: undefined,
  }));

  assert.deepStrictEqual(health, {
    healthy: true,
    version: '1.2.3',
    error: null,
  });
});

test('checkClaudeHealth reports unavailable Claude CLI', () => {
  const health = checkClaudeHealth(() => ({
    status: 127,
    stdout: '',
    stderr: 'not found',
    error: undefined,
  }));

  assert.equal(health.healthy, false);
  assert.equal(health.version, null);
  assert.equal(health.error, 'exit 127');
});

test('buildClaudePrompt includes lane cwd, allowed scope, verification, and closeout', () => {
  const packet: ExecutionPacket = {
    issue_id: 'UTV2-1200',
    title: 'UTV2-1200',
    project: 'Unit Talk V2',
    tier: 'T2',
    lane_type: 'governance',
    branch: 'claude/utv2-1200-governance',
    execution_location: 'Claude Code (interactive)',
    cwd: '.out/worktrees/claude__utv2-1200-governance',
    cwd_guard_command: 'cd ".out/worktrees/claude__utv2-1200-governance"',
    worktree_entrypoint: 'pnpm install --frozen-lockfile',
    dependency_setup: {
      package_install: 'required',
      setup_command: 'pnpm install --frozen-lockfile',
      main_checkout_control_only: true,
    },
    allowed_file_scope: ['scripts/ops/claude-exec.ts'],
    tier_c_warnings: [],
    blockers: [],
    task_contract: buildTaskContract({
      identifier: 'UTV2-1200',
      title: 'Execute the supplied work order',
      url: 'https://linear.app/unit-talk-v2/issue/UTV2-1200',
      description: [
        '## Acceptance criteria',
        '- Implement the requested change.',
        '## Guardrails',
        '- Do not infer a different task.',
        '## Exit criteria',
        '- Verification passes.',
      ].join('\n'),
    }, '2026-05-25T00:00:00.000Z'),
    required_verification: ['pnpm verify'],
    expected_proof_paths: [],
    closeout_instructions: ['Open PR'],
    repo_brief: '[brief]',
    source_of_truth: {
      linear_url: 'https://linear.app/unit-talk-v2/issue/UTV2-1200',
      branch: 'claude/utv2-1200-governance',
      manifest_path: 'docs/06_status/lanes/UTV2-1200.json',
    },
    generated_at: '2026-05-25T00:00:00.000Z',
  };

  const prompt = buildClaudePrompt(packet);

  assert.match(prompt, /Issue: UTV2-1200/);
  assert.match(prompt, /Authoritative task contract/);
  assert.match(prompt, /Execute the supplied work order/);
  assert.match(prompt, /Implement the requested change/);
  assert.match(prompt, /cd "\.out\/worktrees\/claude__utv2-1200-governance"/);
  assert.match(prompt, /scripts\/ops\/claude-exec\.ts/);
  assert.match(prompt, /pnpm verify/);
  assert.match(prompt, /Open PR/);
  assert.ok(prompt.includes(renderTaskContract(packet.task_contract)));
});

test('claude-exec refuses an invalid packet with JSON and never continues to spawn', () => {
  const manifest = { issue_id: 'UTV2-1734', branch: 'claude/utv2-1734' } as LaneManifest;
  const emitted: string[] = [];
  let continuedToSpawn = false;
  const exitCode = resolveClaudeExecutionPacket(
    manifest,
    () => { continuedToSpawn = true; },
    value => { emitted.push(JSON.stringify(value)); },
    () => ({
      ok: false,
      code: 'EXECUTION_PACKET_INVALID',
      issue_id: manifest.issue_id,
      branch: manifest.branch,
      message: 'Execution packet refused: task contract is malformed',
    }),
  );

  assert.equal(exitCode, 2);
  assert.equal(continuedToSpawn, false);
  assert.equal(emitted.length, 1);
  assert.deepEqual(JSON.parse(emitted[0]!), {
    ok: false,
    code: 'EXECUTION_PACKET_INVALID',
    issue_id: 'UTV2-1734',
    branch: 'claude/utv2-1734',
    message: 'Execution packet refused: task contract is malformed',
  });
});

test('resolveLaneCwd prefers manifest execution location', () => {
  const manifest = {
    worktree_path: '.out/worktrees/fallback',
    execution_location: { cwd: '.out/worktrees/current' },
  } as LaneManifest;

  assert.equal(resolveLaneCwd(manifest), path.join(process.cwd(), '.out/worktrees/current'));
});

test('transcriptPathForIssue creates deterministic per-issue transcript path', () => {
  const transcriptPath = transcriptPathForIssue('UTV2-1200', new Date('2026-05-25T12:34:56.789Z'));

  assert.equal(
    transcriptPath,
    path.join(process.cwd(), '.out/ops/claude-exec/UTV2-1200-2026-05-25T123456789Z.log'),
  );
});

// UTV2-1546: delegation kill switch must gate the actual `claude --print ...` spawn,
// placed as late as possible so the CLI health check and manifest/precondition checks
// above still report their own specific failure first. Full behavioral coverage of
// the state reader itself (missing/malformed/suspended/active) lives in
// delegation-state.test.ts.
test('claude-exec checks delegation immediately before spawning claude, and exits 2 when suspended', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'claude-exec.ts'), 'utf8');
  const dryRunReturnIndex = source.indexOf('printDryRun(');
  const delegationCallIndex = source.indexOf("requireDelegationActive('claude-exec')");
  const spawnIndex = source.indexOf("runner('claude', claudeArgs");

  assert.ok(delegationCallIndex >= 0, 'claude-exec.ts must call requireDelegationActive');
  assert.ok(
    dryRunReturnIndex >= 0 && dryRunReturnIndex < delegationCallIndex,
    'delegation check must be placed after the --dry-run early return, so dry-run preview stays available while suspended',
  );
  assert.ok(
    delegationCallIndex < spawnIndex,
    'delegation kill switch must run strictly before the claude spawn',
  );

  const delegationBlock = source.slice(delegationCallIndex, delegationCallIndex + 300);
  assert.match(delegationBlock, /DELEGATION_SUSPENDED/);
  assert.match(delegationBlock, /return 2/);
});

// ── UTV2-1737: EXECUTING dry-run regression coverage ─────────────────────────
// These run the real control flow. The previous guards asserted on source text
// (`source.indexOf('printDryRun(')`), which cannot detect a wrong-module import,
// a wrong-arity call, a throw, unstructured output, an executor launch, or a
// state mutation. All of those shipped past a green suite.

function captureStdout(run: () => number): { exitCode: number; out: string } {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: unknown }).write = ((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const exitCode = run();
    return { exitCode, out: chunks.join('') };
  } finally {
    (process.stdout as unknown as { write: unknown }).write = original;
  }
}

test('claude-exec --dry-run executes, returns structured output, launches nothing', () => {
  let spawned = 0;
  const runner = (() => {
    spawned += 1;
    return { status: 0, stdout: '', stderr: '', error: undefined };
  }) as never;

  // A missing issue is the cheapest path that still exercises argument parsing,
  // the structured-emit path and the return contract without touching a lane.
  const { exitCode, out } = captureStdout(() => claudeExecMain(['--dry-run'], runner));

  assert.equal(spawned, 0, 'dry run must never launch an executor');
  assert.equal(exitCode, 2, 'a missing issue must be a precondition failure');
  const parsed = JSON.parse(out.slice(0, out.lastIndexOf('}') + 1)) as Record<string, unknown>;
  assert.equal(parsed['ok'], false);
  assert.equal(parsed['code'], 'PRECONDITION_FAILED', 'output must be structured, not a stack trace');
});

test('claude-exec --dry-run on an unknown lane refuses structurally rather than throwing', () => {
  let spawned = 0;
  const runner = (() => {
    spawned += 1;
    return { status: 0, stdout: '', stderr: '', error: undefined };
  }) as never;

  // Exercises the packet-resolution path. If generateExecutionPacket were
  // imported from the wrong module this throws TypeError instead of returning,
  // which is exactly the defect a source-text assertion could not see.
  let threw: unknown;
  let result: { exitCode: number; out: string } | undefined;
  try {
    result = captureStdout(() => claudeExecMain(['--issue', 'UTV2-999999', '--dry-run'], runner));
  } catch (error) {
    threw = error;
  }
  assert.equal(threw, undefined, `dry run must not throw: ${String(threw)}`);
  assert.equal(spawned, 0, 'dry run must never launch an executor');
  assert.ok(result, 'dry run must return');
  const parsed = JSON.parse(
    result.out.slice(0, result.out.lastIndexOf('}') + 1),
  ) as Record<string, unknown>;
  assert.equal(typeof parsed['code'], 'string', 'output must be structured JSON with a code');
  assert.ok(String(parsed['code']).length > 0);
});

test('claude-exec --dry-run reaches DRY_RUN on a real lane, mutating nothing', () => {
  // The decisive test. The two above exit before packet resolution, so a
  // wrong-module import is silently converted into PRECONDITION_FAILED by the
  // catch handler and they still pass. Only a run that must reach code DRY_RUN
  // proves generateExecutionPacket is actually callable.
  const issueId = 'UTV2-999998';
  const lanePath = path.join(ROOT, 'docs', '06_status', 'lanes', `${issueId}.json`);
  const syncPath = path.join(ROOT, '.ops', 'sync', `${issueId}.yml`);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-dryrun-'));

  const contract = buildTaskContract({
    identifier: issueId,
    title: 'dry run fixture',
    url: `https://linear.app/unit-talk-v2/issue/${issueId}`,
    description: '## Objective\nFixture.\n\n## Acceptance criteria\n- runs\n',
  });
  const manifest = {
    schema_version: 1, issue_id: issueId, lane_type: 'governance', executor: 'claude', tier: 'T3',
    worktree_path: cwd, branch: `claude/${issueId.toLowerCase()}`, base_branch: 'main',
    commit_sha: null, pr_url: null, files_changed: [], file_scope_lock: [], expected_proof_paths: [],
    status: 'started', started_at: '2026-01-01T00:00:00.000Z', heartbeat_at: '2026-01-01T00:00:00.000Z',
    closed_at: null, blocked_by: [], preflight_token: 'test', created_by: 'test',
    truth_check_history: [], reopen_history: [],
    execution_location: { mode: 'worktree', cwd, package_install: 'verified',
      setup_command: 'pnpm install --frozen-lockfile', main_checkout_control_only: false },
  };

  let spawned = 0;
  const healthyRunner = (() => {
    spawned += 1;
    return { status: 0, stdout: '1.2.3\n', stderr: '', error: undefined };
  }) as never;

  fs.writeFileSync(lanePath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(syncPath, buildSyncYmlWithTaskContract(issueId, contract));
  const syncBefore = fs.readFileSync(syncPath, 'utf8');
  const laneBefore = fs.readFileSync(lanePath, 'utf8');

  try {
    const { exitCode, out } = captureStdout(() =>
      claudeExecMain(['--issue', issueId, '--dry-run'], healthyRunner));
    const parsed = JSON.parse(out.slice(0, out.lastIndexOf('}') + 1)) as Record<string, unknown>;

    assert.equal(parsed['code'], 'DRY_RUN',
      `dry run must reach DRY_RUN; got ${String(parsed['code'])} — a wrong-module import shows up here`);
    assert.equal(parsed['ok'], true);
    assert.equal(exitCode, 0);
    // Health check spawns once; the executor itself must never be launched.
    assert.ok(spawned <= 1, 'dry run must not launch the executor');
    // Purity: neither the sync record nor the manifest may be rewritten.
    assert.equal(fs.readFileSync(syncPath, 'utf8'), syncBefore, 'dry run must not rewrite the sync record');
    assert.equal(fs.readFileSync(lanePath, 'utf8'), laneBefore, 'dry run must not rewrite the manifest');
  } finally {
    fs.rmSync(lanePath, { force: true });
    fs.rmSync(syncPath, { force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('claude-exec --dry-run failure path emits structured output without throwing', () => {
  // Complement to the DRY_RUN test. This forces the catch handler: the lane
  // exists but has no task contract, so packet generation throws. An earlier
  // revision called printDryRun with one argument where it takes two, hidden by
  // an `as never` cast, so the handler itself threw a TypeError and the process
  // crashed instead of refusing. Only a run that REACHES the catch detects that.
  const issueId = 'UTV2-999997';
  const lanePath = path.join(ROOT, 'docs', '06_status', 'lanes', `${issueId}.json`);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-dryrun-fail-'));
  const manifest = {
    schema_version: 1, issue_id: issueId, lane_type: 'governance', executor: 'claude', tier: 'T3',
    worktree_path: cwd, branch: `claude/${issueId.toLowerCase()}`, base_branch: 'main',
    commit_sha: null, pr_url: null, files_changed: [], file_scope_lock: [], expected_proof_paths: [],
    status: 'started', started_at: '2026-01-01T00:00:00.000Z', heartbeat_at: '2026-01-01T00:00:00.000Z',
    closed_at: null, blocked_by: [], preflight_token: 'test', created_by: 'test',
    truth_check_history: [], reopen_history: [],
    execution_location: { mode: 'worktree', cwd, package_install: 'verified',
      setup_command: 'pnpm install --frozen-lockfile', main_checkout_control_only: false },
  };
  let spawned = 0;
  const healthyRunner = (() => {
    spawned += 1;
    return { status: 0, stdout: '1.2.3\n', stderr: '', error: undefined };
  }) as never;

  fs.writeFileSync(lanePath, `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    let threw: unknown;
    let captured: { exitCode: number; out: string } | undefined;
    try {
      captured = captureStdout(() => claudeExecMain(['--issue', issueId, '--dry-run'], healthyRunner));
    } catch (error) {
      threw = error;
    }
    assert.equal(threw, undefined,
      `the dry-run failure handler must not throw: ${String(threw)}`);
    assert.ok(captured, 'dry run must return an exit code');
    const parsed = JSON.parse(captured.out.slice(0, captured.out.lastIndexOf('}') + 1)) as Record<string, unknown>;
    assert.equal(parsed['code'], 'PRECONDITION_FAILED');
    assert.equal(parsed['ok'], false);
    assert.equal(captured.exitCode, 2);
    assert.ok(spawned <= 1, 'dry run must not launch the executor');
  } finally {
    fs.rmSync(lanePath, { force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
