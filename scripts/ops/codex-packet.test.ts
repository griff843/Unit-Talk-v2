import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DEFAULT_PROFILE,
  MODEL_ROUTING_POLICY_PATH,
  buildPrompt,
  classifyScope,
  extractScopePaths,
  parsePacket,
  resolveProfileForScope,
  assertIsolatedWorktree,
} from './codex-packet.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const COMPLETE_PACKET = `# Reject unresolvable capper identity

Profile: codex-sol-high

## Goal
Submissions with an unresolvable capper identity must fail closed.

## Context
Observed: the email local-part was used as a fallback identity.

## Scope
- \`apps/api/src/submission-service.ts\`
- \`apps/api/src/submission-service.test.ts\`

## Acceptance
- [ ] \`pnpm verify\` is green

## Do not touch
- Anything under \`docs/mission/**\`
`;

test('parsePacket extracts title, profile and sections', () => {
  const p = parsePacket(COMPLETE_PACKET);
  assert.equal(p.title, 'Reject unresolvable capper identity');
  assert.equal(p.profile, 'codex-sol-high');
  assert.deepEqual(p.missingSections, []);
  assert.match(p.sections.goal, /fail closed/);
});

test('parsePacket reports every missing required section', () => {
  const p = parsePacket('# Title\n\n## Goal\nsomething\n');
  assert.deepEqual(p.missingSections.sort(), ['Acceptance', 'Do not touch', 'Scope']);
});

test('parsePacket treats a present-but-empty section as missing', () => {
  // An empty heading is the likeliest way an underspecified packet reaches an
  // executor: the author added the heading and never filled it in.
  const p = parsePacket(COMPLETE_PACKET.replace('- Anything under `docs/mission/**`', ''));
  assert.deepEqual(p.missingSections, ['Do not touch']);
});

test('parsePacket ignores headings inside fenced code blocks', () => {
  const withFence = COMPLETE_PACKET.replace(
    '## Context\nObserved: the email local-part was used as a fallback identity.',
    '## Context\n```md\n## Scope\nnot a real section\n```\nreal context'
  );
  const p = parsePacket(withFence);
  assert.match(p.sections.context, /real context/);
  // The real Scope section, not the fenced impostor, is what was parsed.
  assert.match(p.sections.scope, /submission-service\.ts/);
});

test('extractScopePaths reads backticked and bare path bullets, ignoring prose', () => {
  const paths = extractScopePaths(
    '- `apps/api/src/a.ts`\n- packages/db/src/b.ts (the repository)\n- no path on this line\n'
  );
  assert.deepEqual(paths, ['apps/api/src/a.ts', 'packages/db/src/b.ts']);
});

test('profile resolution goes through the canonical resolver, not a local fork', () => {
  const resolved = resolveProfileForScope(DEFAULT_PROFILE, false);
  assert.equal(resolved.profile, DEFAULT_PROFILE);
  assert.ok(resolved.model.length > 0);
  assert.ok(resolved.reasoning_effort.length > 0);
  // policy_version only exists because the canonical resolver produced this.
  assert.ok(resolved.policy_version.length > 0);
});

test('an unknown profile is refused with the canonical code', () => {
  assert.throws(() => resolveProfileForScope('no-such-profile', false), /PROFILE_UNKNOWN/);
});

test('a profile requiring PM authorization is mechanically unavailable here too', () => {
  // The check the local fork did not have: no caller-supplied anything unlocks
  // codex-sol-max, and this entry point must not be the one that does.
  assert.throws(
    () => resolveProfileForScope('codex-sol-max', true),
    /TRUSTED_AUTHORIZATION_UNAVAILABLE|PROFILE_DISABLED/,
  );
});

test('a disabled profile is refused', () => {
  assert.throws(() => resolveProfileForScope('codex-luna-low', false), /PROFILE_DISABLED/);
});

test('a reserved scope cannot run on a profile policy permits only for T2', () => {
  // Risk is mapped to the policy's tier vocabulary rather than invented, and the
  // mapping tightens: the default profile is unavailable for reserved work.
  assert.throws(() => resolveProfileForScope(DEFAULT_PROFILE, true), /PROFILE_NOT_PERMITTED_FOR_TIER/);
  assert.match(
    (() => {
      try {
        resolveProfileForScope(DEFAULT_PROFILE, true);
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    })(),
    /--profile codex-sol-high/,
  );
  assert.equal(resolveProfileForScope('codex-sol-high', true).profile, 'codex-sol-high');
});

test('the default profile is still resolvable against the shipped policy', () => {
  // Guards the drift that makes delegation fail at the moment it is needed:
  // the runner names a profile the policy no longer has.
  const policy = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, MODEL_ROUTING_POLICY_PATH), 'utf8'));
  assert.ok(policy.profiles[DEFAULT_PROFILE], `${DEFAULT_PROFILE} missing from policy`);
  assert.ok(resolveProfileForScope(DEFAULT_PROFILE, false).model.length > 0);
});

test('classifyScope names a reserved surface and stays quiet on ordinary paths', () => {
  assert.deepEqual(classifyScope(REPO_ROOT, ['apps/api/src/submission-service.ts']), []);
  assert.deepEqual(classifyScope(REPO_ROOT, ['supabase/migrations/0001_x.sql']), [
    'production-ddl-and-data',
  ]);
});

test('classifyScope is advisory-safe when the policy cannot be read', () => {
  assert.deepEqual(classifyScope(path.join(REPO_ROOT, 'does', 'not', 'exist'), ['a/b.ts']), []);
});

test('buildPrompt carries the packet and forbids ticket lookup', () => {
  const prompt = buildPrompt('docs/mission/packets/x.md', COMPLETE_PACKET);
  assert.match(prompt, /AGENTS\.md/);
  assert.match(prompt, /no lane manifest and no tier label/);
  assert.ok(prompt.includes('Reject unresolvable capper identity'));
  assert.ok(prompt.includes('--- END PACKET ---'));
});

test('the shipped template is a packet the runner would accept', () => {
  const template = fs.readFileSync(path.join(REPO_ROOT, 'docs/mission/packets/TEMPLATE.md'), 'utf8');
  const parsed = parsePacket(template);
  assert.deepEqual(parsed.missingSections, []);
  assert.ok(parsed.scopePaths.length > 0);
});

// ── checkout isolation ────────────────────────────────────────────────────
// `codex exec` runs with -s danger-full-access: it edits and commits. The
// default --cwd is wherever the command was typed, which is normally the
// control checkout the orchestrator serializes merges through.

function scratchPrimary(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-packet-primary-'));
  const run = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'README.md'), '# scratch\n');
  run('add', '-A');
  run('commit', '-qm', 'base');
  return dir;
}

test('a non-repository directory is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-packet-norepo-'));
  assert.throws(() => assertIsolatedWorktree(dir), /not inside a git repository/);
});

test('the primary (control) checkout is refused even on a work branch', () => {
  // A branch-name test alone would happily run in the control checkout. This
  // is the shared-checkout collision, not the direct-to-main one.
  const primary = scratchPrimary();
  execFileSync('git', ['-C', primary, 'switch', '-q', '-c', 'feature/x']);
  assert.throws(() => assertIsolatedWorktree(primary), /primary \(control\) checkout/);
});

test('a linked worktree on a work branch is accepted', () => {
  const primary = scratchPrimary();
  const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-packet-wt-')), 'work');
  execFileSync('git', ['-C', primary, 'worktree', 'add', '-q', wt, '-b', 'feature/y']);

  const result = assertIsolatedWorktree(wt);
  assert.equal(result.branch, 'feature/y');
  assert.equal(fs.realpathSync(result.toplevel), fs.realpathSync(wt));
});

test('a linked worktree sitting on main is still refused', () => {
  const primary = scratchPrimary();
  const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-packet-wt-main-')), 'work');
  execFileSync('git', ['-C', primary, 'worktree', 'add', '-q', '--detach', wt]);
  execFileSync('git', ['-C', wt, 'switch', '-q', '-c', 'main-copy']);
  execFileSync('git', ['-C', wt, 'branch', '-q', '-m', 'main-copy', 'master']);

  assert.throws(() => assertIsolatedWorktree(wt), /refusing to run on "master"/);
});

test('a detached HEAD is refused — there is nothing to open a PR from', () => {
  const primary = scratchPrimary();
  const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-packet-wt-det-')), 'work');
  execFileSync('git', ['-C', primary, 'worktree', 'add', '-q', '--detach', wt]);

  assert.throws(() => assertIsolatedWorktree(wt), /detached HEAD/);
});
