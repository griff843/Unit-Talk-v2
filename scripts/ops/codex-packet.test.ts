import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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
  sanitizedGitEnv,
  GIT_REPO_SELECTION_VARS,
  extractScopePaths,
  splitScopePaths,
  normalizeScopePath,
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
  assert.deepEqual(classifyScope(REPO_ROOT, ['apps/api/src/submission-service.ts']), {
    reserved: false,
    surfaces: [],
  });
  assert.deepEqual(classifyScope(REPO_ROOT, ['supabase/migrations/0001_x.sql']), {
    reserved: true,
    surfaces: ['production-ddl-and-data'],
  });
});

test('classifyScope fails CLOSED when the policy cannot be read', () => {
  // The answer selects the model profile, and a reserved scope is held to a
  // stricter profile. Returning "nothing reserved" on an unreadable policy
  // would make this MORE permissive than the merge gate it mirrors at exactly
  // the moment policy truth is unavailable.
  assert.deepEqual(classifyScope(path.join(REPO_ROOT, 'does', 'not', 'exist'), ['a/b.ts']), {
    reserved: true,
    surfaces: ['unclassifiable'],
  });
});

test('classifyScope treats an empty scope as unclassifiable, never as clean', () => {
  assert.deepEqual(classifyScope(REPO_ROOT, []), { reserved: true, surfaces: ['unclassifiable'] });
});

test('sanitizedGitEnv strips every repository-selection variable', () => {
  // GIT_DIR overrides `git -C <dir>`: with it set, the isolation probes answer
  // about the repository it names while codex runs somewhere else entirely.
  const dirty = {
    PATH: '/usr/bin',
    GIT_DIR: '/repo/.git/worktrees/wt-x',
    GIT_WORK_TREE: '/repo',
    GIT_COMMON_DIR: '/repo/.git',
    GIT_INDEX_FILE: '/repo/.git/index',
    GIT_OBJECT_DIRECTORY: '/repo/.git/objects',
    GIT_ALTERNATE_OBJECT_DIRECTORIES: '/other/objects',
    GIT_CEILING_DIRECTORIES: '/',
    GIT_DISCOVERY_ACROSS_FILESYSTEM: '1',
    GIT_AUTHOR_NAME: 'kept',
  };
  const clean = sanitizedGitEnv(dirty);
  for (const name of GIT_REPO_SELECTION_VARS) {
    assert.equal(clean[name], undefined, `${name} must be stripped`);
  }
  assert.equal(clean.PATH, '/usr/bin');
  assert.equal(clean.GIT_AUTHOR_NAME, 'kept', 'identity vars are not repository selection');
  assert.equal(dirty.GIT_DIR, '/repo/.git/worktrees/wt-x', 'the caller env is not mutated');
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

// ── the packet must carry a mechanically checkable file boundary ──────────

test('the runner refuses a Scope section that yields no usable path', () => {
  // Prose passes the "section is non-empty" check while extracting nothing, so
  // without this the run would launch with no file boundary at all -- exactly
  // what `## Scope` exists to establish.
  const prosePacket = COMPLETE_PACKET.replace(
    /## Scope\n[\s\S]*?\n\n/,
    '## Scope\nThe submission service and anything it needs.\n\n'
  );
  assert.deepEqual(parsePacket(prosePacket).missingSections, [], 'the section itself is present');
  assert.deepEqual(parsePacket(prosePacket).scopePaths, [], 'but nothing is extractable from it');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packet-scope-'));
  const packetPath = path.join(dir, 'packet.md');
  fs.writeFileSync(packetPath, prosePacket);
  try {
    const result = spawnSync(
      'pnpm',
      ['exec', 'tsx', 'scripts/ops/codex-packet.ts', '--packet', packetPath, '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8', shell: process.platform === 'win32' }
    );
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /declares no usable path/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the deprecated dispatch skill routes to the packet flow instead of executing a lane', () => {
  // A deprecation notice in front matter does not stop an operative body from
  // running. The body itself must not carry a runnable legacy dispatch step.
  const skill = fs.readFileSync(path.join(REPO_ROOT, '.agents/skills/dispatch/SKILL.md'), 'utf8');
  const body = skill.split(/^---$/m).slice(2).join('---');
  for (const command of [
    'pnpm codex:dispatch',
    'pnpm codex:classify',
    'pnpm codex:status',
    'pnpm codex:receive',
    'pnpm ops:lane-start',
    'pnpm ops:lane-finalize',
    'pnpm ops:brief',
  ]) {
    assert.ok(!body.includes(command), `deprecated skill still offers a runnable "${command}"`);
  }
  assert.match(body, /ops:codex-packet/, 'it must name the replacement route');
});

// ── scope paths must be in the form the classifier's globs are anchored to ──

test('normalizeScopePath canonicalizes the spellings a packet actually uses', () => {
  assert.equal(normalizeScopePath('./supabase/migrations/x.sql'), 'supabase/migrations/x.sql');
  assert.equal(normalizeScopePath('supabase\\migrations\\x.sql'), 'supabase/migrations/x.sql');
  assert.equal(normalizeScopePath('apps//api/./src/a.ts'), 'apps/api/src/a.ts');
  assert.equal(normalizeScopePath('apps/api/../worker/src/a.ts'), 'apps/worker/src/a.ts');
  // Nothing that leaves the repo has a reserved-surface answer, so it is not a
  // scope path at all.
  assert.equal(normalizeScopePath('/etc/passwd'), null);
  assert.equal(normalizeScopePath('C:/Windows/system32'), null);
  assert.equal(normalizeScopePath('../outside/a.ts'), null);
  assert.equal(normalizeScopePath('https://example.com/a.ts'), null);
  assert.equal(normalizeScopePath('   '), null);
});

test('a dot-slash scope path still classifies as reserved', () => {
  // The classifier's globs are anchored, so `./supabase/...` matched nothing
  // before normalization: the packet read as unreserved and could take the
  // T2-only default profile while its eventual diff needed reserved handling.
  assert.deepEqual(extractScopePaths('- `./supabase/migrations/0001_x.sql`'), [
    'supabase/migrations/0001_x.sql',
  ]);
  assert.deepEqual(classifyScope(REPO_ROOT, extractScopePaths('- `./supabase/migrations/0001_x.sql`')), {
    reserved: true,
    surfaces: ['production-ddl-and-data'],
  });
});

test('assertIsolatedWorktree refuses a SUBDIRECTORY of the primary checkout', () => {
  // `--git-common-dir` is relative to the cwd git ran in, not to the toplevel.
  // Resolving it against the toplevel named a directory outside the repo, so
  // the equality test failed and a subdirectory of the control checkout passed
  // as isolated whenever it was on a non-protected branch.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packet-primary-'));
  const git = (cwd: string, ...args: string[]): void => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
  };
  try {
    git(dir, 'init', '-b', 'feature/work');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    fs.mkdirSync(path.join(dir, 'nested', 'deeper'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'nested', 'deeper', 'a.txt'), 'x');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-m', 'init');

    // The root of the control checkout was already refused before this fix.
    assert.throws(() => assertIsolatedWorktree(dir), /primary \(control\) checkout/);
    // The subdirectory is the case that slipped through.
    assert.throws(
      () => assertIsolatedWorktree(path.join(dir, 'nested', 'deeper')),
      /primary \(control\) checkout/,
      'a subdirectory of the control checkout must be refused like its root',
    );

    // A linked worktree of the same repo, and its subdirectories, stay allowed.
    const linked = path.join(dir, '..', path.basename(dir) + '-wt');
    git(dir, 'worktree', 'add', '-b', 'feature/isolated', linked);
    assert.equal(assertIsolatedWorktree(linked).branch, 'feature/isolated');
    assert.equal(
      assertIsolatedWorktree(path.join(linked, 'nested', 'deeper')).branch,
      'feature/isolated',
    );
    fs.rmSync(linked, { recursive: true, force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── a scope bullet the runner drops is still an instruction to Codex ───────

test('splitScopePaths keeps the bullets it cannot normalize', () => {
  const scope = [
    '- `apps/api/src/a.ts`',
    '- `../outside/a.ts`',
    '- `/etc/passwd`',
    '- prose that is not a path at all',
    '- see https://example.com/docs',
  ].join('\n');
  const result = splitScopePaths(scope);
  assert.deepEqual(result.scopePaths, ['apps/api/src/a.ts']);
  // Prose and URLs were never scope declarations, so they are not errors.
  assert.deepEqual(result.invalidScopePaths, ['../outside/a.ts', '/etc/passwd']);
});

test('the runner refuses a MIXED scope rather than silently dropping the bad path', () => {
  // One good path made the non-empty check pass while the raw packet still told
  // a danger-full-access run that ../outside/a.ts was in scope.
  const mixed = COMPLETE_PACKET.replace(
    /## Scope\n[\s\S]*?\n\n/,
    '## Scope\n- `apps/api/src/submission-service.ts`\n- `../outside/a.ts`\n\n'
  );
  const parsed = parsePacket(mixed);
  assert.deepEqual(parsed.scopePaths, ['apps/api/src/submission-service.ts']);
  assert.deepEqual(parsed.invalidScopePaths, ['../outside/a.ts']);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packet-mixed-'));
  const packetPath = path.join(dir, 'packet.md');
  fs.writeFileSync(packetPath, mixed);
  try {
    const result = spawnSync(
      'pnpm',
      ['exec', 'tsx', 'scripts/ops/codex-packet.ts', '--packet', packetPath, '--dry-run'],
      { cwd: REPO_ROOT, encoding: 'utf8', shell: process.platform === 'win32' }
    );
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /not inside this repository: \.\.\/outside\/a\.ts/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('assertIsolatedWorktree refuses a linked worktree of a DIFFERENT repository', () => {
  // It is linked, it is not the primary checkout, and it is on a feature
  // branch -- so every other check passes. Launching there would point this
  // packet at an unrelated project.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'packet-otherrepo-'));
  const git = (cwd: string, ...args: string[]): void => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
  };
  try {
    for (const name of ['repo-a', 'repo-b']) {
      const dir = path.join(base, name);
      fs.mkdirSync(dir);
      git(dir, 'init', '-b', 'main');
      git(dir, 'config', 'user.email', 'test@example.com');
      git(dir, 'config', 'user.name', 'test');
      fs.writeFileSync(path.join(dir, 'a.txt'), name);
      git(dir, 'add', '-A');
      git(dir, 'commit', '-m', 'init');
    }
    const repoA = path.join(base, 'repo-a');
    const repoB = path.join(base, 'repo-b');
    const wtB = path.join(base, 'wt-b');
    git(repoB, 'worktree', 'add', '-b', 'feature/other', wtB);

    // Without the invoking repo, the foreign worktree looks perfectly isolated.
    assert.equal(assertIsolatedWorktree(wtB).branch, 'feature/other');
    // Bound to repo-a, it is refused.
    assert.throws(
      () => assertIsolatedWorktree(wtB, repoA),
      /belongs to a different repository/,
      'a worktree of another repository must not be accepted',
    );
    // A worktree of the invoking repo still passes.
    const wtA = path.join(base, 'wt-a');
    git(repoA, 'worktree', 'add', '-b', 'feature/mine', wtA);
    assert.equal(assertIsolatedWorktree(wtA, repoA).branch, 'feature/mine');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('a directory scope is reserved by what it contains', () => {
  // A packet scopes directories; the classifier answers about files.
  // `supabase/migrations` matches no reserved glob on its own, but every file
  // it can contain is reserved.
  for (const dir of ['supabase/migrations', 'supabase', '.github/workflows', '.github']) {
    const result = classifyScope(REPO_ROOT, [dir]);
    assert.equal(result.reserved, true, dir);
  }
});

test('an ordinary directory scope stays unreserved', () => {
  // Deliberately not `apps/smart-form/lib`: that directory contains
  // `auth-*.ts`, so reserving it is correct, not a false positive.
  for (const dir of ['packages/domain/src', 'apps/smart-form/components']) {
    const result = classifyScope(REPO_ROOT, [dir]);
    assert.equal(result.reserved, false, `${dir}: ${result.surfaces.join(',')}`);
  }
});

test('a wildcard scope is reserved by what it can reach', () => {
  // Round 7: normalization accepts a broad wildcard, but the descendant check
  // compared it verbatim -- `**` was treated as a literal directory name, so
  // `apps/worker/**` did not appear to live under `apps/**/` and a packet
  // covering the whole of apps/ reported unreserved and took the permissive
  // default profile. A broader scope must be at least as reserved as anything
  // inside it.
  for (const scope of ['apps/**', 'supabase/**', '.github/**', 'apps/*']) {
    const result = classifyScope(REPO_ROOT, [scope]);
    assert.equal(result.reserved, true, `${scope}: ${result.surfaces.join(',')}`);
  }
});

test('a wildcard scope over unreserved ground stays unreserved', () => {
  // The fix must not collapse into "any wildcard reserves", which would be a
  // different way of reserving everything.
  const result = classifyScope(REPO_ROOT, ['packages/domain/src/**']);
  assert.equal(result.reserved, false, result.surfaces.join(','));
});

test('a scope naming a reserved-by-filename file is reserved', () => {
  // Round 8 review: `**/.env` has no literal directory prefix, so the
  // directory-containment supplement below it cannot match. It does not need
  // to -- classifyDiff already answers the file case, using the same code and
  // the same excludePaths the merge gate uses. Asserted so a future
  // "simplification" of classifyScope that drops the classifyDiff call is
  // caught here rather than by a packet running under a permissive profile.
  for (const scope of [
    'packages/config/.env',
    '.env',
    'apps/worker/.env.production',
    'packages/db/.npmrc',
    '.pnpmfile.cjs',
  ]) {
    const result = classifyScope(REPO_ROOT, [scope]);
    assert.equal(result.reserved, true, `${scope}: ${result.surfaces.join(',')}`);
  }
});

test('this function does not disagree with the gate it mirrors on excluded paths', () => {
  // A hand-rolled glob matcher added here to "cover" suffix-only globs made
  // `**/.env.example` reserved, even though the secrets surface excludes
  // committed templates on purpose. Being stricter than the merge gate is a
  // divergence, not extra safety: it prices a documentation edit at credential
  // attention, which is the exact failure the excludeNote exists to prevent.
  const result = classifyScope(REPO_ROOT, ['packages/config/.env.example']);
  assert.equal(result.reserved, false, result.surfaces.join(','));
});

test('a directory scope that could contain a credential file is not reserved on that basis', () => {
  // Deliberate, and the reason is worth stating: EVERY directory in the repo
  // can contain a `.env`, so reserving on that possibility returns the same
  // answer for every input. A control that cannot distinguish its inputs is
  // not a control. The directory case is carried by the packet prohibition
  // (next test) and enforced where the actual diff is visible.
  for (const dir of ['packages/domain/src', 'apps/smart-form/components']) {
    const result = classifyScope(REPO_ROOT, [dir]);
    assert.equal(result.reserved, false, `${dir}: ${result.surfaces.join(',')}`);
  }
});

test('the packet prompt prohibits reserved filename shapes outright', () => {
  // The directory case cannot be answered from the scope path, so the
  // prohibition has to reach the executor in words. If this text is dropped, a
  // directory-scoped packet has nothing telling it not to write a `.env`.
  const prompt = buildPrompt('docs/mission/packets/x.md', '# packet');
  for (const shape of ['.env', '.npmrc', '.pnpmfile.cjs']) {
    assert.ok(prompt.includes(shape), `prompt does not prohibit ${shape}`);
  }
});

test('the packet prohibition does not forbid the templates policy excludes', () => {
  // Round 8 review, on the prohibition added earlier in round 8: it forbade
  // every `.env.*` file, including `.env.example`, which the secrets surface
  // excludes on purpose. Adding an environment variable normally requires
  // updating that template in the same change, so the prompt blocked an
  // ordinary edit that the classifier itself returns `auto` for — a
  // prohibition stricter than the gate it anticipates, which is the same
  // divergence this round already corrected once in classifyScope.
  const prompt = buildPrompt('docs/mission/packets/x.md', '# packet');
  for (const template of ['.env.example', '.env.template', '.env.sample']) {
    assert.ok(prompt.includes(template), `prompt does not exempt ${template}`);
  }
  assert.match(prompt, /NOT prohibited/);
  // The credential-bearing shapes are still forbidden.
  for (const shape of ['.npmrc', '.pnpmfile.cjs']) {
    assert.ok(prompt.includes(shape), `prompt no longer prohibits ${shape}`);
  }
});

test('a path-shaped line outside a bullet is an invalid scope entry, not an absent one', () => {
  // Round 8 review. The Scope grammar is one path per bullet. A mixed section —
  // one valid bullet plus an unbulleted instruction — kept the valid bullet, so
  // the nonempty-scope check passed and the packet ran under the permissive
  // default profile, while the executor still read the raw instruction and
  // could edit a path OUTSIDE the repository. Neither reserved-surface gate can
  // see that: a file changed outside Git never reaches a diff. This is the same
  // silent-skip defect class as the malformed EXECUTOR_RESULT and the fenced
  // PM-verdict example — a WRONG artifact read as an ABSENT one.
  const mixed = splitScopePaths(
    ['- `scripts/ops/thing.ts`', 'Also edit ../outside/a.ts'].join('\n'),
  );
  assert.deepEqual(mixed.scopePaths, ['scripts/ops/thing.ts']);
  assert.equal(mixed.invalidScopePaths.length, 1, JSON.stringify(mixed));
  assert.match(mixed.invalidScopePaths[0]!, /outside\/a\.ts/);

  // Prose and headings in a Scope section are not scope declarations and must
  // not be reported — otherwise every packet with a sentence of context fails,
  // and a check that fires on everything gets switched off.
  const prose = splitScopePaths(
    [
      '- `scripts/ops/thing.ts`',
      'Keep the change small and focused.',
      '# Notes',
      '> quoted guidance',
      'See https://example.com/docs/thing for background.',
    ].join('\n'),
  );
  assert.deepEqual(prose.scopePaths, ['scripts/ops/thing.ts']);
  assert.deepEqual(prose.invalidScopePaths, [], JSON.stringify(prose.invalidScopePaths));
});
