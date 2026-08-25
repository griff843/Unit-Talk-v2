import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
  readTaskContract,
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

// ---------------------------------------------------------------------------
// Executing dry-run coverage (UTV2-1747)
//
// The two tests replaced here reached DRY_RUN correctly, but wrote their lane
// manifest and sync record into the LIVE checkout at ROOT. An interrupted run
// leaves those behind, and the concurrency governor reads a stray manifest in
// docs/06_status/lanes as a real active lane. These run the entrypoint as a
// child process rooted in a fixture repository instead.
//
// Isolation is free: getRepoRoot() shells out to `git rev-parse --show-toplevel`
// inheriting process.cwd(), so running the entrypoint with cwd inside a fixture
// repository rebinds ROOT to it -- no production code carries a test-only root
// parameter. The helpers below are deliberately duplicated in codex-exec.test.ts
// rather than shared: this lane may not add a file, and importing across test
// modules would re-register the exporting file's tests in both runs.
// ---------------------------------------------------------------------------

const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx');

interface LaneRoot {
  /** Repo root for the run; also the git repository whose cleanliness is asserted. */
  root: string;
  /** PATH entry holding the stub CLI. Kept outside `root` so it is not untracked content. */
  bin: string;
  objective: string;
  syncPath: string;
}

/**
 * claude-exec health-checks by executing the real CLI. A stub keeps the dry run
 * offline: no paid model call, no network, deterministic version string.
 */
function stubClaudeCli(dir: string): string {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'claude'),
    '#!/bin/sh\n[ "$1" = "--version" ] && echo "claude-stub 1.0.0" && exit 0\nexit 0\n',
    { mode: 0o755 },
  );
  return bin;
}

function buildClaudeLaneRoot(issueId: string): LaneRoot {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1747-claude-'));
  const root = path.join(dir, 'repo');
  const wt = path.join(root, 'wt');
  fs.mkdirSync(path.join(root, 'docs', '06_status', 'lanes'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', '05_operations'), { recursive: true });
  fs.mkdirSync(wt, { recursive: true });

  // Copied, never invented. A hand-authored fixture can assert against a field
  // the production reader never looks at, which makes the assertion vacuous.
  fs.copyFileSync(
    path.join(ROOT, 'docs', '05_operations', 'db-writer-classification.json'),
    path.join(root, 'docs', '05_operations', 'db-writer-classification.json'),
  );

  // A Claude manifest must never carry model_routing, at any schema version.
  const manifest = {
    schema_version: 2,
    issue_id: issueId,
    lane_type: 'governance',
    executor: 'claude',
    tier: 'T1',
    worktree_path: wt,
    branch: `claude/${issueId.toLowerCase()}-fixture`,
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: ['scripts/ops/fixture.ts'],
    expected_proof_paths: [],
    status: 'started',
    started_at: '2026-08-24T00:00:00.000Z',
    heartbeat_at: '2026-08-24T00:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: '.out/ops/preflight/fixture.json',
    created_by: 'claude',
    truth_check_history: [],
    reopen_history: [],
    execution_location: {
      mode: 'worktree',
      cwd: wt,
      package_install: 'verified',
      setup_command: null,
      main_checkout_control_only: true,
    },
  };
  fs.writeFileSync(
    path.join(root, 'docs', '06_status', 'lanes', `${issueId}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const objective = 'Prove the captured objective reaches the executor prompt.';
  // Built by production code on purpose: buildTaskContract computes
  // description_sha256 and contract_hash, and assertTaskContract verifies both
  // against the content. A hand-written contract cannot satisfy that, which is
  // what stops this fixture inventing a field the reader never consults.
  const contract = buildTaskContract(
    {
      identifier: issueId,
      title: 'Fixture lane',
      url: `https://linear.app/unit-talk/issue/${issueId}`,
      description: [
        '## Objective',
        objective,
        '',
        '## Acceptance criteria',
        '- The rendered packet carries this contract.',
      ].join('\n'),
    },
    '2026-08-24T00:00:00.000Z',
  );
  const syncPath = path.join(root, '.ops', 'sync', `${issueId}.yml`);
  fs.mkdirSync(path.dirname(syncPath), { recursive: true });
  fs.writeFileSync(syncPath, buildSyncYmlWithTaskContract(issueId, contract));

  fs.writeFileSync(path.join(wt, 'README.md'), 'fixture\n');
  for (const args of [
    ['init', '--initial-branch=main'],
    ['config', 'user.email', 'test@example.com'],
    ['config', 'user.name', 'Test'],
    ['add', '-A'],
    ['commit', '-m', 'fixture base'],
  ]) {
    spawnSync('git', args, { cwd: root, stdio: 'pipe' });
  }

  return { root, bin: stubClaudeCli(dir), objective, syncPath };
}

function runClaudeExec(lane: LaneRoot, args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(TSX_BIN, [path.join(ROOT, 'scripts', 'ops', 'claude-exec.ts'), ...args], {
    cwd: lane.root,
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, PATH: `${lane.bin}${path.delimiter}${process.env['PATH'] ?? ''}` },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Tracked and untracked changes both count -- a stray write is still a mutation. */
function claudeLaneRootChanges(lane: LaneRoot): string {
  return spawnSync('git', ['status', '--porcelain'], {
    cwd: lane.root,
    encoding: 'utf8',
    stdio: 'pipe',
  }).stdout.trim();
}

function parseLeadingJson(out: string): Record<string, unknown> {
  const start = out.indexOf('{');
  const end = out.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, `expected a JSON object in output:\n${out}`);
  return JSON.parse(out.slice(start, end + 2)) as Record<string, unknown>;
}

test('claude-exec --dry-run executes to a rendered packet carrying the captured objective', () => {
  // The decisive test. The earlier tests in this file exit before packet
  // resolution, so a wrong-module import is silently converted into
  // PRECONDITION_FAILED by the catch handler and they still pass. Only a run
  // that must reach DRY_RUN proves generateExecutionPacket is actually callable.
  const issueId = 'UTV2-999911';
  const lane = buildClaudeLaneRoot(issueId);
  const run = runClaudeExec(lane, ['--issue', issueId, '--dry-run']);

  assert.equal(run.status, 0, `dry run must reach DRY_RUN; stderr: ${run.stderr}`);
  const parsed = parseLeadingJson(run.stdout);
  assert.equal(parsed['code'], 'DRY_RUN',
    `dry run must reach DRY_RUN; got ${String(parsed['code'])} — a wrong-module import shows up here`);
  assert.equal(parsed['ok'], true);

  // The objective is the entire point of the packet: an executor given a prompt
  // without it infers the task from the branch name. Assert the rendered text,
  // and tie the prompt to the on-disk contract by integrity hash so the
  // assertion cannot pass against some other contract.
  const contract = readTaskContract(issueId, lane.root);
  assert.ok(
    run.stdout.includes(`integrity hash ${contract.contract_hash}`),
    `claude prompt must carry the on-disk contract; got:\n${run.stdout}`,
  );
  assert.ok(
    run.stdout.includes(lane.objective),
    `the rendered prompt must carry the captured objective; got:\n${run.stdout}`,
  );
  assert.ok(
    renderTaskContract(contract).includes(lane.objective),
    'the contract rendered into that prompt must carry the captured objective',
  );
});

test('claude-exec --dry-run leaves the lane root byte-identical', () => {
  const issueId = 'UTV2-999912';
  const lane = buildClaudeLaneRoot(issueId);
  assert.equal(claudeLaneRootChanges(lane), '', 'fixture must start clean');

  const run = runClaudeExec(lane, ['--issue', issueId, '--dry-run']);
  assert.equal(run.status, 0, `dry run must succeed; stderr: ${run.stderr}`);

  // Resolving a packet normally persists the sync record in both roots and, for
  // a pre-contract lane, makes a live Linear call. Under --dry-run none of that
  // may happen -- a preview that writes is not a preview.
  assert.equal(
    claudeLaneRootChanges(lane),
    '',
    'dry run must leave no tracked or untracked change in the lane root',
  );
});

test('claude-exec --dry-run failure path refuses structurally without throwing', () => {
  // Forces the catch handler: the lane exists but has no task contract, so
  // packet generation throws. An earlier revision called printDryRun with one
  // argument where it takes two, hidden by an `as never` cast, so the handler
  // itself threw a TypeError and the process crashed instead of refusing. Only
  // a run that REACHES the catch detects that -- and only a child process
  // detects the crash as a non-zero exit rather than a caught assertion.
  const issueId = 'UTV2-999913';
  const lane = buildClaudeLaneRoot(issueId);
  fs.rmSync(lane.syncPath);

  const run = runClaudeExec(lane, ['--issue', issueId, '--dry-run']);

  assert.equal(run.status, 2, `expected a structured refusal, not a crash; stderr: ${run.stderr}`);
  const parsed = parseLeadingJson(run.stdout);
  assert.equal(parsed['code'], 'PRECONDITION_FAILED');
  assert.equal(parsed['ok'], false);
  assert.match(String(parsed['message']), /task contract is absent/u);
  // The refusal must not have captured one: a live capture writes the record.
  assert.equal(
    fs.existsSync(lane.syncPath),
    false,
    'a dry run must never capture a contract, which would require a live Linear call',
  );
});
