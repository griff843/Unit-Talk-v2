import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {
  buildClaudePrompt,
  checkClaudeHealth,
  resolveLaneCwd,
  transcriptPathForIssue,
} from './claude-exec.js';
import type { ExecutionPacket } from './execution-packet.js';
import type { LaneManifest } from './shared.js';

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
  assert.match(prompt, /cd "\.out\/worktrees\/claude__utv2-1200-governance"/);
  assert.match(prompt, /scripts\/ops\/claude-exec\.ts/);
  assert.match(prompt, /pnpm verify/);
  assert.match(prompt, /Open PR/);
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
