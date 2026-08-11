/**
 * End-to-end behavioral proof for bootstrap governance identity (UTV2-1619).
 *
 * WHY THIS FILE EXISTS. The first implementation was covered by unit tests that
 * hand-fed the resolver the state they wanted to assert on -- including a lane
 * manifest the real pipeline could never produce. Those tests passed while the
 * actual pipeline failed, because nothing in them exercised the path that
 * decides anything: real git refs, a real `origin/main`, the real CLI, and the
 * real consumer reading the real decision artifact.
 *
 * Every test here builds a throwaway repository with a genuine `origin/main`,
 * commits a branch, and runs the shipped CLI against it by spawning `tsx` the
 * same way the workflows do. Nothing is stubbed. A test that wants a refusal
 * has to actually produce the condition that causes it.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluateFileScopeGuard, loadBootstrapAction } from '../ci/file-scope-guard.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RESOLVER_SOURCE = path.join(REPO_ROOT, 'scripts', 'ops', 'bootstrap-authorization.ts');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

const EXIT_VALID = 0;
const EXIT_RECOGNIZED_INVALID = 3;
const EXIT_NOT_RECOGNIZED = 4;

const GRANT = {
  issue_id: 'UTV2-1619',
  lane_type: 'governance',
  tier: 'T2',
  authorized_by: 'griff843',
  authorized_at: '2026-08-05',
  expires_at: '2099-01-01',
  milestone: 'Milestone 1',
  reason: 'admission dependency',
};

function authorizationsDocument(...authorizations: Record<string, unknown>[]): string {
  return `${JSON.stringify({ schema_version: 1, authorizations }, null, 2)}\n`;
}

function laneManifest(overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    schema_version: 2, issue_id: 'UTV2-1619', lane_type: 'governance', tier: 'T2',
    branch: 'claude/utv2-1619-previous', base_branch: 'main', status: 'done',
    file_scope_lock: [], expected_proof_paths: [], ...overrides,
  }, null, 2)}\n`;
}

interface Fixture {
  dir: string;
  tempDir: string;
  write(relativePath: string, contents: string): void;
  commit(message: string): void;
  branch(name: string): void;
  /** Run the shipped resolver CLI. Returns exit code plus the decision it wrote. */
  resolve(options: {
    branch: string;
    issueId?: string;
    tier?: string;
    changedFiles?: string[];
    title?: string;
    commits?: string;
    /** Run the PR-head copy instead of the base-pinned one. Adversarial cases only. */
    useHeadResolver?: boolean;
  }): { code: number; decisionPath: string; decision: Record<string, unknown> | null };
}

/**
 * Build a repository with a real `origin/main`. The resolver reads authority
 * with `git show origin/main:...`, so a fixture without a genuine remote-tracking
 * ref would silently exercise the "cannot read authority" path instead of the
 * one under test.
 */
function makeFixture(t: { after(fn: () => void): void }, options: {
  authorizations?: string | null;
  manifest?: string | null;
  resolver?: string;
} = {}): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1619-e2e-'));
  const originDir = path.join(root, 'origin.git');
  const workDir = path.join(root, 'work');
  const tempDir = path.join(root, 'runner-temp');
  fs.mkdirSync(tempDir, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const git = (args: string[], cwd = workDir): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '--bare', '--initial-branch=main', originDir], { stdio: 'ignore' });
  execFileSync('git', ['init', '--initial-branch=main', workDir], { stdio: 'ignore' });
  git(['config', 'user.email', 'e2e@example.test']);
  git(['config', 'user.name', 'UTV2 E2E']);
  git(['remote', 'add', 'origin', originDir]);

  const write = (relativePath: string, contents: string): void => {
    const target = path.join(workDir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, 'utf8');
  };
  const commit = (message: string): void => {
    git(['add', '-A']);
    git(['commit', '-q', '-m', message]);
  };

  // Base state: the resolver source itself lives on main, exactly as it will
  // once this lane merges. That is the phase-2 world the mechanism targets.
  write('scripts/ops/bootstrap-authorization.ts', options.resolver ?? fs.readFileSync(RESOLVER_SOURCE, 'utf8'));
  if (options.authorizations !== null) {
    write('docs/governance/BOOTSTRAP_AUTHORIZATIONS.json', options.authorizations ?? authorizationsDocument(GRANT));
  }
  if (options.manifest !== null) {
    write('docs/06_status/lanes/UTV2-1619.json', options.manifest ?? laneManifest());
  }
  write('README.md', '# fixture\n');
  commit('base');
  git(['push', '-q', 'origin', 'main']);
  git(['fetch', '-q', 'origin']);

  return {
    dir: workDir,
    tempDir,
    write,
    commit,
    branch: (name: string) => git(['checkout', '-q', '-b', name]),
    resolve({ branch, issueId, tier = 'T2', changedFiles, title, commits, useHeadResolver }) {
      const changedFilesFile = path.join(tempDir, 'changed-files.txt');
      const files = changedFiles ?? git(['diff', '--name-only', 'origin/main...HEAD'])
        .split('\n').map((line) => line.trim()).filter(Boolean);
      fs.writeFileSync(changedFilesFile, `${files.join('\n')}\n`, 'utf8');

      const decisionPath = path.join(tempDir, 'bootstrap-action.json');
      fs.rmSync(decisionPath, { force: true });

      // Default to the base-pinned copy, because that is what the workflows
      // execute. Defaulting to the working-tree copy would quietly test a file
      // the pipeline never runs -- and in the adversarial cases below, would
      // test the attacker's own resolver.
      const extractedResolver = path.join(tempDir, 'trusted-bootstrap-authorization.ts');
      fs.writeFileSync(
        extractedResolver,
        git(['show', 'origin/main:scripts/ops/bootstrap-authorization.ts']),
        'utf8',
      );
      const args = [
        useHeadResolver ? path.join(workDir, 'scripts/ops/bootstrap-authorization.ts') : extractedResolver,
        '--resolve-action', issueId ?? (branch.match(/UTV2-\d+/i)?.[0] ?? '').toUpperCase(),
        '--branch', branch,
        '--tier', tier,
        '--changed-files-file', changedFilesFile,
        '--head', 'HEAD',
        '--output-json', decisionPath,
      ];
      if (title !== undefined) args.push('--title', title);
      if (commits !== undefined) {
        const commitsFile = path.join(tempDir, 'commits.txt');
        fs.writeFileSync(commitsFile, commits, 'utf8');
        args.push('--commits-file', commitsFile);
      }

      let code = 0;
      try {
        execFileSync(TSX, args, { cwd: workDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        code = typeof (error as { status?: number }).status === 'number'
          ? (error as { status: number }).status
          : 1;
      }
      const decision = fs.existsSync(decisionPath)
        ? (JSON.parse(fs.readFileSync(decisionPath, 'utf8')) as Record<string, unknown>)
        : null;
      return { code, decisionPath, decision };
    },
  };
}

// ── 1. An ordinary manifest-backed UTV2-1619 lane stays ordinary ────────────

test('E2E-1: an active manifest-backed UTV2-1619 lane is never a bootstrap action', (t) => {
  const fixture = makeFixture(t, { manifest: laneManifest({ status: 'started', branch: 'claude/utv2-1619-normal' }) });
  fixture.branch('claude/utv2-1619-normal');
  fixture.write('scripts/ops/bootstrap-authorization.ts', 'export const touched = true;\n');
  fixture.commit('UTV2-1619 ordinary lane work');

  const { code, decision } = fixture.resolve({ branch: 'claude/utv2-1619-normal' });
  assert.equal(code, EXIT_NOT_RECOGNIZED);
  assert.equal(decision?.recognized, false);
  // Step A precedes step B: the active lane identity is the reason reported,
  // and the intent gate is never even reached.
  assert.equal(decision?.code, 'normal_lane_identified');
});

test('E2E-1c: without an active lane, an ordinary branch is refused for lack of intent', (t) => {
  // Same grant, same issue, no active manifest -- and still not a bootstrap
  // action, because the branch never signalled one. This is the case that
  // proves recognition does not follow from the issue ID.
  const fixture = makeFixture(t, { manifest: null });
  fixture.branch('claude/utv2-1619-normal');
  fixture.write('scripts/ops/bootstrap-authorization.ts', 'export const touched = true;\n');
  fixture.commit('UTV2-1619 ordinary lane work');

  const { code, decision } = fixture.resolve({ branch: 'claude/utv2-1619-normal' });
  assert.equal(code, EXIT_NOT_RECOGNIZED);
  assert.equal(decision?.recognized, false);
  assert.equal(decision?.code, 'bootstrap_intent_absent');
});

test('E2E-1a: even a bootstrap-namespaced branch defers to an active lane manifest', (t) => {
  // The grant names UTV2-1619 and the branch signals bootstrap intent, yet an
  // active lane identity still wins. Issue ID + intent must not be sufficient.
  const fixture = makeFixture(t, { manifest: laneManifest({ status: 'in_review' }) });
  fixture.branch('bootstrap/utv2-1619-support');
  fixture.write('scripts/ops/bootstrap-authorization.ts', 'export const touched = true;\n');
  fixture.commit('UTV2-1619 bootstrap attempt');

  const { code, decision } = fixture.resolve({ branch: 'bootstrap/utv2-1619-support' });
  assert.equal(code, EXIT_NOT_RECOGNIZED);
  assert.equal(decision?.recognized, false);
  assert.equal(decision?.code, 'normal_lane_identified');
});

test('E2E-1b: a lane manifest introduced by the branch is pinned to its first commit', (t) => {
  // No manifest on base. The branch adds an ACTIVE one, so the lane has a
  // normal identity and bootstrap must not be evaluated -- resolved from the
  // adding commit, not the head tip.
  const fixture = makeFixture(t, { manifest: null });
  fixture.branch('bootstrap/utv2-1619-support');
  fixture.write('docs/06_status/lanes/UTV2-1619.json', laneManifest({ status: 'started' }));
  fixture.commit('UTV2-1619 declare lane');
  fixture.write('README.md', '# later\n');
  fixture.commit('UTV2-1619 more work');

  const { code, decision } = fixture.resolve({ branch: 'bootstrap/utv2-1619-support' });
  assert.equal(code, EXIT_NOT_RECOGNIZED);
  assert.equal(decision?.code, 'normal_lane_identified');
});

// ── 2. A valid bootstrap action succeeds, end to end ────────────────────────

test('E2E-2: a valid bootstrap action resolves and the real guard accepts its scope', (t) => {
  const fixture = makeFixture(t); // manifest on base is status "done" -> not active
  fixture.branch('bootstrap/utv2-1619-support');
  fixture.write('scripts/ops/bootstrap-authorization.ts', 'export const touched = true;\n');
  fixture.commit('feat(governance): UTV2-1619 recognize bootstrap actions');

  const { code, decision, decisionPath } = fixture.resolve({
    branch: 'bootstrap/utv2-1619-support',
    title: 'UTV2-1619: bootstrap identity support',
    commits: 'feat(governance): UTV2-1619 recognize bootstrap actions',
  });
  assert.equal(code, EXIT_VALID);
  assert.equal(decision?.valid, true);
  assert.equal(decision?.issue_id, 'UTV2-1619');
  assert.equal(decision?.tier, 'T2');
  assert.equal((decision?.authority_source as { ref: string }).ref, 'origin/main');

  // The real consumer, reading the real artifact from outside the checkout.
  const loaded = loadBootstrapAction(fixture.dir, decisionPath);
  assert.equal(loaded?.valid, true, 'the guard must accept a genuine runner-temp decision');
  const guard = evaluateFileScopeGuard({
    prBranch: 'bootstrap/utv2-1619-support',
    changedFiles: ['scripts/ops/bootstrap-authorization.ts'],
    manifests: [],
    bootstrapAction: loaded,
  });
  assert.equal(guard.verdict, 'PASS');
  assert.equal(guard.own_manifest_issue, 'UTV2-1619');
});

test('E2E-2a: a bootstrap action touching a file outside the fixed scope is refused', (t) => {
  const fixture = makeFixture(t);
  fixture.branch('bootstrap/utv2-1619-support');
  fixture.write('apps/api/src/server.ts', 'export const oops = true;\n');
  fixture.commit('UTV2-1619 reach outside bootstrap scope');

  const { code, decision } = fixture.resolve({ branch: 'bootstrap/utv2-1619-support' });
  assert.equal(code, EXIT_RECOGNIZED_INVALID);
  assert.equal(decision?.code, 'scope_violation');
});

// ── 3. Self-authorization fails ─────────────────────────────────────────────

test('E2E-3: a grant that exists only on the PR head authorizes nothing', (t) => {
  const fixture = makeFixture(t, { authorizations: null, manifest: null });
  fixture.branch('bootstrap/utv2-1619-support');
  fixture.write('docs/governance/BOOTSTRAP_AUTHORIZATIONS.json', authorizationsDocument(GRANT));
  fixture.commit('UTV2-1619 grant itself admission');

  const { code, decision } = fixture.resolve({ branch: 'bootstrap/utv2-1619-support' });
  assert.equal(code, EXIT_RECOGNIZED_INVALID);
  assert.equal(decision?.code, 'no_authorization_file');
});

test('E2E-3a: widening the grant on the head cannot change what main authorizes', (t) => {
  // Base grants T2. The head rewrites the grant to T1 and to a different issue.
  // Authority still comes from base, so the tier the action claims must match
  // base's tier, not the one the PR wrote for itself.
  const fixture = makeFixture(t);
  fixture.branch('bootstrap/utv2-1619-support');
  fixture.write(
    'docs/governance/BOOTSTRAP_AUTHORIZATIONS.json',
    authorizationsDocument({ ...GRANT, tier: 'T1' }),
  );
  fixture.commit('UTV2-1619 rewrite own grant');

  const { code, decision } = fixture.resolve({ branch: 'bootstrap/utv2-1619-support', tier: 'T1' });
  assert.equal(code, EXIT_RECOGNIZED_INVALID);
  assert.equal(decision?.code, 'tier_mismatch');
});

// ── 4/5. Malformed and multiple grants: fail closed, zero blast radius ──────

test('E2E-4: a malformed grant fails closed for a bootstrap action', (t) => {
  const fixture = makeFixture(t, { authorizations: '{ not json\n' });
  fixture.branch('bootstrap/utv2-1619-support');
  fixture.write('scripts/ops/bootstrap-authorization.ts', 'export const touched = true;\n');
  fixture.commit('UTV2-1619 bootstrap attempt');

  const { code, decision } = fixture.resolve({ branch: 'bootstrap/utv2-1619-support' });
  assert.equal(code, EXIT_RECOGNIZED_INVALID);
  assert.equal(decision?.code, 'malformed_authorization_file');
});

test('E2E-4a: a malformed grant leaves an unrelated normal PR completely unaffected', (t) => {
  const fixture = makeFixture(t, { authorizations: '{ not json\n', manifest: null });
  fixture.branch('codex/utv2-1701-normal');
  fixture.write('apps/api/src/server.ts', 'export const normal = true;\n');
  fixture.commit('UTV2-1701 ordinary work');

  const { code, decision, decisionPath } = fixture.resolve({ branch: 'codex/utv2-1701-normal' });
  assert.equal(code, EXIT_NOT_RECOGNIZED);
  assert.equal(decision?.recognized, false);
  assert.equal(decision?.code, 'bootstrap_intent_absent',
    'a malformed grant must be unreachable for a PR that never claimed bootstrap identity');

  // And the consumer treats it as an ordinary lane.
  const guard = evaluateFileScopeGuard({
    prBranch: 'codex/utv2-1701-normal',
    changedFiles: ['apps/api/src/server.ts'],
    manifests: [{
      issue_id: 'UTV2-1701', branch: 'codex/utv2-1701-normal', status: 'started',
      file_scope_lock: ['apps/api/src/server.ts'],
    }],
    bootstrapAction: loadBootstrapAction(fixture.dir, decisionPath),
  });
  assert.equal(guard.verdict, 'PASS');
  assert.deepEqual(guard.errors, []);
});

test('E2E-5: multiple active grants fail closed for a bootstrap action', (t) => {
  const fixture = makeFixture(t, {
    authorizations: authorizationsDocument(GRANT, { ...GRANT, issue_id: 'UTV2-1686' }),
  });
  fixture.branch('bootstrap/utv2-1619-support');
  fixture.write('scripts/ops/bootstrap-authorization.ts', 'export const touched = true;\n');
  fixture.commit('UTV2-1619 bootstrap attempt');

  const { code, decision } = fixture.resolve({ branch: 'bootstrap/utv2-1619-support' });
  assert.equal(code, EXIT_RECOGNIZED_INVALID);
  assert.equal(decision?.code, 'multiple_active_authorizations');
});

test('E2E-5a: multiple active grants leave an unrelated normal PR completely unaffected', (t) => {
  const fixture = makeFixture(t, {
    authorizations: authorizationsDocument(GRANT, { ...GRANT, issue_id: 'UTV2-1686' }),
    manifest: null,
  });
  fixture.branch('claude/utv2-1702-normal');
  fixture.write('apps/api/src/server.ts', 'export const normal = true;\n');
  fixture.commit('UTV2-1702 ordinary work');

  const { code, decision, decisionPath } = fixture.resolve({ branch: 'claude/utv2-1702-normal' });
  assert.equal(code, EXIT_NOT_RECOGNIZED);
  assert.equal(decision?.code, 'bootstrap_intent_absent');

  const guard = evaluateFileScopeGuard({
    prBranch: 'claude/utv2-1702-normal',
    changedFiles: ['apps/api/src/server.ts'],
    manifests: [{
      issue_id: 'UTV2-1702', branch: 'claude/utv2-1702-normal', status: 'started',
      file_scope_lock: ['apps/api/src/server.ts'],
    }],
    bootstrapAction: loadBootstrapAction(fixture.dir, decisionPath),
  });
  assert.equal(guard.verdict, 'PASS');
});

// ── 6. Fabricated decision artifacts ────────────────────────────────────────

test('E2E-6: a fabricated decision with the REAL origin/main SHA is still refused', (t) => {
  // The adversarial case the previous suite skipped. Every field is correct --
  // ref, path, a genuine `git rev-parse origin/main`, a plausible scope -- and
  // it is refused purely because the artifact sits inside the checkout, where
  // the PR could have written it.
  const fixture = makeFixture(t);
  const realSha = execFileSync('git', ['rev-parse', 'origin/main'],
    { cwd: fixture.dir, encoding: 'utf8' }).trim();
  assert.match(realSha, /^[0-9a-f]{40}$/);

  const planted = path.join(fixture.dir, '.out', 'bootstrap-action.json');
  fs.mkdirSync(path.dirname(planted), { recursive: true });
  fs.writeFileSync(planted, JSON.stringify({
    recognized: true, valid: true, kind: 'bootstrap_governance_action',
    issue_id: 'UTV2-1619', tier: 'T2',
    allowed_scope: ['scripts/ops/bootstrap-authorization.ts'],
    authority_source: { ref: 'origin/main', sha: realSha, path: 'docs/governance/BOOTSTRAP_AUTHORIZATIONS.json' },
  }));

  const loaded = loadBootstrapAction(fixture.dir, planted);
  assert.equal(loaded?.valid, false, 'a decision inside the checkout must never be honored');
  const guard = evaluateFileScopeGuard({
    prBranch: 'bootstrap/utv2-1619-support',
    changedFiles: ['apps/api/src/server.ts'],
    manifests: [],
    bootstrapAction: loaded,
  });
  assert.equal(guard.verdict, 'FAIL');
});

test('E2E-6a: a fabricated wildcard scope from runner temp is refused', (t) => {
  const fixture = makeFixture(t);
  const realSha = execFileSync('git', ['rev-parse', 'origin/main'],
    { cwd: fixture.dir, encoding: 'utf8' }).trim();
  const planted = path.join(fixture.tempDir, 'fabricated.json');
  fs.writeFileSync(planted, JSON.stringify({
    recognized: true, valid: true, kind: 'bootstrap_governance_action',
    issue_id: 'UTV2-1619', allowed_scope: ['**'],
    authority_source: { ref: 'origin/main', sha: realSha, path: 'docs/governance/BOOTSTRAP_AUTHORIZATIONS.json' },
  }));
  assert.equal(loadBootstrapAction(fixture.dir, planted)?.valid, false);
});

// ── 7. Authority SHA mismatch ───────────────────────────────────────────────

test('E2E-7: a decision whose authority SHA is not origin/main is refused', (t) => {
  const fixture = makeFixture(t);
  const stale = path.join(fixture.tempDir, 'stale.json');
  fs.writeFileSync(stale, JSON.stringify({
    recognized: true, valid: true, kind: 'bootstrap_governance_action',
    issue_id: 'UTV2-1619', allowed_scope: ['scripts/ops/bootstrap-authorization.ts'],
    authority_source: { ref: 'origin/main', sha: '0'.repeat(40), path: 'docs/governance/BOOTSTRAP_AUTHORIZATIONS.json' },
  }));
  const loaded = loadBootstrapAction(fixture.dir, stale);
  assert.equal(loaded?.valid, false);
  assert.equal(loaded?.code, 'malformed_bootstrap_action_result');
});

test('E2E-7a: the SHA check is real -- the same decision with the true SHA is accepted', (t) => {
  // Proves E2E-7 refuses because of the SHA, not because the fixture makes
  // every decision fail. A control that cannot pass proves nothing.
  const fixture = makeFixture(t);
  const realSha = execFileSync('git', ['rev-parse', 'origin/main'],
    { cwd: fixture.dir, encoding: 'utf8' }).trim();
  const good = path.join(fixture.tempDir, 'good.json');
  fs.writeFileSync(good, JSON.stringify({
    recognized: true, valid: true, kind: 'bootstrap_governance_action',
    issue_id: 'UTV2-1619', allowed_scope: ['scripts/ops/bootstrap-authorization.ts'],
    authority_source: { ref: 'origin/main', sha: realSha, path: 'docs/governance/BOOTSTRAP_AUTHORIZATIONS.json' },
  }));
  assert.equal(loadBootstrapAction(fixture.dir, good)?.valid, true);
});

// ── 8. A head-controlled consumer cannot bypass base authority ──────────────

test('E2E-8: a subverted head resolver is never the one that runs', (t) => {
  // The PR rewrites scripts/ops/bootstrap-authorization.ts to approve anything.
  // The workflows extract the resolver from origin/main, so that rewrite is
  // inert -- and the base copy still refuses, for the real reason.
  const subverted = `
export function main(): number { return 0; }
import fs from 'node:fs';
const out = process.argv[process.argv.indexOf('--output-json') + 1];
fs.writeFileSync(out, JSON.stringify({
  recognized: true, valid: true, kind: 'bootstrap_governance_action',
  issue_id: 'UTV2-1619', tier: 'T2', allowed_scope: ['**'],
  authority_source: { ref: 'origin/main', sha: 'f'.repeat(40), path: 'docs/governance/BOOTSTRAP_AUTHORIZATIONS.json' },
}));
`;
  const fixture = makeFixture(t, { authorizations: null, manifest: null });
  fixture.branch('bootstrap/utv2-1619-support');
  fixture.write('scripts/ops/bootstrap-authorization.ts', subverted);
  fixture.commit('UTV2-1619 subvert the resolver');

  // What the workflow actually runs: the base copy.
  const viaBase = fixture.resolve({ branch: 'bootstrap/utv2-1619-support' });
  assert.equal(viaBase.code, EXIT_RECOGNIZED_INVALID);
  assert.equal(viaBase.decision?.code, 'no_authorization_file',
    'the base resolver must refuse on the real reason, not on the head rewrite');

  // And for contrast: running the head copy WOULD have approved it. That is
  // exactly the outcome the base pin exists to prevent, so it is asserted here
  // rather than left as an assumption.
  const viaHead = fixture.resolve({ branch: 'bootstrap/utv2-1619-support', useHeadResolver: true });
  assert.equal(viaHead.decision?.valid, true);
  // ...but the consumer still refuses it, because the forged authority SHA
  // does not match origin/main. Two independent controls, both holding.
  assert.equal(loadBootstrapAction(fixture.dir, viaHead.decisionPath)?.valid, false);
});

test('E2E-8a: an expired grant is refused end to end', (t) => {
  const fixture = makeFixture(t, {
    authorizations: authorizationsDocument({ ...GRANT, expires_at: '2020-01-01' }),
  });
  fixture.branch('bootstrap/utv2-1619-support');
  fixture.write('scripts/ops/bootstrap-authorization.ts', 'export const touched = true;\n');
  fixture.commit('UTV2-1619 bootstrap attempt');

  const { code, decision } = fixture.resolve({ branch: 'bootstrap/utv2-1619-support' });
  assert.equal(code, EXIT_RECOGNIZED_INVALID);
  assert.equal(decision?.code, 'authorization_expired');
});

test('E2E-8b: a foreign issue in the commit trail refuses the action', (t) => {
  const fixture = makeFixture(t);
  fixture.branch('bootstrap/utv2-1619-support');
  fixture.write('scripts/ops/bootstrap-authorization.ts', 'export const touched = true;\n');
  fixture.commit('UTV2-1619 bootstrap support');

  const { code, decision } = fixture.resolve({
    branch: 'bootstrap/utv2-1619-support',
    title: 'UTV2-1619: bootstrap identity support',
    commits: 'UTV2-1619 bootstrap support\n---commit---\nchore: also UTV2-1686',
  });
  assert.equal(code, EXIT_RECOGNIZED_INVALID);
  assert.equal(decision?.code, 'branch_issue_mismatch');
});
